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
    listaEtiquetas, crearEtiqueta, actualizarEtiqueta, eliminarEtiqueta
} from '../controller/webAdminController.js';

import uploadImages from '../middlewares/uploadImages.js';

// Dashboard
routes.get('/', dashboardWeb);

// Categorías
routes.get('/categorias', csrfProtection, categoriasWeb);
routes.post('/categorias/toggle/:idCategoria', csrfProtection, toggleCategoriaWeb);

// Banners
routes.get('/banners', csrfProtection, listaBanners);
routes.post('/banners/crear', uploadImages.single('imagen'), csrfProtection, crearBanner);
routes.post('/banners/editar/:idBanner', uploadImages.single('imagen'), csrfProtection, actualizarBanner);
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

export default routes;
