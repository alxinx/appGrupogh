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
    getPerfilProducto
} from '../controller/storeControllers.js';
import { buscarEmpleadoPorCodigo } from '../controller/adminControllers.js';
import { imprimirComprobanteTraslado } from '../controller/dosificacionController.js';
import { cargarPuntoDeVenta } from '../middlewares/storeMiddleware.js';

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
routes.get('/json/personal/codigo/:codigo', buscarEmpleadoPorCodigo);
routes.get('/json/destinos', getDestinosJSON);

// APIs JSON — traslados
routes.get('/traslados/pendientes', getPendientesJSON);
routes.get('/traslados/historial', getHistorialJSON);
routes.get('/traslados/detalle/:idTraslado', getDetalleTrasladoJSON);
routes.get('/traslados/comprobante/:idTraslado', imprimirComprobanteTraslado);

// APIs JSON — inventario
routes.get('/inventario/json', getInventarioJSON);

// Acciones — traslados
routes.post('/traslados/aceptar', csrfProtection, aceptarTrasladoAPI);
routes.post('/traslados/resolver', csrfProtection, resolverControversiaAPI);

// Acciones — inventario
routes.post('/inventario/desempacar', csrfProtection, desempacarPackAPI);
routes.post('/inventario/trasladar',  csrfProtection, trasladarDesdeStoreAPI);

export default routes;
