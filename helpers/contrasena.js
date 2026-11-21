import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { Op } from 'sequelize';
import db from '../config/bd.js';
import { Usuarios, RecuperacionContrasena } from '../models/index.js';
import { enviarRecuperacionContrasena } from './mailRecuperarContrasena.js';

// Recuperar y cambiar contraseña: la única copia de las reglas. La usan "Olvidé mi
// contraseña", "Restablecer" y "Cambiar contraseña" (controller/loginControllers.js), y la
// edición de un empleado para no dejar la contraseña inicial desfasada (adminControllers.js).
//
// El hash lo pone siempre el hook beforeUpdate de Usuarios (CLAUDE.md §5.2), que además
// fecha passwordCambiadoEn: eso cierra las sesiones abiertas con la contraseña anterior.

export const MINUTOS_ENLACE = 30;
export const LARGO_MINIMO = 8;
const MAX_BYTES_BCRYPT = 72;   // bcrypt ignora lo que pase de 72 bytes: se rechaza en vez de truncar en silencio

/** Una cuenta con password '0' o vacío está bloqueada (empleado no activo): no se recupera. */
export const cuentaBloqueada = (usuario) => !usuario?.password || usuario.password === '0';

/** SHA-256 del token: es lo único que se guarda. */
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;   // 32 bytes en base64url
export const tokenConFormato = (token) => TOKEN_RE.test(String(token || ''));

/** Error para el formulario, o null si la contraseña nueva sirve. */
export function validarNuevaContrasena({ nueva, confirmacion, email }) {
    const n = String(nueva ?? '');
    if (n.length < LARGO_MINIMO) return `La contraseña debe tener al menos ${LARGO_MINIMO} caracteres.`;
    if (Buffer.byteLength(n, 'utf8') > MAX_BYTES_BCRYPT) return 'La contraseña es demasiado larga (máximo 72 caracteres).';
    if (n.trim() !== n) return 'La contraseña no puede empezar ni terminar con espacios.';
    if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(n) || !/\d/.test(n)) return 'Usa al menos una letra y un número.';
    if (email && n.toLowerCase() === String(email).trim().toLowerCase()) return 'La contraseña no puede ser tu correo.';
    if (n !== String(confirmacion ?? '')) return 'Las dos contraseñas no coinciden.';
    return null;
}

/**
 * "Olvidé mi contraseña". No devuelve nada a propósito: el controlador responde lo mismo
 * exista o no la cuenta (no se puede averiguar quién tiene usuario). El motivo queda en el log.
 * Pedir un enlace nuevo anula los anteriores sin usar del mismo usuario.
 */
export async function solicitarRecuperacion({ correo, ip }) {
    const email = String(correo || '').trim().toLowerCase();
    const usuario = await Usuarios.findOne({ where: { emailUsuario: email } });
    if (!usuario) { console.info(`[recuperar] correo sin cuenta · ip=${ip} · correo=${email}`); return; }
    if (cuentaBloqueada(usuario)) { console.info(`[recuperar] cuenta bloqueada, no se envía · ip=${ip} · correo=${email}`); return; }

    const token = randomBytes(32).toString('base64url');
    await db.transaction(async (transaction) => {
        await RecuperacionContrasena.update(
            { estado: 'anulado' },
            { where: { idUsuario: usuario.idUsuario, estado: 'pendiente' }, transaction }
        );
        await RecuperacionContrasena.create({
            idUsuario: usuario.idUsuario,
            tokenHash: hashToken(token),
            expiraEn: new Date(Date.now() + MINUTOS_ENLACE * 60 * 1000),
            ipSolicitud: String(ip || '').slice(0, 64)
        }, { transaction });
    });

    // Después del commit (CLAUDE.md §9): si el correo falla, el enlace existe igual y se
    // puede pedir otro. enviarCorreoSes nunca lanza.
    const enviado = await enviarRecuperacionContrasena({ to: usuario.emailUsuario, nombre: usuario.nombreUsuario, token, minutos: MINUTOS_ENLACE });
    console.info(`[recuperar] enlace ${enviado ? 'enviado' : 'NO enviado (SES)'} · ip=${ip} · correo=${email}`);
}

