import {
    Traslados, DetalleTraslados, PuntosDeVenta,
    Pack, DetallesPack, Productos, Stock, Imagenes,
    Empleados, InsidenciaTraslado
} from '../models/index.js';
import { Op, fn, col, literal } from 'sequelize';
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

const getInventarioLista = async (req, res) => {
    return res.render('./tienda/inventario/lista', {
        pagina: 'Inventario',
        csrfToken: req.csrfToken(),
        currentPath: '/inventario/lista'
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
                {
                    model: InsidenciaTraslado, as: 'insidencias',
                    include: [{
                        model: DetalleTraslados, as: 'detalle',
                        include: [
                            { model: Pack, as: 'pack', attributes: ['codigoEtiqueta'] },
                            { model: Productos, as: 'producto', attributes: ['sku'] }
                        ]
                    }]
                }
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

// ─── INVENTARIO ──────────────────────────────────────────────────────────────

const getInventarioJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    const { busqueda = '', pagina = 1 } = req.query;
    const limite = parseInt(process.env.LIMIT_PER_PAGE) || 10;
    const offset = (parseInt(pagina) - 1) * limite;
    const q = busqueda.trim();

    try {
        // ── PACKS en stock en este PDV ────────────────────────────────
        const packInclude = {
            model: Pack, as: 'packOrigen',
            required: true,
            where: { estado: { [Op.notIn]: ['DESEMPACADO', 'ANULADO'] } },
            include: [{
                model: DetallesPack,
                include: [{ model: Productos, as: 'producto', attributes: ['nombreProducto', 'sku', 'precioVentaMayorista'] }]
            }]
        };
        if (q) packInclude.where = { ...packInclude.where, codigoEtiqueta: { [Op.like]: `%${q}%` } };

        const stockPacks = await Stock.findAll({
            where: { idPuntoVenta: idPdv, idPack: { [Op.ne]: null }, cantidadExistente: { [Op.gt]: 0 }, estadoInterno: 'CERRADO' },
            include: [packInclude]
        });

        // ── PRODUCTOS: stock agregado por producto ────────────────────
        const stockTiendaRows = await Stock.findAll({
            where: { idPuntoVenta: idPdv, idProducto: { [Op.ne]: null } },
            attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'stockTienda']],
            group: ['idProducto'],
            raw: true
        });

        const productIdsTienda = stockTiendaRows.map(r => r.idProducto).filter(Boolean);
        const mapTienda = Object.fromEntries(stockTiendaRows.map(r => [r.idProducto, parseInt(r.stockTienda) || 0]));

        let count = 0, productos = [];

        if (productIdsTienda.length) {
            const stockGlobalRows = await Stock.findAll({
                where: { idProducto: { [Op.in]: productIdsTienda } },
                attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'stockGlobal']],
                group: ['idProducto'],
                raw: true
            });
            const mapGlobal = Object.fromEntries(stockGlobalRows.map(r => [r.idProducto, parseInt(r.stockGlobal) || 0]));

            const whereProd = {
                activo: 1,
                idProducto: { [Op.in]: productIdsTienda },
                ...(q ? {
                    [Op.or]: [
                        { nombreProducto: { [Op.like]: `%${q}%` } },
                        { sku:            { [Op.like]: `%${q}%` } },
                        { ean:            { [Op.like]: `%${q}%` } }
                    ]
                } : {})
            };

            const result = await Productos.findAndCountAll({
                where: whereProd,
                include: [{ model: Imagenes, as: 'imagenes', where: { tipo: 'principal' }, required: false }],
                order: [['nombreProducto', 'ASC']],
                limit: limite,
                offset,
                distinct: true
            });

            count = result.count;
            productos = result.rows.map(p => ({
                ...p.toJSON(),
                stockTienda: mapTienda[p.idProducto] || 0,
                stockGlobal: mapGlobal[p.idProducto] || 0
            }));
        }

        return res.json({
            success: true,
            packs: stockPacks,
            productos,
            totalPaginas: Math.ceil(count / limite),
            paginaActual: parseInt(pagina),
            total: count
        });
    } catch (e) {
        console.error('getInventarioJSON:', e);
        return res.status(500).json({ success: false });
    }
};

const getDestinosJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    try {
        const destinos = await PuntosDeVenta.findAll({
            where: { idPuntoDeVenta: { [Op.ne]: idPdv || '' } },
            attributes: ['idPuntoDeVenta', 'nombreComercial', 'tipo'],
            order: [['nombreComercial', 'ASC']]
        });
        return res.json(destinos);
    } catch (e) {
        return res.status(500).json([]);
    }
};

