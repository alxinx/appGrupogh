import express from "express";
import csrf from "csurf";
import dotenv from 'dotenv';
import cookieParser from "cookie-parser";
import loginRoutes from "./routes/loginRoutes.js";
import adminRoutes from "./routes/adminRoutes.js"
import storeRoutes from "./routes/storeRoutes.js"
import {rutaProtegida, verificarRol} from "./middlewares/authMiddleware.js"
import db from "./config/bd.js"

dotenv.config();

const app = express();
const port = process.env.APP_PORT;

// Conexión a la Base de Datos
try {
    if(process.env.DB_SYNC === "true"){
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

// 2. Configuración de Vistas
app.set("view engine", "pug");
app.set("views", "./views");

// 3. Middlewares de Seguridad (CSRF)
const csrfMiddleware = csrf({ cookie: true });

// Aplicación Global con Excepción para la ruta de imágenes
app.use((req, res, next) => {
    // Excluimos SOLO el POST de inventario para que el middleware uploadImages de la ruta pueda actuar primero
    if (req.path === '/admin/inventario/ingreso' && req.method === 'POST') {
        return next(); 
    }
    // Para todos los demás (Login, Tiendas, GET de inventario), se aplica aquí
    csrfMiddleware(req, res, next);
});

// 4. Rutas
app.use("/", loginRoutes); // LOGIN
app.use("/admin", rutaProtegida, verificarRol('ADMIN'), adminRoutes); // ADMINISTRADOR
app.use("/store", rutaProtegida, verificarRol('STORE'), storeRoutes); // TIENDAS

app.listen(port, () => {
    console.log(`Servidor corriendo en ${process.env.APP_URL}:${port}`);
});