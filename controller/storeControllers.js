import {
    Traslados, DetalleTraslados, PuntosDeVenta,
    Pack, DetallesPack, Productos, Stock,
    Empleados, InsidenciaTraslado
} from '../models/index.js';
import { Op } from 'sequelize';
import db from '../config/bd.js';
import { addClient, removeClient, sendEvent, broadcast } from '../helpers/sseManager.js';

// ─── PÁGINAS ────────────────────────────────────────────────────────────────

const dashboardStores = async (req, res) => {
    return res.render('./tienda/layout', {
        pagina: `Panel principal de ${req.usuario.nombreUsuario}`,
        csrfToken: req.csrfToken(),
        currentPath: req.path
    });
};

const getTraslados = async (req, res) => {
    return res.render('./tienda/traslados/getTraslados', {
        pagina: 'Traslados',
        csrfToken: req.csrfToken(),
        currentPath: '/traslados'
    });
};

// ─── SSE ────────────────────────────────────────────────────────────────────

const sseConnect = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    addClient(idPdv, res);

    // Estado inicial
    await _enviarEstado(idPdv, res);

    // Heartbeat cada 25s para mantener viva la conexión
    const hb = setInterval(() => res.write(': ping\n\n'), 25000);

    req.on('close', () => {
        clearInterval(hb);
        removeClient(idPdv, res);
    });
};

const _enviarEstado = async (idPdv, res) => {
    try {
        const pendientes = await Traslados.count({
            where: { idDestino: idPdv, estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] } }
        });
        const controversias = await Traslados.count({
            where: { idDestino: idPdv, estado: 'EN_CONTROVERSIA' }
        });
        sendEvent(res, 'state', { pendientes, controversias });
    } catch (_) {}
};

// ─── APIs JSON ───────────────────────────────────────────────────────────────

const getPendientesJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    try {
        const traslados = await Traslados.findAll({
            where: { idDestino: idPdv, estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] } },
            include: [
                { model: PuntosDeVenta, as: 'origen',  attributes: ['nombreComercial'], required: false },
                { model: PuntosDeVenta, as: 'destino', attributes: ['nombreComercial'], required: false },
            ],
            order: [['fechaEnvio', 'DESC']]
        });
        return res.json({ success: true, traslados });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ success: false });
    }
};

const getHistorialJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    const { busqueda = '', pagina = 1 } = req.query;
    const limite = parseInt(process.env.LIMIT_PER_PAGE) || 10;
    const offset = (parseInt(pagina) - 1) * limite;

    try {
        let where = {
            idDestino: idPdv,
            estado: { [Op.in]: ['RECIBIDO', 'EN_CONTROVERSIA', 'ANULADO'] }
        };
        if (busqueda.trim()) {
            where.codigoTraslado = { [Op.like]: `%${busqueda.trim()}%` };
        }

        const { count, rows } = await Traslados.findAndCountAll({
            where,
            include: [
                { model: PuntosDeVenta, as: 'destino', attributes: ['nombreComercial'] },
            ],
            order: [
                [db.literal("CASE WHEN estado = 'EN_CONTROVERSIA' THEN 0 ELSE 1 END"), 'ASC'],
                ['fechaEnvio', 'DESC']
            ],
            limit: limite,
            offset,
            distinct: true
        });

        return res.json({
            success: true,
            traslados: rows,
            totalPaginas: Math.ceil(count / limite),
            paginaActual: parseInt(pagina),
            total: count
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ success: false });
    }
};

const getDetalleTrasladoJSON = async (req, res) => {
    const { idTraslado } = req.params;
    try {
        const traslado = await Traslados.findOne({
            where: { idTraslado },
            include: [
                { model: PuntosDeVenta, as: 'destino', attributes: ['nombreComercial'] },
                {
                    model: DetalleTraslados, as: 'items',
                    include: [
                        {
                            model: Pack, as: 'pack',
                            attributes: ['codigoEtiqueta', 'estado'],
                            include: [{
                                model: DetallesPack,
                                include: [{ model: Productos, as: 'producto', attributes: ['nombreProducto', 'sku'] }]
                            }]
                        },
                        { model: Productos, as: 'producto', attributes: ['nombreProducto', 'sku'] }
                    ]
                },
                { model: InsidenciaTraslado, as: 'insidencias' }
            ]
        });
        if (!traslado) return res.status(404).json({ success: false });
        return res.json({ success: true, traslado });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ success: false });
    }
};

