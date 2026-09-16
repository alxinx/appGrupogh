import { UserPermisos, PermisosRecursos, PermisosAcciones } from '../models/index.js';
import { empleadoDeLaSesion, usuarioTieneEmpleado, MENSAJE_SIN_EMPLEADO } from './verificarCodigoEmpleadoAdmin.js';

// Cache en memoria de IDs de recursos y acciones (son datos estáticos seeded).
// Evita re-queries en cada request.
const _cache = new Map();

// Exportado para reutilizar el cache en otros middlewares (ej. verificarPermisoSesion).
export const resolverIds = async (nombreRecurso, tipo, nombreAccion) => {
    const key = `${nombreRecurso}|${tipo}|${nombreAccion}`;
    if (_cache.has(key)) return _cache.get(key);

    const [recurso, accion] = await Promise.all([
        PermisosRecursos.findOne({ where: { nombreRecurso, tipo }, attributes: ['idRecurso'], raw: true }),
        PermisosAcciones.findOne({ where: { nombreAccion },        attributes: ['idAccion'],  raw: true })
    ]);

    if (!recurso || !accion) return null;
    const ids = { idRecurso: recurso.idRecurso, idAccion: accion.idAccion };
    _cache.set(key, ids);
    return ids;
};

// Factory: devuelve un middleware Express.
// Uso: verificarPermisoEmpleado('Traslados', 'vendedor', 'CREATE')
// Requiere que verificarCodigoEmpleado haya corrido antes (req.empleadoVerificado.idUsuario).
const verificarPermisoEmpleado = (nombreRecurso, tipo, nombreAccion) => async (req, res, next) => {
    const idUsuario = req.empleadoVerificado?.idUsuario;
    if (!idUsuario)
        return res.status(403).json({ success: false, mensaje: 'El empleado no tiene acceso al sistema.' });

    try {
        const ids = await resolverIds(nombreRecurso, tipo, nombreAccion);
        if (!ids)
            return res.status(500).json({ success: false, mensaje: 'Configuración de permisos inválida.' });

        const permiso = await UserPermisos.findOne({
            where: { idUsuario, idRecurso: ids.idRecurso, idAccion: ids.idAccion },
            attributes: ['idPermiso']
        });

        if (!permiso)
            return res.status(403).json({
                success: false,
                mensaje: `El empleado no tiene permiso para realizar esta acción.`
            });

        next();
    } catch (e) {
        console.error('verificarPermisoEmpleado:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

// Handler GET que comprueba un código ANTES de una acción del panel, para no habilitar un
// botón que el servidor va a rechazar. Aplica lo mismo que después exigen
// verificarCodigoEmpleadoAdmin + verificarPermisoEmpleado. No es un oráculo de códigos: vive
// detrás de verificarRol('ADMIN'), y un administrador ya ve en Personal quién tiene cada
// permiso. Montarlo detrás de apiRateLimit.
export const validarCodigoConPermiso = (nombreRecurso, tipo, nombreAccion, mensajeSinPermiso) => async (req, res) => {
    const codigo = String(req.params.codigo || '').trim().toUpperCase();
    if (!codigo) return res.status(400).json({ success: false, mensaje: 'Código requerido.' });

    try {
        // Mismo criterio que verificarCodigoEmpleadoAdmin: solo vale el código de quien tiene la
        // sesión. Si no, este GET servía para averiguar de quién es cualquier código.
        const idUsuarioSesion = req.usuario?.idUsuario;
        const empleado = await empleadoDeLaSesion(codigo, idUsuarioSesion);
        if (!empleado) {
            const mensaje = (await usuarioTieneEmpleado(idUsuarioSesion)) ? 'Código de empleado inválido.' : MENSAJE_SIN_EMPLEADO;
            return res.json({ success: false, mensaje });
        }

        const ids = await resolverIds(nombreRecurso, tipo, nombreAccion);
        if (!ids) return res.status(500).json({ success: false, mensaje: 'Configuración de permisos inválida.' });

        const permiso = await UserPermisos.findOne({
            where: { idUsuario: empleado.idUsuario, idRecurso: ids.idRecurso, idAccion: ids.idAccion },
            attributes: ['idPermiso']
        });
        if (!permiso) return res.json({ success: false, mensaje: mensajeSinPermiso });

        return res.json({ success: true, nombre: `${empleado.PrimerNombre} ${empleado.PrimerApellido}`.trim() });
    } catch (e) {
        console.error(`validarCodigoConPermiso(${nombreRecurso}):`, e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

export default verificarPermisoEmpleado;
