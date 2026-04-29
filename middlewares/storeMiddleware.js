import { Empleados, PuntosDeVenta } from '../models/index.js';

export const cargarPuntoDeVenta = async (req, res, next) => {
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
    } catch (_) {}
    next();
};
