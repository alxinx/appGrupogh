import crypto from 'crypto';
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import db from '../config/bd.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { Entidades, EntidadesQrHistorial, Usuarios } from '../models/index.js';
import {
    prefiltrarImagenQr, verificarQrLegible, convertirAWebp, sha256, construirObjectKey
} from '../helpers/qrPago.js';
import { notificarQrActualizado, notificarQrComprometido } from '../helpers/notificarQrPago.js';

// Solo estos tipos pueden recibir pagos por QR; una tarjeta de crédito o una entidad
// crediticia no tienen un QR de recaudo que mostrarle al comprador.
const TIPOS_CON_QR = ['Banco', 'Billetera Virtual'];

const EXPIRACION_URL_SEG   = parseInt(process.env.QR_URL_TTL_SEG) || 600; // 10 min
const CACHE_INTEGRIDAD_MS  = 5 * 60 * 1000;

// Cache de verificaciones de integridad exitosas: Map<objectKey, vencimiento>.
// Evita descargar el objeto en cada vista del checkout. Los resultados negativos
// NUNCA se cachean — un hash que no coincide se actúa de inmediato, siempre.
const integridadOk = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// PANEL ADMIN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /admin/bankentities/:idEntidad/qr
 * Sube y reemplaza el QR de pago de una entidad. Ver el orden del flujo abajo:
 * nada toca R2 hasta que se confirmó que la imagen contiene un QR legible.
 */
const subirQrEntidad = async (req, res) => {
    const { idEntidad } = req.params;

    try {
        const entidad = await Entidades.findByPk(idEntidad);
        if (!entidad)
            return res.status(404).json({ success: false, mensaje: 'Entidad no encontrada.' });

        if (!TIPOS_CON_QR.includes(entidad.tipoEntidad))
            return res.status(422).json({ success: false, mensaje: 'Esta entidad no admite pagos por QR.' });

        if (!req.file?.buffer?.length)
            return res.status(422).json({ success: false, mensaje: 'No se recibió ninguna imagen.' });

        // 1 — Pre-filtro barato: magic bytes, peso, resolución.
        const prefiltro = await prefiltrarImagenQr(req.file.buffer);
        if (!prefiltro.ok)
            return res.status(422).json({ success: false, mensaje: prefiltro.mensaje });

        // 2 — ¿Hay realmente un QR legible? Si no, se corta acá: no se convierte
        //     a WebP ni se sube nada a R2.
        const lectura = await verificarQrLegible(req.file.buffer);
        if (!lectura.ok)
            return res.status(422).json({ success: false, mensaje: lectura.mensaje });

        // 3 — Recién ahora se paga la conversión del archivo real.
        const webp = await convertirAWebp(req.file.buffer);

        // 4 — Hash del archivo final, que es el que se sube y el que se verifica después.
        const hash = sha256(webp);

        // 5 — Subida al bucket privado. El timestamp en la ruta evita pisar la versión
        //     anterior: queda disponible para auditoría hasta que se limpie.
        const objectKey = construirObjectKey(entidad.idEntidad);
        await r2PrivateClient.send(new PutObjectCommand({
            Bucket:       R2_PRIVATE_BUCKET,
            Key:          objectKey,
            Body:         webp,
            ContentType:  'image/webp',
            CacheControl: 'no-store',
            Metadata:     { sha256: hash, identidad: String(entidad.idEntidad) }
        }));

        const habilitar = req.body?.qrEnabled === true || req.body?.qrEnabled === 'true';
        const ahora     = new Date();
        const keyAnterior = entidad.qrObjectKey;

        // 6 y 7 — El historial del QR anterior y la actualización de la entidad son
        //         una sola operación: o queda todo, o no queda nada.
        await db.transaction(async (t) => {
            if (keyAnterior) {
                await EntidadesQrHistorial.create({
                    idEntidad:    entidad.idEntidad,
                    qrObjectKey:  keyAnterior,
                    qrHashSha256: entidad.qrHashSha256,
                    qrStatus:     'replaced',
                    motivo:       'reemplazo',
                    idUsuario:    req.usuario?.idUsuario || null,
                    detalle:      `Reemplazado por ${objectKey}`
                }, { transaction: t });
            }

            await Entidades.update({
                qrObjectKey:  objectKey,
                qrHashSha256: hash,
                qrEnabled:    habilitar,
                qrUploadedAt: ahora,
                qrUploadedBy: req.usuario?.idUsuario || null,
                qrStatus:     'active'
            }, { where: { idEntidad: entidad.idEntidad }, transaction: t });

            await EntidadesQrHistorial.create({
                idEntidad:    entidad.idEntidad,
                qrObjectKey:  objectKey,
                qrHashSha256: hash,
                qrStatus:     'active',
                motivo:       keyAnterior ? 'reemplazo' : 'subida',
                idUsuario:    req.usuario?.idUsuario || null,
                detalle:      habilitar ? 'Habilitado para checkout' : 'Cargado sin habilitar'
            }, { transaction: t });
        });

        if (keyAnterior) {
            console.warn(`[qr-pago] Entidad ${entidad.idEntidad} (${entidad.nombreEntidad}): QR ${keyAnterior} reemplazado por ${objectKey} — usuario ${req.usuario?.idUsuario || 'desconocido'}`);
        }
        integridadOk.delete(keyAnterior);

        // 8 — Aviso al operador. Best-effort: ya está persistido, un fallo de correo
        //     no revierte la subida.
        notificarQrActualizado({
            nombreEntidad: entidad.nombreEntidad,
            usuario:       req.usuario,
            fecha:         ahora,
            reemplazo:     !!keyAnterior
        }).catch(e => console.error('[qr-pago] aviso de actualización:', e.message));

        return res.json({
            success: true,
            mensaje: habilitar
                ? 'QR verificado y publicado en el checkout.'
                : 'QR verificado y guardado. Actívalo cuando quieras publicarlo.',
            qr: {
                qrEnabled:    habilitar,
                qrStatus:     'active',
                qrUploadedAt: ahora
            }
        });

    } catch (e) {
        console.error('subirQrEntidad:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al procesar el QR.' });
    }
};

