import express from 'express';
import verificarPermisoSesion from '../middlewares/verificarPermisoSesion.js';
const routes = express.Router();

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
routes.get('/categorias', pWeb('READ'), categoriasWeb);
routes.post('/categorias/toggle/:idCategoria', pWeb('EDIT'), toggleCategoriaWeb);
routes.post('/categorias/:idCategoria/imagen', pWeb('EDIT'), uploadImages.single('imagen'), subirImagenCategoria);
routes.post('/categorias/:idCategoria/imagen/quitar', pWeb('DELETE'), quitarImagenCategoria);

// Banners
const uploadImagenesBanner = uploadImages.fields([
    { name: 'imagen', maxCount: 1 },
    { name: 'imagenMovil', maxCount: 1 }
]);
routes.get('/banners', pWeb('READ'), listaBanners);
routes.post('/banners/crear', pWeb('CREATE'), uploadImagenesBanner, crearBanner);
routes.post('/banners/editar/:idBanner', pWeb('EDIT'), uploadImagenesBanner, actualizarBanner);
routes.post('/banners/eliminar/:idBanner', pWeb('DELETE'), eliminarBanner);

// Cenefas
routes.get('/cenefas', pWeb('READ'), listaCenefas);
routes.post('/cenefas/crear', pWeb('CREATE'), crearCenefa);
routes.post('/cenefas/editar/:idCenefa', pWeb('EDIT'), actualizarCenefa);
routes.post('/cenefas/eliminar/:idCenefa', pWeb('DELETE'), eliminarCenefa);

// Secciones
routes.get('/secciones', pWeb('READ'), listaSecciones);
routes.post('/secciones/crear', pWeb('CREATE'), uploadImages.single('imagen'), crearSeccion);
routes.post('/secciones/editar/:idSeccion', pWeb('EDIT'), uploadImages.single('imagen'), actualizarSeccion);
routes.post('/secciones/eliminar/:idSeccion', pWeb('DELETE'), eliminarSeccion);

// Popup
routes.get('/popup', pWeb('READ'), gestionPopup);
routes.post('/popup/editar/:idPopup', pWeb('EDIT'), uploadImages.single('imagen'), actualizarPopup);

// Tracking y etiquetas
routes.get('/tracking', pWeb('READ'), listaEtiquetas);
routes.post('/tracking/crear', pWeb('CREATE'), crearEtiqueta);
routes.post('/tracking/editar/:idEtiqueta', pWeb('EDIT'), actualizarEtiqueta);
routes.post('/tracking/eliminar/:idEtiqueta', pWeb('DELETE'), eliminarEtiqueta);

// Páginas secundarias
routes.get('/paginas', pWeb('READ'), listaPaginas);
routes.get('/paginas/nueva', pWeb('CREATE'), nuevaPaginaForm);
routes.get('/paginas/:idPagina/editar', pWeb('EDIT'), editarPaginaForm);
routes.post('/paginas/crear', pWeb('CREATE'), crearPagina);
routes.post('/paginas/:idPagina/editar', pWeb('EDIT'), actualizarPagina);
routes.post('/paginas/:idPagina/eliminar', pWeb('DELETE'), eliminarPagina);

// Pedidos web
routes.get('/pedidos', pWeb('READ'), paginaPedidosWeb);
routes.get('/pedidos/json', pWeb('READ'), jsonPedidosWeb);
routes.get('/pedidos/exportar', pWeb('READ'), exportarPedidosWeb);
routes.get('/pedidos/:idPedido', pWeb('READ'), paginaDetallePedidoWeb);
routes.get('/pedidos/:idPedido/json', pWeb('READ'), jsonDetallePedidoWeb);
routes.post('/pedidos/:idPedido/asignar-tienda', pWeb('EDIT'), asignarTiendaPedidoWeb);
// Cambios de estado hechos a mano: además de la verificación de origen exigen código de empleado, para que
// quede registrado quién dio el pedido por pagado o quién lo canceló.
routes.post('/pedidos/:idPedido/confirmar-pago', pWeb('EDIT'), verificarCodigoEmpleadoAdmin, confirmarPagoPedidoWeb);
routes.post('/pedidos/:idPedido/cancelar', pWeb('EDIT'), verificarCodigoEmpleadoAdmin, cancelarPedidoWeb);

export default routes;
