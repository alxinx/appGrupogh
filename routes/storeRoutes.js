import express from "express";
import csrf from "csurf";
import {
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
    sincronizarReservasPos,
    liberarReservasPos,
    getPosProductoJSON,
    buscarClientePorDoc,
    getMunicipiosStoreJSON,
    guardarCliente,
    getEntidadesJSON,
    procesarFactura,
    getTirillaPDF,
    buscarProductoPorSKU,
    crearTrasladoSueltos,
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
    getSalesPage,
    getVentasMes,
    getDetalleDia,
    validarEmpleadoTraslado,
    trasladarDesdePerfil,
    getTrasladosAlertaJSON,
    validarEmpleadoTienda,
    getPedidosWebPendientesJSON,
    getPedidoWebParaCargarJSON,
    pedidosWebStorePage,
    getPedidosWebListaJSON
} from '../controller/storeControllers.js';
import { buscarEmpleadoPorCodigo } from '../controller/adminControllers.js';
import { imprimirComprobanteTraslado } from '../controller/dosificacionController.js';
import { cargarPuntoDeVenta } from '../middlewares/storeMiddleware.js';
import verificarCodigoEmpleado    from '../middlewares/verificarCodigoEmpleado.js';
import verificarPermisoEmpleado   from '../middlewares/verificarPermisoEmpleado.js';
import verificarPermisoSesion     from '../middlewares/verificarPermisoSesion.js';
import apiRateLimit from '../middlewares/apiRateLimit.js';
import uploadMixed from '../middlewares/uploadMixed.js';

const routes = express.Router();
const csrfProtection = csrf({ cookie: true });

// Middleware global: carga idPuntoDeVenta en req + res.locals
routes.use(cargarPuntoDeVenta);

// Páginas
routes.get('/', csrfProtection, dashboardStores);
routes.get('/traslados/get', csrfProtection, getTraslados);
routes.get('/inventario/lista', csrfProtection, getInventarioLista);
routes.get('/pedidos-web', csrfProtection, pedidosWebStorePage);
routes.get('/inventario/perfilProducto/:idProducto', csrfProtection, getPerfilProducto);

// SSE (sin CSRF — es GET long-lived)
routes.get('/sse', sseConnect);

// JSON helpers
routes.use('/json', apiRateLimit);
routes.use('/inventario/json', apiRateLimit);
routes.use('/traslados/pendientes', apiRateLimit);
routes.use('/traslados/historial', apiRateLimit);
routes.use('/traslados/detalle', apiRateLimit);

routes.get('/json/personal/codigo/:codigo', buscarEmpleadoPorCodigo);
routes.get('/json/personal/validar/:codigo', validarEmpleadoTienda);
routes.get('/json/destinos', getDestinosJSON);
routes.get('/json/pos/buscar', buscarPosProducto);
// Reservas blandas del POS: avisan competencia por el producto, no bloquean stock.
routes.post('/json/pos/reservas', sincronizarReservasPos);
routes.delete('/json/pos/reservas', liberarReservasPos);
routes.get('/json/pos/producto/:idProducto', getPosProductoJSON);
routes.get('/json/clientes/buscar', buscarClientePorDoc);
routes.get('/json/municipios/:deptoId', getMunicipiosStoreJSON);
routes.get('/json/entidades', getEntidadesJSON);
routes.get('/json/traslados/buscar-sku', buscarProductoPorSKU);
routes.get('/json/pedidos-web/pendientes', getPedidosWebPendientesJSON);
routes.get('/json/pedidos-web/lista', getPedidosWebListaJSON);
routes.get('/json/pedidos-web/:idPedido/cargar', getPedidoWebParaCargarJSON);

// APIs JSON — traslados
routes.get('/traslados/pendientes', getPendientesJSON);
routes.get('/traslados/alerta',    getTrasladosAlertaJSON);
routes.get('/traslados/historial', getHistorialJSON);
routes.get('/traslados/detalle/:idTraslado', getDetalleTrasladoJSON);
routes.get('/traslados/comprobante/:idTraslado', imprimirComprobanteTraslado);

// APIs JSON — inventario
routes.get('/inventario/json', getInventarioJSON);

// Acciones — traslados
const pTraslEdit   = verificarPermisoEmpleado('Traslados', 'vendedor', 'EDIT');
const pTraslCreate = verificarPermisoEmpleado('Traslados', 'vendedor', 'CREATE');

routes.post('/traslados/aceptar', csrfProtection, verificarCodigoEmpleado, pTraslEdit,   aceptarTrasladoAPI);
routes.post('/traslados/resolver', csrfProtection, verificarCodigoEmpleado, pTraslEdit,   resolverControversiaAPI);
routes.post('/traslados/crear',   csrfProtection, verificarCodigoEmpleado, pTraslCreate, crearTrasladoSueltos);

// Acciones — inventario
routes.post('/inventario/desempacar', csrfProtection, verificarCodigoEmpleado, verificarPermisoEmpleado('Inventario y Productos', 'vendedor', 'EDIT'), desempacarPackAPI);
routes.post('/inventario/trasladar',  csrfProtection, verificarCodigoEmpleado, pTraslCreate, trasladarDesdeStoreAPI);

// Clientes
routes.post('/clientes/guardar', csrfProtection, uploadMixed.single('rut'), guardarCliente);

// Caja
routes.post('/caja/abrir', csrfProtection, verificarCodigoEmpleado, verificarPermisoEmpleado('Caja y ventas', 'vendedor', 'CREATE'), abrirCajaAPI);

// Facturas
routes.post('/facturas/procesar', csrfProtection, verificarPermisoSesion('Pos de venta', 'vendedor', 'CREATE'), procesarFactura);
routes.get('/facturas/:id/tirilla', getTirillaPDF);

// Storebehivors — cuadre de caja
routes.get('/storebehivors/', csrfProtection, cuadrarCajaPage);
routes.get('/storebehivors/caja/datos', getCuadreCajaDatos);
routes.post('/storebehivors/caja/cerrar', csrfProtection, verificarCodigoEmpleado, verificarPermisoEmpleado('Caja y ventas', 'vendedor', 'EDIT'), cerrarCajaAPI);
routes.get('/storebehivors/caja/:idCajaTienda/pdf', getCuadrePDF);
routes.get('/storebehivors/expenses', csrfProtection, getExpensesPage);
routes.get('/storebehivors/expenses/total-hoy', getTotalEgresosHoy);
routes.get('/storebehivors/expenses/json', getEgresosJSON);
routes.get('/storebehivors/expenses/:idEgreso/pdf', getEgresoComprobantePDF);
routes.post('/storebehivors/expenses/crear', csrfProtection, verificarCodigoEmpleado, verificarPermisoEmpleado('Caja y ventas', 'vendedor', 'CREATE'), crearEgreso);

// Inventario — traslado desde perfil de producto
routes.get('/inventario/json/empleado-traslado', validarEmpleadoTraslado);
routes.post('/inventario/traslado-producto', csrfProtection, verificarCodigoEmpleado, pTraslCreate, trasladarDesdePerfil);

// Storebehivors — ventas del mes
routes.get('/storebehivors/sales', csrfProtection, getSalesPage);
routes.get('/storebehivors/sales/mes', getVentasMes);
routes.get('/storebehivors/sales/dia', getDetalleDia);

export default routes;
