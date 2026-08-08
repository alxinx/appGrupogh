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
        const empleado = await Empleados.findOne({
            where: { codigoEmpleado: codigo },
            attributes: ['idEmpleado', 'idUsuario', 'PrimerNombre', 'PrimerApellido', 'codigoEmpleado', 'estado']
        });

        // Se bloquea a quien ya no es de confianza, no a quien está de licencia: alguien
        // en vacaciones puede estar cubriendo un turno. El mensaje es el mismo que para un
        // código inexistente — no se le confirma a nadie qué códigos existen.
        const habilitado = empleado && !['suspendido', 'despedido'].includes(empleado.estado);

        if (!habilitado) {
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