/**
 * POST /admin/bankentities/:idEntidad/qr/toggle
 * Enciende o apaga el QR sin volver a subir la imagen.
 */
const toggleQrEntidad = async (req, res) => {
    const { idEntidad } = req.params;
    try {
        const habilitar = req.body?.qrEnabled === true || req.body?.qrEnabled === 'true';

        const entidad = await Entidades.findByPk(idEntidad);
        if (!entidad)
            return res.status(404).json({ success: false, mensaje: 'Entidad no encontrada.' });

        if (!TIPOS_CON_QR.includes(entidad.tipoEntidad))
            return res.status(422).json({ success: false, mensaje: 'Esta entidad no admite pagos por QR.' });

        // No se puede publicar lo que no existe o lo que ya se marcó como comprometido.
        if (habilitar && !entidad.qrObjectKey)
            return res.status(422).json({ success: false, mensaje: 'Primero sube una imagen de QR.' });

        if (habilitar && entidad.qrStatus === 'compromised')
            return res.status(409).json({ success: false, mensaje: 'Este QR está marcado como comprometido. Sube uno nuevo para reemplazarlo.' });

        await Entidades.update({ qrEnabled: habilitar }, { where: { idEntidad } });

        if (!habilitar) {
            await EntidadesQrHistorial.create({
                idEntidad:    entidad.idEntidad,
                qrObjectKey:  entidad.qrObjectKey || '(sin archivo)',
                qrHashSha256: entidad.qrHashSha256,
                qrStatus:     entidad.qrStatus || 'active',
                motivo:       'deshabilitado',
                idUsuario:    req.usuario?.idUsuario || null,
                detalle:      'Switch apagado desde el panel'
            });
        }

        return res.json({ success: true, qrEnabled: habilitar });
    } catch (e) {
        console.error('toggleQrEntidad:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar el estado del QR.' });
    }
};

