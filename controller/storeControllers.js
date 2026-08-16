import {
    Traslados, DetalleTraslados, PuntosDeVenta,
    Pack, DetallesPack, Productos, Stock, Imagenes,
    Empleados, InsidenciaTraslado,
    Clientes, ClientesTributario, ClientesUbicacion,
    Departamentos, Municipios, Documentacion,
    Atributos, VariacionesProducto, Entidades,
    FacturaClientes, DetallesFactura, DetallesImpuestosFacturaCliente,
    DetallesPagosFactura, RegimenFacturacion, Egresos,
    CajaTienda, UserPermisos, PermisosAcciones, PermisosRecursos,
    PedidosWeb, DetallesPedidoWeb, PagosPedidoWeb
} from '../models/index.js';
import { Op, fn, col, literal } from 'sequelize';
import { sincronizarReservas, liberarReservas, demandaDeOtrosJson, ajustarPorStock, reconciliarPorVenta } from '../helpers/reservasCarrito.js';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import path from 'path';
import db from '../config/bd.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const LOGO_PATH  = path.resolve(__dirname, '../public/img/logo.png');
import { addClient, removeClient, sendEvent, broadcast } from '../helpers/sseManager.js';
import { resolverIds } from '../middlewares/verificarPermisoEmpleado.js';
import { Upload } from '@aws-sdk/lib-storage';
import s3Client from '../config/r2.js';
import sharp from 'sharp';
import { crearConCodigo } from '../helpers/secuencias.js';
import { resolverPagoWebParaFactura } from '../helpers/pagoWeb.js';

// ─── PÁGINAS ────────────────────────────────────────────────────────────────

const dashboardStores = async (req, res) => {
    const idPuntoDeVenta = req.idPuntoDeVenta;

    const maxCajaHours = parseInt(process.env.MAX_CAJA_HOURS) || 0;
    const limiteCaja = new Date();
    if (maxCajaHours > 0) {
        limiteCaja.setTime(limiteCaja.getTime() - maxCajaHours * 60 * 60 * 1000);
    } else {
        limiteCaja.setHours(0, 0, 0, 0);
    }

    const [trasladosPendientes, departamentos, clienteRaw, cajaDelDiaAnterior, pedidosWebPendientes] = await Promise.all([
        idPuntoDeVenta
            ? Traslados.count({ where: { idDestino: idPuntoDeVenta, estado: 'EN_TRANSITO' } })
            : 0,
        Departamentos.findAll({ attributes: ['id', 'nombre'], order: [['nombre', 'ASC']], raw: true }),
        Clientes.findOne({ where: { idCliente: '0' }, raw: true }).catch(() => null),
        idPuntoDeVenta
            ? CajaTienda.findOne({
                where: {
                    idPuntoDeVenta,
                    estado: 'abierto',
                    fechaCierre: null,
                    permite_factura_extemporanea: false,
                    fechaApertura: { [Op.lt]: limiteCaja }
                },
                attributes: ['idCajaTienda', 'fechaApertura'],
                raw: true
              })
            : null,
        idPuntoDeVenta
            ? PedidosWeb.findAll({
                where: { idTiendaFacturacion: idPuntoDeVenta, estado: 'trasladado', idFacturaCliente: null },
                attributes: ['idPedido', 'numeroPedido', 'nombreCliente', 'apellidoCliente', 'total', 'metodoPago', 'tipoEntrega'],
                order: [['createdAt', 'ASC']],
                raw: true
              })
            : []
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
        clienteGenerico,
        cajaMenorDefault: parseFloat(process.env.PETTY_CASH_FOUND) || 0,
        cajaDelDiaAnterior: cajaDelDiaAnterior || null,
        pedidosWebPendientes: pedidosWebPendientes.map(p => ({
            idPedido: p.idPedido,
            numeroPedido: p.numeroPedido,
            nombreCliente: `${p.nombreCliente} ${p.apellidoCliente}`,
            total: p.total,
            metodoPago: p.metodoPago,
            tipoEntrega: p.tipoEntrega
        }))
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
    const idPdv     = req.idPuntoDeVenta;
    const idUsuario = req.usuario?.idUsuario;
    if (!idPdv) return res.status(403).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    addClient(idPdv, res);
    if (idUsuario) addClient(idUsuario, res); // canal de permisos por usuario

    // Estado inicial
    await _enviarEstado(idPdv, res);

    // Heartbeat cada 25s para mantener viva la conexión
    const hb = setInterval(() => res.write(': ping\n\n'), 25000);

    req.on('close', () => {
        clearInterval(hb);
        removeClient(idPdv, res);
        if (idUsuario) removeClient(idUsuario, res);
    });
};

const _enviarEstado = async (idPdv, res) => {
    try {
        const pendientes = await Traslados.count({
            where: { idDestino: idPdv, estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] } }
        });
        const controversias = await Traslados.count({
            where: { idOrigen: idPdv, estado: 'EN_CONTROVERSIA' }
        });
        sendEvent(res, 'state', { pendientes, controversias });
    } catch (_) {}
};

// ─── PEDIDOS WEB (asignados a esta tienda para despachar) ───────────────────

const getPedidosWebPendientesJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    try {
        const pedidos = await PedidosWeb.findAll({
            where: { idTiendaFacturacion: idPdv, estado: 'trasladado', idFacturaCliente: null },
            attributes: ['idPedido', 'numeroPedido', 'nombreCliente', 'apellidoCliente', 'total', 'metodoPago', 'tipoEntrega'],
            order: [['createdAt', 'ASC']],
            raw: true
        });
        return res.json({
            success: true,
            pedidos: pedidos.map(p => ({
                idPedido: p.idPedido,
                numeroPedido: p.numeroPedido,
                nombreCliente: `${p.nombreCliente} ${p.apellidoCliente}`,
                total: p.total,
                metodoPago: p.metodoPago,
                tipoEntrega: p.tipoEntrega
            }))
        });
    } catch (e) {
        console.error('getPedidosWebPendientesJSON:', e);
        return res.status(500).json({ success: false });
    }
};

// Devuelve los ítems del pedido en el mismo formato que usa el buscador del POS
// (buscarPosProducto), listos para pasarle a addToCart() en el cliente.
const getPedidoWebParaCargarJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    const { idPedido } = req.params;
    if (!idPdv) return res.status(403).json({ success: false });

    try {
        const pedido = await PedidosWeb.findOne({
            where: { idPedido, idTiendaFacturacion: idPdv, estado: 'trasladado', idFacturaCliente: null },
            include: [
                { model: DetallesPedidoWeb, as: 'detalles' },
                { model: PagosPedidoWeb, as: 'pagos', required: false }
            ]
        });
        if (!pedido) return res.status(404).json({ success: false, mensaje: 'Pedido no encontrado o ya no está pendiente para esta tienda.' });
        if (!pedido.detalles.length) return res.status(400).json({ success: false, mensaje: 'El pedido no tiene productos.' });

        const idsProductos = pedido.detalles.map(d => d.idProducto);
        const [productos, stockRows] = await Promise.all([
            Productos.findAll({
                where: { idProducto: { [Op.in]: idsProductos } },
                attributes: ['idProducto', 'nombreProducto', 'sku', 'precioVentaMayorista', 'precioVentaPublicoFinal'],
                include: [{ model: Imagenes, as: 'imagenes', attributes: ['nombreImagen'], limit: 1, required: false }]
            }),
            Stock.findAll({
                where: { idPuntoVenta: idPdv, idProducto: { [Op.in]: idsProductos }, cantidadExistente: { [Op.gt]: 0 } },
                attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'stock']],
                group: ['idProducto'],
                raw: true
            })
        ]);
        const mapProducto = new Map(productos.map(p => [p.idProducto, p]));
        const mapStock = Object.fromEntries(stockRows.map(r => [r.idProducto, parseInt(r.stock) || 0]));

        const r2 = `${process.env.R2_PUBLIC_URL}/productos/`;

        const items = pedido.detalles.map(d => {
            const prod = mapProducto.get(d.idProducto);
            if (!prod) return null;
            const img = prod.imagenes?.[0]?.nombreImagen;
            return {
                idProducto: prod.idProducto,
                nombreProducto: prod.nombreProducto,
                sku: prod.sku,
                precioVentaMayorista: parseFloat(prod.precioVentaMayorista) || 0,
                precioVentaPublicoFinal: parseFloat(prod.precioVentaPublicoFinal) || 0,
                stock: mapStock[prod.idProducto] || 0,
                imagen: img ? `${r2}${img}` : '/img/image-default.webp',
                cantidadPedida: Number(d.cantidad)
            };
        }).filter(Boolean);

        // Pago que ya cobró la pasarela. El POS lo muestra bloqueado: el cajero no está
        // recibiendo plata, solo deja constancia de lo que Wompi confirmó.
        const pagoWeb = await resolverPagoWebParaFactura(pedido);

        return res.json({
            success: true,
            numeroPedido: pedido.numeroPedido,
            nombreCliente: `${pedido.nombreCliente} ${pedido.apellidoCliente}`,
            cedula: pedido.cedula,
            metodoPago: pedido.metodoPago,
            pagoWeb,
            items
        });
    } catch (e) {
        console.error('getPedidoWebParaCargarJSON:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar el pedido.' });
    }
};

const pedidosWebStorePage = async (req, res) => {
    return res.render('./tienda/pedidosWeb/lista', {
        pagina: 'Pedidos Web',
        csrfToken: req.csrfToken(),
        currentPath: '/pedidos-web'
    });
};

const ESTADOS_PEDIDO_WEB_STORE = ['pendiente_pago', 'en_revision', 'trasladado', 'facturado', 'cancelado'];

// Listado paginado de todos los pedidos web alguna vez asignados a esta tienda (no solo los pendientes).
const getPedidosWebListaJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    const { estado = '' } = req.query;
    const pagina  = Math.max(1, parseInt(req.query.pagina) || 1);
    const limite  = parseInt(process.env.LIMIT_PER_PAGE) || 10;
    const offset  = (pagina - 1) * limite;

    try {
        const where = { idTiendaFacturacion: idPdv };
        if (estado && ESTADOS_PEDIDO_WEB_STORE.includes(estado)) where.estado = estado;

        const { count, rows } = await PedidosWeb.findAndCountAll({
            where,
            attributes: ['idPedido', 'numeroPedido', 'nombreCliente', 'apellidoCliente', 'email', 'telefono', 'metodoPago', 'tipoEntrega', 'total', 'estado', 'idFacturaCliente', 'createdAt'],
            order: [['createdAt', 'DESC']],
            limit: limite,
            offset
        });

        return res.json({
            success: true,
            pedidos: rows.map(p => ({
                idPedido: p.idPedido,
                numeroPedido: p.numeroPedido,
                nombreCliente: `${p.nombreCliente} ${p.apellidoCliente}`,
                email: p.email,
                telefono: p.telefono,
                metodoPago: p.metodoPago,
                tipoEntrega: p.tipoEntrega,
                total: p.total,
                estado: p.estado,
                idFacturaCliente: p.idFacturaCliente,
                createdAt: p.createdAt
            })),
            totalPaginas: Math.ceil(count / limite),
            paginaActual: pagina,
            total: count
        });
    } catch (e) {
        console.error('getPedidosWebListaJSON:', e);
        return res.status(500).json({ success: false });
    }
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
                { model: PuntosDeVenta, as: 'origen',  attributes: ['nombreComercial'], required: false },
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

// ─── HELPER: verificar permiso de traslado ────────────────────────────────────
const _checkPermisoTraslado = async (codigoEmpleado, nombreAccion, idPdv = null) => {
    const empleado = await Empleados.findOne({
        where: { codigoEmpleado: codigoEmpleado.trim().toUpperCase() },
        attributes: ['idEmpleado', 'PrimerNombre', 'PrimerApellido', 'idUsuario', 'idPuntoDeVenta']
    });
    if (!empleado) return { ok: false, mensaje: 'Código de empleado no encontrado.' };
    if (!empleado.idUsuario) return { ok: false, mensaje: 'El empleado no tiene cuenta de usuario.' };
    if (idPdv && empleado.idPuntoDeVenta !== idPdv) {
        return { ok: false, mensaje: 'El empleado no pertenece a esta tienda.' };
    }

    const [recurso, accion] = await Promise.all([
        PermisosRecursos.findOne({ where: { nombreRecurso: 'Traslados', tipo: 'vendedor' }, attributes: ['idRecurso'], raw: true }),
        PermisosAcciones.findOne({ where: { nombreAccion: nombreAccion }, attributes: ['idAccion'], raw: true })
    ]);
    if (!recurso || !accion) return { ok: false, mensaje: 'Configuración de permisos inválida.' };

    const permiso = await UserPermisos.findOne({
        where: { idUsuario: empleado.idUsuario, idRecurso: recurso.idRecurso, idAccion: accion.idAccion }
    });
    if (!permiso) return { ok: false, mensaje: `El empleado no tiene permiso (${nombreAccion}) para traslados.` };

    return { ok: true, empleado };
};

