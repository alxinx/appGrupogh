import express from "express";
//import {adminLogin,registerLogin, forgotLogin, registerLoginPost, loginUser} from "../controller/adminControllers.js";
import {adminLogin,registerLogin, forgotLogin, forgotPost, restablecerGet, restablecerPost, cambiarContrasenaGet, cambiarContrasenaPost, registerLoginPost, loginUser, logout} from "../controller/loginControllers.js";
import { rutaProtegida } from '../middlewares/authMiddleware.js';

import {registerValidation, loginValidation} from '../middlewares/fieldValidations.js';
import loginRateLimit from '../middlewares/loginRateLimit.js';
const routes = express.Router();


//GET 
routes.get("/", adminLogin);
// El alta de administradores solo existe si REGISTRO_ABIERTO=true (ver registerLoginPost).
routes.get("/register", registerLogin);
routes.get("/forgot", forgotLogin);
// Recuperar contraseña (helpers/contrasena.js). El enlace del correo lleva el token.
routes.post("/forgot", forgotPost);
routes.get("/restablecer/:token", restablecerGet);
routes.post("/restablecer/:token", restablecerPost);
// Cambiar contraseña con la sesión abierta: la misma pantalla para el panel y la tienda.
routes.get("/cuenta/contrasena", rutaProtegida, cambiarContrasenaGet);
routes.post("/cuenta/contrasena", rutaProtegida, cambiarContrasenaPost);

//POST
routes.post("/logout", logout);




//REGISTROS

// Crea usuarios ADMIN. El controlador responde 404 salvo que REGISTRO_ABIERTO=true.
// Mismo freno que el login. `/register` responde 404 salvo con REGISTRO_ABIERTO, pero el
// límite va igual: si algún día esa variable queda encendida por descuido, no puede
// quedar además un endpoint de alta de administradores sin ningún tope.
routes.post("/register", loginRateLimit, registerValidation, registerLoginPost);

// loginRateLimit va ANTES del validador: un bloqueo activo no debe gastar ni una
// comparación de bcrypt, que es justamente lo que un atacante quiere provocar.
routes.post("/", loginRateLimit, loginValidation, loginUser)


//POST


export default routes;