import { Empleados } from '../models/index.js';

// Segundo factor operativo para acciones sensibles del panel admin (marcar un pedido web
// como pagado, cancelarlo). Mismo patrón que verificarCodigoEmpleado.js del POS —contador
// en memoria, bloqueo tras 5 fallos en 15 min, mensaje genérico— pero sin exigir punto de
// venta: en el panel no hay uno, el código identifica a cualquier empleado activo.
//
// Igual que los otros limitadores del proyecto, el contador vive en el proceso: si la app
// llega a correr en más de una instancia, deja de ser global.

const _intentos  = new Map(); // idUsuario → { count, primeraFalla }
const MAX        = 5;
const VENTANA_MS = 15 * 60 * 1000;

const _logout = (res, mensaje) => {
    res.clearCookie('_token');
    return res.status(401).json({ success: false, mensaje, logout: true });
};

const ESTADOS_BLOQUEADOS = ['suspendido', 'despedido'];
export const MENSAJE_SIN_EMPLEADO = 'Tu usuario no está vinculado a un empleado. Pide que te vinculen en Personal para autorizar esta acción.';

/**
 * En el panel admin el código no identifica a "cualquier empleado": identifica a quien tiene la
 * sesión abierta. Se busca por código Y por el usuario logueado, así que el código de otra
 * persona no existe para esta sesión. Sin esto, un admin que puede ver Personal —donde se listan
 * los códigos— autorizaba acciones con dinero e inventario a nombre de otro empleado.
 *
 * Devuelve el empleado, o null si el código no es de esta sesión o el empleado ya no es de
 * confianza (se bloquea a suspendidos y despedidos, no a quien está de licencia).
 */
export async function empleadoDeLaSesion(codigo, idUsuario) {
    const limpio = String(codigo || '').trim().toUpperCase();
    if (!limpio || !idUsuario) return null;
    const empleado = await Empleados.findOne({
        where: { codigoEmpleado: limpio, idUsuario },
        attributes: ['idEmpleado', 'idUsuario', 'PrimerNombre', 'PrimerApellido', 'codigoEmpleado', 'estado']
    });
    return empleado && !ESTADOS_BLOQUEADOS.includes(empleado.estado) ? empleado : null;
}

// Un usuario sin ficha de empleado no tiene código propio: se le dice por qué, en vez de
// contarle intentos fallidos por algo que no puede corregir escribiendo.
export const usuarioTieneEmpleado = async (idUsuario) =>
    !!idUsuario && (await Empleados.count({ where: { idUsuario } })) > 0;

const verificarCodigoEmpleadoAdmin = async (req, res, next) => {
    const userId = req.usuario?.idUsuario;
    if (!userId) return res.status(401).json({ success: false, mensaje: 'No autorizado.' });

    const codigo = String(req.body?.codigoEmpleado || '').trim().toUpperCase();
    if (!codigo)
        return res.status(400).json({ success: false, mensaje: 'Código de empleado requerido.' });

    let reg = _intentos.get(userId);
    if (reg) {
        if (Date.now() - reg.primeraFalla > VENTANA_MS) {
            _intentos.delete(userId);
            reg = undefined;
        } else if (reg.count >= MAX) {
            return _logout(res, 'Demasiados intentos fallidos. Tu sesión ha sido cerrada por seguridad.');
        }
    }

    try {
        const empleado = await empleadoDeLaSesion(codigo, userId);

        if (!empleado && !(await usuarioTieneEmpleado(userId))) {
            return res.status(403).json({ success: false, mensaje: MENSAJE_SIN_EMPLEADO });
        }

        // El código de otra persona, uno inexistente y el de un empleado dado de baja reciben
        // el mismo mensaje y cuentan igual para el bloqueo: no se le confirma a nadie qué
        // códigos existen. El intento con un código ajeno queda en el log.
        if (!empleado) {
            if (await Empleados.count({ where: { codigoEmpleado: codigo } })) {
                console.warn(`[seguridad] El usuario ${userId} intentó autorizar ${req.method} ${req.originalUrl} con el código de otro empleado.`);
            }
            const actual = reg ?? { count: 0, primeraFalla: Date.now() };
            actual.count++;
            _intentos.set(userId, actual);

            if (actual.count >= MAX)
                return _logout(res, 'Demasiados intentos fallidos. Tu sesión ha sido cerrada por seguridad.');

            const restantes = MAX - actual.count;
            return res.status(400).json({
                success: false,
                mensaje: `Código de empleado inválido. Te queda${restantes !== 1 ? 'n' : ''} ${restantes} intento${restantes !== 1 ? 's' : ''}.`
            });
        }

        _intentos.delete(userId);
        req.empleadoVerificado = {
            idEmpleado:     empleado.idEmpleado,
            idUsuario:      empleado.idUsuario || null,
            nombre:         `${empleado.PrimerNombre} ${empleado.PrimerApellido}`.trim(),
            codigoEmpleado: empleado.codigoEmpleado
        };
        next();

    } catch (e) {
        console.error('verificarCodigoEmpleadoAdmin:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

export default verificarCodigoEmpleadoAdmin;