// ─── HELPERS: operaciones comunes de traslado ─────────────────────────────────

const _calcularValorPack = async (idPack, transaction) => {
    const detalles = await DetallesPack.findAll({ where: { idPack }, transaction });
    return detalles.reduce((s, d) => s + (parseFloat(d.valorUnidad || 0) * d.cantidad), 0);
};

const _crearStockRow = async (idPuntoVenta, { idPack, idProducto }, cantidad, transaction) => {
    if (idPack) {
        await Stock.create({
            idPuntoVenta,
            idPack,
            idProducto:        null,
            cantidadExistente: cantidad,
            cantidadOriginal:  cantidad,
            valorUnidad:       await _calcularValorPack(idPack, transaction),
            estadoInterno:     'CERRADO'
        }, { transaction });
    } else if (idProducto) {
        const ref = await Stock.findOne({
            where: { idProducto },
            order: [['createdAt', 'DESC']],
            transaction
        });
        await Stock.create({
            idPuntoVenta,
            idPack:            null,
            idProducto,
            cantidadExistente: cantidad,
            cantidadOriginal:  cantidad,
            valorUnidad:       ref?.valorUnidad || 0,
            estadoInterno:     'SUELTO'
        }, { transaction });
    }
};

const _crearTraslado = async (idOrigen, idDestino, idEmpleado, notas, transaction) => {
    const traslado = await crearConCodigo(Traslados, 'codigoTraslado', 'TR-', 'traslado', {
        idOrigen,
        idDestino,
        idUsuarioDespacha: idEmpleado,
        notas:             notas || null,
        estado:            'EN_TRANSITO'
    }, transaction);
    return { traslado, codigo: traslado.codigoTraslado };
};

const _broadcastEstadoTraslado = async (idDestino, idOrigen = null) => {
    const pendientes = await Traslados.count({
        where: { idDestino, estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] } }
    });
    broadcast(idDestino, 'state', { pendientes });
    if (idOrigen && !['PRODUCCION', 'BODEGA-VIRTUAL'].includes(idOrigen)) {
        const controversias = await Traslados.count({
            where: { idOrigen, estado: 'EN_CONTROVERSIA' }
        });
        broadcast(idOrigen, 'state', { controversias });
    }
    return pendientes;
};

// ─── HELPERS CAJA ────────────────────────────────────────────────────────────

// Dos iniciales (palabras compuestas) o las dos primeras letras (palabra única) del nombre de la tienda
const _prefijoTienda = (nombreComercial) => {
    const limpio = (nombreComercial || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z\s]/g, '');
    const palabras = limpio.split(/\s+/).filter(Boolean);
    if (palabras.length >= 2) return palabras[0][0] + palabras[1][0];
    return (palabras[0] || 'XX').padEnd(2, 'X').slice(0, 2);
};

// Código único y correlativo por tienda: PREFIJO-000001
const _generarCodigoCaja = async (idPuntoDeVenta, nombreComercial) => {
    const prefijo = _prefijoTienda(nombreComercial);
    const ultimo = await CajaTienda.findOne({
        where: { idPuntoDeVenta, codigo: { [Op.like]: `${prefijo}-%` } },
        order: [['createdAt', 'DESC']]
    });
    const nro = ultimo ? parseInt(ultimo.codigo.split('-')[1], 10) + 1 : 1;
    return `${prefijo}-${String(nro).padStart(6, '0')}`;
};

const _getCajaAbierta = (idPuntoDeVenta, includes = []) =>
    CajaTienda.findOne({
        where: { idPuntoDeVenta, estado: 'abierto', fechaCierre: null },
        include: includes
    });

// estadoTx: 'pendiente' para caja activa, 'liquidada' para PDF de caja ya cerrada
const _calcularTransaccionesCaja = async (idPdv, inicio, fin, estadoTx = 'pendiente') => {
    const [egresosRows, facturas] = await Promise.all([
        Egresos.findAll({
            where: { idPuntoDeVenta: idPdv, estado: estadoTx, createdAt: { [Op.between]: [inicio, fin] } },
            attributes: ['idEgreso', 'referencia', 'descripcion', 'valorEgreso'],
            raw: true
        }),
        FacturaClientes.findAll({
            where: { idPuntoDeVenta: idPdv, estado: estadoTx, createdAt: { [Op.between]: [inicio, fin] } },
            attributes: ['idFacturaCliente', 'prefijo', 'numeroFactura'],
            include: [{ model: DetallesPagosFactura, as: 'pagos',
                        include: [{ model: Entidades, as: 'entidad', attributes: ['nombreEntidad'] }] }]
        })
    ]);

    let sEfectivo = 0, sMedios = 0, sCredito = 0;
    const txEfectivo = [], txElectronicos = [], txCredito = [];
    const facturasEfectivo = new Set(), facturasElectronicos = new Set(), facturasCredito = new Set();

    for (const f of facturas) {
        const nroFactura = `${f.prefijo || ''}${f.numeroFactura}`;
        for (const p of f.pagos) {
            const val = Math.round(parseFloat(p.valor) || 0);
            if (p.metodoPago === 'Efectivo') {
                sEfectivo += val;
                txEfectivo.push({ idFacturaCliente: f.idFacturaCliente, nroFactura, entidad: 'Efectivo', referencia: p.nroReferencia || '—', valor: val });
                facturasEfectivo.add(f.idFacturaCliente);
            } else if (['Banco', 'Billetera Virtual', 'Tarjeta Credito'].includes(p.metodoPago)) {
                sMedios += val;
                txElectronicos.push({ idFacturaCliente: f.idFacturaCliente, nroFactura, entidad: p.entidad?.nombreEntidad || p.metodoPago, referencia: p.nroReferencia || '—', valor: val });
                facturasElectronicos.add(f.idFacturaCliente);
            } else if (p.metodoPago === 'Entidad Crediticia') {
                sCredito += val;
                txCredito.push({ idFacturaCliente: f.idFacturaCliente, nroFactura, entidad: p.entidad?.nombreEntidad || '—', referencia: p.nroReferencia || '—', valor: val });
                facturasCredito.add(f.idFacturaCliente);
            }
        }
    }

    const txEgresos  = egresosRows.map(e => ({ idEgreso: e.idEgreso, referencia: e.referencia || '—', descripcion: e.descripcion || '—', valor: Math.round(parseFloat(e.valorEgreso) || 0) }));
    const sEgresos   = txEgresos.reduce((s, e) => s + e.valor, 0);
    const idFacturas = facturas.map(f => f.idFacturaCliente);

    return {
        sEfectivo, sMedios, sCredito, sEgresos, sVentas: sEfectivo + sMedios + sCredito,
        txEfectivo, txElectronicos, txCredito, txEgresos, idFacturas,
        nFacturasEfectivo:     facturasEfectivo.size,
        nFacturasElectronicos: facturasElectronicos.size,
        nFacturasCredito:      facturasCredito.size,
        nFacturasTotal:        facturas.length
    };
};

// ─── ACEPTAR TRASLADO ────────────────────────────────────────────────────────

