import { Empleados } from '../models/index.js';

export const cargarPuntoDeVenta = async (req, res, next) => {
    try {
        const empleado = await Empleados.findOne({
            where: { idUsuario: req.usuario.idUsuario },
            attributes: ['idEmpleado', 'idPuntoDeVenta', 'PrimerNombre', 'PrimerApellido']
        });
        req.empleado       = empleado || null;
        req.idPuntoDeVenta = empleado?.idPuntoDeVenta || null;
        res.locals.idPuntoDeVenta = req.idPuntoDeVenta;
    } catch (_) {}
    next();
};
