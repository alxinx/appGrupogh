import express from 'express';
import apiRateLimit, { escrituraPublicaRateLimit, trackingRateLimit, crearRateLimit } from '../middlewares/apiRateLimit.js';
import { exigirTurnstile } from '../middlewares/turnstile.js';
import { recibirRutRegistroWeb } from '../middlewares/uploadComprobantes.js';
import { consultarDocumentoRegistro, registrarClienteWeb } from '../controller/registroClienteWebController.js';
import { recibirComprobante } from '../middlewares/uploadComprobante.js';
import { getConfig, getCategorias, getCatalogo, getProducto, getFiltros, postInteresado, darDeBajaInteresado, getPaginaBySlug, getPuntosVenta, getDepartamentosPublico, getMunicipiosPublico, getCiiuPublico, trackVisita, identificarVisitante, crearPedidoWeb, iniciarPagoWompi, consultarEstadoPedido, webhookWompi, subirComprobantePagoWeb, sincronizarReservasWeb, demandaCarritoWeb } from '../controller/webApiController.js';

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

// Departamento/municipio del checkout (envío a domicilio) — mismo listado del DANE que ya
// usa el admin, sin sesión.
routes.get('/departamentos',              getDepartamentosPublico);
routes.get('/municipios/:idDepartamento', getMunicipiosPublico);
routes.get('/ciiu/:codigo',              getCiiuPublico);
routes.post('/interesado',         escrituraPublicaRateLimit, postInteresado);
routes.get('/interesado/baja',     darDeBajaInteresado);
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

// ── Registro público de clientes (grupogh.co/formularios/registroClientes) ──
//
// Abierto a internet, así que va en capas y en este orden: rate limit por IP (barato,
// en memoria) → Turnstile de Cloudflare (token en el header, verificado ANTES de leer el
// body con archivos) → multer con topes chicos → validación campo por campo.
// La consulta de documento revela si alguien es cliente: por eso también exige Turnstile.
const consultaRegistroRateLimit = crearRateLimit({
    limite: () => parseInt(process.env.REGISTRO_CONSULTAS_PER_MIN) || 10,
    nombre: 'registro-consulta',
    mensaje: 'Demasiadas consultas seguidas. Espera un momento e inténtalo de nuevo.'
});
const registroRateLimit = crearRateLimit({
    limite: () => parseInt(process.env.REGISTRO_ENVIOS_POR_10MIN) || 10,
    ventanaMs: 10 * 60 * 1000,
    nombre: 'registro-cliente',
    mensaje: 'Demasiados registros desde esta conexión. Inténtalo más tarde.'
});
routes.post('/registro-clientes/consulta', consultaRegistroRateLimit, exigirTurnstile('registro_cliente'), consultarDocumentoRegistro);
routes.post('/registro-clientes', registroRateLimit, exigirTurnstile('registro_cliente'), recibirRutRegistroWeb, registrarClienteWeb);

export default routes;