// ─── ACEPTAR TRASLADO ────────────────────────────────────────────────────────

const aceptarTrasladoAPI = async (req, res) => {
    const { idTraslado, codigoEmpleado, items } = req.body;
    // items: [{ idDetalleTraslado, idPack, cantidadOriginal, cantidadAceptada, aceptado, razon }]

    if (!idTraslado || !codigoEmpleado || !Array.isArray(items)) {
        return res.status(400).json({ success: false, mensaje: 'Datos incompletos.' });
    }

    // Validar empleado
    const empleado = await Empleados.findOne({
        where: { codigoEmpleado: codigoEmpleado.trim().toUpperCase() },
        attributes: ['idEmpleado']
    });
    if (!empleado) {
        return res.status(400).json({ success: false, mensaje: 'Código de empleado no encontrado.' });
    }

    const traslado = await Traslados.findByPk(idTraslado);
    if (!traslado) return res.status(404).json({ success: false, mensaje: 'Traslado no encontrado.' });

    const hayControversia = items.some(i => !i.aceptado || parseInt(i.cantidadAceptada) < parseInt(i.cantidadOriginal));

    const t = await db.transaction();
    try {
        const nuevoEstado = hayControversia ? 'EN_CONTROVERSIA' : 'RECIBIDO';

        await traslado.update({
            estado: nuevoEstado,
            idUsuarioRecibe: empleado.idEmpleado,
            fechaRecepcion: new Date()
        }, { transaction: t });

        for (const item of items) {
            const cantAceptada = parseInt(item.cantidadAceptada);
            const cantOriginal = parseInt(item.cantidadOriginal);
            const aceptado     = item.aceptado && cantAceptada === cantOriginal;

            // Actualizar estado del detalle
            await DetalleTraslados.update(
                { estado: aceptado ? 'RECIBIDO' : 'CONTROVERSIA' },
                { where: { idDetalleTraslado: item.idDetalleTraslado }, transaction: t }
            );

            // Crear insidencia si hay diferencia
            if (!aceptado) {
                await InsidenciaTraslado.create({
                    idTraslado,
                    idDetalleTraslado: item.idDetalleTraslado,
                    idEmpleado: empleado.idEmpleado,
                    razonInsidencia: item.razon || 'Sin descripción',
                    cantidadOriginal: cantOriginal,
                    cantidadAceptada: cantAceptada,
                    resuelta: 'no'
                }, { transaction: t });
            }

            // Un registro de stock por pack completo (el pack queda intacto)
            if (item.idPack && cantAceptada > 0) {
                const detallesPack = await DetallesPack.findAll({
                    where: { idPack: item.idPack },
                    transaction: t
                });
                const valorPack = detallesPack.reduce(
                    (sum, dp) => sum + (parseFloat(dp.valorUnidad || 0) * dp.cantidad), 0
                );
                await Stock.create({
                    idPuntoVenta: traslado.idDestino,
                    idPack:       item.idPack,
                    idProducto:   null,
                    cantidadExistente: cantAceptada,
                    cantidadOriginal:  cantAceptada,
                    valorUnidad:  valorPack,
                    estadoInterno: 'CERRADO'
                }, { transaction: t });
            }
        }

        await t.commit();

        // Notificar SSE al punto de venta destino
        const pendientes = await Traslados.count({
            where: { idDestino: traslado.idDestino, estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] } }
        });
        const controversias = await Traslados.count({
            where: { idDestino: traslado.idDestino, estado: 'EN_CONTROVERSIA' }
        });
        broadcast(traslado.idDestino, 'state', { pendientes, controversias });

        return res.json({ success: true, estado: nuevoEstado });
    } catch (e) {
        await t.rollback();
        console.error('Error al aceptar traslado:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

// ─── COMPROBANTE (redirige al PDF del admin) ─────────────────────────────────

const comprobanteTraslado = async (req, res) => {
    const { idTraslado } = req.params;
    return res.redirect(`/admin/dosificaciones/comprobante/${idTraslado}`);
};

export {
    dashboardStores,
    getTraslados,
    sseConnect,
    getPendientesJSON,
    getHistorialJSON,
    getDetalleTrasladoJSON,
    aceptarTrasladoAPI,
    comprobanteTraslado
};