const desempacarPackAPI = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    const { idPack, codigoEmpleado } = req.body;

    if (!idPack || !codigoEmpleado) {
        return res.status(400).json({ success: false, mensaje: 'Datos incompletos.' });
    }

    const empleado = await Empleados.findOne({
        where: { codigoEmpleado: codigoEmpleado.trim().toUpperCase() },
        attributes: ['idEmpleado']
    });
    if (!empleado) return res.status(400).json({ success: false, mensaje: 'Código de empleado no encontrado.' });

    // Leer los detalles ANTES de abrir la transacción para evitar lecturas inconsistentes
    const detalles = await DetallesPack.findAll({ where: { idPack } });
    console.log(`[desempacar] idPack=${idPack} — detalles encontrados: ${detalles.length}`, detalles.map(d => ({ idProducto: d.idProducto, cantidad: d.cantidad })));

    if (!detalles.length) {
        return res.status(400).json({ success: false, mensaje: 'El pack no tiene productos registrados.' });
    }

    const t = await db.transaction();
    try {
        // 1. Marcar pack como DESEMPACADO
        await Pack.update({ estado: 'DESEMPACADO' }, { where: { idPack }, transaction: t });

        // 2. Vaciar el registro de stock del pack (queda como historial)
        await Stock.update(
            { estadoInterno: 'SUELTO', cantidadExistente: 0 },
            { where: { idPack, idPuntoVenta: idPdv }, transaction: t }
        );

        // 3. Crear un registro de stock por cada línea de producto del pack
        await Stock.bulkCreate(
            detalles.map(dp => ({
                idPuntoVenta:      idPdv,
                idProducto:        dp.idProducto,
                idPack:            null,
                cantidadExistente: dp.cantidad,
                cantidadOriginal:  dp.cantidad,
                valorUnidad:       dp.valorUnidad || 0,
                estadoInterno:     'SUELTO'
            })),
            { transaction: t }
        );

        await t.commit();
        return res.json({ success: true });
    } catch (e) {
        await t.rollback();
        console.error('desempacarPackAPI:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

const trasladarDesdeStoreAPI = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    const { packs, idDestino, codigoEmpleado, notas } = req.body;

    if (!idDestino || !codigoEmpleado || !Array.isArray(packs) || !packs.length) {
        return res.status(400).json({ success: false, mensaje: 'Datos incompletos.' });
    }

    const empleado = await Empleados.findOne({
        where: { codigoEmpleado: codigoEmpleado.trim().toUpperCase() },
        attributes: ['idEmpleado']
    });
    if (!empleado) return res.status(400).json({ success: false, mensaje: 'Código de empleado no encontrado.' });

    const t = await db.transaction();
    try {
        const ultimoTraslado = await Traslados.findOne({ order: [['createdAt', 'DESC']], transaction: t });
        const nroSiguiente   = ultimoTraslado ? parseInt(ultimoTraslado.codigoTraslado.split('-')[1]) + 1 : 1000;
        const nuevoCodigo    = `TR-${nroSiguiente}`;

        const traslado = await Traslados.create({
            codigoTraslado:     nuevoCodigo,
            idOrigen:           idPdv,
            idDestino,
            idUsuarioDespacha:  empleado.idEmpleado,
            notas:              notas || null,
            estado:             'EN_TRANSITO'
        }, { transaction: t });

        const recordsPacks = await Pack.findAll({ where: { idPack: packs }, transaction: t });
        for (const pack of recordsPacks) {
            await DetalleTraslados.create({
                idTraslado: traslado.idTraslado,
                idPack:     pack.idPack,
                cantidad:   1
            }, { transaction: t });
            await pack.update({ estado: 'TRASLADADO' }, { transaction: t });
            // Vaciar el stock del pack en este PDV
            await Stock.update(
                { cantidadExistente: 0, estadoInterno: 'SUELTO' },
                { where: { idPack: pack.idPack, idPuntoVenta: idPdv }, transaction: t }
            );
        }

        await t.commit();

        const pendientes = await Traslados.count({
            where: { idDestino, estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] } }
        });
        broadcast(idDestino, 'state', { pendientes });

        return res.json({ success: true, idTraslado: traslado.idTraslado, codigo: nuevoCodigo });
    } catch (e) {
        await t.rollback();
        console.error('trasladarDesdeStoreAPI:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

// ─── RESOLVER CONTROVERSIA ───────────────────────────────────────────────────

const resolverControversiaAPI = async (req, res) => {
    const { idTraslado, codigoEmpleado, resoluciones } = req.body;
    // resoluciones: [{ idDetalleTraslado, idPack, resolucion: 'RECIBIDO'|'ANULADO' }]

    if (!idTraslado || !codigoEmpleado || !Array.isArray(resoluciones) || !resoluciones.length) {
        return res.status(400).json({ success: false, mensaje: 'Datos incompletos.' });
    }

    const empleado = await Empleados.findOne({
        where: { codigoEmpleado: codigoEmpleado.trim().toUpperCase() },
        attributes: ['idEmpleado', 'PrimerNombre', 'PrimerApellido']
    });
    if (!empleado) {
        return res.status(400).json({ success: false, mensaje: 'Código de empleado no encontrado.' });
    }

    const traslado = await Traslados.findByPk(idTraslado);
    if (!traslado || traslado.estado !== 'EN_CONTROVERSIA') {
        return res.status(400).json({ success: false, mensaje: 'Traslado no válido para resolución.' });
    }

    const nombreEmpleado = `${empleado.PrimerNombre} ${empleado.PrimerApellido}`;
    const esDesdeProduccion = traslado.idOrigen === 'PRODUCCION' || traslado.idOrigen === 'BODEGA-VIRTUAL';

    const t = await db.transaction();
    try {
        for (const item of resoluciones) {
            const detalle = await DetalleTraslados.findByPk(item.idDetalleTraslado, { transaction: t });
            if (!detalle) continue;

            if (item.resolucion === 'RECIBIDO') {
                await detalle.update({ estado: 'RECIBIDO' }, { transaction: t });

                // Crear stock pack-nivel si tiene pack
                if (item.idPack) {
                    const detallesPack = await DetallesPack.findAll({
                        where: { idPack: item.idPack },
                        transaction: t
                    });
                    const valorPack = detallesPack.reduce(
                        (sum, dp) => sum + (parseFloat(dp.valorUnidad || 0) * dp.cantidad), 0
                    );
                    await Stock.create({
                        idPuntoVenta:      traslado.idDestino,
                        idPack:            item.idPack,
                        idProducto:        null,
                        cantidadExistente: detalle.cantidad,
                        cantidadOriginal:  detalle.cantidad,
                        valorUnidad:       valorPack,
                        estadoInterno:     'CERRADO'
                    }, { transaction: t });
                }
            } else if (item.resolucion === 'ANULADO') {
                await detalle.update({ estado: 'CONTROVERSIA' }, { transaction: t });

                if (item.idPack && esDesdeProduccion) {
                    await Pack.update(
                        { estado: 'ANULADO' },
                        { where: { idPack: item.idPack }, transaction: t }
                    );
                }

                await InsidenciaTraslado.create({
                    idTraslado,
                    idDetalleTraslado: item.idDetalleTraslado,
                    idEmpleado:        empleado.idEmpleado,
                    razonInsidencia:   `TRASLADO ANULADO POR ${nombreEmpleado}`,
                    cantidadOriginal:  detalle.cantidad,
                    cantidadAceptada:  0,
                    resuelta:          'si'
                }, { transaction: t });
            }
        }

        // Si todos los detalles quedaron resueltos (RECIBIDO o con incidencia resuelta), cerrar traslado
        await traslado.update({ estado: 'RECIBIDO' }, { transaction: t });

        await t.commit();

        const pendientes = await Traslados.count({
            where: { idDestino: traslado.idDestino, estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] } }
        });
        const controversias = await Traslados.count({
            where: { idDestino: traslado.idDestino, estado: 'EN_CONTROVERSIA' }
        });
        broadcast(traslado.idDestino, 'state', { pendientes, controversias });

        return res.json({ success: true });
    } catch (e) {
        await t.rollback();
        console.error('Error al resolver controversia:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

const getPerfilProducto = async (req, res) => {
    const idPdv   = req.idPuntoDeVenta;
    const { idProducto } = req.params;

    try {
        const producto = await Productos.findOne({
            where: { idProducto },
            include: [{ model: Imagenes, as: 'imagenes', required: false }]
        });
        if (!producto) return res.redirect('/store/inventario/lista');

        // Stock agrupado por tienda
        const stockRows = await Stock.findAll({
            where: { idProducto },
            attributes: ['idPuntoVenta', [fn('SUM', col('cantidadExistente')), 'total']],
            group: ['idPuntoVenta'],
            raw: true
        });

        const pdvIds = stockRows.map(r => r.idPuntoVenta).filter(Boolean);
        let pdvMap = {};
        if (pdvIds.length) {
            const pdvs = await PuntosDeVenta.findAll({
                where: { idPuntoDeVenta: { [Op.in]: pdvIds } },
                attributes: ['idPuntoDeVenta', 'nombreComercial', 'tipo'],
                raw: true
            });
            pdvMap = Object.fromEntries(pdvs.map(p => [p.idPuntoDeVenta, p]));
        }

        const stockPorTienda = stockRows
            .map(r => ({
                nombreComercial: pdvMap[r.idPuntoVenta]?.nombreComercial || '—',
                tipo:            pdvMap[r.idPuntoVenta]?.tipo            || '—',
                total:           parseInt(r.total) || 0,
                esTiendaActual:  r.idPuntoVenta === idPdv
            }))
            .sort((a, b) => b.esTiendaActual - a.esTiendaActual);

        return res.render('./tienda/inventario/perfilProducto', {
            pagina:         producto.nombreProducto,
            csrfToken:      req.csrfToken(),
            currentPath:    '/inventario/lista',
            producto:       producto.toJSON(),
            stockPorTienda,
            r2Url:          `${process.env.R2_PUBLIC_URL}/productos/`
        });
    } catch (e) {
        console.error('getPerfilProducto:', e);
        return res.redirect('/store/inventario/lista');
    }
};

export {
    dashboardStores,
    getTraslados,
    getInventarioLista,
    sseConnect,
    getPendientesJSON,
    getHistorialJSON,
    getDetalleTrasladoJSON,
    aceptarTrasladoAPI,
    resolverControversiaAPI,
    getInventarioJSON,
    getDestinosJSON,
    desempacarPackAPI,
    trasladarDesdeStoreAPI,
    getPerfilProducto
};