const aceptarTrasladoAPI = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    const { idTraslado, codigoEmpleado, items } = req.body;
    // items: [{ idDetalleTraslado, idPack, cantidadOriginal, cantidadAceptada, aceptado, razon }]

    if (!idTraslado || !codigoEmpleado || !Array.isArray(items)) {
        return res.status(400).json({ success: false, mensaje: 'Datos incompletos.' });
    }

    const empleado = req.empleadoVerificado;

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

            // Registrar movimiento de recepción
            await InsidenciaTraslado.create({
                idTraslado,
                idDetalleTraslado: item.idDetalleTraslado,
                idEmpleado:        empleado.idEmpleado,
                razonInsidencia:   aceptado
                    ? `RECIBIDO: ${cantAceptada}/${cantOriginal} uds`
                    : (item.razon || 'Sin descripción'),
                cantidadOriginal:  cantOriginal,
                cantidadAceptada:  cantAceptada,
                resuelta:          aceptado ? 'si' : 'no'
            }, { transaction: t });

            // Crear stock en destino
            if (cantAceptada > 0) await _crearStockRow(traslado.idDestino, item, cantAceptada, t);

        }

        await t.commit();
        await _broadcastEstadoTraslado(traslado.idDestino, traslado.idOrigen);

        return res.json({ success: true, estado: nuevoEstado });
    } catch (e) {
        // El try tiene trabajo después del commit: si algo falla ahí, la transacción ya está
        // cerrada y un rollback lanzaría otro error, dejando la petición sin respuesta.
        if (!t.finished) await t.rollback().catch(() => {});
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

            const zeroStockIds = productIdsTienda.filter(id => (mapTienda[id] || 0) <= 0);
            const stockOrderClause = zeroStockIds.length
                ? [[literal(`CASE WHEN \`Productos\`.\`idProducto\` IN (${zeroStockIds.map(id => `'${id}'`).join(',')}) THEN 1 ELSE 0 END`), 'ASC']]
                : [];

            const result = await Productos.findAndCountAll({
                where: whereProd,
                include: [{ model: Imagenes, as: 'imagenes', where: { tipo: 'principal' }, required: false }],
                order: [...stockOrderClause, ['nombreProducto', 'ASC']],
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
    const { idPack } = req.body;

    if (!idPack) {
        return res.status(400).json({ success: false, mensaje: 'idPack requerido.' });
    }

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

    const empleado = req.empleadoVerificado;

    const t = await db.transaction();
    try {
        const { traslado, codigo: nuevoCodigo } = await _crearTraslado(idPdv, idDestino, empleado.idEmpleado, notas, t);

        const recordsPacks = await Pack.findAll({
            where: { idPack: packs },
            include: [{ model: DetallesPack, as: 'DETALLES_PACKs' }],
            transaction: t
        });
        for (const pack of recordsPacks) {
            const detalle = await DetalleTraslados.create({
                idTraslado: traslado.idTraslado,
                idPack:     pack.idPack,
                cantidad:   1
            }, { transaction: t });
            await pack.update({ estado: 'TRASLADADO' }, { transaction: t });
            await Stock.update(
                { cantidadExistente: 0, estadoInterno: 'SUELTO' },
                { where: { idPack: pack.idPack, idPuntoVenta: idPdv }, transaction: t }
            );
            await InsidenciaTraslado.create({
                idTraslado:        traslado.idTraslado,
                idDetalleTraslado: detalle.idDetalleTraslado,
                idEmpleado:        empleado.idEmpleado,
                razonInsidencia:   `ENVIADO: pack ${pack.codigoEtiqueta || pack.idPack}`,
                cantidadOriginal:  1,
                cantidadAceptada:  1,
                resuelta:          'si'
            }, { transaction: t });
        }

        await t.commit();
        await _broadcastEstadoTraslado(idDestino);

        return res.json({ success: true, idTraslado: traslado.idTraslado, codigo: nuevoCodigo });
    } catch (e) {
        // El try tiene trabajo después del commit: si algo falla ahí, la transacción ya está
        // cerrada y un rollback lanzaría otro error, dejando la petición sin respuesta.
        if (!t.finished) await t.rollback().catch(() => {});
        console.error('trasladarDesdeStoreAPI:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

// ─── RESOLVER CONTROVERSIA ───────────────────────────────────────────────────

const resolverControversiaAPI = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    const { idTraslado, codigoEmpleado, resoluciones } = req.body;
    // resoluciones: [{ idDetalleTraslado, idPack, resolucion: 'RECIBIDO'|'ANULADO' }]

    if (!idTraslado || !codigoEmpleado || !Array.isArray(resoluciones) || !resoluciones.length) {
        return res.status(400).json({ success: false, mensaje: 'Datos incompletos.' });
    }

    const empleado = req.empleadoVerificado;

    const traslado = await Traslados.findByPk(idTraslado);
    if (!traslado || traslado.estado !== 'EN_CONTROVERSIA') {
        return res.status(400).json({ success: false, mensaje: 'Traslado no válido para resolución.' });
    }

    // Solo el punto de origen puede resolver controversias
    const esDesdeProduccion = traslado.idOrigen === 'PRODUCCION' || traslado.idOrigen === 'BODEGA-VIRTUAL';
    if (!esDesdeProduccion && traslado.idOrigen !== idPdv) {
        return res.status(403).json({ success: false, mensaje: 'Solo el punto de origen puede resolver esta controversia.' });
    }

    const nombreEmpleado = empleado.nombre;

    const t = await db.transaction();
    try {
        for (const item of resoluciones) {
            const detalle = await DetalleTraslados.findByPk(item.idDetalleTraslado, { transaction: t });
            if (!detalle) continue;

            const cantControversia = detalle.cantidadControversia ?? detalle.cantidad;

            if (item.resolucion === 'RECIBIDO') {
                await detalle.update({ estado: 'RECIBIDO' }, { transaction: t });
                const target = item.idPack ? { idPack: item.idPack } : { idProducto: detalle.idProducto };
                await _crearStockRow(traslado.idDestino, target, cantControversia, t);
                await InsidenciaTraslado.create({
                    idTraslado,
                    idDetalleTraslado: item.idDetalleTraslado,
                    idEmpleado:        empleado.idEmpleado,
                    razonInsidencia:   `ACEPTADO POR ORIGEN: ${nombreEmpleado}`,
                    cantidadOriginal:  cantControversia,
                    cantidadAceptada:  cantControversia,
                    resuelta:          'si'
                }, { transaction: t });
            } else if (item.resolucion === 'ANULADO') {
                await detalle.update({ estado: 'CONTROVERSIA' }, { transaction: t });

                if (item.idPack && esDesdeProduccion) {
                    await Pack.update({ estado: 'ANULADO' }, { where: { idPack: item.idPack }, transaction: t });
                }

                if (!esDesdeProduccion && cantControversia > 0) {
                    const target = item.idPack ? { idPack: item.idPack } : { idProducto: detalle.idProducto };
                    await _crearStockRow(traslado.idOrigen, target, cantControversia, t);
                }

                await InsidenciaTraslado.create({
                    idTraslado,
                    idDetalleTraslado: item.idDetalleTraslado,
                    idEmpleado:        empleado.idEmpleado,
                    razonInsidencia:   `ANULADO POR ORIGEN: ${nombreEmpleado}`,
                    cantidadOriginal:  cantControversia,
                    cantidadAceptada:  0,
                    resuelta:          'si'
                }, { transaction: t });
            }
        }

        await traslado.update({ estado: 'RECIBIDO' }, { transaction: t });
        await t.commit();
        await _broadcastEstadoTraslado(traslado.idDestino, idPdv);

        return res.json({ success: true });
    } catch (e) {
        // El try tiene trabajo después del commit: si algo falla ahí, la transacción ya está
        // cerrada y un rollback lanzaría otro error, dejando la petición sin respuesta.
        if (!t.finished) await t.rollback().catch(() => {});
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

        // Stock SUELTO agrupado por tienda (registros con idProducto directo)
        const stockRows = await Stock.findAll({
            where: { idProducto },
            attributes: ['idPuntoVenta', [fn('SUM', col('cantidadExistente')), 'total']],
            group: ['idPuntoVenta'],
            raw: true
        });

        // Stock en packs CERRADOS: Stock.idProducto es null, se resuelve via DetallesPack
        const detallesPorPack = await DetallesPack.findAll({
            where: { idProducto },
            attributes: ['idPack', 'cantidad'],
            raw: true
        });

        let packStockExtra = {};
        if (detallesPorPack.length) {
            const packIdList = [...new Set(detallesPorPack.map(dp => dp.idPack))];
            const cantPorPack = Object.fromEntries(detallesPorPack.map(dp => [dp.idPack, dp.cantidad]));

            const packStocks = await Stock.findAll({
                where: { idPack: { [Op.in]: packIdList }, cantidadExistente: { [Op.gt]: 0 } },
                attributes: ['idPuntoVenta', 'idPack', 'cantidadExistente'],
                raw: true
            });

            for (const ps of packStocks) {
                if (!ps.idPuntoVenta) continue;
                const units = (parseInt(ps.cantidadExistente) || 0) * (parseInt(cantPorPack[ps.idPack]) || 0);
                packStockExtra[ps.idPuntoVenta] = (packStockExtra[ps.idPuntoVenta] || 0) + units;
            }
        }

        const allPdvIds = [...new Set([
            ...stockRows.map(r => r.idPuntoVenta),
            ...Object.keys(packStockExtra)
        ])].filter(Boolean);

        let pdvMap = {};
        if (allPdvIds.length) {
            const pdvs = await PuntosDeVenta.findAll({
                where: { idPuntoDeVenta: { [Op.in]: allPdvIds } },
                attributes: ['idPuntoDeVenta', 'nombreComercial', 'tipo'],
                raw: true
            });
            pdvMap = Object.fromEntries(pdvs.map(p => [p.idPuntoDeVenta, p]));
        }

        const stockPdvSet = new Set(stockRows.map(r => r.idPuntoVenta));
        const stockPorTienda = [
            ...stockRows.map(r => ({
                nombreComercial: pdvMap[r.idPuntoVenta]?.nombreComercial || '—',
                tipo:            pdvMap[r.idPuntoVenta]?.tipo            || '—',
                total:           (parseInt(r.total) || 0) + (packStockExtra[r.idPuntoVenta] || 0),
                esTiendaActual:  r.idPuntoVenta === idPdv
            })),
            ...Object.entries(packStockExtra)
                .filter(([pdvId]) => pdvId && !stockPdvSet.has(pdvId))
                .map(([pdvId, packTotal]) => ({
                    nombreComercial: pdvMap[pdvId]?.nombreComercial || '—',
                    tipo:            pdvMap[pdvId]?.tipo            || '—',
                    total:           packTotal,
                    esTiendaActual:  pdvId === idPdv
                }))
        ].sort((a, b) => b.esTiendaActual - a.esTiendaActual);

        const cantidadActual = stockPorTienda.find(r => r.esTiendaActual)?.total || 0;

        const BODEGA_VIRTUAL_ID = '00000000-0000-0000-0000-000000000000';
        const destinos = idPdv ? await PuntosDeVenta.findAll({
            where: { idPuntoDeVenta: { [Op.notIn]: [idPdv, BODEGA_VIRTUAL_ID] } },
            attributes: ['idPuntoDeVenta', 'nombreComercial'],
            order: [['nombreComercial', 'ASC']],
            raw: true
        }) : [];

        return res.render('./tienda/inventario/perfilProducto', {
            pagina:         producto.nombreProducto,
            csrfToken:      req.csrfToken(),
            currentPath:    '/inventario/lista',
            producto:       producto.toJSON(),
            stockPorTienda,
            cantidadActual,
            destinos,
            r2Url:          `${process.env.R2_PUBLIC_URL}/productos/`
        });
    } catch (e) {
        console.error('getPerfilProducto:', e);
        return res.redirect('/store/inventario/lista');
    }
};

// POST /store/json/pos/reservas
// El POS avisa qué tiene cargado en "Tu Orden" para que web y otras tiendas lo sepan.
// No bloquea stock: la unidad es del primero que confirme la venta.
const sincronizarReservasPos = async (req, res) => {
    try {
        // El titular es el usuario del panel: dos vendedores en la misma tienda compiten
        // entre sí igual que con un cliente web.
        const referencia = String(req.usuario?.idUsuario || '');
        if (!referencia) return res.status(401).json({ success: false, mensaje: 'Sesión no válida.' });

        const items = Array.isArray(req.body?.items) ? req.body.items : [];

        // Si otra venta se llevó las unidades mientras el operador armaba la orden, se le
        // devuelve la corrección para que no intente facturar algo que ya no existe.
        const { items: ajustados, ajustes } = await ajustarPorStock(items);

        await sincronizarReservas({
            origen: 'pos',
            referencia,
            idPuntoDeVenta: req.idPuntoDeVenta || null,
            items: ajustados
        });

        const demanda = await demandaDeOtrosJson(ajustados.map(i => i.idProducto), { origen: 'pos', referencia }, { incluirTiendas: true });
        return res.json({ success: true, demanda, ajustes });
    } catch (e) {
        console.error('[pos] sincronizarReservasPos:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al registrar la orden.' });
    }
};

// Se llama al facturar o vaciar la orden: lo que ya se vendió o se descartó deja de competir.
const liberarReservasPos = async (req, res) => {
    try {
        const referencia = String(req.usuario?.idUsuario || '');
        if (referencia) await liberarReservas({ origen: 'pos', referencia });
        return res.json({ success: true });
    } catch (e) {
        console.error('[pos] liberarReservasPos:', e);
        return res.status(500).json({ success: false });
    }
};

const buscarPosProducto = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    const q = (req.query.q || '').trim();
    if (!q) return res.json({ success: true, productos: [] });

    try {
        const term = `%${q}%`;
        // Traemos hasta 50 candidatos para que el sort por stock posterior
        // no quede truncado antes de evaluar todos los coincidentes.
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
            limit: 50
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
        // Stock en OTRAS tiendas vendibles. Sirve para distinguir "acá no hay, pero se puede
        // pedir" de "no hay en ninguna parte": son dos situaciones muy distintas para quien
        // atiende, y hasta ahora las dos decían lo mismo.
        // Una sola consulta agregada para todos los productos, no una por fila.
        const stockOtras = await Stock.findAll({
            where: {
                idPuntoVenta: { [Op.ne]: idPdv },
                idProducto:   { [Op.in]: ids },
                cantidadExistente: { [Op.gt]: 0 }
            },
            attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'stock']],
            include: [{
                model: PuntosDeVenta,
                as: 'ubicacion',
                attributes: [],
                // Bodega y tránsito no cuentan: no son mercancía que otra tienda pueda vender.
                where: { tipo: 'Punto de venta' },
                required: true
            }],
            group: ['STOCKS.idProducto'],
            raw: true
        });
        const mapOtras = Object.fromEntries(stockOtras.map(r => [r.idProducto, parseInt(r.stock) || 0]));

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
                    stockOtrasTiendas:       mapOtras[p.idProducto] || 0,
                    imagen:                  img ? `${r2}${img}` : '/img/image-default.webp'
                };
            })
            .sort((a, b) => b.stock - a.stock)
            .slice(0, 8);

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
            variaciones.flatMap(v => (v.idAtributos || '').split('|').map(Number)).filter(Boolean)
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
  try {
    const { idCliente, idEmpleado, items, pagos, idPedidoWeb } = req.body;
    const idPuntoDeVenta = req.idPuntoDeVenta;
    const WHOLESALE_MIN  = parseInt(process.env.WHOLESALE_PRICE_MIN_PRODUCT) || 6;

    // ── 1. Validar datos del frontend ─────────────────────────────────────────
    if (!idPuntoDeVenta)
        return res.status(403).json({ success: false, mensaje: 'Sin punto de venta asignado.' });

    const cajaAbierta = await _getCajaAbierta(idPuntoDeVenta);
    if (!cajaAbierta)
        return res.status(403).json({ success: false, mensaje: 'No hay caja abierta. Debes abrir la caja antes de facturar.' });

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
    // Si la orden viene de un pedido web, el pago NO lo digita el cajero: ya lo cobró la pasarela.
    // Se reconstruye desde PAGOS_PEDIDO_WEB y se ignora por completo lo que haya mandado el
    // cliente, para que ni un bug del front ni una petición manipulada puedan cambiar el monto
    // o la entidad con la que queda registrada una venta ya cobrada.
    let pagosEfectivos = pagos;
    let itemsEfectivos = items;
    let idClienteEfectivo = idCliente;
    let detallesWeb = null;
    let pagoWebFactura = null;
    if (idPedidoWeb) {
        const pedidoWeb = await PedidosWeb.findOne({
            where: { idPedido: idPedidoWeb, idTiendaFacturacion: idPuntoDeVenta, estado: 'trasladado', idFacturaCliente: null }
        });
        if (!pedidoWeb)
            return res.status(400).json({ success: false, mensaje: 'El pedido web no está disponible para facturar en esta tienda.' });

        // Un pedido web es inmodificable desde el POS: el cliente ya pagó una lista concreta de
        // productos a un precio concreto. Ni los artículos ni el cliente se toman del body — se
        // reconstruyen desde el pedido, igual que ya se hacía con el pago. Así ni un bug del
        // front ni una petición manipulada pueden facturar algo distinto a lo que se compró.
        detallesWeb = await DetallesPedidoWeb.findAll({ where: { idPedido: pedidoWeb.idPedido }, raw: true });
        if (!detallesWeb.length)
            return res.status(400).json({ success: false, mensaje: 'El pedido web no tiene artículos.' });

        itemsEfectivos = detallesWeb.map(d => ({ idProducto: d.idProducto, cantidad: parseInt(d.cantidad) }));

        // El cliente sale del pedido (lo resolvió procesarPagoAprobado al confirmar el pago).
        // Si el pedido no alcanzó a vincular uno, se respeta el que mande el POS.
        if (pedidoWeb.idCliente) idClienteEfectivo = pedidoWeb.idCliente;

        pagoWebFactura = await resolverPagoWebParaFactura(pedidoWeb);
        if (pagoWebFactura) {
            pagosEfectivos = [{
                idEntidad: pagoWebFactura.idEntidad,
                valor: pagoWebFactura.valor,
                // Queda la transacción de la pasarela (o el voucher del QR) como referencia
                // del pago, para poder conciliar en el cuadre de caja.
                nroReferencia: pagoWebFactura.idTransaccion || pagoWebFactura.referencia || null
            }];
        }
    }

    if (!Array.isArray(pagosEfectivos) || pagosEfectivos.length === 0)
        return res.status(400).json({ success: false, mensaje: 'Sin métodos de pago.' });
    for (const p of pagosEfectivos) {
        const val = Number(p.valor);
        if (!Number.isFinite(val) || val <= 0)
            return res.status(400).json({ success: false, mensaje: 'Valor de pago inválido.' });
        if (p.idEntidad != null && !Number.isInteger(Number(p.idEntidad)))
            return res.status(400).json({ success: false, mensaje: 'idEntidad inválido.' });
        if (p.nroReferencia != null && typeof p.nroReferencia !== 'string')
            return res.status(400).json({ success: false, mensaje: 'Referencia inválida.' });
    }

    // ── 2. Verificar suma de pagos = total de la orden ────────────────────────
    const idProductos = [...new Set(itemsEfectivos.map(i => i.idProducto))];
    const productos   = await Productos.findAll({
        where: { idProducto: idProductos },
        attributes: ['idProducto', 'nombreProducto', 'precioVentaMayorista', 'precioVentaPublicoFinal'],
        raw: true
    });
    const prodMap = new Map(productos.map(p => [p.idProducto, p]));
    for (const it of itemsEfectivos)
        if (!prodMap.has(it.idProducto))
            return res.status(400).json({ success: false, mensaje: `Producto no encontrado: ${it.idProducto}.` });

    const totalCantidad   = itemsEfectivos.reduce((s, i) => s + parseInt(i.cantidad), 0);
    const esMayorista     = totalCantidad >= WHOLESALE_MIN;
    // En un pedido web el precio es el que el cliente ya pagó, no el vigente hoy en el POS:
    // la factura tiene que cuadrar contra el pago que entró. Para una venta de mostrador se
    // calcula normal, con la regla de mayorista.
    const precioWebPorProducto = new Map((detallesWeb || []).map(d => [d.idProducto, parseFloat(d.valorUnidad)]));
    let   totalOrden      = 0;
    const itemsProcesados = itemsEfectivos.map(it => {
        const prod    = prodMap.get(it.idProducto);
        const qty     = parseInt(it.cantidad);
        const precio  = precioWebPorProducto.has(it.idProducto)
            ? precioWebPorProducto.get(it.idProducto)
            : (esMayorista ? parseFloat(prod.precioVentaMayorista) : parseFloat(prod.precioVentaPublicoFinal));
        const subTotal = parseFloat((precio * qty).toFixed(2));
        totalOrden    += subTotal;
        return { idProducto: it.idProducto, nombreProducto: prod.nombreProducto, cantidad: qty, valorUnidad: precio, subTotal, total: subTotal };
    });
    totalOrden = parseFloat(totalOrden.toFixed(2));
    const sumaPagos = parseFloat(pagosEfectivos.reduce((s, p) => s + Number(p.valor), 0).toFixed(2));
    if (Math.abs(sumaPagos - totalOrden) > 1)
        return res.status(400).json({ success: false, mensaje: `Suma de pagos ($${sumaPagos}) ≠ total orden ($${totalOrden}).` });

    // ── 3. Verificar cliente ──────────────────────────────────────────────────
    const clienteExiste = await Clientes.count({ where: { idCliente: idClienteEfectivo.trim() } });
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
            idCliente:            idClienteEfectivo.trim(),
            idRegimenFacturacion: regimen.idRegimenFacturacion,
            idPuntoDeVenta,
            idEmpleado:           _idEmpleado,
            tipoDocumento:        regimen.tipoFactura || '03',
            prefijo:              regimen.prefijo     || '',
            numeroFactura:        String(nroFactura),
            fechaEmision:         `${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,'0')}-${String(ahora.getDate()).padStart(2,'0')}`,
            horaEmision:          ahora.toTimeString().slice(0, 8)
        }, { transaction: t });

        await RegimenFacturacion.update(
            { nroActual: nroFactura },
            { where: { idRegimenFacturacion: regimen.idRegimenFacturacion }, transaction: t }
        );

        // ── 6.5 Si esta venta viene de un pedido web asignado a esta tienda, se cierra el ciclo ──
        // (condicionado a estado/tienda para no pisar un pedido ya facturado por otro proceso en paralelo).
        if (idPedidoWeb && typeof idPedidoWeb === 'string') {
            await PedidosWeb.update(
                { estado: 'facturado', idFacturaCliente: factura.idFacturaCliente, fechaCambioEstado: new Date() },
                { where: { idPedido: idPedidoWeb, idTiendaFacturacion: idPuntoDeVenta, estado: 'trasladado', idFacturaCliente: null }, transaction: t }
            );
        }

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
        const idEntidades  = pagosEfectivos.filter(p => p.idEntidad != null).map(p => Number(p.idEntidad));
        const entidadesMap = new Map();
        if (idEntidades.length) {
            const ents = await Entidades.findAll({
                where: { idEntidad: idEntidades },
                attributes: ['idEntidad', 'tipoEntidad'],
                raw: true, transaction: t
            });
            ents.forEach(e => entidadesMap.set(e.idEntidad, e.tipoEntidad));
        }
        for (const p of pagosEfectivos) {
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

        // El stock bajó con esta venta: se podan los carritos web y las órdenes de otros
        // vendedores que ya no alcanzan. Cada uno se entera en su próxima sincronización.
        // Va después del commit y en su propio try: la factura ya está hecha y nada de esto
        // puede tumbarla.
        try {
            await reconciliarPorVenta(idProductos);
        } catch (e) {
            console.error('[procesarFactura] reconciliación de carritos:', e.message);
        }

        // Notificar admin con ventas y desglose de pagos del día para este PDV
        try {
            const hoyStart = new Date(); hoyStart.setHours(0, 0, 0, 0);
            const factHoy = await FacturaClientes.findAll({
                attributes: ['idFacturaCliente'],
                where: { idPuntoDeVenta, createdAt: { [Op.gte]: hoyStart } },
                raw: true
            });
            let ventasHoy = 0;
            const pagosHoy = { Efectivo: 0, Banco: 0, 'Billetera Virtual': 0, 'Entidad Crediticia': 0, 'Tarjeta Credito': 0 };
            if (factHoy.length) {
                const ids = factHoy.map(f => f.idFacturaCliente);
                const [detallesRows, pagosRows] = await Promise.all([
                    DetallesFactura.findAll({
                        attributes: [[fn('SUM', col('total')), 'suma']],
                        where: { idFacturaCliente: { [Op.in]: ids } },
                        raw: true
                    }),
                    DetallesPagosFactura.findAll({
                        attributes: ['metodoPago', [fn('SUM', col('valor')), 'total']],
                        where: { idFacturaCliente: { [Op.in]: ids } },
                        group: ['metodoPago'],
                        raw: true
                    })
                ]);
                ventasHoy = parseFloat(detallesRows[0]?.suma || 0);
                for (const r of pagosRows) {
                    if (Object.prototype.hasOwnProperty.call(pagosHoy, r.metodoPago)) {
                        pagosHoy[r.metodoPago] = parseFloat(r.total || 0);
                    }
                }
            }
            broadcast('__ADMIN__', 'store_stats', { idPuntoDeVenta, ventasHoy });
            broadcast('__ADMIN__', 'store_stats_detail', { idPuntoDeVenta, ventasHoy, pagos: pagosHoy });

            // Global: ventas + métodos de pago de todas las tiendas hoy
            const todasFacturasHoy = await FacturaClientes.findAll({
                attributes: ['idFacturaCliente'],
                where: { createdAt: { [Op.gte]: hoyStart } },
                raw: true
            });
            if (todasFacturasHoy.length) {
                const todosIds = todasFacturasHoy.map(f => f.idFacturaCliente);
                const [globalVentasRow, globalPagosRows] = await Promise.all([
                    DetallesFactura.findAll({
                        attributes: [[fn('SUM', col('total')), 'suma']],
                        where: { idFacturaCliente: { [Op.in]: todosIds } },
                        raw: true
                    }),
                    DetallesPagosFactura.findAll({
                        attributes: ['metodoPago', [fn('SUM', col('valor')), 'total']],
                        where: { idFacturaCliente: { [Op.in]: todosIds } },
                        group: ['metodoPago'],
                        raw: true
                    })
                ]);
                const pagosGlobales = { efectivo: 0, transBill: 0, tCredito: 0, creditos: 0 };
                for (const r of globalPagosRows) {
                    const v = Math.round(parseFloat(r.total || 0));
                    if (r.metodoPago === 'Efectivo')                                           pagosGlobales.efectivo  += v;
                    else if (r.metodoPago === 'Banco' || r.metodoPago === 'Billetera Virtual') pagosGlobales.transBill += v;
                    else if (r.metodoPago === 'Tarjeta Credito')                               pagosGlobales.tCredito  += v;
                    else if (r.metodoPago === 'Entidad Crediticia')                            pagosGlobales.creditos  += v;
                }
                broadcast('__ADMIN__', 'global_stats', {
                    ventasGlobalesHoy: Math.round(parseFloat(globalVentasRow[0]?.suma || 0)),
                    pagosGlobales
                });
            }
        } catch (_) {}

        // Descuento atómico de cupo extemporáneo
        let redirigirCierre = false;
        if (cajaAbierta.permite_factura_extemporanea) {
            await CajaTienda.update(
                {
                    cupo_facturas_extemporaneas: literal('GREATEST(cupo_facturas_extemporaneas - 1, 0)'),
                    permite_factura_extemporanea: literal('IF(cupo_facturas_extemporaneas <= 0, FALSE, TRUE)')
                },
                { where: { idCajaTienda: cajaAbierta.idCajaTienda } }
            );
            const cajaCheck = await CajaTienda.findOne({
                where: { idCajaTienda: cajaAbierta.idCajaTienda },
                attributes: ['permite_factura_extemporanea'],
                raw: true
            });
            redirigirCierre = !cajaCheck.permite_factura_extemporanea;
        }

        return res.json({ success: true, idFacturaCliente: factura.idFacturaCliente, ...(redirigirCierre ? { redirigirCierre: true } : {}) });

    } catch (error) {
        // El try tiene trabajo después del commit (descuento de cupo extemporáneo): si algo
        // falla ahí, la transacción ya está cerrada y un rollback lanzaría otro error,
        // dejando la petición sin respuesta.
        if (!t.finished) await t.rollback().catch(() => {});
        console.error('procesarFactura [transacción]:', error);
        return res.status(500).json({ success: false, mensaje: 'Error interno al procesar la factura.' });
    }

  } catch (error) {
      console.error('procesarFactura [validación]:', error);
      return res.status(500).json({ success: false, mensaje: 'Error al procesar la solicitud.' });
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
                { model: Empleados,          as: 'vendedor', attributes: ['PrimerNombre', 'PrimerApellido'] },
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

        // Si esta factura salió de un pedido de la tienda web, la tirilla lo destaca: quien la
        // recibe (cliente o auditoría) tiene que poder distinguirla de una venta de mostrador y
        // rastrearla hasta la transacción de la pasarela.
        const pedidoWeb = await PedidosWeb.findOne({
            where: { idFacturaCliente: id },
            include: [{ model: PagosPedidoWeb, as: 'pagos', required: false }]
        });
        const pagoWebTirilla = pedidoWeb ? await resolverPagoWebParaFactura(pedidoWeb) : null;

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
        // +55 cuando lleva el sello VENTA WEB, para que no se corte la tirilla.
        const estH   = 350 + factura.detalles.length * 24 + pagosFactura.length * 18 + 100 + LOGO_SIZE + 10
                     + (pedidoWeb ? 55 : 0);

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
        if (reg?.resolucionFacturacion) doc.text(`Resolución de facturación Nro. ${reg.resolucionFacturacion} desde el ${reg.nroInicio} hasta el ${reg.nroFin}`, MARGIN, doc.y, { width: CW, align: 'center' });

        doc.moveDown(0.3); hr();

        // Número y fecha de factura
        doc.font('Helvetica-Bold').fontSize(8)
           .text(`Factura No: ${factura.prefijo || ''}${factura.numeroFactura}`, MARGIN, doc.y, { width: CW });
        doc.font('Helvetica').fontSize(7)
           .text(`Fecha: ${factura.fechaEmision}  Hora: ${factura.horaEmision || ''}`, MARGIN, doc.y, { width: CW });
        const nomVendedor = factura.vendedor
            ? `${factura.vendedor.PrimerNombre} ${factura.vendedor.PrimerApellido}`.trim()
            : 'N/A';
        doc.text(`Vendedor: ${nomVendedor}`, MARGIN, doc.y, { width: CW });

        // ── Sello VENTA WEB ───────────────────────────────────────────────────
        if (pedidoWeb) {
            doc.moveDown(0.4);

            const tieneTx = !!(pagoWebTirilla?.idTransaccion);
            const altoCaja = tieneTx ? 46 : 34;
            const yCaja = doc.y;

            doc.save();
            doc.lineWidth(1.2).rect(MARGIN, yCaja, CW, altoCaja).stroke('#000');

            doc.font('Helvetica-Bold').fontSize(13)
               .text('VENTA WEB', MARGIN, yCaja + 5, { width: CW, align: 'center', lineBreak: false });

            doc.font('Helvetica-Bold').fontSize(7)
               .text(`Pedido ${pedidoWeb.numeroPedido}`, MARGIN, yCaja + 21, { width: CW, align: 'center', lineBreak: false });

            if (tieneTx) {
                doc.font('Helvetica').fontSize(6)
                   .text(`Transacción ${pagoWebTirilla.idTransaccion}`, MARGIN + 2, yCaja + 31, { width: CW - 4, align: 'center', lineBreak: false });
            }
            doc.restore();

            doc.y = yCaja + altoCaja + 4;
        }

        doc.moveDown(0.3); hr();

        // Cliente
        if (factura.idCliente === '0') {
            doc.font('Helvetica-Bold').fontSize(7).text('Cliente: Consumidor Final', MARGIN, doc.y, { width: CW });
        } else if (cli) {
            const nomCli = cli.tipo_persona === 'J'
                ? (cli.razon_social || '')
                : [cli.primer_nombre, cli.segundo_nombre, cli.primer_apellido, cli.segundo_apellido].filter(Boolean).join(' ');
            const docCli = `${cli.tipo_documento || ''} ${cli.numero_doc || ''}${cli.digito_verif ? '-' + cli.digito_verif : ''}`.trim();
            doc.font('Helvetica-Bold').fontSize(7).text(`Cliente: ${nomCli}`, MARGIN, doc.y, { width: CW });
            doc.font('Helvetica').fontSize(7).text(`Doc: ${docCli}`, MARGIN, doc.y, { width: CW });
            if (cli.telefono) doc.text(`Tel: ${cli.telefono}`, MARGIN, doc.y, { width: CW });
            if (cli.email)    doc.text(`Email: ${cli.email}`,  MARGIN, doc.y, { width: CW });
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

    const empleado = req.empleadoVerificado;

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

        const { traslado, codigo: nuevoCodigo } = await _crearTraslado(idPdv, idDestino, empleado.idEmpleado, notas, t);

        for (const item of items) {
            const cant = parseInt(item.cantidad);
            const detalle = await DetalleTraslados.create({
                idTraslado: traslado.idTraslado,
                idPack:     null,
                idProducto: item.idProducto,
                cantidad:   cant
            }, { transaction: t });
            await InsidenciaTraslado.create({
                idTraslado:        traslado.idTraslado,
                idDetalleTraslado: detalle.idDetalleTraslado,
                idEmpleado:        empleado.idEmpleado,
                razonInsidencia:   `ENVIADO: ${cant} uds`,
                cantidadOriginal:  cant,
                cantidadAceptada:  cant,
                resuelta:          'si'
            }, { transaction: t });
        }

        await t.commit();

        const pendientes = await _broadcastEstadoTraslado(idDestino);
        broadcast(idDestino, 'new_traslado', { codigo: nuevoCodigo, pendientes });

        return res.json({ success: true, idTraslado: traslado.idTraslado, codigo: nuevoCodigo });
    } catch (e) {
        // El try tiene trabajo después del commit: si algo falla ahí, la transacción ya está
        // cerrada y un rollback lanzaría otro error, dejando la petición sin respuesta.
        if (!t.finished) await t.rollback().catch(() => {});
        console.error('crearTrasladoSueltos:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

// ─── EGRESOS ──────────────────────────────────────────────────────────────────

const getExpensesPage = async (req, res) => {
    return res.render('./tienda/storebehivors/expenses', {
        pagina: 'Egresos',
        csrfToken: req.csrfToken(),
        currentPath: '/storebehivors/expenses'
    });
};

const cuadrarCajaPage = async (req, res) => {
    return res.render('./tienda/storebehivors/cuadrarCaja', {
        pagina: 'Cuadre de Caja',
        csrfToken: req.csrfToken(),
        currentPath: '/storebehivors/'
    });
};

const getCuadreCajaDatos = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false, mensaje: 'Sin punto de venta.' });

    try {
        const caja = await _getCajaAbierta(idPdv, [
            { model: Empleados, as: 'empleadoApertura', attributes: ['idEmpleado', 'PrimerNombre', 'PrimerApellido'] }
        ]);
        if (!caja) return res.status(400).json({ success: false, mensaje: 'No hay caja abierta.' });

        const { sEfectivo, sMedios, sCredito, sEgresos, sVentas, txEfectivo, txElectronicos, txCredito, txEgresos } =
            await _calcularTransaccionesCaja(idPdv, new Date(caja.fechaApertura), new Date());

        return res.json({
            success: true,
            caja: {
                idCajaTienda:     caja.idCajaTienda,
                cajaMenor:        Math.round(parseFloat(caja.cajaMenor) || 0),
                empleadoApertura: `${caja.empleadoApertura?.PrimerNombre || ''} ${caja.empleadoApertura?.PrimerApellido || ''}`.trim()
            },
            totales: { ventas: sVentas, egresos: sEgresos, efectivo: sEfectivo, mediosElectronicos: sMedios, credito: sCredito },
            txEfectivo,
            txElectronicos,
            txCredito,
            txEgresos
        });
    } catch (e) {
        console.error('getCuadreCajaDatos:', e);
        return res.status(500).json({ success: false });
    }
};

