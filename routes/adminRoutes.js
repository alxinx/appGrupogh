import express from "express";
import {adminLogin,registerLogin, forgotLogin} from "../controller/adminControllers.js";
const routes = express.Router();


//GET 
routes.get("/", adminLogin);
routes.get("/register", registerLogin);
routes.get("/forgot", forgotLogin);



//ADMINISTRADOR


//POST


export default routes;