import express from "express";
import { TIPOS_DOCUMENTO } from './helpers/tiposDocumento.js';
import { RESPONSABILIDADES_FISCALES, ENTIDADES_FINANCIERAS, TIPOS_CUENTA_BANCARIA, TIPOS_LLAVE_BREB, FORMATOS_NUMERO_CUENTA } from './helpers/catalogos.js';
import verificarOrigen, { limpiarCookieCsrfVieja } from "./middlewares/verificarOrigen.js";
import dotenv from 'dotenv';
import cookieParser from "cookie-parser";
import loginRoutes from "./routes/loginRoutes.js";
import adminRoutes from "./routes/adminRoutes.js"
import { MAX_IMAGENES, MAX_BYTES_IMAGEN } from "./middlewares/uploadImages.js"
import storeRoutes from "./routes/storeRoutes.js"
import webRouters from "./routes/webRoutes.js"
import webAdminRoutes from "./routes/webAdminRoutes.js"
import webApiRoutes from "./routes/webApiRoutes.js"
import { rutaProtegida, verificarRol } from "./middlewares/authMiddleware.js"
import permisosAdmin from "./middlewares/permisosAdmin.js"
import cabecerasSeguridad from "./middlewares/cabecerasSeguridad.js"
import db from "./config/bd.js";
import { verificarTrasladosExpirados } from "./controller/storeControllers.js";
import { cargarContadoresAdmin } from './middlewares/adminMenuMiddleware.js';
import { tituloLista } from './helpers/textoLista.js';


dotenv.config();

const app = express();
const port = process.env.APP_PORT;

// Detrás de Nginx o Cloudflare, req.ip devuelve la IP del proxy para todo el mundo: el
// limitador del login bloquearía a todos los usuarios a la vez, y apiRateLimit trataría al
// tráfico entero como un solo cliente. TRUST_PROXY declara cuántos saltos de confianza hay.
// En local va en 0 (sin proxy) para que nadie pueda falsear su IP con X-Forwarded-For.
const TRUST_PROXY = parseInt(process.env.TRUST_PROXY);
app.set('trust proxy', Number.isFinite(TRUST_PROXY) ? TRUST_PROXY : 0);

// Sin la variable declarada, el valor cae en 0 y eso es lo correcto en local — pero en
// producción detrás de un proxy es un fallo silencioso: todas las peticiones llegarían con
// la misma IP y el limitador del login dejaría afuera a todos los usuarios tras cinco
// fallos de cualquiera. El aviso existe para que ese caso no se descubra el día que pasa.
if (!Number.isFinite(TRUST_PROXY)) {
    console.warn(
        '[config] TRUST_PROXY no está declarada; se asume 0 (sin proxy adelante).\n' +
        '         Si la app corre detrás de Nginx, Cloudflare o un balanceador, ponela en 1:\n' +
        '         de lo contrario los límites por IP tratan a todo el tráfico como un solo cliente.'
    );
}

// Formateo de nombres en listados: disponible como tc() en cualquier vista Pug.
// Es solo presentación — no altera lo que está guardado.
app.locals.tc = tituloLista;

// Catálogos que usan formularios de varias áreas (el modal de clientes del POS vive en el
// layout de la tienda y se pinta en todas sus pantallas). Fuente: src/json/.
app.locals.tiposDocumento = TIPOS_DOCUMENTO;
app.locals.responsabilidadesFiscales = RESPONSABILIDADES_FISCALES;
app.locals.entidadesFinancieras = ENTIDADES_FINANCIERAS;
app.locals.tiposCuentaBancaria = TIPOS_CUENTA_BANCARIA;
app.locals.tiposLlaveBreb = TIPOS_LLAVE_BREB;
app.locals.formatosNumeroCuenta = FORMATOS_NUMERO_CUENTA;

// Conexión a la Base de Datos
try {
    if (process.env.DB_SYNC === "true") {
        await db.sync();
    }
    await db.authenticate();
    console.log('Conexión a la base de datos establecida correctamente.');
} catch (error) {
    console.log(`No se pudo conectar a la base de datos: ${error}`);
}

