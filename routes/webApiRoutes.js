import express from 'express';
import { getConfig, getCategorias, getCatalogo, getProducto, getFiltros, postInteresado, getPaginaBySlug, getPuntosVenta, trackVisita, identificarVisitante, crearPedidoWeb, iniciarPagoWompi, consultarEstadoPedido, webhookWompi } from '../controller/webApiController.js';

const routes = express.Router();

routes.get('/config',              getConfig);
routes.get('/categorias',          getCategorias);
routes.get('/filtros',             getFiltros);
routes.get('/productos',           getCatalogo);
routes.get('/producto/:slug',      getProducto);
routes.get('/pagina/:slug',        getPaginaBySlug);
routes.get('/puntos-venta',        getPuntosVenta);
routes.post('/interesado',         postInteresado);
routes.post('/visitante/track',        trackVisita);
routes.post('/visitante/identificar',  identificarVisitante);
routes.post('/pedidos',                crearPedidoWeb);
routes.post('/pedidos/:idPedido/pago', iniciarPagoWompi);
routes.get('/pedidos/:numeroPedido/estado', consultarEstadoPedido);
routes.post('/webhooks/wompi', webhookWompi);

export default routes;
