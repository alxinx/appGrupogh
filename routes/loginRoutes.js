import express from "express";
import {adminLogin,registerLogin, forgotLogin, registerLoginPost, loginUser} from "../controller/adminControllers.js";
import {registerValidation, loginValidation} from '../middlewares/fieldValidations.js';
const routes = express.Router();


//GET 
routes.get("/", adminLogin);
routes.get("/register", registerLogin);
routes.get("/forgot", forgotLogin);



//ADMINISTRADOR


routes.post("/register", registerValidation, registerLoginPost);
routes.post("/", loginValidation, loginUser)


//POST


export default routes;