const cerrarCajaAPI = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false, mensaje: 'Sin punto de venta.' });

    const { idCajaTienda, codigoEmpleado, operadorEgresos, operadorEfectivo, operadorElectronicos, operadorCredito, operadorBase, nota } = req.body;

    if (!idCajaTienda) return res.status(400).json({ success: false, mensaje: 'idCajaTienda requerido.' });

    try {
        const empleadoCierre = req.empleadoVerificado;

        // ── Buscar la caja por idCajaTienda + idPuntoDeVenta + estado abierto ──
        const caja = await CajaTienda.findOne({
            where: { idCajaTienda, idPuntoDeVenta: idPdv, estado: 'abierto' },
            include: [
                { model: Empleados,    as: 'empleadoApertura', attributes: ['PrimerNombre', 'PrimerApellido'] },
                { model: PuntosDeVenta, as: 'puntoDeVenta',    attributes: ['nombreComercial', 'footerBill'] }
            ]
        });
        if (!caja) return res.status(400).json({ success: false, mensaje: 'No hay caja abierta con ese ID.' });

        const inicio = new Date(caja.fechaApertura);
        const fin    = new Date();

        const { sEfectivo, sMedios, sCredito, sEgresos, sVentas, txElectronicos, txCredito, txEgresos, idFacturas } =
            await _calcularTransaccionesCaja(idPdv, inicio, fin);

        const oEgresos      = Math.round(parseFloat(operadorEgresos)      || 0);
        const oEfectivo     = Math.round(parseFloat(operadorEfectivo)     || 0);
        const oElectronicos = Math.round(parseFloat(operadorElectronicos) || 0);
        const oCredito      = Math.round(parseFloat(operadorCredito)      || 0);
        const oBase         = Math.round(parseFloat(operadorBase)        || 0);

        if (idFacturas.length > 0) {
            await Promise.all([
                FacturaClientes.update({ estado: 'liquidada' }, { where: { idFacturaCliente: idFacturas } }),
                Egresos.update({ estado: 'liquidada' }, { where: { idPuntoDeVenta: idPdv, estado: 'pendiente', createdAt: { [Op.between]: [inicio, fin] } } })
            ]);
        }

        await caja.update({
            idEmpleadoCierre:               empleadoCierre.idEmpleado,
            fechaCierre:                    new Date(),
            cajaMenorRegistrada:            oBase,
            ventasTotales:                  sVentas,
            ventasTotalesRegistradas:       oEfectivo + oElectronicos + oCredito,
            egresosTotales:                 sEgresos,
            egresosTotalesRegistrados:      oEgresos,
            ventasCredito:                  sCredito,
            ventasCreditoRegistradas:       oCredito,
            ventasEfectivo:                 sEfectivo,
            ventasEfectivoRegistradas:      oEfectivo,
            ventasMediosElectronicos:        sMedios,
            ventasMediosElectronicosRegistradas: oElectronicos,
            estado:                         'cerrado',
            nota:                           nota || null
        });

        broadcast('__ADMIN__', 'caja_status', { idPuntoDeVenta: idPdv, estado: 'cuadrada' });

        return res.json({ success: true, idCajaTienda: caja.idCajaTienda });
    } catch (e) {
        console.error('cerrarCajaAPI:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

// ── Helper reutilizable para generar el PDF de cuadre ────────────────────────
const _generarPDFCuadre = async ({ caja, regimen, municipio, sums, txElectronicos, txCredito, txEgresos }) => {
    const W = 227, MARGIN = 10, CW = W - MARGIN * 2;
    const estH = 720 + txElectronicos.length * 16 + txCredito.length * 16 + txEgresos.length * 11;
    const doc = new PDFDocument({ size: [W, estH], margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, autoFirstPage: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const pdfEnd = new Promise(r => doc.on('end', r));

    // URL de verificación pública del cierre (misma lógica que el QR de comprobante de traslados)
    const baseUrl         = `${process.env.APP_URL}:${process.env.APP_PORT}`;
    const verificacionUrl = `${baseUrl}/store/storebehivors/caja/${caja.idCajaTienda}/pdf`;
    const qrBuffer         = await QRCode.toBuffer(verificacionUrl, { type: 'png', width: 200, margin: 1 });

    const hr  = () => { doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CW, doc.y).strokeColor('#888').lineWidth(0.3).stroke(); doc.moveDown(0.3); };
    const fmt = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;
    const fmtFechaHora = (d) => {
        if (!d) return '—';
        const date = new Date(d);
        const f = date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const h = date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
        return `${f} ${h}`;
    };

    // Fila "label .......... valor" con puntos de relleno calculados al ancho disponible
    // checkbox: antepone "[ ]" para que el operador pueda marcar el ítem al auditar el voucher impreso
    const filaPuntos = (label, valor, opts = {}) => {
        const { size = 6.5, bold = false, indent = 0, checkbox = false } = opts;
        const lbl = checkbox ? `[ ] ${label}` : label;
        const width = CW - indent;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
        const wLabel = doc.widthOfString(lbl + ' ');
        const wValor = doc.widthOfString(' ' + valor);
        const wDot   = doc.widthOfString('.') || 1;
        const nDots  = Math.max(3, Math.floor((width - wLabel - wValor - 3) / wDot));
        doc.text(`${lbl} ${'.'.repeat(nDots)} ${valor}`, MARGIN + indent, doc.y, { width });
    };

    const seccionTitulo = (txt) => {
        doc.moveDown(0.1);
        doc.font('Helvetica-Bold').fontSize(7).text(`[ ${txt} ]`, MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.2);
    };

    // Lista de transacciones agrupada por entidad, con subtotal por grupo
    const listaPorEntidad = (titulo, transacciones) => {
        if (!transacciones.length) return;
        seccionTitulo(titulo);

        const grupos = new Map();
        for (const t of transacciones) {
            if (!grupos.has(t.entidad)) grupos.set(t.entidad, []);
            grupos.get(t.entidad).push(t);
        }

        for (const [entidad, txs] of grupos) {
            doc.font('Helvetica-Bold').fontSize(6.5).text(`${entidad}:`, MARGIN, doc.y, { width: CW });
            doc.moveDown(0.1);
            let subtotal = 0;
            for (const t of txs) {
                subtotal += t.valor;
                filaPuntos(`Fact ${t.nroFactura} · Ref ${t.referencia}`, fmt(t.valor), { indent: 4, checkbox: true });
                doc.moveDown(0.1);
            }
            hr();
            filaPuntos(`TOTAL ${entidad.toUpperCase()}:`, fmt(subtotal), { bold: true });
            doc.moveDown(0.3);
        }
    };

    // ── HEADER: logo, nombre comercial, datos tributarios ──────────────────────
    try {
        const LOGO_SIZE = 40;
        doc.image(LOGO_PATH, MARGIN + (CW - LOGO_SIZE) / 2, MARGIN, { width: LOGO_SIZE, height: LOGO_SIZE });
        doc.y = MARGIN + LOGO_SIZE + 4;
    } catch (_) { doc.y = MARGIN + 8; }

    doc.font('Helvetica-Bold').fontSize(9).text(caja.puntoDeVenta?.nombreComercial || regimen?.razonSocial || 'Punto de Venta', MARGIN, doc.y, { width: CW, align: 'center' });
    doc.font('Helvetica').fontSize(6.5);
    if (regimen?.razonSocial) doc.text(regimen.razonSocial, MARGIN, doc.y, { width: CW, align: 'center' });
    if (regimen?.taxId)       doc.text(`NIT: ${regimen.taxId}${regimen.DV ? '-' + regimen.DV : ''}`, MARGIN, doc.y, { width: CW, align: 'center' });
    if (caja.puntoDeVenta?.direccionPrincipal) doc.text(caja.puntoDeVenta.direccionPrincipal, MARGIN, doc.y, { width: CW, align: 'center' });
    if (municipio?.nombre) doc.text(municipio.nombre, MARGIN, doc.y, { width: CW, align: 'center' });
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(7).text(`CIERRE DE CAJA — ${new Date(caja.fechaCierre).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}`, MARGIN, doc.y, { width: CW, align: 'center' });
    if (caja.codigo) {
        doc.font('Helvetica').fontSize(6.5).text(`Codigo cierre: ${caja.codigo}`, MARGIN, doc.y, { width: CW, align: 'center' });
    }
    doc.moveDown(0.3); hr();

    // ── SECCIÓN 2: apertura / cierre ────────────────────────────────────────────
    const nomApertura = `${caja.empleadoApertura?.PrimerNombre || ''} ${caja.empleadoApertura?.PrimerApellido || ''}`.trim();
    const nomCierre   = `${caja.empleadoCierre?.PrimerNombre || ''} ${caja.empleadoCierre?.PrimerApellido || ''}`.trim();
    doc.font('Helvetica').fontSize(6.5);
    doc.text(`Apertura: ${fmtFechaHora(caja.fechaApertura)}`, MARGIN, doc.y, { width: CW });
    doc.text(`Abrió: ${nomApertura || 'N/A'}`,               MARGIN, doc.y, { width: CW });
    doc.moveDown(0.15);
    doc.text(`Cierre: ${fmtFechaHora(caja.fechaCierre)}`, MARGIN, doc.y, { width: CW });
    doc.text(`Cerró: ${nomCierre || 'N/A'}`,            MARGIN, doc.y, { width: CW });
    doc.moveDown(0.3); hr();

    // ── SECCIÓN 3: ventas y egresos globales (negrilla) ─────────────────────────
    doc.font('Helvetica-Bold').fontSize(8);
    filaPuntos('VENTAS TOTALES', fmt(sums.sVentas),  { bold: true, size: 8 });
    doc.moveDown(0.2);
    filaPuntos('EGRESOS',        fmt(sums.sEgresos), { bold: true, size: 8 });
    doc.moveDown(0.3); hr();

    // ── SECCIÓN 4: resumen de operación por método de pago ─────────────────────
    seccionTitulo('RESUMEN DE OPERACIÓN EN SISTEMA');
    filaPuntos('Efectivo',            fmt(sums.sEfectivo), { checkbox: true });
    doc.moveDown(0.15);
    filaPuntos('Crédito',             fmt(sums.sCredito), { checkbox: true });
    doc.moveDown(0.15);
    filaPuntos('Medios Electrónicos', fmt(sums.sMedios), { checkbox: true });
    doc.moveDown(0.15);
    filaPuntos('(-) Egresos Totales', fmt(sums.sEgresos));
    doc.moveDown(0.3); hr();

    // ── SECCIÓN 5: auditoría de caja física (base / caja menor) ────────────────
    seccionTitulo('AUDITORÍA DE CAJA FÍSICA');
    const cajaMenorSistema    = Math.round(parseFloat(caja.cajaMenor) || 0);
    const cajaMenorRegistrada = Math.round(parseFloat(caja.cajaMenorRegistrada) || 0);
    filaPuntos('Base (Caja Menor)', fmt(cajaMenorSistema), { checkbox: true });
    if (Math.abs(cajaMenorSistema - cajaMenorRegistrada) > 0.5) {
        doc.moveDown(0.1);
        doc.font('Helvetica').fontSize(6).text(
            `Diferencia con registrado: ${fmt(Math.abs(cajaMenorSistema - cajaMenorRegistrada))} (Registrado: ${fmt(cajaMenorRegistrada)})`,
            MARGIN, doc.y, { width: CW, indent: 4 }
        );
    }
    doc.moveDown(0.15);
    const efReg = Math.round(parseFloat(caja.ventasEfectivoRegistradas)            || 0);
    const crReg = Math.round(parseFloat(caja.ventasCreditoRegistradas)             || 0);
    const meReg = Math.round(parseFloat(caja.ventasMediosElectronicosRegistradas)  || 0);
    const egReg = Math.round(parseFloat(caja.egresosTotalesRegistrados)            || 0);
    filaPuntos('Efectivo Registrado',             fmt(efReg), { checkbox: true, bold: Math.abs(efReg - Math.round(sums.sEfectivo)) > 0.5 });
    doc.moveDown(0.1);
    filaPuntos('Crédito Registrado',              fmt(crReg), { checkbox: true, bold: Math.abs(crReg - Math.round(sums.sCredito))  > 0.5 });
    doc.moveDown(0.1);
    filaPuntos('Medios Electrónicos Registrado',  fmt(meReg), { checkbox: true, bold: Math.abs(meReg - Math.round(sums.sMedios))   > 0.5 });
    doc.moveDown(0.1);
    filaPuntos('Egresos Registrado',              fmt(egReg), { checkbox: true, bold: Math.abs(egReg - Math.round(sums.sEgresos))  > 0.5 });
    doc.moveDown(0.3); hr();

    // ── Detalle: transacciones electrónicas (Banco / Billetera / Tarjeta) ──────
    listaPorEntidad('TRANSACCIONES ELECTRÓNICAS', txElectronicos);

    // ── Detalle: ventas a entidades crediticias ─────────────────────────────────
    listaPorEntidad('VENTAS A CRÉDITO', txCredito);

    // ── SECCIÓN 6: egresos ───────────────────────────────────────────────────────
    if (txEgresos.length > 0) {
        seccionTitulo('EGRESOS');
        for (const e of txEgresos) {
            filaPuntos(e.referencia, fmt(e.valor));
            doc.moveDown(0.1);
        }
        hr();
        filaPuntos('TOTAL EGRESOS:', fmt(sums.sEgresos), { bold: true });
        doc.moveDown(0.3); hr();
    }

    // ── SECCIÓN 7: descuadre (solo si hay diferencias sistema vs operador) ─────
    const categoriasDescuadre = [
        { label: 'egresos',             sis: caja.egresosTotales,                      op: caja.egresosTotalesRegistrados },
        { label: 'efectivo',            sis: caja.ventasEfectivo,                      op: caja.ventasEfectivoRegistradas },
        { label: 'medios electrónicos', sis: caja.ventasMediosElectronicos,            op: caja.ventasMediosElectronicosRegistradas },
        { label: 'crédito',             sis: caja.ventasCredito,                       op: caja.ventasCreditoRegistradas },
    ].map(c => ({ label: c.label, sis: Math.round(parseFloat(c.sis) || 0), op: Math.round(parseFloat(c.op) || 0) }))
     .filter(c => Math.abs(c.sis - c.op) > 0.5);

    const enControversia = categoriasDescuadre.length > 0;
    if (enControversia) {
        seccionTitulo('DESCUADRE');
        for (const c of categoriasDescuadre) {
            doc.font('Helvetica-Bold').fontSize(6.5).text(`Diferencia de ${c.label}`, MARGIN, doc.y, { width: CW });
            doc.moveDown(0.1);
            doc.font('Helvetica').fontSize(6.5).text(
                `En sistema: ${fmt(c.sis)}    Operador: ${fmt(c.op)}    Diferencia: ${fmt(Math.abs(c.sis - c.op))}`,
                MARGIN, doc.y, { width: CW }
            );
            doc.moveDown(0.25);
        }
        hr();
    }

    if (caja.nota) {
        doc.font('Helvetica-Bold').fontSize(6.5).text('Nota:', MARGIN, doc.y);
        doc.font('Helvetica').fontSize(6.5).text(caja.nota, MARGIN, doc.y, { width: CW });
        doc.moveDown(0.3); hr();
    }

    doc.font('Helvetica-Bold').fontSize(9)
       .text(`[ ${enControversia ? 'EN CONTROVERSIA' : 'CAJA EN ORDEN'} ]`, MARGIN, doc.y, { width: CW, align: 'center' });
    doc.moveDown(0.3); hr();

    // ── QR de verificación ───────────────────────────────────────────────────
    const QR_SIZE = 65;
    const qrX = MARGIN + (CW - QR_SIZE) / 2;
    doc.image(qrBuffer, qrX, doc.y, { width: QR_SIZE });
    doc.y += QR_SIZE + 4;
    doc.font('Helvetica-Oblique').fontSize(5.5)
       .text('Verifica la autenticidad de este cierre escaneando el código QR', MARGIN, doc.y, { width: CW, align: 'center' });

    doc.end();
    await pdfEnd;
    return Buffer.concat(chunks);
};

const getCuadrePDF = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    const { idCajaTienda } = req.params;

    try {
        const caja = await CajaTienda.findOne({
            where: { idCajaTienda, idPuntoDeVenta: idPdv, estado: 'cerrado' },
            include: [
                { model: Empleados,    as: 'empleadoApertura', attributes: ['PrimerNombre', 'PrimerApellido'] },
                { model: Empleados,    as: 'empleadoCierre',   attributes: ['PrimerNombre', 'PrimerApellido'] },
                { model: PuntosDeVenta, as: 'puntoDeVenta',    attributes: ['nombreComercial', 'direccionPrincipal', 'ciudad'] }
            ]
        });
        if (!caja) return res.status(404).send('Caja no encontrada.');

        const [regimen, municipio, datos] = await Promise.all([
            RegimenFacturacion.findOne({ where: { idPuntoDeVenta: idPdv, activa: true } }),
            caja.puntoDeVenta?.ciudad
                ? Municipios.findOne({ where: { id: caja.puntoDeVenta.ciudad }, attributes: ['nombre'], raw: true })
                : null,
            _calcularTransaccionesCaja(idPdv, new Date(caja.fechaApertura), new Date(caja.fechaCierre), 'liquidada')
        ]);

        const buf = await _generarPDFCuadre({
            caja, regimen, municipio,
            sums:           { sEfectivo: datos.sEfectivo, sMedios: datos.sMedios, sCredito: datos.sCredito, sEgresos: datos.sEgresos, sVentas: datos.sVentas },
            txElectronicos: datos.txElectronicos,
            txCredito:      datos.txCredito,
            txEgresos:      datos.txEgresos
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="cuadre-${new Date(caja.fechaCierre).toISOString().slice(0,10)}.pdf"`);
        res.setHeader('Content-Length', buf.length);
        return res.send(buf);
    } catch (e) {
        console.error('getCuadrePDF:', e);
        return res.status(500).send('Error al generar el PDF.');
    }
};

const crearEgreso = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false, mensaje: 'Sin punto de venta asignado.' });

    const { valorEgreso, referencia, descripcion } = req.body;
    if (!valorEgreso) {
        return res.status(400).json({ success: false, mensaje: 'Valor requerido.' });
    }

    const empleado = req.empleadoVerificado;

    const valor = parseFloat(valorEgreso);
    if (!Number.isFinite(valor) || valor <= 0) {
        return res.status(400).json({ success: false, mensaje: 'Valor inválido.' });
    }

    try {
        const cajaActiva = await CajaTienda.findOne({
            where: { idPuntoDeVenta: idPdv, estado: 'abierto' },
            attributes: ['idCajaTienda']
        });

        const egreso = await Egresos.create({
            idPuntoDeVenta: idPdv,
            idEmpleado: empleado.idEmpleado,
            idCajaTienda: cajaActiva?.idCajaTienda || null,
            valorEgreso: valor,
            referencia: referencia?.trim() || null,
            descripcion: descripcion?.trim() || null,
            estado: 'pendiente'
        });

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const totalHoy = await Egresos.sum('valorEgreso', {
            where: { idPuntoDeVenta: idPdv, createdAt: { [Op.gte]: hoy } }
        });

        broadcast(idPdv, 'new_egreso', {
            egreso: {
                idEgreso: egreso.idEgreso,
                referencia: egreso.referencia,
                valorEgreso: parseFloat(egreso.valorEgreso),
                descripcion: egreso.descripcion,
                estado: egreso.estado,
                createdAt: egreso.createdAt
            },
            totalHoy: totalHoy || 0
        });

        broadcast('__ADMIN__', 'store_stats', { idPuntoDeVenta: idPdv, egresosHoy: totalHoy || 0 });

        return res.json({
            success: true,
            idEgreso: egreso.idEgreso,
            nombreEmpleado: empleado.nombre
        });
    } catch (e) {
        console.error('crearEgreso:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

const getEgresosJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    const { pagina = 1, fechaA, fechaB, estado } = req.query;
    const limite = parseInt(process.env.LIMIT_PER_PAGE) || 10;
    const offset = (parseInt(pagina) - 1) * limite;

    try {
        const where = { idPuntoDeVenta: idPdv };

        if (fechaA && fechaB) {
            const inicio = new Date(fechaA); inicio.setHours(0, 0, 0, 0);
            const fin    = new Date(fechaB); fin.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [inicio, fin] };
        } else if (fechaA) {
            const inicio = new Date(fechaA); inicio.setHours(0, 0, 0, 0);
            where.createdAt = { [Op.gte]: inicio };
        } else if (fechaB) {
            const fin = new Date(fechaB); fin.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.lte]: fin };
        }

        if (estado && ['pendiente', 'liquidada'].includes(estado)) {
            where.estado = estado;
        }

        const { count, rows } = await Egresos.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            limit: limite,
            offset,
            distinct: true
        });

        return res.json({
            success: true,
            egresos: rows,
            totalPaginas: Math.ceil(count / limite),
            paginaActual: parseInt(pagina),
            total: count
        });
    } catch (e) {
        console.error('getEgresosJSON:', e);
        return res.status(500).json({ success: false });
    }
};

const getTotalEgresosHoy = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    try {
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const total = await Egresos.sum('valorEgreso', {
            where: { idPuntoDeVenta: idPdv, createdAt: { [Op.gte]: hoy } }
        });
        return res.json({ success: true, total: total || 0 });
    } catch (e) {
        console.error('getTotalEgresosHoy:', e);
        return res.status(500).json({ success: false });
    }
};

const getEgresoComprobantePDF = async (req, res) => {
    const { idEgreso } = req.params;
    const idPdv = req.idPuntoDeVenta;

    try {
        const egreso = await Egresos.findOne({
            where: { idEgreso, idPuntoDeVenta: idPdv },
            include: [
                { model: Empleados,     as: 'empleado',     attributes: ['PrimerNombre', 'PrimerApellido', 'codigoEmpleado'] },
                { model: PuntosDeVenta, as: 'puntoDeVenta', attributes: ['nombreComercial'] },
                { model: CajaTienda,    as: 'caja',         attributes: ['codigo'] }
            ]
        });
        if (!egreso) return res.status(404).json({ success: false, mensaje: 'Egreso no encontrado.' });

        const W = 227, MARGIN = 10, CW = W - MARGIN * 2, LOGO_H = 55;
        const estH = 450;

        const doc = new PDFDocument({
            size: [W, estH],
            margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
            autoFirstPage: true
        });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        const pdfEnd = new Promise(r => doc.on('end', r));

        const hr = () => {
            doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CW, doc.y).strokeColor('#BBBBBB').lineWidth(0.5).stroke();
            doc.moveDown(0.4);
        };

        const fila = (label, valor) => {
            const y = doc.y;
            doc.font('Helvetica-Bold').fontSize(6.5).text(label, MARGIN, y, { width: CW * 0.38 });
            doc.font('Helvetica').fontSize(6.5).text(String(valor), MARGIN + CW * 0.38, y, { width: CW * 0.62 });
            doc.y = Math.max(doc.y, y + 11);
            doc.moveDown(0.1);
        };

        // Logo
        const logoX = MARGIN + (CW - LOGO_H) / 2;
        doc.image(LOGO_PATH, logoX, MARGIN, { width: LOGO_H, height: LOGO_H });
        doc.y = MARGIN + LOGO_H + 6;

        // Encabezado
        doc.font('Helvetica-Bold').fontSize(10).text('COMPROBANTE DE EGRESO', MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.2);
        if (egreso.puntoDeVenta?.nombreComercial) {
            doc.font('Helvetica').fontSize(7).text(egreso.puntoDeVenta.nombreComercial, MARGIN, doc.y, { width: CW, align: 'center' });
        }
        if (egreso.caja?.codigo) {
            doc.font('Helvetica').fontSize(6.5).text(`Caja: ${egreso.caja.codigo}`, MARGIN, doc.y, { width: CW, align: 'center' });
        }
        doc.moveDown(0.4);
        hr();

        // Fecha y hora en zona Colombia
        const fechaEgreso = new Date(egreso.createdAt);
        const fechaStr = fechaEgreso.toLocaleString('es-CO', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false, timeZone: 'America/Bogota'
        });

        fila('Egreso N°:', `#${egreso.idEgreso}`);
        fila('Fecha y hora:', fechaStr);
        fila('Estado:', egreso.estado.toUpperCase());

        doc.moveDown(0.2); hr();

        const nombreEmp  = egreso.empleado ? `${egreso.empleado.PrimerNombre} ${egreso.empleado.PrimerApellido}` : 'N/A';
        const codigoEmp  = egreso.empleado?.codigoEmpleado || 'N/A';

        fila('Responsable:', nombreEmp);

        doc.moveDown(0.2); hr();

        if (egreso.referencia) fila('Referencia:', egreso.referencia);
        if (egreso.descripcion) {
            doc.font('Helvetica-Bold').fontSize(6.5).text('Descripción:', MARGIN, doc.y, { width: CW });
            doc.moveDown(0.1);
            doc.font('Helvetica').fontSize(6.5).text(egreso.descripcion, MARGIN, doc.y, { width: CW });
            doc.moveDown(0.4);
        }

        doc.moveDown(0.2); hr();

        // Valor grande y destacado
        const valorStr = `$${Math.round(parseFloat(egreso.valorEgreso)).toLocaleString('es-CO')}`;
        doc.font('Helvetica').fontSize(6.5).text('VALOR DEL EGRESO', MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.1);
        doc.font('Helvetica-Bold').fontSize(16).text(valorStr, MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.6);

        hr();

        const footerCD = process.env.FOOTER_CODEDREAM || '';
        if (footerCD) {
            doc.font('Helvetica').fontSize(6).text(footerCD, MARGIN, doc.y, { width: CW, align: 'center' });
        }

        doc.end();
        await pdfEnd;

        const buf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="egreso-${egreso.idEgreso}.pdf"`);
        res.setHeader('Content-Length', buf.length);
        return res.send(buf);

    } catch (e) {
        console.error('getEgresoComprobantePDF:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al generar el comprobante.' });
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
                        await _crearStockRow(traslado.idOrigen, { idProducto: detalle.idProducto }, detalle.cantidad, t);
                    }
                    await InsidenciaTraslado.create({
                        idTraslado:        traslado.idTraslado,
                        idDetalleTraslado: detalle.idDetalleTraslado,
                        idEmpleado:        null,
                        razonInsidencia:   'DEVUELTO: traslado expirado automáticamente',
                        cantidadOriginal:  detalle.cantidad,
                        cantidadAceptada:  detalle.cantidad,
                        resuelta:          'si'
                    }, { transaction: t });
                }

                await traslado.update({ estado: 'DEVUELTO' }, { transaction: t });
                await t.commit();

                broadcast(traslado.idOrigen, 'traslado_devuelto', {
                    idTraslado:  traslado.idTraslado,
                    codigo:      traslado.codigoTraslado
                });
            } catch (e) {
                // El try tiene trabajo después del commit: si algo falla ahí, la transacción ya está
                // cerrada y un rollback lanzaría otro error, dejando la petición sin respuesta.
                if (!t.finished) await t.rollback().catch(() => {});
                console.error('verificarTrasladosExpirados traslado', traslado.idTraslado, e);
            }
        }
    } catch (e) {
        console.error('verificarTrasladosExpirados:', e);
    }
};

// ─── TRASLADO DESDE PERFIL DE PRODUCTO ──────────────────────────────────────

const validarEmpleadoTraslado = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    const { codigo, accion = 'CREATE' } = req.query;
    if (!codigo) return res.status(400).json({ success: false });

    try {
        const check = await _checkPermisoTraslado(codigo, accion, idPdv);
        if (!check.ok) return res.json({ success: false, mensaje: check.mensaje });
        const { empleado } = check;
        return res.json({ success: true, nombre: `${empleado.PrimerNombre} ${empleado.PrimerApellido}` });
    } catch (e) {
        console.error('validarEmpleadoTraslado:', e);
        return res.status(500).json({ success: false });
    }
};

const trasladarDesdePerfil = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false, mensaje: 'Sin punto de venta.' });

    const { idProducto, cantidad, idDestino, codigoEmpleado, notas } = req.body;

    if (!idProducto || !cantidad || !idDestino || !codigoEmpleado) {
        return res.status(400).json({ success: false, mensaje: 'Datos incompletos.' });
    }

    // Delega a crearTrasladoSueltos que ya valida permiso CREATE
    req.body.items = [{ idProducto, cantidad: parseInt(cantidad) }];
    return crearTrasladoSueltos(req, res);
};

// ─── MÓDULO: VENTAS DEL MES ─────────────────────────────────────────────────

const getSalesPage = async (req, res) => {
    return res.render('./tienda/storebehivors/sales', {
        pagina: 'Mis Ventas',
        csrfToken: req.csrfToken(),
        currentPath: '/storebehivors/sales'
    });
};

const _toDateStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const getVentasMes = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    try {
        const now = new Date();
        const hoyStr = _toDateStr(now);

        let { fechaA, fechaB } = req.query;
        if (!fechaA) fechaA = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        if (!fechaB) fechaB = hoyStr;

        const fechas = [];
        const cur = new Date(fechaA + 'T00:00:00');
        const endDate = new Date(fechaB + 'T00:00:00');
        while (cur <= endDate) {
            fechas.push(_toDateStr(cur));
            cur.setDate(cur.getDate() + 1);
        }
        fechas.reverse();

        const resultado = [];

        for (const fecha of fechas) {
            const inicio = new Date(fecha + 'T00:00:00');
            const fin    = new Date(fecha + 'T23:59:59');

            if (fecha === hoyStr) {
                const [facturas, egresos] = await Promise.all([
                    FacturaClientes.findAll({
                        where: { idPuntoDeVenta: idPdv, createdAt: { [Op.between]: [inicio, fin] } },
                        include: [{ model: DetallesPagosFactura, as: 'pagos', attributes: ['metodoPago', 'valor'] }]
                    }),
                    Egresos.findAll({
                        where: { idPuntoDeVenta: idPdv, createdAt: { [Op.between]: [inicio, fin] } },
                        attributes: ['valorEgreso'],
                        raw: true
                    })
                ]);

                let efectivo = 0, electronico = 0, credito = 0;
                for (const f of facturas) {
                    for (const p of f.pagos) {
                        const val = parseFloat(p.valor) || 0;
                        if (p.metodoPago === 'Efectivo') efectivo += val;
                        else if (['Banco', 'Billetera Virtual', 'Tarjeta Credito'].includes(p.metodoPago)) electronico += val;
                        else if (p.metodoPago === 'Entidad Crediticia') credito += val;
                    }
                }
                const egrTotal = egresos.reduce((s, e) => s + (parseFloat(e.valorEgreso) || 0), 0);

                resultado.push({
                    fecha, esHoy: true, estadoCaja: 'abierto',
                    efectivo: Math.round(efectivo), electronico: Math.round(electronico),
                    credito: Math.round(credito), egresos: Math.round(egrTotal),
                    total: Math.round(efectivo + electronico + credito)
                });
            } else {
                const caja = await CajaTienda.findOne({
                    where: { idPuntoDeVenta: idPdv, fechaApertura: { [Op.between]: [inicio, fin] } },
                    attributes: ['ventasEfectivo', 'ventasMediosElectronicos', 'ventasCredito', 'egresosTotales', 'ventasTotales', 'estado'],
                    raw: true
                });
                if (caja) {
                    resultado.push({
                        fecha, esHoy: false, estadoCaja: caja.estado,
                        efectivo:   Math.round(parseFloat(caja.ventasEfectivo)            || 0),
                        electronico: Math.round(parseFloat(caja.ventasMediosElectronicos) || 0),
                        credito:    Math.round(parseFloat(caja.ventasCredito)             || 0),
                        egresos:    Math.round(parseFloat(caja.egresosTotales)            || 0),
                        total:      Math.round(parseFloat(caja.ventasTotales)             || 0)
                    });
                }
            }
        }

        return res.json({ success: true, ventas: resultado, hoy: hoyStr });
    } catch (e) {
        console.error('getVentasMes:', e);
        return res.status(500).json({ success: false });
    }
};

const getDetalleDia = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    const now    = new Date();
    const hoyStr = _toDateStr(now);
    const fecha  = req.query.fecha || hoyStr;
    const esHoy  = fecha === hoyStr;
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const LIMIT  = 10;
    const offset = (page - 1) * LIMIT;

    try {
        const inicio = new Date(fecha + 'T00:00:00');
        const fin    = new Date(fecha + 'T23:59:59');

        let resumen = { efectivo: 0, electronico: 0, credito: 0, egresos: 0, total: 0 };
        let idCajaTiendaResult = null;

        if (esHoy) {
            const [facturas, egresos] = await Promise.all([
                FacturaClientes.findAll({
                    where: { idPuntoDeVenta: idPdv, createdAt: { [Op.between]: [inicio, fin] } },
                    include: [{ model: DetallesPagosFactura, as: 'pagos', attributes: ['metodoPago', 'valor'] }]
                }),
                Egresos.findAll({
                    where: { idPuntoDeVenta: idPdv, createdAt: { [Op.between]: [inicio, fin] } },
                    attributes: ['valorEgreso'],
                    raw: true
                })
            ]);
            let efectivo = 0, electronico = 0, credito = 0;
            for (const f of facturas) {
                for (const p of f.pagos) {
                    const val = parseFloat(p.valor) || 0;
                    if (p.metodoPago === 'Efectivo') efectivo += val;
                    else if (['Banco', 'Billetera Virtual', 'Tarjeta Credito'].includes(p.metodoPago)) electronico += val;
                    else if (p.metodoPago === 'Entidad Crediticia') credito += val;
                }
            }
            const egrTotal = egresos.reduce((s, e) => s + (parseFloat(e.valorEgreso) || 0), 0);
            resumen = {
                efectivo: Math.round(efectivo), electronico: Math.round(electronico),
                credito: Math.round(credito), egresos: Math.round(egrTotal),
                total: Math.round(efectivo + electronico + credito)
            };
        } else {
            const caja = await CajaTienda.findOne({
                where: { idPuntoDeVenta: idPdv, fechaApertura: { [Op.between]: [inicio, fin] } },
                attributes: ['idCajaTienda', 'ventasEfectivo', 'ventasMediosElectronicos', 'ventasCredito', 'egresosTotales', 'ventasTotales', 'estado'],
                raw: true
            });
            if (caja) {
                idCajaTiendaResult = caja.estado === 'cerrado' ? caja.idCajaTienda : null;
                resumen = {
                    efectivo:    Math.round(parseFloat(caja.ventasEfectivo)            || 0),
                    electronico: Math.round(parseFloat(caja.ventasMediosElectronicos)  || 0),
                    credito:     Math.round(parseFloat(caja.ventasCredito)             || 0),
                    egresos:     Math.round(parseFloat(caja.egresosTotales)            || 0),
                    total:       Math.round(parseFloat(caja.ventasTotales)             || 0)
                };
            }
        }

        const whereFactura = esHoy
            ? { idPuntoDeVenta: idPdv, createdAt: { [Op.between]: [inicio, fin] } }
            : { idPuntoDeVenta: idPdv, fechaEmision: fecha };

        const { count, rows } = await FacturaClientes.findAndCountAll({
            where: whereFactura,
            include: [
                { model: Clientes, as: 'cliente', attributes: ['primer_nombre', 'primer_apellido', 'razon_social', 'tipo_persona'] },
                { model: DetallesPagosFactura, as: 'pagos', attributes: ['valor', 'metodoPago'] }
            ],
            order: [['createdAt', 'DESC']],
            limit: LIMIT,
            offset
        });

        const facturas = rows.map(f => {
            const totalFact = f.pagos.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0);
            const c = f.cliente;
            const nombre = c?.tipo_persona === 'J'
                ? (c?.razon_social || 'Sin nombre')
                : (`${c?.primer_nombre || ''} ${c?.primer_apellido || ''}`).trim() || 'Consumidor Final';
            return {
                idFacturaCliente: f.idFacturaCliente,
                nroFactura: `${f.prefijo || ''}${f.numeroFactura || ''}`,
                cliente: nombre,
                total: Math.round(totalFact)
            };
        });

        return res.json({
            success: true, fecha, esHoy, resumen, facturas,
            totalFacturas: count, page,
            totalPages: Math.ceil(count / LIMIT),
            idCajaTienda: idCajaTiendaResult
        });
    } catch (e) {
        console.error('getDetalleDia:', e);
        return res.status(500).json({ success: false });
    }
};

const abrirCajaAPI = async (req, res) => {
    const idPuntoDeVenta = req.idPuntoDeVenta;
    if (!idPuntoDeVenta)
        return res.status(403).json({ success: false, mensaje: 'Sin punto de venta asignado.' });

    try {
        const cajaExistente = await _getCajaAbierta(idPuntoDeVenta);
        if (cajaExistente)
            return res.status(400).json({ success: false, mensaje: 'Hay una caja pendiente de cierre. Ciérrala antes de abrir una nueva.' });

        const cajaMenor = Number(req.body.cajaMenor);
        if (!Number.isFinite(cajaMenor) || cajaMenor < 0)
            return res.status(400).json({ success: false, mensaje: 'Caja menor inválida.' });

        const { idEmpleado } = req.empleadoVerificado;
        const codigo = await _generarCodigoCaja(idPuntoDeVenta, res.locals.nombreTienda);

        const caja = await CajaTienda.create({
            idPuntoDeVenta,
            codigo,
            idEmpleadoApertura: idEmpleado,
            idEmpleadoCierre:   idEmpleado,   // placeholder hasta el cierre real
            cajaMenor,
            fechaApertura: new Date(),
            estado: 'abierto'
        });

        broadcast('__ADMIN__', 'caja_status', { idPuntoDeVenta, estado: 'abierta' });

        return res.json({ success: true, idCajaTienda: caja.idCajaTienda });
    } catch (e) {
        console.error('abrirCajaAPI:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

// ── API: alertas de traslados — entrantes (destino = yo) y salientes sin aceptar (origen = yo) ──
const getTrasladosAlertaJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    try {
        const maxTime = parseInt(process.env.MAX_TRANSFER_TIME) || 259200; // segundos
        const ahora   = Date.now();

        const [entrantes, salientes] = await Promise.all([
            Traslados.findAll({
                where: { idDestino: idPdv, estado: 'EN_TRANSITO' },
                include: [
                    { model: PuntosDeVenta,    as: 'origen',  attributes: ['nombreComercial'], required: false },
                    { model: DetalleTraslados, as: 'items',   attributes: ['cantidad'] }
                ],
                order: [['fechaEnvio', 'ASC']]
            }),
            Traslados.findAll({
                where: { idOrigen: idPdv, estado: 'EN_TRANSITO' },
                include: [
                    { model: PuntosDeVenta,    as: 'destino', attributes: ['nombreComercial'], required: false },
                    { model: DetalleTraslados, as: 'items',   attributes: ['cantidad'] }
                ],
                order: [['fechaEnvio', 'ASC']]
            })
        ]);

        const mapear = (t, esOrigen) => {
            const totalItems            = (t.items || []).reduce((s, i) => s + (parseInt(i.cantidad) || 0), 0);
            const segundosTranscurridos = Math.floor((ahora - new Date(t.fechaEnvio).getTime()) / 1000);
            const fraccion              = Math.min(segundosTranscurridos / maxTime, 1);
            const nivel                 = fraccion < 1 / 3 ? 'verde' : fraccion < 2 / 3 ? 'naranja' : 'rojo';
            const contraparte           = esOrigen
                ? (t.destino?.nombreComercial || '—')
                : (t.origen?.nombreComercial  || '—');
            return { idTraslado: t.idTraslado, codigo: t.codigoTraslado, contraparte, fechaEnvio: t.fechaEnvio, segundosTranscurridos, totalItems, nivel, esOrigen };
        };

        const traslados = [
            ...entrantes.map(t => mapear(t, false)),
            ...salientes.map(t => mapear(t, true))
        ];

        return res.json({ success: true, traslados, maxTime });
    } catch (e) {
        console.error('getTrasladosAlertaJSON:', e);
        return res.status(500).json({ success: false });
    }
};

// accion (query, opcional): si se pasa, además de pertenecer a la tienda exige que el
// empleado tenga permiso ('Caja y ventas'/'vendedor'/accion) — usado por apertura
// (CREATE) y cierre (EDIT) de caja para dar feedback en vivo antes de enviar el form.
const validarEmpleadoTienda = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });
    const { codigo } = req.params;
    const { accion } = req.query;
    try {
        const empleado = await Empleados.findOne({
            where: { codigoEmpleado: codigo.trim().toUpperCase(), idPuntoDeVenta: idPdv },
            attributes: ['idEmpleado', 'idUsuario', 'PrimerNombre', 'PrimerApellido']
        });
        if (!empleado) return res.json({ success: false, mensaje: 'El empleado no pertenece a esta tienda.' });

        if (accion) {
            if (!empleado.idUsuario)
                return res.json({ success: false, mensaje: 'El empleado no tiene acceso al sistema.' });

            const ids = await resolverIds('Caja y ventas', 'vendedor', accion);
            if (!ids) return res.status(500).json({ success: false, mensaje: 'Configuración de permisos inválida.' });

            const permiso = await UserPermisos.findOne({
                where: { idUsuario: empleado.idUsuario, idRecurso: ids.idRecurso, idAccion: ids.idAccion },
                attributes: ['idPermiso']
            });
            if (!permiso) return res.json({ success: false, mensaje: 'El empleado no tiene permiso para esta acción.' });
        }

        return res.json({
            success: true,
            idEmpleado: empleado.idEmpleado,
            nombre: `${empleado.PrimerNombre} ${empleado.PrimerApellido}`
        });
    } catch (e) {
        console.error('validarEmpleadoTienda:', e);
        return res.status(500).json({ success: false });
    }
};

export {
    dashboardStores,
    getTraslados,
    getInventarioLista,
    sseConnect,
    getPedidosWebPendientesJSON,
    getPedidoWebParaCargarJSON,
    pedidosWebStorePage,
    getPedidosWebListaJSON,
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
    verificarTrasladosExpirados,
    getExpensesPage,
    crearEgreso,
    getEgresosJSON,
    getTotalEgresosHoy,
    getEgresoComprobantePDF,
    abrirCajaAPI,
    cuadrarCajaPage,
    getCuadreCajaDatos,
    cerrarCajaAPI,
    getCuadrePDF,
    _generarPDFCuadre,
    _calcularTransaccionesCaja,
    getSalesPage,
    getVentasMes,
    getDetalleDia,
    validarEmpleadoTraslado,
    trasladarDesdePerfil,
    getTrasladosAlertaJSON,
    validarEmpleadoTienda,
    sincronizarReservasPos,
    liberarReservasPos
};
