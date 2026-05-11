import express from 'express';
const routes = express.Router();

import { getConfig, getCategoriasPublicas, getCatalogoProductos, getDetalleProducto } from '../controller/webPublicController.js';
import apiRateLimit from '../middlewares/apiRateLimit.js';

routes.use(apiRateLimit);

routes.get('/config',           getConfig);
routes.get('/categorias',       getCategoriasPublicas);
routes.get('/productos',        getCatalogoProductos);
routes.get('/producto/:slug',   getDetalleProducto);

export default routes;
