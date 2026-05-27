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
    getTrasladosAlertaJSON
} from '../controller/storeControllers.js';
import { buscarEmpleadoPorCodigo } from '../controller/adminControllers.js';
import { imprimirComprobanteTraslado } from '../controller/dosificacionController.js';
import { cargarPuntoDeVenta } from '../middlewares/storeMiddleware.js';
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
routes.get('/json/destinos', getDestinosJSON);
routes.get('/json/pos/buscar', buscarPosProducto);
routes.get('/json/pos/producto/:idProducto', getPosProductoJSON);
routes.get('/json/clientes/buscar', buscarClientePorDoc);
routes.get('/json/municipios/:deptoId', getMunicipiosStoreJSON);
routes.get('/json/entidades', getEntidadesJSON);
routes.get('/json/traslados/buscar-sku', buscarProductoPorSKU);

// APIs JSON — traslados
routes.get('/traslados/pendientes', getPendientesJSON);
routes.get('/traslados/alerta',    getTrasladosAlertaJSON);
routes.get('/traslados/historial', getHistorialJSON);
routes.get('/traslados/detalle/:idTraslado', getDetalleTrasladoJSON);
routes.get('/traslados/comprobante/:idTraslado', imprimirComprobanteTraslado);

// APIs JSON — inventario
routes.get('/inventario/json', getInventarioJSON);

// Acciones — traslados
routes.post('/traslados/aceptar', csrfProtection, aceptarTrasladoAPI);
routes.post('/traslados/resolver', csrfProtection, resolverControversiaAPI);
routes.post('/traslados/crear', csrfProtection, crearTrasladoSueltos);

// Acciones — inventario
routes.post('/inventario/desempacar', csrfProtection, desempacarPackAPI);
routes.post('/inventario/trasladar',  csrfProtection, trasladarDesdeStoreAPI);

// Clientes
routes.post('/clientes/guardar', csrfProtection, uploadMixed.single('rut'), guardarCliente);

// Caja
routes.post('/caja/abrir', csrfProtection, abrirCajaAPI);

// Facturas
routes.post('/facturas/procesar', csrfProtection, procesarFactura);
routes.get('/facturas/:id/tirilla', getTirillaPDF);

// Storebehivors — cuadre de caja
routes.get('/storebehivors/', csrfProtection, cuadrarCajaPage);
routes.get('/storebehivors/caja/datos', getCuadreCajaDatos);
routes.post('/storebehivors/caja/cerrar', csrfProtection, cerrarCajaAPI);
routes.get('/storebehivors/caja/:idCajaTienda/pdf', getCuadrePDF);
routes.get('/storebehivors/expenses', csrfProtection, getExpensesPage);
routes.get('/storebehivors/expenses/total-hoy', getTotalEgresosHoy);
routes.get('/storebehivors/expenses/json', getEgresosJSON);
routes.get('/storebehivors/expenses/:idEgreso/pdf', getEgresoComprobantePDF);
routes.post('/storebehivors/expenses/crear', csrfProtection, crearEgreso);

// Inventario — traslado desde perfil de producto
routes.get('/inventario/json/empleado-traslado', validarEmpleadoTraslado);
routes.post('/inventario/traslado-producto', csrfProtection, trasladarDesdePerfil);

// Storebehivors — ventas del mes
routes.get('/storebehivors/sales', csrfProtection, getSalesPage);
routes.get('/storebehivors/sales/mes', getVentasMes);
routes.get('/storebehivors/sales/dia', getDetalleDia);

export default routes;
