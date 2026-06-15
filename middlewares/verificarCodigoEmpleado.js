import { Empleados } from '../models/index.js';

// Contador en memoria: userId → { count, primeraFalla (timestamp) }
const _intentos  = new Map();
const MAX        = 5;
const VENTANA_MS = 15 * 60 * 1000; // 15 minutos desde la primera falla

const _logout = (res, mensaje) => {
    res.clearCookie('_token');
    return res.status(401).json({ success: false, mensaje, logout: true });
};

const verificarCodigoEmpleado = async (req, res, next) => {
    const idPdv  = req.idPuntoDeVenta;
    const userId = req.usuario?.idUsuario;

    if (!idPdv || !userId)
        return res.status(403).json({ success: false, mensaje: 'Sin punto de venta asignado.' });

    const codigo = String(req.body?.codigoEmpleado || '').trim().toUpperCase();
    if (!codigo)
        return res.status(400).json({ success: false, mensaje: 'Código de empleado requerido.' });

    // ── Verificar si ya está bloqueado ──────────────────────────────────────
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
            where: { codigoEmpleado: codigo, idPuntoDeVenta: idPdv },
            attributes: ['idEmpleado', 'idUsuario', 'PrimerNombre', 'PrimerApellido', 'codigoEmpleado']
        });

        if (!empleado) {
            const actual = reg ?? { count: 0, primeraFalla: Date.now() };
            actual.count++;
            _intentos.set(userId, actual);

            if (actual.count >= MAX)
                return _logout(res, 'Demasiados intentos fallidos. Tu sesión ha sido cerrada por seguridad.');

            const restantes = MAX - actual.count;
            return res.status(400).json({
                success: false,
                mensaje: `El empleado no pertenece a esta tienda. Te queda${restantes !== 1 ? 'n' : ''} ${restantes} intento${restantes !== 1 ? 's' : ''}.`
            });
        }

        // ── Éxito: resetear contador e inyectar datos en req ────────────────
        _intentos.delete(userId);
        req.empleadoVerificado = {
            idEmpleado:     empleado.idEmpleado,
            idUsuario:      empleado.idUsuario || null,
            nombre:         `${empleado.PrimerNombre} ${empleado.PrimerApellido}`.trim(),
            codigoEmpleado: empleado.codigoEmpleado
        };
        next();

    } catch (e) {
        console.error('verificarCodigoEmpleado:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

export default verificarCodigoEmpleado;
