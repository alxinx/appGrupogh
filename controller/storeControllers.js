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
    PedidosWeb, DetallesPedidoWeb, PagosPedidoWeb,
    CajasYBancos, TrasladoEfectivo, TrasladoEfectivoHistorial, MovimientosCajasBancos
} from '../models/index.js';
import { Op, fn, col, literal } from 'sequelize';
import { sincronizarReservas, liberarReservas, demandaDeOtrosJson, ajustarPorStock, reconciliarPorVenta } from '../helpers/reservasCarrito.js';
import { validarDescripcionEgreso } from '../helpers/descripcionEgreso.js';
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
import { tituloLista } from '../helpers/textoLista.js';
import { prepararVoucher } from '../helpers/voucherTraslado.js';
import { resumenPendientes, wherePendienteAceptar } from '../helpers/trasladosPendientes.js';
import { generarPDFTraslado, buscarTrasladoParaPDF } from '../helpers/pdfTraslado.js';
import { invalidarContadoresAdmin } from '../middleware/adminMenuMiddleware.js';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { crearConCodigo, siguienteNumero } from '../helpers/secuencias.js';
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
                    // También 'auditoria': una caja que quedó a medio cuadrar de ayer
                    // sigue siendo una caja vencida sin cerrar. Con solo 'abierto', el
                    // menú no la encontraba y en vez de "Cerrar Caja Anterior" ofrecía
                    // "Apertura de Caja" — sobre una caja que sí existe y que el sistema
                    // no dejaría abrir de nuevo.
                    estado: { [Op.in]: ESTADOS_CAJA_VIVA },
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
        tipoDocumento: 'CC',
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
            order: [['createdAt', 'DESC'], ['idPedido', 'ASC']],
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

// Estados en los que la caja del turno sigue viva. 'auditoria' es la caja que el
// operador está cuadrando: ya no admite ventas, pero todo lo demás —leer sus totales,
// cerrarla, calcular el efectivo disponible— tiene que seguir funcionando. Tratarla como
// inexistente rompería la propia pantalla de cuadre.
const ESTADOS_CAJA_VIVA = ['abierto', 'auditoria'];

const _getCajaAbierta = (idPuntoDeVenta, includes = [], transaction = undefined) =>
    CajaTienda.findOne({
        where: { idPuntoDeVenta, estado: { [Op.in]: ESTADOS_CAJA_VIVA }, fechaCierre: null },
        include: includes,
        transaction
    });

