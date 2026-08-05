import express from 'express';
import csrf from 'csurf';
const routes = express.Router();
const csrfProtection = csrf({ cookie: true });

import {
    dashboardWeb,
    categoriasWeb, toggleCategoriaWeb,
    listaBanners, crearBanner, actualizarBanner, eliminarBanner,
    listaCenefas, crearCenefa, actualizarCenefa, eliminarCenefa,
    listaSecciones, crearSeccion, actualizarSeccion, eliminarSeccion,
    gestionPopup, actualizarPopup,
    listaEtiquetas, crearEtiqueta, actualizarEtiqueta, eliminarEtiqueta,
    listaPaginas, nuevaPaginaForm, editarPaginaForm, crearPagina, actualizarPagina, eliminarPagina,
    paginaPedidosWeb, jsonPedidosWeb, jsonDetallePedidoWeb, exportarPedidosWeb,
    paginaDetallePedidoWeb, asignarTiendaPedidoWeb, cancelarPedidoWeb
} from '../controller/webAdminController.js';

import uploadImages from '../middlewares/uploadImages.js';

// Dashboard
routes.get('/', dashboardWeb);

// Categorías
routes.get('/categorias', csrfProtection, categoriasWeb);
routes.post('/categorias/toggle/:idCategoria', csrfProtection, toggleCategoriaWeb);

// Banners
const uploadImagenesBanner = uploadImages.fields([
    { name: 'imagen', maxCount: 1 },
    { name: 'imagenMovil', maxCount: 1 }
]);
routes.get('/banners', csrfProtection, listaBanners);
routes.post('/banners/crear', uploadImagenesBanner, csrfProtection, crearBanner);
routes.post('/banners/editar/:idBanner', uploadImagenesBanner, csrfProtection, actualizarBanner);
routes.post('/banners/eliminar/:idBanner', csrfProtection, eliminarBanner);

// Cenefas
routes.get('/cenefas', csrfProtection, listaCenefas);
routes.post('/cenefas/crear', csrfProtection, crearCenefa);
routes.post('/cenefas/editar/:idCenefa', csrfProtection, actualizarCenefa);
routes.post('/cenefas/eliminar/:idCenefa', csrfProtection, eliminarCenefa);

// Secciones
routes.get('/secciones', csrfProtection, listaSecciones);
routes.post('/secciones/crear', uploadImages.single('imagen'), csrfProtection, crearSeccion);
routes.post('/secciones/editar/:idSeccion', uploadImages.single('imagen'), csrfProtection, actualizarSeccion);
routes.post('/secciones/eliminar/:idSeccion', csrfProtection, eliminarSeccion);

// Popup
routes.get('/popup', csrfProtection, gestionPopup);
routes.post('/popup/editar/:idPopup', uploadImages.single('imagen'), csrfProtection, actualizarPopup);

// Tracking y etiquetas
routes.get('/tracking', csrfProtection, listaEtiquetas);
routes.post('/tracking/crear', csrfProtection, crearEtiqueta);
routes.post('/tracking/editar/:idEtiqueta', csrfProtection, actualizarEtiqueta);
routes.post('/tracking/eliminar/:idEtiqueta', csrfProtection, eliminarEtiqueta);

// Páginas secundarias
routes.get('/paginas', csrfProtection, listaPaginas);
routes.get('/paginas/nueva', csrfProtection, nuevaPaginaForm);
routes.get('/paginas/:idPagina/editar', csrfProtection, editarPaginaForm);
routes.post('/paginas/crear', csrfProtection, crearPagina);
routes.post('/paginas/:idPagina/editar', csrfProtection, actualizarPagina);
routes.post('/paginas/:idPagina/eliminar', csrfProtection, eliminarPagina);

// Pedidos web
routes.get('/pedidos', paginaPedidosWeb);
routes.get('/pedidos/json', jsonPedidosWeb);
routes.get('/pedidos/exportar', exportarPedidosWeb);
routes.get('/pedidos/:idPedido', csrfProtection, paginaDetallePedidoWeb);
routes.get('/pedidos/:idPedido/json', jsonDetallePedidoWeb);
routes.post('/pedidos/:idPedido/asignar-tienda', csrfProtection, asignarTiendaPedidoWeb);
routes.post('/pedidos/:idPedido/cancelar', csrfProtection, cancelarPedidoWeb);

export default routes;
