import express from 'express';
import apiRateLimit from '../middlewares/apiRateLimit.js';
import { recibirComprobante } from '../middlewares/uploadComprobante.js';
import { getConfig, getCategorias, getCatalogo, getProducto, getFiltros, postInteresado, getPaginaBySlug, getPuntosVenta, trackVisita, identificarVisitante, crearPedidoWeb, iniciarPagoWompi, consultarEstadoPedido, webhookWompi, subirComprobantePagoWeb, sincronizarReservasWeb, demandaCarritoWeb } from '../controller/webApiController.js';

import { listarEntidadesQrPublico, getQrPagoPublico } from '../controller/qrPagoControllers.js';

const routes = express.Router();

routes.get('/config',              getConfig);
routes.get('/categorias',          getCategorias);
routes.get('/filtros',             getFiltros);
routes.get('/productos',           getCatalogo);
routes.get('/producto/:slug',      getProducto);

// Reservas blandas: avisan que otros tienen el producto cargado, no bloquean stock.
// Con apiRateLimit porque las llama el navegador en cada cambio del carrito.
routes.post('/carrito/reservas',   apiRateLimit, sincronizarReservasWeb);
routes.get('/carrito/demanda',     apiRateLimit, demandaCarritoWeb);
routes.get('/pagina/:slug',        getPaginaBySlug);
routes.get('/puntos-venta',        getPuntosVenta);
routes.post('/interesado',         postInteresado);
routes.post('/visitante/track',        trackVisita);
routes.post('/visitante/identificar',  identificarVisitante);
routes.post('/pedidos',                crearPedidoWeb);
routes.post('/pedidos/:idPedido/pago', iniciarPagoWompi);
routes.get('/pedidos/:numeroPedido/estado', consultarEstadoPedido);
routes.post('/webhooks/wompi', webhookWompi);

// Pago por QR — solo lectura. Devuelve URLs firmadas de corta vida, nunca el object key.
routes.get('/pagos/qr',            listarEntidadesQrPublico);
routes.get('/pagos/qr/:idEntidad', getQrPagoPublico);

// Comprobante de la transferencia por QR. Público (el checkout no tiene sesión), acotado
// en el controlador a pedidos 'pendiente_pago' con metodoPago='qr' y con rate limit por IP.
routes.post('/pedidos/:idPedido/comprobante', apiRateLimit, recibirComprobante, subirComprobantePagoWeb);

export default routes;