// estadoTx: 'pendiente' para caja activa, 'liquidada' para PDF de caja ya cerrada
// `transaction` es opcional y por defecto no va: el cuadre y los reportes leen fuera de
// toda transacción, como siempre. Lo usa el traslado de efectivo, que recalcula el tope
// con la caja bloqueada y necesita leer dentro de la misma transacción para no evaluar
// un estado anterior al lock.
const _calcularTransaccionesCaja = async (idPdv, inicio, fin, estadoTx = 'pendiente', transaction = undefined) => {
    const [egresosRows, facturas] = await Promise.all([
        Egresos.findAll({
            where: { idPuntoDeVenta: idPdv, estado: estadoTx, createdAt: { [Op.between]: [inicio, fin] } },
            attributes: ['idEgreso', 'referencia', 'descripcion', 'valorEgreso', 'metodoPago', 'idEntidad', 'idCajaBanco', 'tipo'],
            include: [
                { model: Entidades, as: 'entidad', attributes: ['nombreEntidad'], required: false },
                // Los traslados apuntan a una cuenta propia, no a una entidad de cobro.
                // Sin este include el cuadre los mostraría sin destino.
                { model: CajasYBancos, as: 'cajaBancoDestino', attributes: ['nombreCajaBanco'], required: false },
                // El estado del traslado. Un traslado 'En Transito' es plata que ya salió
                // del cajón pero que nadie aceptó todavía: el operador cierra su turno
                // respondiendo por un efectivo que el otro lado aún puede rechazar, y
                // tiene derecho a verlo marcado antes de firmar el cuadre.
                { model: TrasladoEfectivo, as: 'trasladoEfectivo', attributes: ['estado'], required: false }
            ],
            transaction
        }),
        FacturaClientes.findAll({
            where: { idPuntoDeVenta: idPdv, estado: estadoTx, createdAt: { [Op.between]: [inicio, fin] } },
            attributes: ['idFacturaCliente', 'prefijo', 'numeroFactura'],
            include: [{ model: DetallesPagosFactura, as: 'pagos',
                        include: [{ model: Entidades, as: 'entidad', attributes: ['nombreEntidad'] }] }],
            transaction
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

    // Un egreso pagado por transferencia NO sale del cajón. Antes todos se descontaban
    // del efectivo, así que pagarle a un proveedor por Nequi dejaba el efectivo esperado
    // corto por ese monto.
    const txEgresos = egresosRows.map(e => ({
        idEgreso:    e.idEgreso,
        referencia:  e.referencia || '—',
        descripcion: e.descripcion || '—',
        valor:       Math.round(parseFloat(e.valorEgreso) || 0),
        metodoPago:  e.metodoPago || 'Efectivo',
        // Un gasto y un traslado son las dos cosas que salen del cajón, pero significan
        // distinto: uno es plata que el negocio gastó, el otro es plata que solo cambió
        // de lugar. Sin este campo el cuadre los suma en un solo número y esa diferencia
        // se pierde.
        tipo:        e.tipo || 'Egreso',
        // Nulo en un egreso común: no hay traslado del que hablar.
        estadoTraslado: e.trasladoEfectivo?.estado || null,
        entidad:     e.cajaBancoDestino?.nombreCajaBanco || e.entidad?.nombreEntidad || null
    }));
    const sEgresos            = txEgresos.reduce((s, e) => s + e.valor, 0);
    const sEgresosEfectivo    = txEgresos.filter(e => e.metodoPago === 'Efectivo').reduce((s, e) => s + e.valor, 0);
    const sEgresosElectronicos = sEgresos - sEgresosEfectivo;
    const idFacturas = facturas.map(f => f.idFacturaCliente);

    return {
        sEfectivo, sMedios, sCredito, sEgresos, sVentas: sEfectivo + sMedios + sCredito,
        sEgresosEfectivo, sEgresosElectronicos,
        // Lo que debería haber físicamente en el cajón: base + ventas en efectivo −
        // egresos pagados en efectivo. Antes esta cuenta la hacía el vendedor de cabeza.
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
                ? [[literal(`CASE WHEN \`PRODUCTOS\`.\`idProducto\` IN (${zeroStockIds.map(id => `'${id}'`).join(',')}) THEN 1 ELSE 0 END`), 'ASC']]
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

// Mismo set que CLIENTES.tipoDocumento (ENUM).
const TIPOS_DOC_CLIENTE = ['CC', 'CE', 'TI', 'NIT', 'PP', 'PPT', 'PEP'];

const guardarCliente = async (req, res) => {
    const {
        idCliente: idClienteExistente,
        tipo_persona: tipo_personaRaw,
        tipoDocumento, numero_doc, digito_verif,
        razon_social, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
        email, telefono,
        regimen_fiscal, responsabilidad_fiscal,
        gran_contribuyente, autorretenedor, agente_retencion, obligado_aduanero,
        ciiu, descripcion_ciiu, fecha_rut,
        idDepartamento, nombreDepartamento, idMunicipio, nombreMunicipio, direccion
    } = req.body;

    if (!tipoDocumento || !numero_doc) {
        return res.status(400).json({ success: false, mensaje: 'Tipo y número de documento son requeridos.' });
    }
    if (!TIPOS_DOC_CLIENTE.includes(tipoDocumento)) {
        return res.status(400).json({ success: false, mensaje: 'Tipo de documento inválido.' });
    }

    const tipo_persona = tipo_personaRaw || (tipoDocumento === 'NIT' ? 'J' : 'N');
    const esEmpresa    = tipo_persona === 'J';
    const toBool       = (v) => v === 'true' || v === true;
    const toTitle      = (s) => s ? s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : null;

    const t = await db.transaction();
    let idCliente;

    try {
        const datosBase = {
            tipo_persona,
            tipoDocumento,
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
            // Los códigos llegan como arreglo desde el formulario. Se normalizan a la
            // cadena "O-13,O-15" que guarda la columna, filtrando contra la lista válida:
            // un código inventado en el navegador no puede terminar en una factura.
            const CODIGOS_DIAN = ['O-13', 'O-15', 'O-23', 'O-47', 'R-99-PN'];
            const responsabilidades = (Array.isArray(responsabilidad_fiscal)
                ? responsabilidad_fiscal
                : String(responsabilidad_fiscal || '').split(','))
                .map(c => String(c).trim().toUpperCase())
                .filter(c => CODIGOS_DIAN.includes(c));

            const tribData = {
                regimen_fiscal,
                // Nulo y no cadena vacía: "todavía no se declaró" es distinto de haber
                // declarado R-99-PN, que es decir que no aplica ninguna.
                responsabilidad_fiscal: responsabilidades.length ? [...new Set(responsabilidades)].join(',') : null,
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
            documento: `${tipoDocumento} ${numero_doc.trim()}`
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

    // La marca OF viene del interruptor del formulario de cliente. Se normaliza a booleano
    // acá y no se toma del body tal cual: es una columna de la factura y `req.body` no se
    // pasa nunca directo a `create` (CLAUDE.md §12). Ausente significa "no aplica", que es
    // el caso de casi todas las ventas.
    const marcarOF = req.body?.OF === true || req.body?.OF === 'true' || req.body?.OF === 1;
    const WHOLESALE_MIN  = parseInt(process.env.WHOLESALE_PRICE_MIN_PRODUCT) || 6;

    // ── 1. Validar datos del frontend ─────────────────────────────────────────
    if (!idPuntoDeVenta)
        return res.status(403).json({ success: false, mensaje: 'Sin punto de venta asignado.' });

    const cajaAbierta = await _getCajaAbierta(idPuntoDeVenta);
    if (!cajaAbierta)
        return res.status(403).json({ success: false, mensaje: 'No hay caja abierta. Debes abrir la caja antes de facturar.' });

    // El cristal sobre la orden en el POS es comodidad; esto es lo que de verdad impide
    // vender. Sin este freno, una venta que entra mientras el operador cuenta el cajón
    // aparece en los totales del cierre pero no en lo que él contó, y el descuadre se le
    // anota a él aunque la plata esté ahí.
    // El candado caduca: una caja trabada por una pestaña que se cerró de golpe no puede
    // dejar a la tienda sin facturar para siempre. Si venció, se libera y la venta sigue.
    if (cajaAbierta.estado === 'auditoria' && !(await _liberarCuadreSiVencio(idPuntoDeVenta, cajaAbierta)))
        return res.status(409).json({
            success: false,
            cajaEnCuadre: true,
            mensaje: 'La caja está en proceso de cierre. No se pueden registrar ventas hasta que termine el cuadre.'
        });

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
            horaEmision:          ahora.toTimeString().slice(0, 8),
            // Marcada OF: sale en la hoja aparte del informe de facturación de la tienda,
            // con los datos tributarios del cliente abiertos en columnas.
            OF:                   marcarOF
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
            const docCli = `${cli.tipoDocumento || ''} ${cli.numero_doc || ''}${cli.digito_verif ? '-' + cli.digito_verif : ''}`.trim();
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
    // Destinos posibles de una transferencia: las cuentas propias del negocio que estén
    // activas. No son las ENTIDADES —ésas son los medios con los que la tienda COBRA—,
    // sino a dónde se consigna la plata del cajón.
    //
    // Una cuenta inactiva no aparece: el perfil de la cuenta ya bloquea sus movimientos,
    // así que ofrecerla acá sería ofrecer un destino que después rechaza el asiento.
    const cuentas = await CajasYBancos.findAll({
        where: { estado: true },
        attributes: ['idCajaBanco', 'nombreCajaBanco', 'tipo', 'referencia'],
        // Cajas primero: consignar de un cajón a otro es lo más frecuente y lo más
        // inmediato. Un ORDER BY alfabético dejaba 'banco' arriba de 'caja'.
        order: [[literal("FIELD(tipo, 'caja', 'banco', 'billetera')"), 'ASC'], ['nombreCajaBanco', 'ASC']],
        raw: true
    });

    return res.render('./tienda/storebehivors/expenses', {
        pagina: 'Egresos',
        csrfToken: req.csrfToken(),
        currentPath: '/storebehivors/expenses',
        cuentas
    });
};

// Cuánto efectivo hay realmente disponible para transferir.
//
// Es lo recaudado en efectivo MENOS lo que ya salió del cajón en efectivo. La base de la
// caja no cuenta: es el sencillo para dar cambio, no plata de la venta. Sin restar los
// egresos, una tienda que recaudó 1.000.000 y pagó 800.000 en efectivo podría "consignar"
// 1.000.000 que físicamente no están.
const _efectivoDisponibleParaTraslado = async (idPdv, transaction = undefined) => {
    const caja = await _getCajaAbierta(idPdv, [], transaction);
    if (!caja) return { hayCaja: false, recaudado: 0, egresosEfectivo: 0, disponible: 0 };

    const { sEfectivo, sEgresosEfectivo } = await _calcularTransaccionesCaja(
        idPdv, new Date(caja.fechaApertura), new Date(), 'pendiente', transaction
    );

    return {
        hayCaja: true,
        recaudado: sEfectivo,
        egresosEfectivo: sEgresosEfectivo,
        disponible: Math.max(0, sEfectivo - sEgresosEfectivo)
    };
};

// GET /store/storebehivors/expenses/efectivo-disponible
const getEfectivoDisponible = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false, mensaje: 'Sin punto de venta.' });
    try {
        return res.json({ success: true, ...(await _efectivoDisponibleParaTraslado(idPdv)) });
    } catch (e) {
        console.error('getEfectivoDisponible:', e);
        return res.status(500).json({ success: false });
    }
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

        const { sEfectivo, sMedios, sCredito, sEgresos, sEgresosEfectivo, sEgresosElectronicos,
                sVentas, txEfectivo, txElectronicos, txCredito, txEgresos } =
            await _calcularTransaccionesCaja(idPdv, new Date(caja.fechaApertura), new Date());

        return res.json({
            success: true,
            caja: {
                idCajaTienda:     caja.idCajaTienda,
                cajaMenor:        Math.round(parseFloat(caja.cajaMenor) || 0),
                empleadoApertura: `${caja.empleadoApertura?.PrimerNombre || ''} ${caja.empleadoApertura?.PrimerApellido || ''}`.trim()
            },
            totales: {
                ventas: sVentas, egresos: sEgresos, efectivo: sEfectivo,
                mediosElectronicos: sMedios, credito: sCredito,
                egresosEfectivo: sEgresosEfectivo, egresosElectronicos: sEgresosElectronicos,
                // Lo que debería estar físicamente en el cajón. Antes esta cuenta la hacía
                // el vendedor de cabeza; ahora sale del mismo lugar que todo lo demás.
                efectivoEsperado: Math.round(parseFloat(caja.cajaMenor) || 0) + sEfectivo - sEgresosEfectivo,
                // Lo que la tienda entrega al cerrar. Es lo del cajón MENOS la base: la
                // caja menor no se entrega, se queda para que el turno siguiente pueda dar
                // cambio. Son dos números distintos y confundirlos hace entregar de más o
                // de menos, así que los dos salen calculados de acá y no de la cabeza de
                // nadie.
                // Nunca negativo: si del cajón salió más de lo que entró por ventas, no hay
                // nada que entregar y el faltante es de la base, que se informa aparte.
                totalAEntregar: Math.max(0, sEfectivo - sEgresosEfectivo),
                baseCorta:      Math.max(0, sEgresosEfectivo - sEfectivo)
            },
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

// ─── ENTRAR Y SALIR DEL CUADRE ───────────────────────────────────────────────
//
// Mientras el operador cuenta el cajón, la caja pasa a 'auditoria' y el POS deja de
// facturar. Sin esto, una venta que entra a mitad del conteo queda en los totales del
// cierre pero no en lo que el operador contó, y el descuadre se le anota a él aunque la
// plata esté físicamente en el cajón.
//
// El cambio se avisa por SSE a las terminales DE ESTE PUNTO DE VENTA y solo a ellas
// —`broadcast` reparte por idPuntoDeVenta—. La caja es de la sede, no de la máquina: si
// una tienda tiene dos registradoras, las dos se frenan; las demás sedes ni se enteran y
// siguen vendiendo con su propia caja.

const _avisarEstadoCuadre = (idPdv, enCuadre) => {
    try {
        broadcast(idPdv, 'caja_en_cuadre', { enCuadre });
    } catch (e) {
        console.error('avisar estado de cuadre:', e);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Expiración del candado de cuadre.
//
// 'auditoria' frena la facturación de toda la sede. Se soltaba solo si el navegador
// alcanzaba a avisar al cerrarse; si el equipo se apaga o se cae la red, ese aviso no
// llega y la tienda queda sin poder facturar hasta que alguien lo note.
//
// Acá el candado caduca. La pantalla del cuadre lo refresca mientras está viva, así que
// un conteo largo de verdad nunca se corta; lo que caduca es el candado abandonado.
//
// La liberación es perezosa a propósito: no hay proceso de fondo ni cron que mantener,
// la suelta la primera petición que se topa con ella. Y va con el estado en el WHERE, así
// que si dos peticiones llegan juntas solo una libera y solo una avisa.
// ─────────────────────────────────────────────────────────────────────────────
const CUADRE_TIMEOUT_MS = (parseInt(process.env.CUADRE_TIMEOUT_MIN, 10) || 30) * 60 * 1000;

const _cuadreVencido = (caja) => {
    if (!caja || caja.estado !== 'auditoria') return false;
    // Sin marca no se puede saber cuándo empezó: son las cajas que ya estaban trabadas
    // antes de que existiera la columna. Se dan por vencidas para que no queden colgadas
    // eternamente, que es justamente el problema que esto viene a resolver.
    if (!caja.cuadreDesde) return true;
    return Date.now() - new Date(caja.cuadreDesde).getTime() > CUADRE_TIMEOUT_MS;
};

/**
 * Libera la caja si su cuadre caducó. Devuelve true si la liberó.
 */
const _liberarCuadreSiVencio = async (idPdv, caja) => {
    if (!_cuadreVencido(caja)) return false;
    const [filas] = await CajaTienda.update(
        { estado: 'abierto', cuadreDesde: null },
        { where: { idCajaTienda: caja.idCajaTienda, estado: 'auditoria' } }
    );
    if (!filas) return false;
    console.warn(`[cuadre] caja ${caja.codigo || caja.idCajaTienda} liberada por vencimiento`);
    _avisarEstadoCuadre(idPdv, false);
    return true;
};

// POST /store/storebehivors/caja/cuadre/iniciar
//
// También hace de latido: la pantalla del cuadre lo vuelve a llamar cada tanto para
// decir que sigue ahí, y eso corre la marca hacia adelante.
const iniciarCuadreCaja = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false, mensaje: 'Sin punto de venta.' });

    try {
        // `update` con el estado en el WHERE y revisando filas afectadas: si otra terminal
        // ganó la carrera, no se pisa su resultado ni se avisa dos veces.
        const [filas] = await CajaTienda.update(
            { estado: 'auditoria', cuadreDesde: new Date() },
            { where: { idPuntoDeVenta: idPdv, estado: 'abierto', fechaCierre: null } }
        );

        if (!filas) {
            const caja = await _getCajaAbierta(idPdv);
            if (!caja) return res.status(409).json({ success: false, mensaje: 'No hay una caja abierta para cuadrar.' });
            // Ya estaba en auditoría: o alguien más entró al cuadre antes, o es esta misma
            // pantalla mandando su latido. En los dos casos se corre la marca: el candado
            // tiene dueño vivo y no hay razón para que caduque.
            await CajaTienda.update(
                { cuadreDesde: new Date() },
                { where: { idCajaTienda: caja.idCajaTienda, estado: 'auditoria' } }
            );
            return res.json({ success: true, yaEstaba: true });
        }

        _avisarEstadoCuadre(idPdv, true);
        return res.json({ success: true, yaEstaba: false });
    } catch (e) {
        console.error('iniciarCuadreCaja:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo iniciar el cuadre.' });
    }
};

// POST /store/storebehivors/caja/cuadre/liberar
//
// Devuelve la caja a 'abierto'. Lo llama el botón "Volver a vender" y también la propia
// pantalla al abandonarse, para que nadie quede sin poder facturar porque alguien cerró
// una pestaña.
const liberarCuadreCaja = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false, mensaje: 'Sin punto de venta.' });

    try {
        const [filas] = await CajaTienda.update(
            { estado: 'abierto', cuadreDesde: null },
            { where: { idPuntoDeVenta: idPdv, estado: 'auditoria', fechaCierre: null } }
        );
        if (filas) _avisarEstadoCuadre(idPdv, false);
        return res.json({ success: true, liberada: filas > 0 });
    } catch (e) {
        console.error('liberarCuadreCaja:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo liberar la caja.' });
    }
};

// GET /store/storebehivors/caja/cuadre/estado
// Lo consulta el POS al cargar: el evento SSE solo llega a quien ya estaba conectado, y
// una terminal que abre después tiene que enterarse igual de que la caja está en cuadre.
const getEstadoCuadreCaja = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });
    try {
        const caja = await _getCajaAbierta(idPdv);
        // Si el candado caducó se suelta acá mismo: esta es la petición que hace el POS
        // al cargar, así que una terminal que abre después de un cuadre abandonado se
        // encuentra la caja libre en vez del cristal encima.
        if (await _liberarCuadreSiVencio(idPdv, caja)) {
            return res.json({ success: true, enCuadre: false, liberadaPorVencimiento: true });
        }
        return res.json({ success: true, enCuadre: caja?.estado === 'auditoria' });
    } catch (e) {
        console.error('getEstadoCuadreCaja:', e);
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
            // También en 'auditoria': es justamente la caja que se está cuadrando.
            where: { idCajaTienda, idPuntoDeVenta: idPdv, estado: { [Op.in]: ESTADOS_CAJA_VIVA } },
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

        // El cierre escribe en tres tablas financieras: va en una transacción. Si algo
        // falla a mitad de camino, no puede quedar la factura liquidada con la caja
        // todavía abierta — ese estado haría que el siguiente cierre no la viera.
        const t = await db.transaction();
        try {
            // Los egresos se liquidan SIEMPRE, no solo cuando hubo facturas. Antes esto
            // estaba dentro de `if (idFacturas.length > 0)`: un día sin ventas pero con
            // egresos los dejaba en 'pendiente' y volvían a contarse en el cierre
            // siguiente, inflándolo. Pasa en un día flojo o en una tienda que ese día
            // solo recibió mercancía.
            if (idFacturas.length > 0) {
                await FacturaClientes.update(
                    { estado: 'liquidada' },
                    { where: { idFacturaCliente: idFacturas }, transaction: t }
                );
            }
            await Egresos.update(
                { estado: 'liquidada' },
                { where: { idPuntoDeVenta: idPdv, estado: 'pendiente', createdAt: { [Op.between]: [inicio, fin] } }, transaction: t }
            );

            await caja.update({
                idEmpleadoCierre:               empleadoCierre.idEmpleado,
                // La marca del cuadre muere con la caja: una cerrada nunca está en cuadre.
                cuadreDesde:                    null,
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
            }, { transaction: t });

            await t.commit();
        } catch (e) {
            if (!t.finished) await t.rollback().catch(() => {});
            throw e;
        }

        // El aviso va DESPUÉS del commit y fuera de su try: si fallara acá, un rollback
        // sobre una transacción ya cerrada lanzaría un segundo error dentro del catch y
        // la respuesta no se enviaría nunca.
        try {
            broadcast('__ADMIN__', 'caja_status', { idPuntoDeVenta: idPdv, estado: 'cuadrada' });
        } catch (e) {
            console.error('cerrarCajaAPI (aviso post-cierre):', e);
        }

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
    // Estas cuatro cifras son lo que DECLARÓ EL OPERADOR al cerrar, no lo que hay en el
    // cajón. Se llamaban "Efectivo Registrado", "Egresos Registrado"… y ese rótulo se
    // leía como "el efectivo que quedó": con una caja sin medios electrónicos ni crédito,
    // "Efectivo Registrado" da igual que "Ventas Totales" y parece que no se restó nada.
    // Decir de quién es el número saca la ambigüedad de raíz.
    filaPuntos('Ventas en efectivo (operador)',   fmt(efReg), { checkbox: true, bold: Math.abs(efReg - Math.round(sums.sEfectivo)) > 0.5 });
    doc.moveDown(0.1);
    filaPuntos('Ventas a crédito (operador)',     fmt(crReg), { checkbox: true, bold: Math.abs(crReg - Math.round(sums.sCredito))  > 0.5 });
    doc.moveDown(0.1);
    filaPuntos('Medios electrónicos (operador)',  fmt(meReg), { checkbox: true, bold: Math.abs(meReg - Math.round(sums.sMedios))   > 0.5 });
    doc.moveDown(0.1);
    filaPuntos('Egresos (operador)',              fmt(egReg), { checkbox: true, bold: Math.abs(egReg - Math.round(sums.sEgresos))  > 0.5 });
    doc.moveDown(0.3); hr();

    // ── El neto: contra esto se cuenta el cajón ───────────────────────────────
    //
    // El recibo listaba los componentes por separado y nunca imprimía el resultado, así
    // que quien audita el papel tenía que hacer la resta de cabeza — que es exactamente
    // lo que este comprobante existe para evitar. Se imprimen los dos números porque son
    // distintos y confundirlos hace entregar de más o de menos:
    //
    //   · en el cajón = base + ventas en efectivo − egresos en efectivo
    //   · a entregar  = lo mismo SIN la base, que se queda para el turno siguiente
    //
    // Se usa `sEgresosEfectivo` y no `sEgresos`: un egreso pagado por transferencia no
    // sale del cajón y restarlo dejaría el efectivo esperado corto por ese monto.
    const egresosEfectivo = Math.round(sums.sEgresosEfectivo || 0);
    const efectivoEsperado = cajaMenorSistema + Math.round(sums.sEfectivo) - egresosEfectivo;
    const neto             = Math.round(sums.sEfectivo) - egresosEfectivo;

    // El neto puede dar negativo: pasa cuando del cajón salió más efectivo del que
    // entró por ventas, y entonces la diferencia salió de la base. No se puede entregar
    // un monto negativo, así que se entrega cero y el faltante se dice aparte, en
    // palabras. Un "-$5.000" impreso en el renglón de lo que hay que entregar no se
    // entiende y se presta a que alguien lo lea como un monto a cobrar.
    const aEntregar   = Math.max(0, neto);
    const baseCorta   = Math.max(0, -neto);

    seccionTitulo('EFECTIVO ESPERADO');
    doc.font('Helvetica').fontSize(6).text(
        `Base ${fmt(cajaMenorSistema)} + ventas en efectivo ${fmt(Math.round(sums.sEfectivo))} - egresos en efectivo ${fmt(egresosEfectivo)}`,
        MARGIN, doc.y, { width: CW }
    );
    doc.moveDown(0.2);
    filaPuntos('DEBE HABER EN EL CAJON', fmt(efectivoEsperado), { bold: true });
    doc.moveDown(0.1);
    filaPuntos('TOTAL A ENTREGAR',       fmt(aEntregar),        { bold: true });
    doc.moveDown(0.1);
    if (baseCorta > 0) {
        doc.font('Helvetica-Bold').fontSize(6).text(
            `La base quedo corta en ${fmt(baseCorta)}: del cajon salio mas efectivo del que entro por ventas. Se repone con las proximas ventas en efectivo.`,
            MARGIN, doc.y, { width: CW }
        );
        doc.moveDown(0.1);
    }
    doc.font('Helvetica').fontSize(5.5).text(
        `A entregar = lo del cajon menos la base de ${fmt(cajaMenorSistema)}, que queda para el proximo turno.`,
        MARGIN, doc.y, { width: CW }
    );
    doc.moveDown(0.3); hr();

    // ── Detalle: transacciones electrónicas (Banco / Billetera / Tarjeta) ──────
    listaPorEntidad('TRANSACCIONES ELECTRÓNICAS', txElectronicos);

    // ── Detalle: ventas a entidades crediticias ─────────────────────────────────
    listaPorEntidad('VENTAS A CRÉDITO', txCredito);

    // ── SECCIÓN 6: egresos ───────────────────────────────────────────────────────
    if (txEgresos.length > 0) {
        seccionTitulo('EGRESOS Y TRASLADOS DE EFECTIVO');
        for (const e of txEgresos) {
            // El comprobante impreso también tiene que decir de dónde salió la plata:
            // quien concilia después no puede quedar con la misma ambigüedad. En un
            // traslado lo que interesa es lo contrario —a dónde fue—, que es lo que
            // permite seguirle el rastro a esa plata desde este papel.
            // `->` y no una flecha Unicode: la Helvetica estándar de PDFKit codifica en
            // WinAnsi y no tiene glifo para U+2192, así que la flecha salía impresa como
            // un signo de admiración. Los acentos sí están en WinAnsi y se usan libremente.
            const destino = e.tipo === 'Traslado'
                ? (e.entidad ? ` -> ${e.entidad}` : '')
                : (e.metodoPago === 'Electronico' ? ` (${e.entidad || 'transferencia'})` : '');
            // Marcas de una o dos letras y no la palabra entera: la línea ya lleva
            // referencia, destino y valor, y en 227 puntos de ancho no entra una columna
            // más. El asterisco es lo único que distingue un traslado ya asentado de uno
            // que todavía puede volver.
            const marca = e.tipo !== 'Traslado' ? ''
                : (e.estadoTraslado === 'En Transito' ? '[T*] ' : '[T] ');
            filaPuntos(`${marca}${e.referencia}${destino}`, fmt(e.valor));
            doc.moveDown(0.1);
        }
        hr();

        // Los dos conceptos se totalizan por separado. Sumarlos en una sola cifra hace
        // parecer que el negocio gastó plata que en realidad solo se mudó a otra cuenta,
        // y esa lectura es la que infla los egresos de un cierre.
        const totalTraslados = txEgresos.filter(e => e.tipo === 'Traslado').reduce((a, e) => a + e.valor, 0);
        const totalGastos    = Math.round(sums.sEgresos) - totalTraslados;

        filaPuntos('TOTAL EGRESOS:',   fmt(totalGastos),    { bold: true });
        doc.moveDown(0.1);
        filaPuntos('TOTAL TRASLADOS:', fmt(totalTraslados), { bold: true });
        doc.moveDown(0.1);
        filaPuntos('TOTAL GENERAL:',   fmt(Math.round(sums.sEgresos)), { bold: true });
        // Lo que salió del cajón y el destino todavía no aceptó. Va con el mismo peso que
        // los otros totales porque explica una parte del descuadre: si acá figuran
        // $100.000 sin aceptar, esa es la razón por la que esos $100.000 no están
        // físicamente en el punto de venta, y la referencia de la línea de arriba es por
        // dónde se le sigue el rastro.
        const totalSinAceptar = txEgresos
            .filter(e => e.estadoTraslado === 'En Transito')
            .reduce((a, e) => a + e.valor, 0);

        if (totalSinAceptar > 0) {
            doc.moveDown(0.1);
            filaPuntos('SIN ACEPTAR AÚN:', fmt(totalSinAceptar), { bold: true });
        }

        if (totalTraslados > 0) {
            doc.moveDown(0.1);
            doc.font('Helvetica').fontSize(5.5).text(
                '[T] = traslado de efectivo a una caja o cuenta del negocio: esa plata no se gastó, cambió de lugar.',
                MARGIN, doc.y, { width: CW }
            );
        }

        if (totalSinAceptar > 0) {
            doc.moveDown(0.1);
            doc.font('Helvetica-Bold').fontSize(5.5).text(
                '[T*] = despachado, pero el destino todavía NO lo aceptó. Esa plata ya salió del cajón y por eso no está en la tienda. Si el destino la rechaza o recibe menos, la diferencia vuelve a este turno.',
                MARGIN, doc.y, { width: CW }
            );
        }
        if (sums.sEgresosElectronicos > 0) {
            doc.moveDown(0.1);
            filaPuntos('  De los cuales salieron del cajón:', fmt(sums.sEgresosEfectivo));
        }
        doc.moveDown(0.3); hr();
    }

    // ── SECCIÓN 7: descuadre (solo si hay diferencias sistema vs operador) ─────
    const categoriasDescuadre = [
        // La base entra al descuadre como cualquier otra categoría. Antes la diferencia
        // se imprimía pero el cierre NO quedaba marcado: si alguien sacaba plata de la
        // base, no saltaba en ningún lado.
        { label: 'base (caja menor)',   sis: caja.cajaMenor,                           op: caja.cajaMenorRegistrada },
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
            sums:           { sEfectivo: datos.sEfectivo, sMedios: datos.sMedios, sCredito: datos.sCredito, sEgresos: datos.sEgresos, sVentas: datos.sVentas, sEgresosEfectivo: datos.sEgresosEfectivo, sEgresosElectronicos: datos.sEgresosElectronicos },
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

    const { valorEgreso, referencia, descripcion, metodoPago, idCajaBanco } = req.body;
    if (!valorEgreso) {
        return res.status(400).json({ success: false, mensaje: 'Valor requerido.' });
    }

    const empleado = req.empleadoVerificado;

    const valor = parseFloat(valorEgreso);
    if (!Number.isFinite(valor) || valor <= 0) {
        return res.status(400).json({ success: false, mensaje: 'Valor inválido.' });
    }

    // El formulario ya la exige, pero eso es del navegador. Un egreso sin motivo es plata
    // que sale sin dejar dicho en qué se usó, y el cuadre no puede reconstruirlo después.
    const desc = validarDescripcionEgreso(descripcion);
    if (!desc.ok) {
        return res.status(400).json({ success: false, mensaje: desc.mensaje });
    }

    // Una transferencia mueve el efectivo del cajón a una cuenta propia.
    const metodo = metodoPago === 'Electronico' ? 'Electronico' : 'Efectivo';
    let cuentaDestino = null;

    if (metodo === 'Electronico') {
        if (!idCajaBanco) {
            return res.status(400).json({ success: false, mensaje: 'Indicá a qué cuenta se transfiere.' });
        }
        // Se valida contra la base, y que siga ACTIVA: el formulario solo muestra las
        // activas, pero eso es comodidad del navegador. Una cuenta pudo desactivarse
        // mientras el formulario estaba abierto.
        cuentaDestino = await CajasYBancos.findOne({
            where: { idCajaBanco, estado: true },
            attributes: ['idCajaBanco', 'nombreCajaBanco', 'referencia']
        });
        if (!cuentaDestino) {
            return res.status(422).json({ success: false, mensaje: 'La cuenta indicada no existe o está inactiva.' });
        }

        // El tope se recalcula acá con los mismos números del cuadre. El aviso del
        // formulario es una cortesía; esto es lo que impide consignar plata que no está
        // en el cajón, aunque la petición no venga del formulario.
        const efectivo = await _efectivoDisponibleParaTraslado(idPdv);
        if (!efectivo.hayCaja) {
            return res.status(422).json({ success: false, mensaje: 'No hay una caja abierta: no se puede transferir efectivo.' });
        }
        if (valor > efectivo.disponible) {
            return res.status(422).json({
                success: false,
                mensaje: `La transferencia no puede superar el efectivo disponible en caja ($${Math.round(efectivo.disponible).toLocaleString('es-CO')}).`,
                disponible: efectivo.disponible
            });
        }
    }

    try {
        const cajaActiva = await CajaTienda.findOne({
            where: { idPuntoDeVenta: idPdv, estado: { [Op.in]: ESTADOS_CAJA_VIVA } },
            attributes: ['idCajaTienda']
        });

        // Una transferencia saca el efectivo del cajón y lo consigna en una cuenta del
        // propio negocio: esa plata no se gastó, cambió de lugar. Sin escribir el tipo,
        // todo caía en el default 'Egreso' y consignar la venta del día aparecía en los
        // reportes como si el negocio hubiera gastado esa plata, que es exactamente lo
        // que la columna existe para evitar.
        const tipoEgreso = metodo === 'Electronico' ? 'Traslado' : 'Egreso';

        // La transacción existe por la referencia: el número se reserva en SECUENCIAS y
        // tiene que confirmarse junto con la fila que lo usa. Si el INSERT falla, el
        // contador vuelve atrás y ese número queda libre para el próximo egreso.
        const egreso = await db.transaction(async (t) => Egresos.create({
            idPuntoDeVenta: idPdv,
            idEmpleado: empleado.idEmpleado,
            idCajaTienda: cajaActiva?.idCajaTienda || null,
            valorEgreso: valor,
            referencia: referencia?.trim() || await _referenciaAutomatica(tipoEgreso, t),
            descripcion: desc.valor,
            metodoPago: metodo,
            idCajaBanco: cuentaDestino?.idCajaBanco || null,
            tipo: tipoEgreso,
            estado: 'pendiente'
        }, { transaction: t }));

        const totales = await _totalesEgresosHoy(idPdv);

        // La fila viaja con la misma forma que la del listado (`filaEgreso`): la que
        // aparece sola arriba de la tabla tiene que verse igual que después de recargar.
        // El empleado y la cuenta destino ya están resueltos acá, así que se pasan
        // armados en vez de volver a consultarlos.
        broadcast(idPdv, 'new_egreso', {
            egreso: filaEgreso({
                ...egreso.get({ plain: true }),
                empleado: { PrimerNombre: empleado.nombre },
                cajaBancoDestino: cuentaDestino
                    ? { nombreCajaBanco: cuentaDestino.nombreCajaBanco, referencia: cuentaDestino.referencia }
                    : null
            }),
            egresosHoy:   totales.egresos,
            trasladosHoy: totales.traslados
        });

        // Al admin sigue yendo TODO lo que salió del cajón, gastos y traslados juntos: su
        // tablero suma los egresos de cada tienda sin separar por tipo, y mandarle acá un
        // número con otro criterio dejaría la tarjeta en vivo peleada con la que se pinta
        // al recargar esa misma pantalla.
        broadcast('__ADMIN__', 'store_stats', { idPuntoDeVenta: idPdv, egresosHoy: totales.total });

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

// ─── AVISOS DE TRASLADOS RESUELTOS SIN ENTRAR COMPLETOS ──────────────────────
//
// El aviso viaja por SSE en el momento, pero un evento SSE se pierde si el navegador no
// está abierto: el administrador resuelve a las ocho de la noche y el operador, que ya se
// fue, nunca se entera de que le quedó un faltante a cargo. Estos dos endpoints hacen que
// el aviso sobreviva a eso — `avisoVistoEn` nulo significa "todavía no lo vio".

// Un traslado 'Recibido' no tiene nada que avisar: entró completo.
// Qué traslados tienen algo que avisarle al punto de venta.
//
// No alcanza con el estado: un traslado que llegó con EXCEDENTE queda 'Recibido' —lo que
// la tienda mandó sí entró completo— y aun así hay algo que contar, porque en el fajo se
// fue plata de la caja menor y el operador va a encontrar el fondo de cambio corto al
// cerrar. Por eso la condición es "estado que no cuadró O hubo excedente".
const _whereAvisoPendiente = (idPdv) => ({
    idTiendaOrigen: idPdv,
    avisoVistoEn: null,
    [Op.or]: [
        { estado: { [Op.in]: ['Rechazado', 'Controversia'] } },
        { valorExcedente: { [Op.gt]: 0 } },
        // Corrección bancaria: el traslado quedó 'Recibido' pero por un valor distinto al
        // que la tienda registró al despachar, y su egreso cambió con él. El operador
        // tiene que enterarse porque es su cuadre el que se movió.
        //
        // Se detecta comparando el valor actual contra el que quedó en el paso de salida
        // —que es append-only y guarda para siempre lo que se registró originalmente—, y
        // no buscando un texto en la observación: un cambio de redacción no puede apagar
        // un aviso.
        literal(`EXISTS (SELECT 1 FROM TRASLADO_EFECTIVO_HISTORIAL h
                         WHERE h.idTrasladosEfectivo = TRASLADO_EFECTIVO.idTrasladosEfectivo
                           AND h.tipoTransaccion = 'Salida'
                           AND h.valorTransaccion <> TRASLADO_EFECTIVO.valorTraslado)`)
    ]
});

// GET /store/traslados/avisos
const getAvisosTraslado = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    try {
        const filas = await TrasladoEfectivo.findAll({
            where: _whereAvisoPendiente(idPdv),
            attributes: ['idTrasladosEfectivo', 'codigoTraslado', 'estado', 'valorTraslado', 'valorExcedente', 'idMovimiento'],
            include: [{ model: MovimientosCajasBancos, as: 'movimiento', attributes: ['valor'], required: false }],
            // El más viejo primero: se muestran en el orden en que ocurrieron.
            order: [['updatedAt', 'ASC']]
        });

        // La observación con la que se resolvió es el último paso de la bitácora. Se piden
        // todas juntas, no una por traslado.
        const ids = filas.map(f => f.idTrasladosEfectivo);
        const notas = {};
        if (ids.length) {
            const pasos = await TrasladoEfectivoHistorial.findAll({
                where: {
                    idTrasladosEfectivo: { [Op.in]: ids },
                    // 'Ingreso' entra por la corrección bancaria, que deja su explicación
                    // ahí. No arrastra ruido: un traslado aceptado sin novedad nunca
                    // aparece en esta lista.
                    tipoTransaccion: { [Op.in]: ['Rechazado', 'Controversia', 'Excedente', 'Ingreso'] }
                },
                attributes: ['idTrasladosEfectivo', 'observacion'],
                order: [['idTransaccion', 'ASC']],
                raw: true
            });
            for (const p of pasos) notas[p.idTrasladosEfectivo] = p.observacion;
        }

        return res.json({
            success: true,
            avisos: filas.map(t => {
                const despachado = Math.round(parseFloat(t.valorTraslado) || 0);
                const aceptado   = Math.round(parseFloat(t.movimiento?.valor) || 0);
                return {
                    idTraslado:  t.idTrasladosEfectivo,
                    codigo:      t.codigoTraslado,
                    estado:      t.estado,
                    despachado,
                    aceptado,
                    devuelto:    despachado - aceptado,
                    excedente:   Math.round(parseFloat(t.valorExcedente) || 0),
                    // El aviso guardado no sabe cuál fue el valor original —vive en la
                    // bitácora— y no lo necesita: el texto de la corrección ya lo dice.
                    corregido:   null,
                    // Un aviso guardado se muestra al entrar, cuando la caja de aquel
                    // turno ya no es la de hoy. Se dice sin prometer un ajuste automático
                    // que a esta altura ya no puede ocurrir.
                    ajusteAplicado: false,
                    observacion: notas[t.idTrasladosEfectivo] || null
                };
            })
        });
    } catch (e) {
        console.error('getAvisosTraslado:', e);
        return res.status(500).json({ success: false });
    }
};

// POST /store/traslados/avisos/visto
//
// Marca uno o todos como vistos. El `where` incluye `avisoVistoEn: null` para que dos
// pestañas confirmando a la vez no se pisen la fecha: gana la primera y la segunda no
// afecta filas, que es lo correcto — la hora del aviso es cuándo lo vio, no cuándo hizo
// el último clic.
const marcarAvisoTrasladoVisto = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    const { idTraslado } = req.body;

    try {
        const where = _whereAvisoPendiente(idPdv);
        if (idTraslado) where.idTrasladosEfectivo = idTraslado;

        const [filas] = await TrasladoEfectivo.update({ avisoVistoEn: new Date() }, { where });
        return res.json({ success: true, marcados: filas });
    } catch (e) {
        console.error('marcarAvisoTrasladoVisto:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── LISTADO DE EGRESOS ──────────────────────────────────────────────────────
// El libro de egresos de una tienda crece sin techo: una fila por cada gasto y cada
// consignación, todos los días, para siempre. Por eso se pagina por cursor (keyset) y
// no por OFFSET.
//
// Con OFFSET la base tiene que leer y descartar todas las filas anteriores para llegar
// a la página pedida, así que la página 500 cuesta mucho más que la 1, y el COUNT(*)
// del total recorre la tabla entera en cada petición. Peor todavía: entre que alguien
// ve una página y pide la siguiente puede registrarse un egreso nuevo —que entra
// arriba, porque el orden es descendente—, el OFFSET se corre una fila y esa fila se
// repite o se saltea. Con cursor la página siguiente se pide "desde este registro hacia
// atrás", que no se mueve aunque entren filas nuevas.
const EGRESOS_POR_PAGINA = 15;

// El orden es (createdAt DESC, idEgreso DESC) y no solo createdAt: `createdAt` es un
// DATETIME de segundos, y dos egresos registrados en el mismo segundo empatan. Sin un
// desempate único MySQL no garantiza en qué orden salen las filas empatadas entre dos
// consultas, y una misma fila puede aparecer en dos páginas. El id autoincremental es
// ese desempate.
const ORDEN_EGRESOS = [['createdAt', 'DESC'], ['idEgreso', 'DESC']];

const armarCursorEgreso = (e) => `${new Date(e.createdAt).getTime()}.${e.idEgreso}`;

const leerCursorEgreso = (cursor) => {
    if (!cursor) return null;
    const corte = String(cursor).indexOf('.');
    if (corte < 1) return null;
    const ms = Number(String(cursor).slice(0, corte));
    const id = Number(String(cursor).slice(corte + 1));
    if (!Number.isFinite(ms) || !Number.isInteger(id)) return null;
    return { createdAt: new Date(ms), idEgreso: id };
};

// "Estrictamente antes que el cursor" en ese orden. Escrito como OR de dos ramas y no
// como comparación de tuplas porque Sequelize no la emite y MySQL no aprovecharía el
// índice con ella.
const egresoAntesDe = ({ createdAt, idEgreso }) => ({
    [Op.or]: [
        { createdAt: { [Op.lt]: createdAt } },
        { createdAt, idEgreso: { [Op.lt]: idEgreso } }
    ]
});

// Colombia no tiene horario de verano: es UTC-5 todo el año. Declarar el desfase en el
// literal es exacto y no necesita una librería de zonas horarias, que el proyecto no
// tiene. Sin esto, "desde el 18" significaba la medianoche del servidor, que en un host
// en UTC deja afuera los egresos de las primeras cinco horas del día en la tienda.
const OFFSET_BOGOTA = '-05:00';
const inicioDiaBogota = (iso) => new Date(`${iso}T00:00:00.000${OFFSET_BOGOTA}`);
const finDiaBogota    = (iso) => new Date(`${iso}T23:59:59.999${OFFSET_BOGOTA}`);

// `en-CA` porque su formato de fecha corta ES el ISO `YYYY-MM-DD`, que es lo que
// `inicioDiaBogota` espera. No hay que armarlo a mano con getFullYear/getMonth, que
// además daría el día del reloj del servidor y no el de Bogotá.
const _hoyEnBogota = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

/**
 * Los dos números del resumen del día, en UNA consulta agrupada por tipo.
 *
 * Son disjuntos a propósito: un egreso es plata que el negocio gastó; un traslado es plata
 * que solo cambió de lugar y sigue siendo del negocio. Sumarlos en un mismo "total de
 * egresos" —que es lo que había— contaba dos veces la misma plata al mostrar las dos
 * tarjetas juntas, y presentaba la consignación de la venta del día como si fuera un gasto.
 *
 * El día es el de Bogotá y no el del reloj del servidor. El atajo "Hoy" del listado ya
 * corta así, y dos cifras en la misma pantalla que no coincidan en qué es "hoy" son peor
 * que no tener la segunda.
 */
const _totalesEgresosHoy = async (idPdv) => {
    const filas = await Egresos.findAll({
        where: { idPuntoDeVenta: idPdv, createdAt: { [Op.gte]: inicioDiaBogota(_hoyEnBogota()) } },
        attributes: ['tipo', [fn('SUM', col('valorEgreso')), 'total']],
        group: ['tipo'],
        raw: true
    });
    const de = (t) => parseFloat(filas.find(f => f.tipo === t)?.total || 0) || 0;
    const egresos   = de('Egreso');
    const traslados = de('Traslado');
    return { egresos, traslados, total: egresos + traslados };
};

const ISO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Los mismos filtros para el listado y para cualquier consulta que después necesite el
// mismo recorte: un solo criterio, un solo lugar.
const filtrosEgresos = (idPdv, { fechaA, fechaB, estado, tipo } = {}) => {
    const where = { idPuntoDeVenta: idPdv };

    const desde = ISO_FECHA.test(fechaA || '') ? inicioDiaBogota(fechaA) : null;
    const hasta = ISO_FECHA.test(fechaB || '') ? finDiaBogota(fechaB)    : null;
    if (desde && hasta)      where.createdAt = { [Op.between]: [desde, hasta] };
    else if (desde)          where.createdAt = { [Op.gte]: desde };
    else if (hasta)          where.createdAt = { [Op.lte]: hasta };

    if (['pendiente', 'liquidada'].includes(estado)) where.estado = estado;
    if (['Egreso', 'Traslado'].includes(tipo))       where.tipo   = tipo;

    return where;
};

// Una sola forma de la fila, usada por el listado y por el aviso en vivo del SSE. Si
// cada uno armara la suya, una fila recién registrada se vería distinta de la misma
// fila después de recargar.
// Se arma por partes y no con toLocaleDateString: el formato corto en español mete un
// "de" y un punto ("18 de ago."), que en una columna que se barre de arriba abajo es
// ruido. Acá queda "18 ago".
const PARTES_FECHA = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', timeZone: 'America/Bogota' });
const FMT_HORA     = { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' };

const fechaCorta = (f) => {
    const p = Object.fromEntries(PARTES_FECHA.formatToParts(f).map(x => [x.type, x.value]));
    return `${p.day} ${(p.month || '').replace('.', '')}`;
};

const filaEgreso = (e) => {
    const f = new Date(e.createdAt);
    const destino = e.cajaBancoDestino;
    return {
        idEgreso:    e.idEgreso,
        valor:       parseFloat(e.valorEgreso) || 0,
        tipo:        e.tipo,
        estado:      e.estado,
        // La referencia NO pasa por `tituloLista`: es un dato literal —un número de
        // comprobante, un consecutivo— y darle formato sería alterarlo, no presentarlo.
        referencia:  e.referencia || null,
        // El detalle sí: lo escribe quien registra el egreso, con el teclado del POS y
        // a veces con el bloq mayús puesto. Un "PAGO ARRIENDO LOCAL" grita en medio de
        // la tabla, y `text-transform: capitalize` no lo arregla porque sube la primera
        // letra pero no baja las demás. En la base queda tal como lo escribieron.
        descripcion: e.descripcion ? tituloLista(e.descripcion) : null,
        fecha:       fechaCorta(f),
        hora:        f.toLocaleTimeString('es-CO', FMT_HORA),
        iso:         f.toISOString(),
        responsable: e.empleado
            ? [e.empleado.PrimerNombre, e.empleado.PrimerApellido].filter(Boolean).join(' ')
            : null,
        // El nombre de la cuenta se normaliza igual que en el selector del formulario y
        // en el perfil de la cuenta; su referencia, no, por lo mismo que la de arriba.
        destino:     destino
            ? (destino.referencia
                ? `${tituloLista(destino.nombreCajaBanco)} — ${destino.referencia}`
                : tituloLista(destino.nombreCajaBanco))
            : null
    };
};

const INCLUDES_EGRESO = [
    { model: Empleados,    as: 'empleado',         attributes: ['PrimerNombre', 'PrimerApellido'],       required: false },
    { model: CajasYBancos, as: 'cajaBancoDestino', attributes: ['nombreCajaBanco', 'referencia'],        required: false }
];

const getEgresosJSON = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false });

    const { cursor, fechaA, fechaB, estado, tipo } = req.query;

    try {
        const where = filtrosEgresos(idPdv, { fechaA, fechaB, estado, tipo });
        const posicion = leerCursorEgreso(cursor);

        // Se pide una fila de más: si vuelve, hay página siguiente. Así se sabe si
        // mostrar "Cargar más" sin contar el total de la tabla.
        const filas = await Egresos.findAll({
            where: posicion ? { ...where, ...egresoAntesDe(posicion) } : where,
            include: INCLUDES_EGRESO,
            order: ORDEN_EGRESOS,
            limit: EGRESOS_POR_PAGINA + 1
        });

        const hayMas = filas.length > EGRESOS_POR_PAGINA;
        const pagina = hayMas ? filas.slice(0, EGRESOS_POR_PAGINA) : filas;

        return res.json({
            success: true,
            egresos: pagina.map(filaEgreso),
            cursorSiguiente: hayMas ? armarCursorEgreso(pagina[pagina.length - 1]) : null,
            // Distingue "esta tienda todavía no registró ningún egreso" de "ninguno
            // coincide con estos filtros": son dos pantallas vacías distintas.
            filtrado: !!(fechaA || fechaB || estado || tipo)
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
        // Las tres claves van con nombre propio. Un `total` a secas obligaba a adivinar si
        // incluía los traslados, y esa duda es justamente la que hacía que las dos
        // tarjetas mostraran la misma plata.
        const { egresos, traslados, total } = await _totalesEgresosHoy(idPdv);
        return res.json({ success: true, egresos, traslados, total });
    } catch (e) {
        console.error('getTotalEgresosHoy:', e);
        return res.status(500).json({ success: false });
    }
};


// ─── TRASLADO DE EFECTIVO A UNA CAJA O CUENTA DEL NEGOCIO ────────────────────
//
// El operador saca efectivo del cajón y lo manda a una cuenta de la empresa. Eso
// produce DOS hechos distintos sobre la misma plata, y por eso dos filas:
//
//   · EGRESOS  — lo que el cuadre de caja resta del cajón hoy. Se guarda con
//     `metodoPago: 'Efectivo'` porque la plata sale físicamente del cajón; guardarlo
//     como 'Electronico' lo dejaba fuera de `sEgresosEfectivo` y el mismo efectivo se
//     podía consignar una y otra vez sin que la validación se quejara.
//   · TRASLADO_EFECTIVO — el documento que viaja: su código, su destino y su estado,
//     hasta que el responsable de la cuenta lo acepta y recién ahí se asienta el
//     movimiento. `idTrasladoEfectivo` en el egreso es lo que une los dos.
//
// La plata NO llega a la cuenta destino en este paso. El traslado nace 'En Transito' y
// `idMovimiento` queda nulo a propósito: mientras viaja no está asentada en ningún
// saldo. Quien la acepta es otro flujo.

// Colombia es UTC-5 todo el año, así que el desfase literal alcanza para fechar el
// código en hora local sin una librería de zonas horarias.
const _selloBogota = (f = new Date()) => {
    const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(f).reduce((a, x) => (a[x.type] = x.value, a), {});
    // `en-CA` con hour12:false devuelve "24" para la medianoche; MySQL y el ojo humano
    // esperan "00".
    const hora = p.hour === '24' ? '00' : p.hour;
    return `${p.year}${p.month}${p.day}${hora}${p.minute}${p.second}`;
};

// Prefijo corto de la tienda para el código del traslado. Se prefiere `prefijo`, que es
// el código con el que el negocio ya nombra al punto de venta; si está vacío cae en
// `_prefijoTienda`, el mismo que arma los códigos de caja, para que la tienda no tenga
// dos abreviaturas distintas según qué documento se mire.
const _prefijoTraslado = (pdv) => {
    const declarado = (pdv?.prefijo || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 5);
    return declarado || _prefijoTienda(pdv?.nombreComercial);
};

// El código es UNIQUE en la tabla. Dos traslados de la misma tienda en el mismo segundo
// chocarían, así que ante colisión se reintenta con un sufijo corto en vez de fallar.
const _generarCodigoTraslado = async (pdv, transaction) => {
    const prefijo = _prefijoTraslado(pdv);
    for (let intento = 0; intento < 5; intento++) {
        const sufijo = intento === 0 ? '' : `-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
        const codigo = `${prefijo}-${_selloBogota()}${sufijo}`;
        const existe = await TrasladoEfectivo.findOne({
            where: { codigoTraslado: codigo }, attributes: ['idTrasladosEfectivo'], transaction
        });
        if (!existe) return codigo;
    }
    throw new Error('No se pudo generar un código de traslado único.');
};

// Un traslado hacia un banco o una billetera deja rastro en un extracto, y sin el
// comprobante nadie puede conciliarlo después. Hacia otra caja física no hay nada que
// adjuntar: la plata pasa de mano a mano y lo que la respalda son las dos firmas del
// comprobante impreso.
const _exigeVoucher = (tipoCuenta) => ['banco', 'billetera'].includes(tipoCuenta);

// ─────────────────────────────────────────────────────────────────────────────
// Referencia de un egreso o de un traslado, cuando el operador no escribió ninguna.
//
// Era un campo libre y opcional, y en la práctica quedaba vacío. Un egreso sin referencia
// no se puede nombrar: en el cuadre, en el listado y en una llamada por teléfono no hay
// forma de señalar CUÁL de los tres egresos de $50.000 de esa tienda es el que está en
// discusión. En un traslado hacia otra caja el problema es estructural: la plata pasa de
// mano a mano y no existe ningún comprobante externo que transcribir.
//
// Lo que el operador escriba manda SIEMPRE. En un egreso su referencia es el número de la
// factura que pagó; en un traslado a un banco es el comprobante de la consignación, que es
// lo único que permite encontrar el movimiento en el extracto. Pisarlos con un correlativo
// interno sería borrar el dato útil y dejar el inútil.
//
// El número sale de SECUENCIAS y no de un MAX+1: se reserva con un UPDATE sobre una sola
// fila, así dos egresos simultáneos hacen fila en vez de llevarse el mismo número. Y como
// se reserva dentro de la transacción que lo usa, si esa transacción se revierte el número
// vuelve atrás con ella: no quedan huecos en la numeración.
// ─────────────────────────────────────────────────────────────────────────────
const SECUENCIA_REFERENCIA = {
    Egreso:   { secuencia: 'egreso_referencia',            prefijo: 'EGR-' },
    Traslado: { secuencia: 'traslado_efectivo_referencia', prefijo: 'TRA-' }
};

const _referenciaAutomatica = async (tipo, transaction) => {
    const { secuencia, prefijo } = SECUENCIA_REFERENCIA[tipo] || SECUENCIA_REFERENCIA.Egreso;
    return `${prefijo}${await siguienteNumero(secuencia, transaction)}`;
};

// Rechazo de negocio dentro de la transacción. Lanzarlo hace el rollback (que es lo que
// se quiere) y al salir se distingue de una falla real: éste es un 422 con un motivo que
// el operador puede leer, la otra es un 500 genérico.
class ErrorTraslado extends Error {}

const crearTrasladoEfectivo = async (req, res) => {
    const idPdv = req.idPuntoDeVenta;
    if (!idPdv) return res.status(403).json({ success: false, mensaje: 'Sin punto de venta asignado.' });

    const empleado = req.empleadoVerificado;
    const { idCajaBanco, referencia, descripcion } = req.body;

    // ── Validaciones que no tocan la base ────────────────────────────────────
    const valor = parseFloat(req.body.valorTraslado);
    if (!Number.isFinite(valor) || valor <= 0)
        return res.status(400).json({ success: false, mensaje: 'El valor del traslado debe ser mayor que cero.' });

    if (!idCajaBanco)
        return res.status(400).json({ success: false, mensaje: 'Indicá a qué cuenta se traslada el efectivo.' });

    // Antes de subir el voucher: rechazar acá ahorra un archivo en R2 que nadie va a usar.
    const desc = validarDescripcionEgreso(descripcion);
    if (!desc.ok)
        return res.status(400).json({ success: false, mensaje: desc.mensaje });

    try {
        // ── Cuenta destino ───────────────────────────────────────────────────
        // Se revalida contra la base y que siga ACTIVA: el formulario solo lista las
        // activas, pero eso es comodidad del navegador. Una cuenta pudo desactivarse
        // mientras el formulario estaba abierto.
        const cuenta = await CajasYBancos.findOne({
            where: { idCajaBanco, estado: true },
            attributes: ['idCajaBanco', 'nombreCajaBanco', 'tipo', 'referencia']
        });
        if (!cuenta)
            return res.status(422).json({ success: false, mensaje: 'La cuenta indicada no existe o está inactiva.' });

        // ── Caja abierta ─────────────────────────────────────────────────────
        // `idCajaTienda` es NOT NULL en el traslado: ancla la plata al turno del que
        // salió. Sin ese anclaje un traslado hecho al filo del cierre podría caer fuera
        // de la ventana del cuadre y no descontarse nunca.
        // El prefijo del código sale de acá. `cargarPuntoDeVenta` solo cuelga el id en
        // la petición, así que la fila se pide una vez.
        const pdv = await PuntosDeVenta.findByPk(idPdv, { attributes: ['prefijo', 'nombreComercial'], raw: true });

        const caja = await _getCajaAbierta(idPdv);
        if (!caja)
            return res.status(422).json({ success: false, mensaje: 'No hay una caja abierta: no se puede trasladar efectivo.' });

        // ── Tope de efectivo ─────────────────────────────────────────────────
        // Lo recaudado en efectivo menos lo que ya salió en efectivo, SIN sumar la caja
        // menor: la base del cajón es del negocio para dar cambio, no plata disponible
        // para consignar. El aviso del formulario es una cortesía; esto es lo que impide
        // trasladar efectivo que no está.
        const efectivo = await _efectivoDisponibleParaTraslado(idPdv);
        if (!efectivo.hayCaja)
            return res.status(422).json({ success: false, mensaje: 'No hay una caja abierta: no se puede trasladar efectivo.' });

        // Filtro barato: corta acá para no subir un archivo ni abrir una transacción
        // cuando ya se sabe que no alcanza. La verificación que manda es la de adentro
        // de la transacción, con la caja bloqueada.
        if (valor > efectivo.disponible) {
            return res.status(422).json({
                success: false,
                mensaje: `El traslado no puede superar el efectivo disponible en caja ($${Math.round(efectivo.disponible).toLocaleString('es-CO')}).`,
                disponible: efectivo.disponible
            });
        }

        // ── Voucher ──────────────────────────────────────────────────────────
        const necesitaVoucher = _exigeVoucher(cuenta.tipo);
        if (necesitaVoucher && !req.file)
            return res.status(400).json({ success: false, mensaje: 'Adjuntá el comprobante de la consignación.' });

        // Se prepara ANTES de tocar la base: validar el contenido real del archivo y
        // convertirlo es lo que más puede fallar, y hacerlo con una transacción abierta
        // la mantiene esperando por nada.
        let voucher = null;
        if (req.file?.buffer) {
            const revision = await prepararVoucher(req.file.buffer);
            if (!revision.ok) return res.status(400).json({ success: false, mensaje: revision.mensaje });
            voucher = revision;
        }

        // El id se genera acá y no lo deja poner a Sequelize porque la clave del objeto
        // en R2 lo lleva adentro, y la subida ocurre antes de escribir la fila.
        const idTraslado = randomUUID();

        // La subida va antes de abrir la transacción, igual que en el QR de pago. Si la
        // transacción falla después, queda un objeto huérfano en el bucket —que no le
        // hace daño a nadie—; al revés quedaría una fila apuntando a un archivo que no
        // existe, y eso sí es un comprobante perdido.
        let keyVoucher = null;
        if (voucher) {
            keyVoucher = `documentacion/transacciones/${idTraslado}-${Date.now()}.${voucher.formato.toLowerCase()}`;
            await new Upload({
                client: s3Client,
                params: {
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: keyVoucher,
                    Body: voucher.buffer,
                    ContentType: voucher.contentType
                }
            }).done();
        }

        // ── Escritura ────────────────────────────────────────────────────────
        // Forma manejada de `transaction`: hace commit sola al resolver y rollback sola
        // si algo lanza. Sin `t.commit()` ni `t.rollback()` a mano no existe el caso de
        // un rollback sobre una transacción ya cerrada, que lanzaría un segundo error
        // dentro del catch y dejaría la petición colgada para siempre.
        const resultado = await db.transaction(async (t) => {
            // Lock sobre la fila del turno de caja. Sin esto, dos pestañas que envían el
            // mismo efectivo al mismo tiempo pasan las dos la verificación —cada una lee
            // un saldo que todavía no incluye a la otra— y la tienda consigna plata que
            // no tiene. El lock serializa los traslados de una misma caja: el segundo
            // espera al primero y recién ahí recalcula.
            await CajaTienda.findOne({
                where: { idCajaTienda: caja.idCajaTienda },
                attributes: ['idCajaTienda'],
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            // Recuento con el lock tomado y leyendo dentro de la transacción: acá sí se
            // ve lo que asentó quien llegó primero.
            const firme = await _efectivoDisponibleParaTraslado(idPdv, t);
            if (!firme.hayCaja) throw new ErrorTraslado('No hay una caja abierta: no se puede trasladar efectivo.');
            if (valor > firme.disponible) {
                throw new ErrorTraslado(
                    `El traslado no puede superar el efectivo disponible en caja ($${Math.round(firme.disponible).toLocaleString('es-CO')}).`
                );
            }

            const codigoTraslado = await _generarCodigoTraslado(pdv, t);

            // Hacia otra caja no hay comprobante externo que transcribir: la plata pasa de
            // mano a mano. Sin una referencia propia, ese traslado no se puede nombrar en
            // el listado ni en el cuadre. Hacia un banco, en cambio, lo que el operador
            // escribió es el número de la consignación y no se toca: es lo único que
            // permite encontrar el movimiento en el extracto.
            const referenciaFinal = referencia?.trim() || await _referenciaAutomatica('Traslado', t);

            const traslado = await TrasladoEfectivo.create({
                idTrasladosEfectivo: idTraslado,
                idTiendaOrigen:  idPdv,
                idCajaBanco:     cuenta.idCajaBanco,
                idEmpleadoEnvia: empleado.idEmpleado,
                // Nulo a propósito: todavía no se sabe quién lo va a recibir.
                idEmpleadoRecibe: null,
                idCajaTienda:    caja.idCajaTienda,
                // Nulo a propósito: la plata no está asentada en ningún saldo mientras
                // viaja. El movimiento se crea al aceptarla.
                idMovimiento:    null,
                // La referencia de la consignación, que el formulario exige cuando el
                // destino es un banco o una billetera. Queda también en el egreso, que es
                // lo que lee el cuadre de caja; acá vive en el documento del traslado,
                // que es lo que ve quien la acepta del otro lado y contra lo que concilia
                // el movimiento en el extracto.
                referencia:      referenciaFinal,
                valorTraslado:   valor,
                codigoTraslado,
                estado:          'En Transito'
            }, { transaction: t });

            // Primer paso de la bitácora: la salida desde el punto de venta.
            await TrasladoEfectivoHistorial.create({
                idTrasladosEfectivo: idTraslado,
                idEmpleado:          empleado.idEmpleado,
                tipoTransaccion:     'Salida',
                valorTransaccion:    valor,
                observacion:         desc.valor
            }, { transaction: t });

            // El egreso: esto es lo que descuenta el cajón en el cuadre de hoy.
            const egreso = await Egresos.create({
                idPuntoDeVenta:     idPdv,
                idEmpleado:         empleado.idEmpleado,
                idCajaTienda:       caja.idCajaTienda,
                valorEgreso:        valor,
                referencia:         referenciaFinal,
                descripcion:        desc.valor,
                metodoPago:         'Efectivo',
                idCajaBanco:        cuenta.idCajaBanco,
                idTrasladoEfectivo: idTraslado,
                tipo:               'Traslado',
                estado:             'pendiente'
            }, { transaction: t });

            if (keyVoucher) {
                await Documentacion.create({
                    idPropietario:   idTraslado,
                    nombreDocumento: `Comprobante traslado ${codigoTraslado}`,
                    keyName:         keyVoucher,
                    formato:         voucher.formato,
                    pertenece:       'transacciones_bancarias'
                }, { transaction: t });
            }

            return { traslado, egreso, codigoTraslado };
        });

        // ── Avisos ───────────────────────────────────────────────────────────
        // Fuera de la transacción y en su propio try: un broadcast que falle no puede
        // tumbar un traslado ya asentado ni dejar la respuesta sin enviar.
        try {
            const totales = await _totalesEgresosHoy(idPdv);

            broadcast(idPdv, 'new_egreso', {
                egreso: filaEgreso({
                    ...resultado.egreso.get({ plain: true }),
                    empleado: { PrimerNombre: empleado.nombre },
                    cajaBancoDestino: { nombreCajaBanco: cuenta.nombreCajaBanco, referencia: cuenta.referencia }
                }),
                egresosHoy:   totales.egresos,
                trasladosHoy: totales.traslados
            });
            broadcast('__ADMIN__', 'store_stats', { idPuntoDeVenta: idPdv, egresosHoy: totales.total });

            // Aviso al panel del admin: hay un traslado esperando que alguien lo acepte.
            // Va el total y el desglose por cuenta en el MISMO evento —el badge del menú
            // usa uno y las campanas del listado el otro—, para que no puedan pintarse
            // dos estados de momentos distintos.
            //
            // El número se recalcula contra la base en vez de sumar uno al anterior: el
            // admin puede tener la pantalla abierta desde antes, o puede haber aceptado
            // traslados en otra pestaña, y un contador incremental se desincroniza al
            // primer evento que se pierda.
            broadcast('__ADMIN__', 'traslados_pendientes', await resumenPendientes());

            // El cache del menú dura 30 s. Sin invalidarlo, la próxima página que cargue
            // el admin podría pintar el badge viejo y contradecir al aviso que acaba de
            // recibir en vivo.
            invalidarContadoresAdmin();
        } catch (e) {
            console.error('crearTrasladoEfectivo: aviso posterior falló', e);
        }

        return res.json({
            success: true,
            idTrasladoEfectivo: idTraslado,
            idEgreso:           resultado.egreso.idEgreso,
            codigoTraslado:     resultado.codigoTraslado,
            nombreEmpleado:     empleado.nombre
        });

    } catch (e) {
        if (e instanceof ErrorTraslado)
            return res.status(422).json({ success: false, mensaje: e.message });

        console.error('crearTrasladoEfectivo:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo registrar el traslado.' });
    }
};

// GET /store/storebehivors/expenses/traslado/:idTraslado/pdf
//
// El mismo comprobante que emite el administrador, generado por el mismo helper. Acotado
// a la tienda de la sesión: sin ese filtro, cambiar el id en la URL mostraría el
// comprobante de otra sede.
const getTrasladoEfectivoPDF = async (req, res) => {
    try {
        const traslado = await buscarTrasladoParaPDF(req.params.idTraslado, { idTiendaOrigen: req.idPuntoDeVenta });
        if (!traslado) return res.status(404).json({ success: false, mensaje: 'Traslado no encontrado.' });

        const buf = await generarPDFTraslado(traslado);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="traslado-${traslado.codigoTraslado}.pdf"`);
        res.setHeader('Content-Length', buf.length);
        return res.send(buf);
    } catch (e) {
        console.error('getTrasladoEfectivoPDF:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al generar el comprobante.' });
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
            order: [['createdAt', 'DESC'], ['idFacturaCliente', 'ASC']],
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

        // ── No se abre con plata del turno anterior en el aire ────────────────
        //
        // Un traslado 'En Transito' es efectivo que ya salió del cajón y que todavía nadie
        // aceptó. Si el destino lo rechaza o recibe de menos, esa diferencia vuelve a la
        // tienda — pero el cuadre del que la despachó ya está firmado y no se puede tocar,
        // así que esa plata queda sin asiento en ninguna parte.
        //
        // El freno va en la APERTURA y no en el cierre a propósito. Bloquear el cierre
        // dejaría al cajero encerrado de noche esperando a un administrador que ya se fue,
        // y a la mañana siguiente la tienda tampoco abriría. Acá el turno cierra normal,
        // el cajero se va, y la exigencia cae en la mañana: sobre el administrador, que es
        // quien tiene que resolverlo, y a una hora en la que está.
        //
        // También impide que el problema se herede: sin este freno, la plata que vuelve
        // aterriza en el turno de otro cajero, que termina respondiendo por un traslado
        // que no despachó.
        const enElAire = await TrasladoEfectivo.findAll({
            where: { idTiendaOrigen: idPuntoDeVenta, ...wherePendienteAceptar() },
            attributes: ['idTrasladosEfectivo', 'codigoTraslado', 'valorTraslado', 'createdAt'],
            include: [{ model: CajasYBancos, as: 'cajaBancoDestino', attributes: ['nombreCajaBanco'], required: false }],
            order: [['createdAt', 'ASC']]
        });

        if (enElAire.length) {
            const total = enElAire.reduce((a, t) => a + (parseFloat(t.valorTraslado) || 0), 0);
            return res.status(409).json({
                success: false,
                trasladosPendientes: true,
                mensaje: enElAire.length === 1
                    ? 'Hay un traslado de efectivo que el destino todavía no aceptó. La caja no se puede abrir hasta que se resuelva.'
                    : `Hay ${enElAire.length} traslados de efectivo que el destino todavía no aceptó. La caja no se puede abrir hasta que se resuelvan.`,
                total,
                traslados: enElAire.map(t => ({
                    codigo:  t.codigoTraslado,
                    valor:   Math.round(parseFloat(t.valorTraslado) || 0),
                    destino: t.cajaBancoDestino?.nombreCajaBanco
                        ? tituloLista(t.cajaBancoDestino.nombreCajaBanco)
                        : 'cuenta del negocio',
                    fecha: new Date(t.createdAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })
                }))
            });
        }

        const cajaMenor = Number(req.body.cajaMenor);
        if (!Number.isFinite(cajaMenor) || cajaMenor < 0)
            return res.status(400).json({ success: false, mensaje: 'Caja menor inválida.' });

        const { idEmpleado } = req.empleadoVerificado;
        const codigo = await _generarCodigoCaja(idPuntoDeVenta, res.locals.nombreTienda);

        const caja = await CajaTienda.create({
            idPuntoDeVenta,
            codigo,
            idEmpleadoApertura: idEmpleado,
            // Se deja nulo a propósito: quién cierra el turno no se sabe al abrirlo, y
            // puede no ser quien lo abrió. `cerrarCajaAPI` lo llena con el empleado que
            // de verdad cerró.
            idEmpleadoCierre:   null,
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
    getEgresosJSON, getEfectivoDisponible,
    getTotalEgresosHoy,
    getEgresoComprobantePDF,
    crearTrasladoEfectivo,
    getTrasladoEfectivoPDF,
    getAvisosTraslado,
    marcarAvisoTrasladoVisto,
    abrirCajaAPI,
    cuadrarCajaPage,
    getCuadreCajaDatos,
    cerrarCajaAPI,
    iniciarCuadreCaja,
    liberarCuadreCaja,
    getEstadoCuadreCaja,
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
