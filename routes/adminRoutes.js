import express from "express";
import {adminLogin,registerLogin, forgotLogin, registerLoginPost} from "../controller/adminControllers.js";
import {registerValidation} from '../middlewares/fieldValidations.js';
const routes = express.Router();


//GET 
routes.get("/", adminLogin);
routes.get("/register", registerLogin);
routes.get("/forgot", forgotLogin);



//ADMINISTRADOR


routes.post("/register", registerValidation, registerLoginPost);


//POST


export default routes;