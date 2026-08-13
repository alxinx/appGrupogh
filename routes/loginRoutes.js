import express from "express";
//import {adminLogin,registerLogin, forgotLogin, registerLoginPost, loginUser} from "../controller/adminControllers.js";
import {adminLogin,registerLogin, forgotLogin, registerLoginPost, loginUser, logout} from "../controller/loginControllers.js";

import {registerValidation, loginValidation} from '../middlewares/fieldValidations.js';
import loginRateLimit from '../middlewares/loginRateLimit.js';
const routes = express.Router();


//GET 
routes.get("/", adminLogin);
// El alta de administradores solo existe si REGISTRO_ABIERTO=true (ver registerLoginPost).
routes.get("/register", registerLogin);
routes.get("/forgot", forgotLogin);

//POST
routes.post("/logout", logout);




//REGISTROS

// Crea usuarios ADMIN. El controlador responde 404 salvo que REGISTRO_ABIERTO=true.
routes.post("/register", registerValidation, registerLoginPost);

// loginRateLimit va ANTES del validador: un bloqueo activo no debe gastar ni una
// comparación de bcrypt, que es justamente lo que un atacante quiere provocar.
routes.post("/", loginRateLimit, loginValidation, loginUser)


//POST


export default routes;