/** El enlace vigente de ese token (con su usuario), o null. Solo lectura: para pintar el formulario. */
export async function enlaceVigente(token) {
    if (!tokenConFormato(token)) return null;
    const enlace = await RecuperacionContrasena.findOne({
        where: { tokenHash: hashToken(token), estado: 'pendiente', expiraEn: { [Op.gt]: new Date() } },
        include: [{ model: Usuarios, as: 'usuario', attributes: ['idUsuario', 'emailUsuario', 'nombreUsuario', 'password'] }]
    });
    return enlace && !cuentaBloqueada(enlace.usuario) ? enlace : null;
}

/**
 * Pone la contraseña nueva con un enlace. El enlace se gasta con un update condicionado al
 * estado 'pendiente' (CLAUDE.md §9): dos envíos a la vez no pueden usarlo dos veces.
 * Devuelve `{ usuario }` o `{ error, vencido }`.
 */
export async function restablecerConToken({ token, nueva, confirmacion, ip }) {
    if (!tokenConFormato(token)) return { error: 'El enlace no es válido.', vencido: true };
    return db.transaction(async (transaction) => {
        const enlace = await RecuperacionContrasena.findOne({
            where: { tokenHash: hashToken(token), estado: 'pendiente', expiraEn: { [Op.gt]: new Date() } },
            transaction, lock: transaction.LOCK.UPDATE
        });
        if (!enlace) return { error: 'El enlace ya se usó o venció. Pide uno nuevo.', vencido: true };
        const usuario = await Usuarios.findByPk(enlace.idUsuario, { transaction, lock: transaction.LOCK.UPDATE });
        if (!usuario || cuentaBloqueada(usuario)) return { error: 'El enlace ya se usó o venció. Pide uno nuevo.', vencido: true };

        const error = validarNuevaContrasena({ nueva, confirmacion, email: usuario.emailUsuario });
        if (error) return { error };

        const [filas] = await RecuperacionContrasena.update(
            { estado: 'usado', usadoEn: new Date(), ipUso: String(ip || '').slice(0, 64) },
            { where: { idRecuperacion: enlace.idRecuperacion, estado: 'pendiente' }, transaction }
        );
        if (filas !== 1) return { error: 'El enlace ya se usó o venció. Pide uno nuevo.', vencido: true };

        usuario.password = nueva;   // el hook hashea y fecha passwordCambiadoEn
        await usuario.save({ transaction });
        return { usuario };
    });
}

/** "Cambiar contraseña" con la sesión abierta: exige la actual. Devuelve `{ usuario }` o `{ error, actualMal }`. */
export async function cambiarContrasena({ idUsuario, actual, nueva, confirmacion }) {
    const usuario = await Usuarios.findByPk(idUsuario);
    if (!usuario || !(await usuario.checkPassword(String(actual ?? '')))) return { error: 'La contraseña actual no es correcta.', actualMal: true };
    const error = validarNuevaContrasena({ nueva, confirmacion, email: usuario.emailUsuario });
    if (error) return { error };
    if (await bcrypt.compare(String(nueva), usuario.password)) return { error: 'La contraseña nueva tiene que ser distinta de la actual.' };
    usuario.password = nueva;
    await usuario.save();
    return { usuario };
}

/**
 * La contraseña inicial de un empleado es su documento. Si se corrige el documento y la
 * persona nunca cambió esa contraseña, la contraseña pasa al documento nuevo — si no, queda
 * esperando el documento mal escrito y nadie lo sabe. Si ya la cambió, no se toca.
 * Va dentro de la transacción de la edición. Devuelve true si la actualizó.
 */
export async function sincronizarContrasenaInicial({ idUsuario, documentoAnterior, documentoNuevo, transaction }) {
    if (!idUsuario || !documentoNuevo || documentoAnterior === documentoNuevo) return false;
    const usuario = await Usuarios.findByPk(idUsuario, { transaction, lock: transaction?.LOCK.UPDATE });
    if (!usuario || cuentaBloqueada(usuario)) return false;
    if (!(await bcrypt.compare(String(documentoAnterior ?? ''), usuario.password))) return false;
    usuario.password = documentoNuevo;
    await usuario.save({ transaction });
    return true;
}
