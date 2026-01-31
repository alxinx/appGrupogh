import express, { Router } from "express";
const routes = express.Router();
import {homePage, producto, listadoProductos} from '../controller/webControllers.js'



routes.get("/", homePage);
routes.get("/producto/vestido-aurora", producto);
routes.get("/colecciones", listadoProductos);

//routes.get("/")


 export default routes