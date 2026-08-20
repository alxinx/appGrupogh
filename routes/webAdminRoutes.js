import express from 'express';
import verificarPermisoSesion from '../middlewares/verificarPermisoSesion.js';
import csrf from 'csurf';
const routes = express.Router();
const csrfProtection = csrf({ cookie: true });

// Permisos del módulo de tienda web. `permisosAdmin` (montado en "/admin") ya verificó que
// este usuario puede entrar a la carpeta /web; esto distingue qué puede hacer adentro:
// mirar el catálogo no es lo mismo que publicar un banner en el sitio público.
const pWeb = (accion) => verificarPermisoSesion('Tienda Web', 'administrativo', accion);

import {
    dashboardWeb,
    categoriasWeb, toggleCategoriaWeb, subirImagenCategoria, quitarImagenCategoria,
    listaBanners, crearBanner, actualizarBanner, eliminarBanner,
    listaCenefas, crearCenefa, actualizarCenefa, eliminarCenefa,
    listaSecciones, crearSeccion, actualizarSeccion, eliminarSeccion,
    gestionPopup, actualizarPopup,
    listaEtiquetas, crearEtiqueta, actualizarEtiqueta, eliminarEtiqueta,
    listaPaginas, nuevaPaginaForm, editarPaginaForm, crearPagina, actualizarPagina, eliminarPagina,
    paginaPedidosWeb, jsonPedidosWeb, jsonDetallePedidoWeb, exportarPedidosWeb,
    paginaDetallePedidoWeb, asignarTiendaPedidoWeb, cancelarPedidoWeb, confirmarPagoPedidoWeb
} from '../controller/webAdminController.js';

import verificarCodigoEmpleadoAdmin from '../middlewares/verificarCodigoEmpleadoAdmin.js';

import uploadImages from '../middlewares/uploadImages.js';

// Dashboard
routes.get('/', pWeb('READ'), dashboardWeb);

// Categorías
routes.get('/categorias', pWeb('READ'), csrfProtection, categoriasWeb);
routes.post('/categorias/toggle/:idCategoria', pWeb('EDIT'), csrfProtection, toggleCategoriaWeb);
routes.post('/categorias/:idCategoria/imagen', pWeb('EDIT'), uploadImages.single('imagen'), csrfProtection, subirImagenCategoria);
routes.post('/categorias/:idCategoria/imagen/quitar', pWeb('DELETE'), csrfProtection, quitarImagenCategoria);

// Banners
const uploadImagenesBanner = uploadImages.fields([
    { name: 'imagen', maxCount: 1 },
    { name: 'imagenMovil', maxCount: 1 }
]);
routes.get('/banners', pWeb('READ'), csrfProtection, listaBanners);
routes.post('/banners/crear', pWeb('CREATE'), uploadImagenesBanner, csrfProtection, crearBanner);
routes.post('/banners/editar/:idBanner', pWeb('EDIT'), uploadImagenesBanner, csrfProtection, actualizarBanner);
routes.post('/banners/eliminar/:idBanner', pWeb('DELETE'), csrfProtection, eliminarBanner);

// Cenefas
routes.get('/cenefas', pWeb('READ'), csrfProtection, listaCenefas);
routes.post('/cenefas/crear', pWeb('CREATE'), csrfProtection, crearCenefa);
routes.post('/cenefas/editar/:idCenefa', pWeb('EDIT'), csrfProtection, actualizarCenefa);
routes.post('/cenefas/eliminar/:idCenefa', pWeb('DELETE'), csrfProtection, eliminarCenefa);

// Secciones
routes.get('/secciones', pWeb('READ'), csrfProtection, listaSecciones);
routes.post('/secciones/crear', pWeb('CREATE'), uploadImages.single('imagen'), csrfProtection, crearSeccion);
routes.post('/secciones/editar/:idSeccion', pWeb('EDIT'), uploadImages.single('imagen'), csrfProtection, actualizarSeccion);
routes.post('/secciones/eliminar/:idSeccion', pWeb('DELETE'), csrfProtection, eliminarSeccion);

// Popup
routes.get('/popup', pWeb('READ'), csrfProtection, gestionPopup);
routes.post('/popup/editar/:idPopup', pWeb('EDIT'), uploadImages.single('imagen'), csrfProtection, actualizarPopup);

// Tracking y etiquetas
routes.get('/tracking', pWeb('READ'), csrfProtection, listaEtiquetas);
routes.post('/tracking/crear', pWeb('CREATE'), csrfProtection, crearEtiqueta);
routes.post('/tracking/editar/:idEtiqueta', pWeb('EDIT'), csrfProtection, actualizarEtiqueta);
routes.post('/tracking/eliminar/:idEtiqueta', pWeb('DELETE'), csrfProtection, eliminarEtiqueta);

// Páginas secundarias
routes.get('/paginas', pWeb('READ'), csrfProtection, listaPaginas);
routes.get('/paginas/nueva', pWeb('CREATE'), csrfProtection, nuevaPaginaForm);
routes.get('/paginas/:idPagina/editar', pWeb('EDIT'), csrfProtection, editarPaginaForm);
routes.post('/paginas/crear', pWeb('CREATE'), csrfProtection, crearPagina);
routes.post('/paginas/:idPagina/editar', pWeb('EDIT'), csrfProtection, actualizarPagina);
routes.post('/paginas/:idPagina/eliminar', pWeb('DELETE'), csrfProtection, eliminarPagina);

// Pedidos web
routes.get('/pedidos', pWeb('READ'), paginaPedidosWeb);
routes.get('/pedidos/json', pWeb('READ'), jsonPedidosWeb);
routes.get('/pedidos/exportar', pWeb('READ'), exportarPedidosWeb);
routes.get('/pedidos/:idPedido', pWeb('READ'), csrfProtection, paginaDetallePedidoWeb);
routes.get('/pedidos/:idPedido/json', pWeb('READ'), jsonDetallePedidoWeb);
routes.post('/pedidos/:idPedido/asignar-tienda', pWeb('EDIT'), csrfProtection, asignarTiendaPedidoWeb);
// Cambios de estado hechos a mano: además del CSRF exigen código de empleado, para que
// quede registrado quién dio el pedido por pagado o quién lo canceló.
routes.post('/pedidos/:idPedido/confirmar-pago', pWeb('EDIT'), csrfProtection, verificarCodigoEmpleadoAdmin, confirmarPagoPedidoWeb);
routes.post('/pedidos/:idPedido/cancelar', pWeb('EDIT'), csrfProtection, verificarCodigoEmpleadoAdmin, cancelarPedidoWeb);

export default routes;
