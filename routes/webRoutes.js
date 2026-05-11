import express from "express";
const routes = express.Router();
import { homePage, productoDetalle, listadoProductos, catalogoCategoria } from '../controller/webControllers.js';

routes.get("/", homePage);
routes.get("/catalogo/:idCategoria", catalogoCategoria);
routes.get("/producto/:slug", productoDetalle);
routes.get("/colecciones", listadoProductos);

export default routes;
