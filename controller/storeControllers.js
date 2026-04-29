import {
    Traslados, DetalleTraslados, PuntosDeVenta,
    Pack, DetallesPack, Productos, Stock, Imagenes,
    Empleados, InsidenciaTraslado,
    Clientes, ClientesTributario, ClientesUbicacion,
    Departamentos, Municipios, Documentacion,
    Atributos, VariacionesProducto, Entidades,
    FacturaClientes, DetallesFactura, DetallesImpuestosFacturaCliente,
    DetallesPagosFactura, RegimenFacturacion
} from '../models/index.js';
import { Op, fn, col, literal } from 'sequelize';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';
import path from 'path';
import db from '../config/bd.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const LOGO_PATH  = path.resolve(__dirname, '../public/img/logo.png');
import { addClient, removeClient, sendEvent, broadcast } from '../helpers/sseManager.js';
import { Upload } from '@aws-sdk/lib-storage';
import s3Client from '../config/r2.js';
import sharp from 'sharp';

// ─── PÁGINAS ────────────────────────────────────────────────────────────────

const dashboardStores = async (req, res) => {
    const idPuntoDeVenta = req.idPuntoDeVenta;

    const [trasladosPendientes, departamentos, clienteRaw] = await Promise.all([
        idPuntoDeVenta
            ? Traslados.count({ where: { idDestino: idPuntoDeVenta, estado: 'EN_TRANSITO' } })
            : 0,
        Departamentos.findAll({ attributes: ['id', 'nombre'], order: [['nombre', 'ASC']], raw: true }),
        Clientes.findOne({ where: { idCliente: '0' }, raw: true }).catch(() => null)
    ]);

    const clienteGenerico = clienteRaw || {
        idCliente: '0',
        primer_nombre: 'Cliente',
        primer_apellido: 'Genérico',
        tipo_documento: 'CC',
        numero_doc: '0000000000'
    };

    return res.render('./tienda/layout', {
        pagina: `Panel principal de ${req.usuario.nombreUsuario}`,
        csrfToken: req.csrfToken(),
        currentPath: req.path,
        trasladosPendientes,
        wholesaleMin: parseInt(process.env.WHOLESALE_PRICE_MIN_PRODUCT) || 6,
        departamentos,
        clienteGenerico
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
            where: {
                [Op.or]: [{ idDestino: idPdv }, { idOrigen: idPdv }],
                estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] }
            },
            include: [
                { model: PuntosDeVenta, as: 'origen',  attributes: ['nombreComercial'], required: false },
                { model: PuntosDeVenta, as: 'destino', attributes: ['nombreComercial'], required: false },
            ],
            order: [['fechaEnvio', 'DESC']]
        });
        return res.json({ success: true, traslados, idPdv });
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
            [Op.or]: [{ idDestino: idPdv }, { idOrigen: idPdv }],
            estado: { [Op.in]: ['RECIBIDO', 'EN_CONTROVERSIA', 'ANULADO', 'DEVUELTO'] }
        };
        if (busqueda.trim()) {
            where.codigoTraslado = { [Op.like]: `%${busqueda.trim()}%` };
        }

        const { count, rows } = await Traslados.findAndCountAll({
            where,
            include: [
                { model: PuntosDeVenta, as: 'origen',  attributes: ['nombreComercial'], required: false },
                { model: PuntosDeVenta, as: 'destino', attributes: ['nombreComercial'], required: false },
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
            idPdv,
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
    const idPdv = req.idPuntoDeVenta;
    try {
        const traslado = await Traslados.findOne({
            where: {
                idTraslado,
                [Op.or]: [{ idOrigen: idPdv }, { idDestino: idPdv }]
            },
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
            const updateDetalle = { estado: aceptado ? 'RECIBIDO' : 'CONTROVERSIA' };
            if (!aceptado) updateDetalle.cantidadControversia = cantOriginal - cantAceptada;
            await DetalleTraslados.update(
                updateDetalle,
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

            // Crear stock en destino
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
            } else if (!item.idPack && item.idProducto && cantAceptada > 0) {
                const stockRef = await Stock.findOne({
                    where: { idProducto: item.idProducto },
                    order: [['createdAt', 'DESC']],
                    transaction: t
                });
                await Stock.create({
                    idPuntoVenta:      traslado.idDestino,
                    idPack:            null,
                    idProducto:        item.idProducto,
                    cantidadExistente: cantAceptada,
                    cantidadOriginal:  cantAceptada,
                    valorUnidad:       stockRef?.valorUnidad || 0,
                    estadoInterno:     'SUELTO'
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

        // ── PRODUCTOS con stock en esta tienda (paginados) ────────────
        // 1. IDs de productos que tienen stock en la tienda actual
        const rowsTienda = await Stock.findAll({
            where: { idPuntoVenta: idPdv, idProducto: { [Op.ne]: null } },
            attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'stockTienda']],
            group: ['idProducto'],
            raw: true
        });

        const productIdsTienda = rowsTienda.map(r => r.idProducto).filter(Boolean);
        const mapTienda = Object.fromEntries(rowsTienda.map(r => [r.idProducto, parseInt(r.stockTienda) || 0]));

        let count = 0, productos = [];

        if (productIdsTienda.length) {
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

            // 2. IDs de la página actual para el batch de stock global
            const idsEnPagina = result.rows.map(p => p.idProducto);

            // 3. Stock global: suma cantidadExistente SIN filtro de tienda
            const rowsGlobal = await Stock.findAll({
                where: { idProducto: { [Op.in]: idsEnPagina } },
                attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'stockGlobal']],
                group: ['idProducto'],
                raw: true
            });
            const mapGlobal = Object.fromEntries(rowsGlobal.map(r => [r.idProducto, parseInt(r.stockGlobal) || 0]));

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

            // Cantidad real en controversia (puede ser menor que la original)
            const cantControversia = detalle.cantidadControversia ?? detalle.cantidad;

            if (item.resolucion === 'RECIBIDO') {
                await detalle.update({ estado: 'RECIBIDO' }, { transaction: t });

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
                        cantidadExistente: cantControversia,
                        cantidadOriginal:  cantControversia,
                        valorUnidad:       valorPack,
                        estadoInterno:     'CERRADO'
                    }, { transaction: t });
                } else if (detalle.idProducto) {
                    const stockRef = await Stock.findOne({
                        where: { idProducto: detalle.idProducto },
                        order: [['createdAt', 'DESC']],
                        transaction: t
                    });
                    await Stock.create({
                        idPuntoVenta:      traslado.idDestino,
                        idPack:            null,
                        idProducto:        detalle.idProducto,
                        cantidadExistente: cantControversia,
                        cantidadOriginal:  cantControversia,
                        valorUnidad:       stockRef?.valorUnidad || 0,
                        estadoInterno:     'SUELTO'
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
                    cantidadOriginal:  cantControversia,
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

const buscarPosProducto = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    const q = (req.query.q || '').trim();
    if (!q) return res.json({ success: true, productos: [] });

    try {
        const term = `%${q}%`;
        const productos = await Productos.findAll({
            where: {
                activo: 1,
                [Op.or]: [
                    { nombreProducto: { [Op.like]: term } },
                    { sku:            { [Op.like]: term } },
                    { ean:            { [Op.like]: term } }
                ]
            },
            attributes: ['idProducto', 'nombreProducto', 'sku', 'precioVentaMayorista', 'precioVentaPublicoFinal'],
            include: [{
                model: Imagenes,
                as: 'imagenes',
                attributes: ['nombreImagen'],
                limit: 1,
                required: false
            }],
            limit: 8
        });

        if (!productos.length) return res.json({ success: true, productos: [] });

        const ids = productos.map(p => p.idProducto);

        const stockRows = await Stock.findAll({
            where: {
                idPuntoVenta: idPdv,
                idProducto:   { [Op.in]: ids },
                cantidadExistente: { [Op.gt]: 0 }
            },
            attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'stock']],
            group: ['idProducto'],
            raw: true
        });
        const mapStock = Object.fromEntries(stockRows.map(r => [r.idProducto, parseInt(r.stock) || 0]));

        const r2 = `${process.env.R2_PUBLIC_URL}/productos/`;
        const resultado = productos
            .map(p => {
                const img = p.imagenes?.[0]?.nombreImagen;
                return {
                    idProducto:              p.idProducto,
                    nombreProducto:          p.nombreProducto,
                    sku:                     p.sku,
                    precioVentaMayorista:    parseFloat(p.precioVentaMayorista)    || 0,
                    precioVentaPublicoFinal: parseFloat(p.precioVentaPublicoFinal) || 0,
                    stock:                   mapStock[p.idProducto] || 0,
                    imagen:                  img ? `${r2}${img}` : '/img/image-default.webp'
                };
            })
            .sort((a, b) => b.stock - a.stock);

        return res.json({ success: true, productos: resultado });
    } catch (e) {
        console.error('buscarPosProducto:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── POS: DETALLE PRODUCTO (modal) ──────────────────────────────────────────

const getPosProductoJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    const { idProducto } = req.params;
    try {
        const [producto, variaciones, stockRows] = await Promise.all([
            Productos.findOne({
                where: { idProducto, activo: 1 },
                attributes: ['idProducto', 'nombreProducto', 'descripcion', 'precioVentaMayorista', 'precioVentaPublicoFinal'],
                include: [{ model: Imagenes, as: 'imagenes', attributes: ['nombreImagen'], required: false }]
            }),
            VariacionesProducto.findAll({ where: { idProducto } }),
            Stock.findAll({
                where: { idProducto, cantidadExistente: { [Op.gt]: 0 } },
                attributes: ['idPuntoVenta', [fn('SUM', col('cantidadExistente')), 'total']],
                group: ['idPuntoVenta'],
                raw: true
            })
        ]);
        if (!producto) return res.json({ success: false });

        const attrIds = [...new Set(
            variaciones.flatMap(v => v.idAtributos.split('|').map(Number)).filter(Boolean)
        )];
        let tallas = [], colores = [];
        if (attrIds.length) {
            const attrs = await Atributos.findAll({ where: { idAtributo: { [Op.in]: attrIds } } });
            tallas  = attrs.filter(a => a.tipo === 'TALLA').map(a => a.valor);
            colores = attrs.filter(a => a.tipo === 'COLOR').map(a => ({ valor: a.valor, codigo: a.codigo1 || '#cccccc' }));
        }

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
                nombre:  pdvMap[r.idPuntoVenta]?.nombreComercial || '—',
                tipo:    pdvMap[r.idPuntoVenta]?.tipo            || '—',
                stock:   parseInt(r.total) || 0,
                esLocal: r.idPuntoVenta === idPdv
            }))
            .sort((a, b) => b.esLocal - a.esLocal);

        const stockLocal = stockPorTienda.find(s => s.esLocal)?.stock || 0;

        const r2 = `${process.env.R2_PUBLIC_URL}/productos/`;
        return res.json({
            success: true,
            producto: {
                idProducto:   producto.idProducto,
                nombre:       producto.nombreProducto,
                descripcion:  producto.descripcion || '',
                precioMayor:  parseFloat(producto.precioVentaMayorista)    || 0,
                precioDetal:  parseFloat(producto.precioVentaPublicoFinal) || 0,
                imagenes:     producto.imagenes.map(i => `${r2}${i.nombreImagen}`),
                tallas,
                colores,
                stockLocal,
                stockPorTienda
            }
        });
    } catch (e) {
        console.error('getPosProductoJSON:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── CLIENTES ────────────────────────────────────────────────────────────────

const buscarClientePorDoc = async (req, res) => {
    const { doc } = req.query;
    if (!doc || doc.trim().length < 3) return res.json({ success: false });
    try {
        const cliente = await Clientes.findOne({
            where: { numero_doc: doc.trim() },
            include: [
                { model: ClientesTributario, as: 'tributario', required: false },
                { model: ClientesUbicacion, as: 'ubicaciones', required: false }
            ]
        });
        if (!cliente) return res.json({ success: false });
        return res.json({ success: true, cliente });
    } catch (e) {
        console.error('buscarClientePorDoc:', e);
        return res.status(500).json({ success: false });
    }
};

const getMunicipiosStoreJSON = async (req, res) => {
    const { deptoId } = req.params;
    try {
        const municipios = await Municipios.findAll({
            where: { departamento_id: deptoId },
            attributes: ['id', 'nombre'],
            order: [['nombre', 'ASC']],
            raw: true
        });
        return res.json(municipios);
    } catch (e) {
        return res.status(500).json([]);
    }
};

const guardarCliente = async (req, res) => {
    const {
        idCliente: idClienteExistente,
        tipo_persona: tipo_personaRaw,
        tipo_documento, numero_doc, digito_verif,
        razon_social, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
        email, telefono,
        regimen_fiscal, gran_contribuyente, autorretenedor, agente_retencion, obligado_aduanero,
        ciiu, descripcion_ciiu, fecha_rut,
        idDepartamento, nombreDepartamento, idMunicipio, nombreMunicipio, direccion
    } = req.body;

    if (!tipo_documento || !numero_doc) {
        return res.status(400).json({ success: false, mensaje: 'Tipo y número de documento son requeridos.' });
    }

    const tipo_persona = tipo_personaRaw || (tipo_documento === 'NIT' ? 'J' : 'N');
    const esEmpresa    = tipo_persona === 'J';
    const toBool       = (v) => v === 'true' || v === true;
    const toTitle      = (s) => s ? s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : null;

    const t = await db.transaction();
    let idCliente;

    try {
        const datosBase = {
            tipo_persona,
            tipo_documento,
            numero_doc:       numero_doc.trim(),
            digito_verif:     digito_verif || null,
            razon_social:     toTitle(razon_social),
            primer_nombre:    toTitle(primer_nombre),
            segundo_nombre:   toTitle(segundo_nombre),
            primer_apellido:  toTitle(primer_apellido),
            segundo_apellido: toTitle(segundo_apellido),
            email:            email?.trim().toLowerCase() || null,
            telefono:         telefono?.trim() || null,
            activo:           true
        };

        // Si viene con un idCliente cargado, verificar si el doc sigue siendo el mismo
        const clienteCargado = (idClienteExistente && idClienteExistente !== '0')
            ? await Clientes.findOne({ where: { idCliente: idClienteExistente }, attributes: ['idCliente', 'numero_doc'], transaction: t })
            : null;

        const mismoDoc = clienteCargado && clienteCargado.numero_doc.trim() === numero_doc.trim();

        if (mismoDoc) {
            // Mismo documento → actualizar el cliente existente
            await clienteCargado.update(datosBase, { transaction: t });
            idCliente = clienteCargado.idCliente;
        } else {
            // Documento distinto o cliente nuevo → buscar por doc o crear
            const existente = await Clientes.findOne({ where: { numero_doc: numero_doc.trim() }, transaction: t });
            if (existente) {
                await existente.update(datosBase, { transaction: t });
                idCliente = existente.idCliente;
            } else {
                const nuevo = await Clientes.create(datosBase, { transaction: t });
                idCliente = nuevo.idCliente;
            }
        }

        // Tributario (solo si empresa)
        if (esEmpresa && regimen_fiscal) {
            const tribExist = await ClientesTributario.findOne({ where: { idCliente }, transaction: t });
            const tribData = {
                regimen_fiscal,
                gran_contribuyente: toBool(gran_contribuyente),
                autorretenedor:     toBool(autorretenedor),
                agente_retencion:   toBool(agente_retencion),
                obligado_aduanero:  toBool(obligado_aduanero),
                ciiu:               ciiu || null,
                descripcion_ciiu:   toTitle(descripcion_ciiu),
                fecha_rut:          fecha_rut || null
            };
            if (tribExist) {
                await tribExist.update(tribData, { transaction: t });
            } else {
                await ClientesTributario.create({ idCliente, ...tribData }, { transaction: t });
            }
        }

        // Ubicación
        if (idDepartamento || direccion) {
            const ubExist = await ClientesUbicacion.findOne({ where: { idCliente, es_principal: true }, transaction: t });
            const ubData = {
                idDepartamento:    idDepartamento || null,
                nombreDepartamento: nombreDepartamento || null,
                idMunicipio:       idMunicipio || null,
                nombreMunicipio:   nombreMunicipio || null,
                direccion:         direccion || null,
                es_principal:      true
            };
            if (ubExist) {
                await ubExist.update(ubData, { transaction: t });
            } else {
                await ClientesUbicacion.create({ idCliente, ...ubData }, { transaction: t });
            }
        }

        // RUT
        if (req.file) {
            const file = req.file;
            const ext  = file.originalname.split('.').pop().toLowerCase();
            const isImage = file.mimetype.startsWith('image/');
            const nombreArchivo = `rut-${numero_doc.trim()}-${Date.now()}.${isImage ? 'webp' : ext}`;
            const r2Key = `documentacion/clientes/${nombreArchivo}`;

            let buffer      = file.buffer;
            let contentType = file.mimetype;
            if (isImage) {
                buffer = await sharp(file.buffer)
                    .resize(1500, 1500, { fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toBuffer();
                contentType = 'image/webp';
            }

            await new Upload({
                client: s3Client,
                params: { Bucket: process.env.R2_BUCKET_NAME, Key: r2Key, Body: buffer, ContentType: contentType }
            }).done();

            await Documentacion.create({
                idPropietario:  idCliente,
                nombreDocumento: 'RUT',
                keyName:         r2Key,
                formato:         isImage ? 'WEBP' : ext.toUpperCase(),
                pertenece:       'cliente'
            }, { transaction: t });
        }

        await t.commit();

        const nombreDisplay = esEmpresa
            ? (razon_social || `${primer_nombre || ''} ${primer_apellido || ''}`.trim())
            : `${primer_nombre || ''} ${primer_apellido || ''}`.trim();

        return res.json({
            success: true,
            idCliente,
            nombre:    nombreDisplay,
            documento: `${tipo_documento} ${numero_doc.trim()}`
        });
    } catch (e) {
        await t.rollback();
        console.error('guardarCliente:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al guardar el cliente.' });
    }
};

const getEntidadesJSON = async (req, res) => {
    try {
        const entidades = await Entidades.findAll({
            where: { recibirPagosPos: true },
            attributes: ['idEntidad', 'nombreEntidad', 'tipoEntidad'],
            raw: true
        });
        return res.json({ success: true, entidades });
    } catch (e) {
        console.error('getEntidadesJSON:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── HELPER FORMATO MONEDA ───────────────────────────────────────────────────
const fmtCOP = n => Math.round(n).toLocaleString('es-CO');

// ─── PROCESAR FACTURA ─────────────────────────────────────────────────────────
const procesarFactura = async (req, res) => {
    const { idCliente, idEmpleado, items, pagos } = req.body;
    const idPuntoDeVenta = req.idPuntoDeVenta;
    const WHOLESALE_MIN  = parseInt(process.env.WHOLESALE_PRICE_MIN_PRODUCT) || 6;

    // ── 1. Validar datos del frontend ─────────────────────────────────────────
    if (!idPuntoDeVenta)
        return res.status(403).json({ success: false, mensaje: 'Sin punto de venta asignado.' });
    if (!idCliente || typeof idCliente !== 'string' || !idCliente.trim())
        return res.status(400).json({ success: false, mensaje: 'Cliente inválido.' });
    const _idEmpleado = String(idEmpleado || '').trim();
    if (!_idEmpleado)
        return res.status(400).json({ success: false, mensaje: 'Empleado inválido.' });
    if (!Array.isArray(items) || items.length === 0)
        return res.status(400).json({ success: false, mensaje: 'Orden sin artículos.' });
    for (const it of items) {
        if (!it.idProducto || typeof it.idProducto !== 'string')
            return res.status(400).json({ success: false, mensaje: 'Producto inválido en la orden.' });
        const qty = parseInt(it.cantidad);
        if (!Number.isInteger(qty) || qty <= 0)
            return res.status(400).json({ success: false, mensaje: `Cantidad inválida para producto ${it.idProducto}.` });
    }
    if (!Array.isArray(pagos) || pagos.length === 0)
        return res.status(400).json({ success: false, mensaje: 'Sin métodos de pago.' });
    for (const p of pagos) {
        const val = Number(p.valor);
        if (!Number.isFinite(val) || val <= 0)
            return res.status(400).json({ success: false, mensaje: 'Valor de pago inválido.' });
        if (p.idEntidad != null && !Number.isInteger(Number(p.idEntidad)))
            return res.status(400).json({ success: false, mensaje: 'idEntidad inválido.' });
        if (p.nroReferencia != null && typeof p.nroReferencia !== 'string')
            return res.status(400).json({ success: false, mensaje: 'Referencia inválida.' });
    }

    // ── 2. Verificar suma de pagos = total de la orden ────────────────────────
    const idProductos = [...new Set(items.map(i => i.idProducto))];
    const productos   = await Productos.findAll({
        where: { idProducto: idProductos },
        attributes: ['idProducto', 'nombreProducto', 'precioVentaMayorista', 'precioVentaPublicoFinal'],
        raw: true
    });
    const prodMap = new Map(productos.map(p => [p.idProducto, p]));
    for (const it of items)
        if (!prodMap.has(it.idProducto))
            return res.status(400).json({ success: false, mensaje: `Producto no encontrado: ${it.idProducto}.` });

    const totalCantidad   = items.reduce((s, i) => s + parseInt(i.cantidad), 0);
    const esMayorista     = totalCantidad >= WHOLESALE_MIN;
    let   totalOrden      = 0;
    const itemsProcesados = items.map(it => {
        const prod    = prodMap.get(it.idProducto);
        const qty     = parseInt(it.cantidad);
        const precio  = esMayorista
            ? parseFloat(prod.precioVentaMayorista)
            : parseFloat(prod.precioVentaPublicoFinal);
        const subTotal = parseFloat((precio * qty).toFixed(2));
        totalOrden    += subTotal;
        return { idProducto: it.idProducto, nombreProducto: prod.nombreProducto, cantidad: qty, valorUnidad: precio, subTotal, total: subTotal };
    });
    totalOrden = parseFloat(totalOrden.toFixed(2));
    const sumaPagos = parseFloat(pagos.reduce((s, p) => s + Number(p.valor), 0).toFixed(2));
    if (Math.abs(sumaPagos - totalOrden) > 1)
        return res.status(400).json({ success: false, mensaje: `Suma de pagos ($${sumaPagos}) ≠ total orden ($${totalOrden}).` });

    // ── 3. Verificar cliente ──────────────────────────────────────────────────
    const clienteExiste = await Clientes.count({ where: { idCliente: idCliente.trim() } });
    if (!clienteExiste)
        return res.status(400).json({ success: false, mensaje: 'Cliente no encontrado.' });

    // ── 4. Verificar stock por producto ───────────────────────────────────────
    for (const it of itemsProcesados) {
        const [{ total: stockTotal }] = await Stock.findAll({
            where: { idPuntoVenta: idPuntoDeVenta, idProducto: it.idProducto, cantidadExistente: { [Op.gt]: 0 } },
            attributes: [[fn('SUM', col('cantidadExistente')), 'total']],
            raw: true
        });
        if ((stockTotal || 0) < it.cantidad)
            return res.status(400).json({
                success: false,
                mensaje: `Stock insuficiente para "${it.nombreProducto}". Disponible: ${stockTotal || 0}, requerido: ${it.cantidad}.`
            });
    }

    // ── 5. Verificar resolución de facturación ────────────────────────────────
    const regimen = await RegimenFacturacion.findOne({
        where: { idPuntoDeVenta, activa: true, fechaVencimiento: { [Op.gte]: new Date() } },
        raw: true
    });
    if (!regimen)
        return res.status(400).json({ success: false, mensaje: 'Sin resolución de facturación vigente.' });
    if (BigInt(regimen.nroActual) >= BigInt(regimen.nroFin))
        return res.status(400).json({ success: false, mensaje: 'Resolución de facturación agotada.' });

    // ── Transacción ───────────────────────────────────────────────────────────
    const t = await db.transaction();
    try {
        const ahora       = new Date();
        const nroFactura  = Number(regimen.nroActual) + 1;

        // ── 6. Crear factura ──────────────────────────────────────────────────
        const factura = await FacturaClientes.create({
            idCliente:            idCliente.trim(),
            idRegimenFacturacion: regimen.idRegimenFacturacion,
            idPuntoDeVenta,
            idEmpleado:           _idEmpleado,
            tipoDocumento:        regimen.tipoFactura || '03',
            prefijo:              regimen.prefijo     || '',
            numeroFactura:        String(nroFactura),
            fechaEmision:         ahora.toISOString().slice(0, 10),
            horaEmision:          ahora.toTimeString().slice(0, 8)
        }, { transaction: t });

        await RegimenFacturacion.update(
            { nroActual: nroFactura },
            { where: { idRegimenFacturacion: regimen.idRegimenFacturacion }, transaction: t }
        );

        // ── 7. Detalles de factura ────────────────────────────────────────────
        const detallesCreados = [];
        for (const it of itemsProcesados) {
            const det = await DetallesFactura.create({
                idFacturaCliente: factura.idFacturaCliente,
                idProducto:       it.idProducto,
                cantidad:         it.cantidad,
                valorUnidad:      it.valorUnidad,
                subTotal:         it.subTotal,
                total:            it.total
            }, { transaction: t });
            detallesCreados.push({ ...it, idDetallesFactura: det.idDetallesFactura });
        }

        // ── 8. Detalles de pagos ──────────────────────────────────────────────
        const idEntidades  = pagos.filter(p => p.idEntidad != null).map(p => Number(p.idEntidad));
        const entidadesMap = new Map();
        if (idEntidades.length) {
            const ents = await Entidades.findAll({
                where: { idEntidad: idEntidades },
                attributes: ['idEntidad', 'tipoEntidad'],
                raw: true, transaction: t
            });
            ents.forEach(e => entidadesMap.set(e.idEntidad, e.tipoEntidad));
        }
        for (const p of pagos) {
            const metodoPago = p.idEntidad != null
                ? (entidadesMap.get(Number(p.idEntidad)) || 'Efectivo')
                : 'Efectivo';
            await DetallesPagosFactura.create({
                idFacturaCliente: factura.idFacturaCliente,
                idEntidad:        p.idEntidad != null ? Number(p.idEntidad) : null,
                metodoPago,
                valor:            Number(p.valor),
                nroReferencia:    p.nroReferencia?.trim() || null
            }, { transaction: t });
        }

        // ── 9. Actualizar stock FIFO ──────────────────────────────────────────
        for (const it of itemsProcesados) {
            let pendiente   = it.cantidad;
            const stockRows = await Stock.findAll({
                where:    { idPuntoVenta: idPuntoDeVenta, idProducto: it.idProducto, cantidadExistente: { [Op.gt]: 0 } },
                order:    [['createdAt', 'ASC']],
                transaction: t,
                lock:     t.LOCK.UPDATE
            });
            for (const row of stockRows) {
                if (pendiente <= 0) break;
                if (row.cantidadExistente <= pendiente) {
                    pendiente -= row.cantidadExistente;
                    await Stock.update({ cantidadExistente: 0 }, { where: { idStock: row.idStock }, transaction: t });
                } else {
                    await Stock.update({ cantidadExistente: row.cantidadExistente - pendiente }, { where: { idStock: row.idStock }, transaction: t });
                    pendiente = 0;
                }
            }
            if (pendiente > 0) {
                await t.rollback();
                return res.status(400).json({ success: false, mensaje: `Stock insuficiente para "${it.nombreProducto}" al facturar.` });
            }
        }

        // ── 10. Impuestos base cero ───────────────────────────────────────────
        for (const det of detallesCreados) {
            await DetallesImpuestosFacturaCliente.create({
                idFacturaCliente:  factura.idFacturaCliente,
                idDetallesFactura: det.idDetallesFactura,
                tipoImpuesto:      '0',
                nombreImpuesto:    null,
                porcentaje:        0,
                baseGravable:      det.subTotal,
                valorImpuesto:     0,
                retencion:         false
            }, { transaction: t });
        }

        await t.commit();
        return res.json({ success: true, idFacturaCliente: factura.idFacturaCliente });

    } catch (error) {
        await t.rollback();
        console.error('procesarFactura:', error);
        return res.status(500).json({ success: false, mensaje: 'Error interno al procesar la factura.' });
    }
};

// ─── TIRILLA PDF ──────────────────────────────────────────────────────────────
const getTirillaPDF = async (req, res) => {
    const { id } = req.params;
    try {
        const factura = await FacturaClientes.findOne({
            where:   { idFacturaCliente: id },
            include: [
                { model: Clientes,           as: 'cliente' },
                { model: RegimenFacturacion, as: 'regimen' },
                { model: PuntosDeVenta,      as: 'puntoDeVenta' },
                {
                    model:   DetallesFactura, as: 'detalles',
                    include: [{ model: Productos, as: 'producto', attributes: ['nombreProducto'] }]
                }
            ]
        });
        if (!factura) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada.' });

        const pagosFactura = await DetallesPagosFactura.findAll({
            where:   { idFacturaCliente: id },
            include: [{ model: Entidades, as: 'entidad', attributes: ['nombreEntidad'] }]
        });

        const municipio = factura.puntoDeVenta?.ciudad
            ? await Municipios.findOne({ where: { id: factura.puntoDeVenta.ciudad }, attributes: ['nombre'], raw: true })
            : null;

        let clienteUbicacion = null;
        if (factura.idCliente !== '0') {
            clienteUbicacion = await ClientesUbicacion.findOne({
                where: { idCliente: factura.idCliente },
                order: [['createdAt', 'DESC']],
                raw: true
            });
        }

        // ── PDF ───────────────────────────────────────────────────────────────
        const W      = 227;
        const MARGIN = 8;
        const CW     = W - MARGIN * 2;
        const LOGO_SIZE = 60;
        const estH   = 350 + factura.detalles.length * 24 + pagosFactura.length * 18 + 100 + LOGO_SIZE + 10;

        const doc    = new PDFDocument({ size: [W, estH], margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, autoFirstPage: true });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        const pdfEnd = new Promise(r => doc.on('end', r));

        const reg = factura.regimen;
        const pdv = factura.puntoDeVenta;
        const cli = factura.cliente;

        // Helper: fila multi-columna
        const row = (cols, startY) => {
            let maxY = startY;
            for (const { txt, x, w, align, bold, size } of cols) {
                doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size || 6.5);
                doc.text(txt, x, startY, { width: w, align: align || 'left', lineBreak: true });
                if (doc.y > maxY) maxY = doc.y;
                doc.y = startY;
            }
            doc.y = maxY + 1;
        };
        const hr = () => { doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CW, doc.y).strokeColor('#888').lineWidth(0.5).stroke(); doc.moveDown(0.3); };

        // CABECERA — logo centrado
        const logoX = MARGIN + (CW - LOGO_SIZE) / 2;
        doc.image(LOGO_PATH, logoX, MARGIN, { width: LOGO_SIZE, height: LOGO_SIZE });
        doc.y = MARGIN + LOGO_SIZE + 4;

        doc.font('Helvetica-Bold').fontSize(9).text(reg?.razonSocial || '', MARGIN, doc.y, { width: CW, align: 'center' });
        doc.font('Helvetica').fontSize(7);
        if (reg?.taxId) doc.text(`NIT: ${reg.taxId}${reg.DV ? '-' + reg.DV : ''}`, MARGIN, doc.y, { width: CW, align: 'center' });
        if (pdv?.direccionPrincipal) doc.text(pdv.direccionPrincipal, MARGIN, doc.y, { width: CW, align: 'center' });
        if (municipio?.nombre) doc.text(municipio.nombre, MARGIN, doc.y, { width: CW, align: 'center' });
        if (reg?.responsabilidades) doc.text(reg.responsabilidades, MARGIN, doc.y, { width: CW, align: 'center' });

        doc.moveDown(0.3); hr();

        // Número y fecha de factura
        doc.font('Helvetica-Bold').fontSize(8)
           .text(`Factura No: ${factura.prefijo || ''}${factura.numeroFactura}`, MARGIN, doc.y, { width: CW });
        doc.font('Helvetica').fontSize(7)
           .text(`Fecha: ${factura.fechaEmision}  Hora: ${factura.horaEmision || ''}`, MARGIN, doc.y, { width: CW });

        doc.moveDown(0.3); hr();

        // Cliente
        if (factura.idCliente === '0') {
            doc.font('Helvetica-Bold').fontSize(7).text('Cliente: Consumidor Final', MARGIN, doc.y, { width: CW });
        } else if (cli) {
            const nomCli = [cli.primer_nombre, cli.segundo_nombre, cli.primer_apellido, cli.segundo_apellido].filter(Boolean).join(' ');
            const docCli = `${cli.tipo_documento || ''} ${cli.numero_doc || ''}${cli.digito_verif ? '-' + cli.digito_verif : ''}`.trim();
            doc.font('Helvetica-Bold').fontSize(7).text(`Cliente: ${nomCli}`, MARGIN, doc.y, { width: CW });
            doc.font('Helvetica').fontSize(7).text(`Doc: ${docCli}`, MARGIN, doc.y, { width: CW });
            if (clienteUbicacion) {
                const dir = [clienteUbicacion.direccion, clienteUbicacion.nombreMunicipio, clienteUbicacion.nombreDepartamento].filter(Boolean).join(', ');
                doc.text(`Dir: ${dir}`, MARGIN, doc.y, { width: CW });
            }
        }

        doc.moveDown(0.3); hr();

        // Tabla de productos — encabezado
        const c1 = CW * 0.42, c2 = CW * 0.11, c3 = CW * 0.23, c4 = CW * 0.24;
        row([
            { txt: 'Producto',  x: MARGIN,            w: c1, bold: true },
            { txt: 'Cant',      x: MARGIN + c1,        w: c2, bold: true, align: 'center' },
            { txt: 'V/U',       x: MARGIN + c1 + c2,   w: c3, bold: true, align: 'right' },
            { txt: 'Subtotal',  x: MARGIN + c1+c2+c3,  w: c4, bold: true, align: 'right' }
        ], doc.y);
        hr();

        let subtotalFactura = 0;
        for (const det of factura.detalles) {
            const nombre = det.producto?.nombreProducto || det.idProducto;
            const vu     = parseFloat(det.valorUnidad);
            const vtotal = parseFloat(det.total);
            subtotalFactura += vtotal;
            row([
                { txt: nombre,         x: MARGIN,            w: c1 },
                { txt: String(parseInt(det.cantidad)), x: MARGIN + c1, w: c2, align: 'center' },
                { txt: `$${fmtCOP(vu)}`,    x: MARGIN + c1 + c2,  w: c3, align: 'right' },
                { txt: `$${fmtCOP(vtotal)}`, x: MARGIN+c1+c2+c3, w: c4, align: 'right' }
            ], doc.y);
        }

        hr();

        // Totales
        const totRow = (label, valor, bold = false) => {
            const tY = doc.y;
            doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 7.5 : 7);
            doc.text(label, MARGIN, tY, { width: CW * 0.65 });
            doc.text(`$${fmtCOP(valor)}`, MARGIN + CW * 0.65, tY, { width: CW * 0.35, align: 'right' });
            doc.y = Math.max(doc.y, tY + (bold ? 10 : 9));
            doc.moveDown(0.1);
        };
        totRow('Subtotal:', subtotalFactura);
        totRow('Total Impuestos:', 0);
        doc.moveDown(0.1);
        totRow('TOTAL A PAGAR:', subtotalFactura, true);

        hr();

        // Métodos de pago
        doc.font('Helvetica-Bold').fontSize(7).text('MÉTODOS DE PAGO', MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.2);
        const p1 = CW * 0.38, p2 = CW * 0.32, p3 = CW * 0.30;
        row([
            { txt: 'Método',     x: MARGIN,      w: p1, bold: true },
            { txt: 'Referencia', x: MARGIN + p1, w: p2, bold: true },
            { txt: 'Valor',      x: MARGIN+p1+p2, w: p3, bold: true, align: 'right' }
        ], doc.y);
        for (const pago of pagosFactura) {
            const nomEntidad = pago.metodoPago === 'Efectivo' ? 'Efectivo' : (pago.entidad?.nombreEntidad || pago.metodoPago);
            row([
                { txt: nomEntidad,               x: MARGIN,       w: p1 },
                { txt: pago.nroReferencia || '-', x: MARGIN + p1,  w: p2 },
                { txt: `$${fmtCOP(parseFloat(pago.valor))}`, x: MARGIN+p1+p2, w: p3, align: 'right' }
            ], doc.y);
        }

        hr();

        // Footer punto de venta
        if (pdv?.footerBill) {
            doc.font('Helvetica').fontSize(6.5).text(pdv.footerBill, MARGIN, doc.y, { width: CW, align: 'center' });
            doc.moveDown(0.4);
        }

        // Footer CODEDREAM
        const footerCD = process.env.FOOTER_CODEDREAM || '';
        if (footerCD) {
            doc.font('Helvetica').fontSize(6).text(footerCD, MARGIN, doc.y, { width: CW, align: 'center' });
        }

        doc.end();
        await pdfEnd;

        const buf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="tirilla-${factura.prefijo || ''}${factura.numeroFactura}.pdf"`);
        res.setHeader('Content-Length', buf.length);
        return res.send(buf);

    } catch (error) {
        console.error('getTirillaPDF:', error);
        return res.status(500).json({ success: false, mensaje: 'Error al generar la tirilla.' });
    }
};

// ─── BUSCAR PRODUCTO POR SKU (nuevo traslado) ────────────────────────────────
const buscarProductoPorSKU = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    const { sku } = req.query;
    if (!sku) return res.json({ success: false });
    try {
        const producto = await Productos.findOne({
            where: { sku: sku.trim().toUpperCase() },
            attributes: ['idProducto', 'nombreProducto', 'sku']
        });
        if (!producto) return res.json({ success: false, mensaje: 'Producto no encontrado.' });

        const stockRows = await Stock.findAll({
            where: { idProducto: producto.idProducto, idPuntoVenta: idPdv }
        });
        const stockDisponible = stockRows.reduce((sum, s) => sum + parseFloat(s.cantidadExistente || 0), 0);

        return res.json({
            success: true,
            idProducto:      producto.idProducto,
            nombreProducto:  producto.nombreProducto,
            sku:             producto.sku,
            stockDisponible
        });
    } catch (e) {
        return res.status(500).json({ success: false });
    }
};

// ─── CREAR TRASLADO DE UNIDADES SUELTAS ──────────────────────────────────────
const crearTrasladoSueltos = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    const { items, idDestino, codigoEmpleado, notas } = req.body;

    if (!idDestino || !codigoEmpleado || !Array.isArray(items) || !items.length) {
        return res.status(400).json({ success: false, mensaje: 'Datos incompletos.' });
    }

    const empleado = await Empleados.findOne({
        where: { codigoEmpleado: codigoEmpleado.trim().toUpperCase() },
        attributes: ['idEmpleado']
    });
    if (!empleado) return res.status(400).json({ success: false, mensaje: 'Código de empleado no encontrado.' });

    const t = await db.transaction();
    try {
        for (const item of items) {
            const cantSolicitada = parseInt(item.cantidad);
            if (!item.idProducto || cantSolicitada <= 0) {
                await t.rollback();
                return res.status(400).json({ success: false, mensaje: 'Ítem inválido.' });
            }

            const stockRows = await Stock.findAll({
                where: { idProducto: item.idProducto, idPuntoVenta: idPdv, cantidadExistente: { [Op.gt]: 0 } },
                order: [['createdAt', 'ASC']],
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            const totalDisponible = stockRows.reduce((sum, s) => sum + parseFloat(s.cantidadExistente), 0);
            if (totalDisponible < cantSolicitada) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    mensaje: `Stock insuficiente para SKU ${item.sku || item.idProducto}. Disponible: ${totalDisponible}, solicitado: ${cantSolicitada}.`
                });
            }

            let restante = cantSolicitada;
            for (const row of stockRows) {
                if (restante <= 0) break;
                const disponible = parseFloat(row.cantidadExistente);
                if (disponible <= restante) {
                    await row.update({ cantidadExistente: 0 }, { transaction: t });
                    restante -= disponible;
                } else {
                    await row.update({ cantidadExistente: disponible - restante }, { transaction: t });
                    restante = 0;
                }
            }
        }

        const ultimoTraslado = await Traslados.findOne({ order: [['createdAt', 'DESC']], transaction: t });
        const nroSiguiente   = ultimoTraslado ? parseInt(ultimoTraslado.codigoTraslado.split('-')[1]) + 1 : 1000;
        const nuevoCodigo    = `TR-${nroSiguiente}`;

        const traslado = await Traslados.create({
            codigoTraslado:    nuevoCodigo,
            idOrigen:          idPdv,
            idDestino,
            idUsuarioDespacha: empleado.idEmpleado,
            notas:             notas || null,
            estado:            'EN_TRANSITO'
        }, { transaction: t });

        for (const item of items) {
            await DetalleTraslados.create({
                idTraslado: traslado.idTraslado,
                idPack:     null,
                idProducto: item.idProducto,
                cantidad:   parseInt(item.cantidad)
            }, { transaction: t });
        }

        await t.commit();

        const pendientes = await Traslados.count({
            where: { idDestino, estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] } }
        });
        broadcast(idDestino, 'new_traslado', { codigo: nuevoCodigo, pendientes });
        broadcast(idDestino, 'state', { pendientes });

        return res.json({ success: true, idTraslado: traslado.idTraslado, codigo: nuevoCodigo });
    } catch (e) {
        await t.rollback();
        console.error('crearTrasladoSueltos:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

// ─── VERIFICAR TRASLADOS EXPIRADOS (llamado periódicamente) ──────────────────
const verificarTrasladosExpirados = async () => {
    try {
        const maxHours = parseInt(process.env.MAX_TRANSFER_HOURS) || 24;
        const corte    = new Date(Date.now() - maxHours * 60 * 60 * 1000);

        const expirados = await Traslados.findAll({
            where: {
                estado:     { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] },
                fechaEnvio: { [Op.lt]: corte }
            },
            include: [{ model: DetalleTraslados, as: 'items' }]
        });

        for (const traslado of expirados) {
            const t = await db.transaction();
            try {
                for (const detalle of traslado.items) {
                    if (detalle.idPack) {
                        await Stock.update(
                            { cantidadExistente: db.literal('cantidadOriginal'), estadoInterno: 'CERRADO' },
                            { where: { idPack: detalle.idPack, idPuntoVenta: traslado.idOrigen }, transaction: t }
                        );
                        await Pack.update(
                            { estado: 'EMPACADO' },
                            { where: { idPack: detalle.idPack }, transaction: t }
                        );
                    } else if (detalle.idProducto) {
                        const stockRef = await Stock.findOne({
                            where: { idProducto: detalle.idProducto },
                            order: [['createdAt', 'DESC']],
                            transaction: t
                        });
                        await Stock.create({
                            idPuntoVenta:      traslado.idOrigen,
                            idPack:            null,
                            idProducto:        detalle.idProducto,
                            cantidadExistente: detalle.cantidad,
                            cantidadOriginal:  detalle.cantidad,
                            valorUnidad:       stockRef?.valorUnidad || 0,
                            estadoInterno:     'SUELTO'
                        }, { transaction: t });
                    }
                }

                await traslado.update({ estado: 'DEVUELTO' }, { transaction: t });
                await t.commit();

                broadcast(traslado.idOrigen, 'traslado_devuelto', {
                    idTraslado:  traslado.idTraslado,
                    codigo:      traslado.codigoTraslado
                });
            } catch (e) {
                await t.rollback();
                console.error('verificarTrasladosExpirados traslado', traslado.idTraslado, e);
            }
        }
    } catch (e) {
        console.error('verificarTrasladosExpirados:', e);
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
    getPerfilProducto,
    buscarPosProducto,
    getPosProductoJSON,
    buscarClientePorDoc,
    getMunicipiosStoreJSON,
    guardarCliente,
    getEntidadesJSON,
    procesarFactura,
    getTirillaPDF,
    buscarProductoPorSKU,
    crearTrasladoSueltos,
    verificarTrasladosExpirados
};
