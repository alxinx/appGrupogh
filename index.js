import express from "express";
import csrf from "csurf";
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
import db from "./config/bd.js";
import { verificarTrasladosExpirados } from "./controller/storeControllers.js";
import { cargarContadoresAdmin } from './middleware/adminMenuMiddleware.js';
import { tituloLista } from './helpers/textoLista.js';


dotenv.config();

const app = express();
const port = process.env.APP_PORT;

// Detrás de Nginx o Cloudflare, req.ip devuelve la IP del proxy para todo el mundo: el
// limitador del login bloquearía a todos los usuarios a la vez, y apiRateLimit trataría al
// tráfico entero como un solo cliente. TRUST_PROXY declara cuántos saltos de confianza hay.
// En local va en 0 (sin proxy) para que nadie pueda falsear su IP con X-Forwarded-For.
app.set('trust proxy', parseInt(process.env.TRUST_PROXY) || 0);

// Formateo de nombres en listados: disponible como tc() en cualquier vista Pug.
// Es solo presentación — no altera lo que está guardado.
app.locals.tc = tituloLista;

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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use(cookieParser());

// CORS para la API pública de la tienda web (sin cookies/sesión, consumida por grupoghweb desde el navegador)
app.use('/api/web', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// 2. Configuración de Vistas
app.set("view engine", "pug");
app.set("views", "./views");

// 3. Middlewares de Seguridad (CSRF)
const csrfMiddleware = csrf({ cookie: true });

// Aplicación Global con Excepción para la ruta de imágenes
app.use((req, res, next) => {
    // Excluimos SOLO el POST de inventario, provedores y personal para que el middleware uploadImages/Mixed actué primero
    if ((req.path === '/admin/inventario/ingreso' || req.path === '/admin/provedores/new' || req.path === '/admin/personal/new' || req.path.startsWith('/admin/personal/ver/') || req.path === '/admin/clientes/nuevo' || req.path.match(/^\/admin\/clientes\/editar\/.+$/) || req.path === '/admin/inventario/batch' || req.path.match(/^\/admin\/web\/(banners|secciones|popup)\/(crear|editar\/.+)$/) || req.path.match(/^\/admin\/web\/categorias\/\d+\/imagen$/)) && req.method === 'POST') {
        return next();
    }
    // Excluimos endpoints de API JSON autenticados (usan JWT + verificación de permisos propia)
    if (req.path.match(/^\/admin\/api\/clientes\/.+\/credito$/) && req.method === 'POST') {
        return next();
    }
    if (req.path.match(/^\/admin\/api\/clientes\/archivos\/.+\/eliminar$/) && req.method === 'POST') {
        return next();
    }
    if (req.path.match(/^\/admin\/api\/provedores\/factura\/.+\/abonar$/) && req.method === 'POST') {
        return next();
    }
    // API pública de la tienda web — sin CSRF (solo GET, sin estado)
    if (req.path.startsWith('/api/web')) return next();
    // Para todos los demás (Login, Tiendas, GET de inventario), se aplica aquí
    csrfMiddleware(req, res, next);
});

// 4. Rutas
app.use("/pagina", webRouters)
app.use("/", loginRoutes); // LOGIN
app.use("/admin", rutaProtegida, verificarRol('ADMIN'), cargarContadoresAdmin, adminRoutes); // ADMINISTRADOR
app.use("/admin/web", rutaProtegida, verificarRol('ADMIN'), cargarContadoresAdmin, webAdminRoutes); // CMS E-COMMERCE
app.use("/api/web", webApiRoutes); // API PÚBLICA TIENDA WEB
app.use("/store", rutaProtegida, verificarRol('STORE'), storeRoutes); // TIENDAS

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

// 6. CSRF error handler
app.use((err, req, res, next) => {
    if (err.code !== 'EBADCSRFTOKEN') return next(err);
    console.error(`[CSRF] ${req.method} ${req.url} — token inválido o ausente`);
    const isJson = req.headers.accept?.includes('application/json') ||
                   req.headers['content-type']?.includes('application/json');
    if (isJson) return res.status(403).json({ success: false, mensaje: 'Sesión expirada. Recarga la página.' });
    return res.status(403).send('<h2>Sesión expirada. <a href="javascript:location.reload()">Recargar</a></h2>');
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