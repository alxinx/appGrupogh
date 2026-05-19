import express from 'express';
import { getConfig, getCategorias, getCatalogo, getProducto, getFiltros, postInteresado, getPaginaBySlug } from '../controller/webApiController.js';

const routes = express.Router();

routes.get('/config',          getConfig);
routes.get('/categorias',      getCategorias);
routes.get('/filtros',         getFiltros);
routes.get('/productos',       getCatalogo);
routes.get('/producto/:slug',  getProducto);
routes.get('/pagina/:slug',    getPaginaBySlug);
routes.post('/interesado',     postInteresado);

export default routes;
