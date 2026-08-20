import express from 'express';
import apiRateLimit, { escrituraPublicaRateLimit, trackingRateLimit } from '../middlewares/apiRateLimit.js';
import { recibirComprobante } from '../middlewares/uploadComprobante.js';
import { getConfig, getCategorias, getCatalogo, getProducto, getFiltros, postInteresado, getPaginaBySlug, getPuntosVenta, trackVisita, identificarVisitante, crearPedidoWeb, iniciarPagoWompi, consultarEstadoPedido, webhookWompi, subirComprobantePagoWeb, sincronizarReservasWeb, demandaCarritoWeb } from '../controller/webApiController.js';

import { listarEntidadesQrPublico, getQrPagoPublico } from '../controller/qrPagoControllers.js';

const routes = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Freno por IP en TODA la API pública.
//
// Está abierta a internet sin sesión: el catálogo, los filtros y la ficha de producto
// hacen consultas pesadas contra la base, y sin límite cualquiera puede dejar el sitio
// —y de paso el POS de las tiendas, que comparte la base— de rodillas desde una consola.
//
// El webhook de Wompi queda FUERA a propósito, más abajo: es la pasarela avisando que un
// pago se aprobó, reintenta si falla y llega de una IP que no controlamos. Frenarlo
// perdería confirmaciones de pagos reales, que es mucho peor que el abuso que evita.
// ─────────────────────────────────────────────────────────────────────────────
routes.use((req, res, next) =>
    req.path === '/webhooks/wompi' ? next() : apiRateLimit(req, res, next));

routes.get('/config',              getConfig);
routes.get('/categorias',          getCategorias);
routes.get('/filtros',             getFiltros);
routes.get('/productos',           getCatalogo);
routes.get('/producto/:slug',      getProducto);

// Reservas blandas: avisan que otros tienen el producto cargado, no bloquean stock.
// Con apiRateLimit porque las llama el navegador en cada cambio del carrito.
routes.post('/carrito/reservas',   sincronizarReservasWeb);
routes.get('/carrito/demanda',     demandaCarritoWeb);
routes.get('/pagina/:slug',        getPaginaBySlug);
routes.get('/puntos-venta',        getPuntosVenta);
routes.post('/interesado',         escrituraPublicaRateLimit, postInteresado);
routes.post('/visitante/track',        trackingRateLimit, trackVisita);
routes.post('/visitante/identificar',  trackingRateLimit, identificarVisitante);
routes.post('/pedidos',                escrituraPublicaRateLimit, crearPedidoWeb);
routes.post('/pedidos/:idPedido/pago', escrituraPublicaRateLimit, iniciarPagoWompi);
routes.get('/pedidos/:numeroPedido/estado', consultarEstadoPedido);
routes.post('/webhooks/wompi', webhookWompi);

// Pago por QR — solo lectura. Devuelve URLs firmadas de corta vida, nunca el object key.
routes.get('/pagos/qr',            listarEntidadesQrPublico);
routes.get('/pagos/qr/:idEntidad', getQrPagoPublico);

// Comprobante de la transferencia por QR. Público (el checkout no tiene sesión), acotado
// en el controlador a pedidos 'pendiente_pago' con metodoPago='qr' y con rate limit por IP.
routes.post('/pedidos/:idPedido/comprobante', escrituraPublicaRateLimit, recibirComprobante, subirComprobantePagoWeb);

export default routes;
