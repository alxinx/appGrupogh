import { UserPermisos, PermisosRecursos, PermisosAcciones } from '../models/index.js';

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

export default verificarPermisoEmpleado;
