import { Op } from 'sequelize';
import { Empleados, PuntosDeVenta, CajaTienda } from '../models/index.js';

const API_PATH = /\/(json|sse|pdf|api)\//;

export const cargarPuntoDeVenta = async (req, res, next) => {
    // Valor seguro por defecto: sin caja (muestra modal) a menos que se confirme que hay una abierta hoy
    res.locals.sinCaja = false;

    try {
        const empleado = await Empleados.findOne({
            where: { idUsuario: req.usuario.idUsuario },
            attributes: ['idEmpleado', 'idPuntoDeVenta', 'PrimerNombre', 'PrimerApellido'],
            include: [{ model: PuntosDeVenta, as: 'sede', attributes: ['nombreComercial'] }]
        });
        req.empleado              = empleado || null;
        req.idPuntoDeVenta        = empleado?.idPuntoDeVenta || null;
        res.locals.idPuntoDeVenta = req.idPuntoDeVenta;
        res.locals.nombreTienda   = empleado?.sede?.nombreComercial || null;

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
        // En caso de error, se asume sin caja para forzar apertura
        res.locals.sinCaja = true;
    }
    next();
};