/**
 * GET /admin/bankentities/:idEntidad/qr
 * Vista previa para el admin. Devuelve una URL firmada de corta vida, igual que el
 * endpoint público: el object key nunca sale del backend.
 */
const previewQrEntidad = async (req, res) => {
    const { idEntidad } = req.params;
    try {
        const entidad = await Entidades.findByPk(idEntidad, {
            include: [{ model: Usuarios, as: 'qrAutor', attributes: ['nombreUsuario', 'apellidoUsuario', 'emailUsuario'], required: false }]
        });
        if (!entidad)
            return res.status(404).json({ success: false, mensaje: 'Entidad no encontrada.' });

        if (!entidad.qrObjectKey)
            return res.json({ success: true, tieneQr: false });

        const url = await firmarUrl(entidad.qrObjectKey);

        return res.json({
            success:      true,
            tieneQr:      true,
            url,
            expiraEnSeg:  EXPIRACION_URL_SEG,
            qrEnabled:    entidad.qrEnabled,
            qrStatus:     entidad.qrStatus,
            qrUploadedAt: entidad.qrUploadedAt,
            subidoPor:    entidad.qrAutor
                ? `${entidad.qrAutor.nombreUsuario || ''} ${entidad.qrAutor.apellidoUsuario || ''}`.trim() || entidad.qrAutor.emailUsuario
                : null
        });
    } catch (e) {
        console.error('previewQrEntidad:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al obtener el QR.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// API PÚBLICA — CHECKOUT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/web/pagos/qr
 * Entidades que hoy ofrecen pago por QR. Solo datos de presentación.
 */
const listarEntidadesQrPublico = async (req, res) => {
    try {
        const entidades = await Entidades.findAll({
            where: { qrEnabled: true, qrStatus: 'active' },
            attributes: ['idEntidad', 'nombreEntidad', 'tipoEntidad'],
            order: [['nombreEntidad', 'ASC']],
            raw: true
        });
        return res.json({ success: true, entidades });
    } catch (e) {
        console.error('listarEntidadesQrPublico:', e);
        return res.status(500).json({ success: false, mensaje: 'No fue posible cargar los métodos de pago.' });
    }
};

/**
 * GET /api/web/pagos/qr/:idEntidad
 * Devuelve una URL firmada de corta vida para mostrar el QR en el checkout.
 * Nunca devuelve el object key ni credenciales.
 */
const getQrPagoPublico = async (req, res) => {
    const { idEntidad } = req.params;

    // Respuesta única para todos los casos de "no disponible": el cliente no tiene
    // por qué distinguir entre entidad inexistente, QR apagado o QR comprometido.
    const noDisponible = () => res.status(404).json({
        success: false,
        mensaje: 'Este método de pago no está disponible en este momento.'
    });

    try {
        if (!/^\d+$/.test(String(idEntidad))) return noDisponible();

        const entidad = await Entidades.findByPk(idEntidad);
        if (!entidad || !entidad.qrEnabled || entidad.qrStatus !== 'active' || !entidad.qrObjectKey)
            return noDisponible();

        const integro = await verificarIntegridad(entidad);
        if (!integro) return noDisponible();

        const url = await firmarUrl(entidad.qrObjectKey);

        return res.json({
            success: true,
            entidad: { idEntidad: entidad.idEntidad, nombreEntidad: entidad.nombreEntidad, tipoEntidad: entidad.tipoEntidad },
            qr:      { url, expiraEnSeg: EXPIRACION_URL_SEG }
        });
    } catch (e) {
        console.error('getQrPagoPublico:', e);
        return res.status(500).json({ success: false, mensaje: 'No fue posible cargar el QR de pago.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAS
// ─────────────────────────────────────────────────────────────────────────────

/** Presigned URL de lectura, de vida corta. El bucket es privado: no hay otra vía. */
async function firmarUrl(objectKey) {
    return getSignedUrl(
        r2PrivateClient,
        new GetObjectCommand({ Bucket: R2_PRIVATE_BUCKET, Key: objectKey }),
        { expiresIn: EXPIRACION_URL_SEG }
    );
}

/**
 * Descarga el objeto y recalcula su SHA-256 contra el guardado en la fila.
 * Si no coincide, el QR se marca 'compromised', se apaga y se alerta al operador.
 *
 * El ETag de R2 no sirve para esto (es un MD5, y en multipart ni eso), así que la
 * verificación honesta es rehacer el hash. Los aciertos se cachean unos minutos para
 * no descargar el archivo en cada visita al checkout; los fallos nunca se cachean.
 */
async function verificarIntegridad(entidad) {
    const { qrObjectKey, qrHashSha256 } = entidad;
    if (!qrHashSha256) return true; // nada contra qué comparar (QR previo a esta verificación)

    const vence = integridadOk.get(qrObjectKey);
    if (vence && vence > Date.now()) return true;

    let hashReal;
    try {
        const objeto = await r2PrivateClient.send(new GetObjectCommand({
            Bucket: R2_PRIVATE_BUCKET,
            Key:    qrObjectKey
        }));

        const hasher = crypto.createHash('sha256');
        for await (const trozo of objeto.Body) hasher.update(trozo);
        hashReal = hasher.digest('hex');
    } catch (e) {
        // Un fallo de red contra R2 no es evidencia de manipulación: no se marca
        // comprometido, solo no se sirve el QR en esta petición.
        console.error(`[qr-pago] No se pudo verificar la integridad de ${qrObjectKey}:`, e.message);
        return false;
    }

    if (hashReal === qrHashSha256) {
        integridadOk.set(qrObjectKey, Date.now() + CACHE_INTEGRIDAD_MS);
        return true;
    }

    await marcarComprometido(entidad, `El hash del archivo en R2 (${hashReal.slice(0, 12)}…) no coincide con el registrado (${qrHashSha256.slice(0, 12)}…)`);
    return false;
}

/**
 * Marca el QR como comprometido y lo saca de circulación.
 * El update es condicional al estado 'active' y se revisa el número de filas afectadas:
 * si dos peticiones concurrentes detectan lo mismo, solo una alerta al operador.
 */
async function marcarComprometido(entidad, motivo) {
    try {
        const [filas] = await Entidades.update(
            { qrStatus: 'compromised', qrEnabled: false },
            { where: { idEntidad: entidad.idEntidad, qrStatus: 'active' } }
        );

        integridadOk.delete(entidad.qrObjectKey);
        if (!filas) return; // otra petición ya lo marcó y ya notificó

        await EntidadesQrHistorial.create({
            idEntidad:    entidad.idEntidad,
            qrObjectKey:  entidad.qrObjectKey,
            qrHashSha256: entidad.qrHashSha256,
            qrStatus:     'compromised',
            motivo:       'hash_no_coincide',
            idUsuario:    null,
            detalle:      motivo.slice(0, 255)
        });

        console.error(`[qr-pago] ALERTA: entidad ${entidad.idEntidad} (${entidad.nombreEntidad}) marcada como comprometida. ${motivo}`);

        notificarQrComprometido({
            nombreEntidad: entidad.nombreEntidad,
            idEntidad:     entidad.idEntidad,
            motivo
        }).catch(e => console.error('[qr-pago] aviso de compromiso:', e.message));
    } catch (e) {
        console.error('marcarComprometido:', e);
    }
}

export {
    subirQrEntidad,
    toggleQrEntidad,
    previewQrEntidad,
    listarEntidadesQrPublico,
    getQrPagoPublico,
};
