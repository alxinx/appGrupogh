import { UserPermisos } from '../models/index.js';
import { resolverIds }  from './verificarPermisoEmpleado.js';

// Factory: verifica permiso del usuario de la SESIÓN (req.usuario), no del código de empleado.
// Uso: verificarPermisoSesion('Pos de venta', 'vendedor', 'CREATE')
const verificarPermisoSesion = (nombreRecurso, tipo, nombreAccion) => async (req, res, next) => {
    const idUsuario = req.usuario?.idUsuario;
    if (!idUsuario)
        return res.status(403).json({ success: false, mensaje: 'No autenticado.' });

    try {
        const ids = await resolverIds(nombreRecurso, tipo, nombreAccion);
        if (!ids)
            return res.status(500).json({ success: false, mensaje: 'Configuración de permisos inválida.' });

        const permiso = await UserPermisos.findOne({
            where: { idUsuario, idRecurso: ids.idRecurso, idAccion: ids.idAccion },
            attributes: ['idPermiso']
        });

        if (!permiso)
            return res.status(403).json({ success: false, mensaje: 'Sin permiso para realizar esta acción.' });

        next();
    } catch (e) {
        console.error('verificarPermisoSesion:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

export default verificarPermisoSesion;
