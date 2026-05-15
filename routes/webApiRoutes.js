import express from 'express';
import { getConfig, getCategorias, getCatalogo, getProducto, getFiltros } from '../controller/webApiController.js';

const routes = express.Router();

routes.get('/config',          getConfig);
routes.get('/categorias',      getCategorias);
routes.get('/filtros',         getFiltros);
routes.get('/productos',       getCatalogo);
routes.get('/producto/:slug',  getProducto);

export default routes;