// 1. Middlewares de configuración básica
//
// La API pública (/api/web) recibe JSON de un carrito, un formulario de contacto o un
// tracking de visitante — nunca más de unos KB. Se parsea con un límite propio, chico,
// ANTES del límite general de 50mb que necesita el panel admin (contenido rico de
// páginas/secciones, formularios grandes). body-parser no reparsea si `req._body` ya
// quedó seteado, así que el límite grande de abajo no pisa este ni vuelve a leer el
// stream — solo aplica a las rutas que no matchean acá. Sin este límite chico, cualquiera
// podía mandar peticiones con bodies cercanos a 50MB a un endpoint sin sesión: el parseo
// (CPU + memoria) ocurre igual aunque el rate limit después responda 429.
app.use('/api/web', express.json({ limit: '256kb' }));
app.use('/api/web', express.urlencoded({ extended: true, limit: '256kb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use(cookieParser());

// CORS para la API pública de la tienda web (sin cookies/sesión, consumida por grupoghweb desde el navegador)
app.use('/api/web', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    // X-Turnstile-Token: el token anti-bots del registro público de clientes viaja en un
    // header para verificarse antes de leer el body (middlewares/turnstile.js).
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Turnstile-Token');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// 2. Configuración de Vistas
app.set("view engine", "pug");
app.set("views", "./views");

// Cabeceras de seguridad en TODA respuesta, antes que cualquier ruta.
app.use(cabecerasSeguridad);

// 3. Protección CSRF por origen (middlewares/verificarOrigen.js), sin token en el navegador.
// Va antes de TODAS las rutas y no necesita leer el body, así que ya no hay que exceptuar
// las rutas multipart para que multer actúe primero: también quedan protegidas.
// /api/web queda afuera: es la API pública que consume grupoghweb desde otro origen, sin
// cookies de sesión (rate limit + Turnstile + firma del webhook de Wompi).
app.use(limpiarCookieCsrfVieja);
app.use((req, res, next) => req.path.startsWith('/api/web') ? next() : verificarOrigen(req, res, next));

// 4. Rutas
app.use("/pagina", webRouters)
app.use("/", loginRoutes); // LOGIN
// `permisosAdmin` va DESPUÉS de verificarRol y ANTES de las rutas: primero se confirma
// que es un administrador, después a qué módulos de ese panel puede entrar. Hasta acá el
// rol abría todo el panel y los permisos finos de USER_PERMISOS no los leía nadie.
app.use("/admin", rutaProtegida, verificarRol('ADMIN'), permisosAdmin, cargarContadoresAdmin, adminRoutes); // ADMINISTRADOR
// Sin `permisosAdmin`: el montaje de "/admin" de arriba corre primero y ya verificó la
// carpeta /web con la ruta completa. Acá la ruta llega recortada ("/paginas"), así que
// volver a verificarla la mediría contra un camino que no existe y rebotaría todo.
app.use("/admin/web", rutaProtegida, verificarRol('ADMIN'), cargarContadoresAdmin, webAdminRoutes); // CMS E-COMMERCE
app.use("/api/web", webApiRoutes); // API PÚBLICA TIENDA WEB
// EMPLOYER es el empleado de bodega: tiene punto de venta asignado igual que un vendedor
// y trabaja desde el área de tienda. Antes no estaba admitido acá ni en /admin, y el rebote
// de verificarRol lo mandaba a /store/ en un bucle de redirecciones sin fin.
app.use("/store", rutaProtegida, verificarRol('STORE', 'EMPLOYER'), storeRoutes); // TIENDAS

// 5. Errores de subida de archivos (multer)
// Sin esto, superar el límite terminaba en el manejador por defecto de Express, que
// responde HTML; el formulario espera JSON y lo mostraba como "no se pudo conectar con
// el servidor" — un mensaje que manda a buscar el problema en el lugar equivocado.
app.use((err, req, res, next) => {
    if (err?.name !== 'MulterError') return next(err);

    const mensajes = {
        LIMIT_FILE_COUNT: `Subiste demasiadas imágenes. El máximo es ${MAX_IMAGENES} por producto.`,
        LIMIT_FILE_SIZE:  `Alguna imagen pesa más de ${Math.round(MAX_BYTES_IMAGEN / 1024 / 1024)} MB. Reducila e intentá de nuevo.`,
        LIMIT_UNEXPECTED_FILE: 'Se recibió un archivo en un campo inesperado.',
    };
    const mensaje = mensajes[err.code] || 'No se pudieron procesar los archivos enviados.';
    console.error(`[upload] ${req.method} ${req.url} — ${err.code}: ${err.message}`);

    const esJson = req.headers.accept?.includes('application/json') ||
                   req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest';
    if (esJson) return res.status(400).json({ success: false, mensaje });
    return res.status(400).send(`<h2>${mensaje} <a href="javascript:history.back()">Volver</a></h2>`);
});

// 5b. Errores de parseo del body (express.json/urlencoded, vía body-parser)
// Sin esto, un body más grande que el límite o un JSON mal formado caían en la página de
// error por defecto de Express: HTML con el stack trace completo y rutas absolutas del
// servidor — expuesto incluso en /api/web, que es pública y sin sesión.
app.use((err, req, res, next) => {
    const tiposBodyParser = ['entity.too.large', 'entity.parse.failed', 'encoding.unsupported'];
    if (!tiposBodyParser.includes(err?.type)) return next(err);

    const mensajes = {
        'entity.too.large':     'La solicitud es demasiado grande.',
        'entity.parse.failed':  'El cuerpo de la solicitud no es JSON válido.',
        'encoding.unsupported': 'Codificación de la solicitud no soportada.'
    };
    console.error(`[body-parser] ${req.method} ${req.url} — ${err.type}: ${err.message}`);
    return res.status(err.status || 400).json({ success: false, mensaje: mensajes[err.type] || 'Solicitud inválida.' });
});

app.listen(port, () => {
    console.log(`Servidor corriendo en ${process.env.APP_URL}:${port}`);
});

// Verificar traslados expirados cada 15 minutos
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
setTimeout(async () => {
    await verificarTrasladosExpirados();
    setInterval(verificarTrasladosExpirados, CHECK_INTERVAL_MS);
}, 5000);