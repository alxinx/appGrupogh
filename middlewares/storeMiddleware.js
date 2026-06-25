import { Op } from 'sequelize';
import { Empleados, PuntosDeVenta, CajaTienda, UserPermisos, PermisosRecursos, PermisosAcciones } from '../models/index.js';

const API_PATH = /\/(json|sse|pdf|api)\//;

// Prefijos de rutas de página dentro de /store que están protegidas por recursos
const PAGINAS_PREFIJOS = ['/traslados', '/inventario', '/storebehivors'];

const esRutaPagina = (path) =>
    path === '/' || PAGINAS_PREFIJOS.some(p => path === p || path.startsWith(p + '/'));

export const cargarPuntoDeVenta = async (req, res, next) => {
    res.locals.sinCaja            = false;
    res.locals.carpetasPermitidas = [];
    res.locals.puedeFacturar      = false;

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

        if (req.method === 'GET' && !API_PATH.test(req.path)) {

            // ── Verificar caja del día ────────────────────────────────────────
            if (req.idPuntoDeVenta) {
                const inicioDia = new Date();
                inicioDia.setHours(0, 0, 0, 0);
                const caja = await CajaTienda.findOne({
                    where: {
                        idPuntoDeVenta: req.idPuntoDeVenta,
                        estado: 'abierto',
                        fechaCierre: null,
                        [Op.or]: [
                            { fechaApertura: { [Op.gte]: inicioDia } },
                            { permite_factura_extemporanea: true }
                        ]
                    },
                    attributes: ['idCajaTienda', 'permite_factura_extemporanea']
                });
                res.locals.sinCaja = !caja;
            }

            // ── Permisos de recursos (solo rutas de página) ───────────────────
            if (esRutaPagina(req.path)) {
                const rows = await UserPermisos.findAll({
                    where: { idUsuario: req.usuario.idUsuario },
                    include: [
                        {
                            model: PermisosRecursos,
                            as: 'recurso',
                            where: { tipo: 'vendedor', folder: { [Op.not]: null } },
                            attributes: ['folder']
                        },
                        {
                            model: PermisosAcciones,
                            as: 'accion',
                            attributes: ['nombreAccion']
                        }
                    ],
                    attributes: [],
                    raw: true
                });

                const carpetasPermitidas = [...new Set(
                    rows.map(r => r['recurso.folder']).filter(Boolean)
                )];
                res.locals.carpetasPermitidas = carpetasPermitidas;
                res.locals.puedeFacturar      = rows.some(
                    r => r['recurso.folder'] === '/' && r['accion.nombreAccion'] === 'CREATE'
                );

                const tieneAcceso = carpetasPermitidas.some(folder =>
                    folder === '/'
                        ? req.path === '/'
                        : req.path === folder || req.path.startsWith(folder + '/')
                );

                if (!tieneAcceso) {
                    // Sin ningún permiso: cerrar sesión
                    if (!carpetasPermitidas.length) {
                        res.clearCookie('_token');
                        return res.redirect('/');
                    }
                    // Redirigir a la primera carpeta accesible
                    const primero = carpetasPermitidas[0];
                    return res.redirect('/store' + (primero === '/' ? '/' : primero + '/'));
                }
            }
        }
    } catch (e) {
        console.error('[storeMiddleware] error:', e.message);
        res.locals.sinCaja = true;
    }
    next();
};
