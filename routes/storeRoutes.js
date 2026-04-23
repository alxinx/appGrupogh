import express from "express";
import csrf from "csurf";
import {
    dashboardStores,
    getTraslados,
    sseConnect,
    getPendientesJSON,
    getHistorialJSON,
    getDetalleTrasladoJSON,
    aceptarTrasladoAPI
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

// SSE (sin CSRF — es GET long-lived)
routes.get('/sse', sseConnect);

// JSON helpers
routes.get('/json/personal/codigo/:codigo', buscarEmpleadoPorCodigo);

// APIs JSON
routes.get('/traslados/pendientes', getPendientesJSON);
routes.get('/traslados/historial', getHistorialJSON);
routes.get('/traslados/detalle/:idTraslado', getDetalleTrasladoJSON);
routes.get('/traslados/comprobante/:idTraslado', imprimirComprobanteTraslado);

// Acción
routes.post('/traslados/aceptar', csrfProtection, aceptarTrasladoAPI);

export default routes;
