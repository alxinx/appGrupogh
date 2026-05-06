import { Op } from 'sequelize';
import { Empleados, PuntosDeVenta, CajaTienda, UserPermisos, PermisosRecursos } from '../models/index.js';

const API_PATH = /\/(json|sse|pdf|api)\//;

export const cargarPuntoDeVenta = async (req, res, next) => {
    res.locals.sinCaja      = false;
    res.locals.menuRecursos = null; // null = sin restricción (mostrar todo)

    try {
        const [empleado, permisosRaw] = await Promise.all([
            Empleados.findOne({
                where: { idUsuario: req.usuario.idUsuario },
                attributes: ['idEmpleado', 'idPuntoDeVenta', 'PrimerNombre', 'PrimerApellido'],
                include: [{ model: PuntosDeVenta, as: 'sede', attributes: ['nombreComercial'] }]
            }),
            UserPermisos.findAll({
                where: { idUsuario: req.usuario.idUsuario },
                attributes: ['idRecurso'],
                raw: true
            })
        ]);

        req.empleado              = empleado || null;
        req.idPuntoDeVenta        = empleado?.idPuntoDeVenta || null;
        res.locals.idPuntoDeVenta = req.idPuntoDeVenta;
        res.locals.nombreTienda   = empleado?.sede?.nombreComercial || null;
        res.locals.idUsuario      = req.usuario.idUsuario;

        // Si el usuario tiene permisos definidos, construir el Set de recursos
        if (permisosRaw.length > 0) {
            const ids = [...new Set(permisosRaw.map(p => p.idRecurso))];
            const recursos = await PermisosRecursos.findAll({
                where: { idRecurso: { [Op.in]: ids } },
                attributes: ['nombreRecurso'],
                raw: true
            });
            res.locals.menuRecursos = new Set(recursos.map(r => r.nombreRecurso));
        }

        if (req.method === 'GET' && !API_PATH.test(req.path) && req.idPuntoDeVenta) {
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);

            const caja = await CajaTienda.findOne({
                where: {
                    idPuntoDeVenta: req.idPuntoDeVenta,
                    estado: 'abierto',
                    fechaApertura: { [Op.gte]: hoy },
                    fechaCierre: null
                },
                attributes: ['idCajaTienda']
            });
            res.locals.sinCaja = !caja;
        }
    } catch (e) {
        console.error('[storeMiddleware] error al verificar caja:', e.message);
        res.locals.sinCaja = true;
    }
    next();
};
