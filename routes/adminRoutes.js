import express from "express";
import csrf from 'csurf';
const routes = express.Router(); // 2. Definir router antes de usarlo
const csrfProtection = csrf({ cookie: true });
import { dashboard, dashboardStores, newStore, saveStoreBasic, verTienda, editarTienda, dashboardInventorys, storeInventory, billingToday, storeEmployers, storeDocuments, saveProduct, listaProductos, verProducto, stockTotalProducto, unidadesVendidasProducto, diasInventarioProducto, stockPorTiendaProducto, ventasHistoricoProducto, ventasPorTiendaProducto, editarProducto, batchBuyOrder, saveBatchOrder, dashboardCustomers, dashboardEmployees, newEmployer, saveEmployee,checkDocumentoPersonal,
checkEmailPersonal, filterEmployeeListJson, buscarEmpleadoPorCodigo, dashboardOrders, dashboardSupplier, newSupplier, verProveedor, actualizarProveedor, saveSupplier, checkNitSupplier, dashboardSettings, municipiosJson, categoriasJson, skuJson, eanJson, familiaSugerenciasJson, filterProductListJson, jsonImageProduct, jsonUnicidad, baseFrondend, filterSupplierListJson, filterStoreInventoryJson, imprimirEtiquetaSKU,
adminSseConnect, getTiendasStatsHoy, getTiendaStatsHoyDetalle, getFacturasJSON, exportarFacturasTienda, getCajasAbiertasPorFecha, autorizarFacturaExtemporanea,
jsonPermisosRecursos, jsonPermisosAcciones,
verEmpleado, actualizarEmpleado, eliminarDocumentoEmpleado, cambiarEstadoEmpleado,
getPagosHoyPorMetodo,
destrabarCuadreTienda, listarEntidades, crearEntidad, crearCajaBanco, getCajaBancoEditar, editarCajaBanco, verPerfilCajaBanco, decidirTrasladoEfectivo, validarEmpleadoBancos, getTrasladoPDFAdmin, getMovimientosCuentaJSON, crearMovimientoCuenta, exportarMovimientosCuenta, toggleEntidad, verDetallesEntidad, editarEntidad, getTransaccionesEntidad,
getStatsVendedorMes,
getCajasCerradasAdmin,
getAdminCuadrePDF,
getStockBajoGlobal, getStockBajoPorTienda, getVentasPdv30d, getCarteraUrgente,
getClientesStats, filterClientesListJson, getClientePerfil, getClienteHistorial, getClienteArchivos, eliminarDocumentoCliente, activarCreditoCliente, newCliente, saveCliente, editarClienteForm, updateCliente, checkDocumentoCliente,
getFacturasPendientesProveedores, getDetalleFacturaPendiente, registrarAbonoProveedor, getTirillaAbonoProveedor,
storeCierresCaja, storeTrasladosTienda,
getCierresCajaListaJSON, getCierreCajaDatosJSON, getCierreFacturasJSON, getCierreEgresosJSON, getTrasladosTiendaJSON,
getTiendaDocumentos, subirDocumentoTienda, eliminarDocumentoTienda,
trasladarProductoAdmin } from "../controller/adminControllers.js"
import { getTirillaPDF } from "../controller/storeControllers.js"
import { subirQrEntidad, toggleQrEntidad, previewQrEntidad } from "../controller/qrPagoControllers.js"
import { PuntosDeVenta } from "../models/index.js";

//CONTROLADOR DOSIFICACIOONES:
import { guardarDosificacion, homeDose, newDose, obtenerDosificacionesPaginadas, obtenerProductosPorDose, verDosificacion, obtenerMetadataDose, widgetGlobales, trasladarPacks, imprimirEtiquetasLote, imprimirEtiquetasPorPack, imprimirComprobanteTraslado, historialPack, imprimirGuiaEmpaque } from '../controller/dosificacionController.js'

//CONTROLADOR IMPORTACIONES:
import { formularioImportaciones, procesarImportacionExcel } from '../controller/importacionesController.js'


import { storeRegisterValidation, storeBasicTaxDataValidation, productBasicValidation, cajaBancoValidation, cajaBancoEditValidation } from '../middlewares/fieldValidations.js';
import verificarCodigoEmpleadoAdmin from '../middlewares/verificarCodigoEmpleadoAdmin.js';
import verificarPermisoEmpleado from '../middlewares/verificarPermisoEmpleado.js';
import verificarPermisoSesion from '../middlewares/verificarPermisoSesion.js';

// ─────────────────────────────────────────────────────────────────────────────
// Permisos por módulo.
//
// `permisosAdmin` decide a qué CARPETA puede entrar un usuario. Esto decide QUÉ puede
// hacer adentro: alguien con READ sobre productos ve el listado y la ficha, pero el
// formulario de alta le responde 403 aunque escriba la URL a mano.
//
// Va también en las rutas /api y /json, y ahí es donde más importa: el filtro de carpeta
// solo mira páginas, así que sin esto un usuario sin acceso a Personal igual podía pedir
// `/admin/json/personal/lista` y traerse la nómina entera.
//
// Un alias corto por módulo porque son más de cien rutas: la cadena larga repetida cien
// veces se desincroniza a la primera corrección.
// ─────────────────────────────────────────────────────────────────────────────
const perm = (recurso) => (accion) => verificarPermisoSesion(recurso, 'administrativo', accion);

const pInv = perm('Inventario y Productos');
const pTie = perm('tiendas');
const pBan = perm('Bancos');
const pPro = perm('Provedores');
const pPer = perm('Personal');
const pCli = perm('Clientes');
const pPed = perm('Pedidos y Reparto');
const pCfg = perm('Settings');
const pDos = perm('Dosificación y Repartos');
import uploadImages, { MAX_IMAGENES } from '../middlewares/uploadImages.js';
import uploadMixed from '../middlewares/uploadMixed.js'; // Importamos el middleware mixto
import { recibirQr } from '../middlewares/uploadQr.js';
import qrUploadRateLimit from '../middlewares/qrUploadRateLimit.js';
import apiRateLimit from '../middlewares/apiRateLimit.js';
import { subirComprobantesMovimiento } from '../middlewares/uploadComprobantes.js';
import uploadExcel from '../middlewares/uploadExcel.js';



//*********************************[GETS ROUTES]**********************************/

routes.get("/", dashboard);

//TIENDAS
routes.get('/tiendas', pTie('READ'), dashboardStores);
routes.get('/tiendas/new', pTie('CREATE'), newStore);
routes.get('/tiendas/ver/:idPuntoDeVenta', pTie('READ'), verTienda);

// Suelta a mano una caja trabada en cuadre. Va con CSRF y con el mismo permiso que
// editar la tienda: quien puede administrarla puede destrabarle la caja.
routes.post('/tiendas/:idPuntoDeVenta/destrabar-cuadre',
    csrfProtection,
    verificarPermisoSesion('tiendas', 'administrativo', 'EDIT'),
    destrabarCuadreTienda);
routes.get('/tiendas/partials/facturacionHoy/:idPuntoDeVenta', pTie('READ'), csrfProtection, billingToday)
routes.get('/tiendas/partials/inventario/:idPuntoDeVenta', pTie('READ'), storeInventory)
routes.get('/tiendas/partials/empleados/:idPuntoDeVenta', pTie('READ'), storeEmployers)
routes.get('/tiendas/partials/documentacion/:idPuntoDeVenta', pTie('READ'), storeDocuments)
routes.get('/tiendas/partials/cierresCaja/:idPuntoDeVenta', pTie('READ'),   storeCierresCaja)
routes.get('/tiendas/partials/traslados/:idPuntoDeVenta', pTie('READ'),     storeTrasladosTienda)

//routes.get('/tiendas/nueva',newStore);
//routes.get('/tiendas/verPunto/:idPuntoDeVenta',verTienda);
routes.get('/tiendas/editar/:idPuntoDeVenta', pTie('EDIT'), editarTienda);


//INVENTARIOS Y PRODUCTOS.
routes.get('/inventario/ingreso', csrfProtection, pInv('CREATE'), dashboardInventorys);
routes.get('/inventario/listado', pInv('READ'), listaProductos);
routes.get('/inventario/ver/:idProducto', pInv('READ'), verProducto)
routes.get('/inventario/editar/:idProducto', pInv('EDIT'), editarProducto)
routes.get('/inventario/batch/', pInv('CREATE'), batchBuyOrder)
routes.post('/inventario/batch/', pInv('CREATE'),
    uploadMixed.fields([{ name: 'facturas', maxCount: 5 }]),
    csrfProtection,
    saveBatchOrder
)
routes.get('/inventario/etiqueta-sku/:idProducto', pInv('READ'), imprimirEtiquetaSKU)


//ENTIDADES BANCARIAS
routes.get('/bankentities/listado', pBan('READ'), csrfProtection, listarEntidades);
routes.post('/bankentities/crear', pBan('CREATE'), csrfProtection, crearEntidad);

// CAJAS Y BANCOS — la validación va antes del controlador: un cuerpo inválido no
// llega a tocar la base.
routes.post('/bankentities/cajas/crear', pBan('CREATE'), csrfProtection, cajaBancoValidation, crearCajaBanco);

// Perfil de una caja o banco con sus movimientos.
routes.get('/bankentities/cajas/:idCajaBanco', pBan('READ'), csrfProtection, verPerfilCajaBanco);

// Aceptar, rechazar o aceptar parcialmente un traslado de efectivo.
//
// Dos middlewares, y hacen falta los dos:
//
//   · verificarCodigoEmpleadoAdmin — QUIÉN toma la decisión. La bitácora tiene que
//     nombrar a una persona, no solo al usuario del panel desde el que se hizo clic.
//     Pero solo comprueba que el código exista y que el empleado no esté suspendido:
//     con eso alcanzaba cualquier código de cualquier tienda, incluido el de un
//     vendedor, para asentar plata en una cuenta del negocio.
//   · verificarPermisoEmpleado('Bancos', …, 'EDIT') — SI ESA PERSONA PUEDE. Aceptar un
//     traslado mueve el saldo de una caja o un banco; es la misma autoridad que se
//     necesita para registrar un movimiento a mano, y por eso pide el recurso Bancos.
routes.post('/bankentities/traslados/:idTraslado/decidir',
    csrfProtection,
    verificarCodigoEmpleadoAdmin,
    verificarPermisoEmpleado('Bancos', 'administrativo', 'EDIT'),
    decidirTrasladoEfectivo);
routes.get('/bankentities/traslados/:idTraslado/pdf', pBan('READ'), getTrasladoPDFAdmin);

// Comprueba el código ANTES de decidir, para no habilitar un botón que el servidor va a
// rechazar. Pasa por apiRateLimit: aunque solo llega un administrador, un código de
// empleado son cinco dígitos y probarlos en bucle no debe salir gratis.
routes.get('/bankentities/empleado/validar/:codigo', pBan('READ'), apiRateLimit, validarEmpleadoBancos);
routes.get('/bankentities/cajas/:idCajaBanco/editar', pBan('EDIT'), csrfProtection, getCajaBancoEditar);
routes.post('/bankentities/cajas/:idCajaBanco/editar', pBan('EDIT'), csrfProtection, cajaBancoEditValidation, editarCajaBanco);
routes.get('/bankentities/cajas/:idCajaBanco/movimientos', pBan('READ'), getMovimientosCuentaJSON);
routes.get('/bankentities/cajas/:idCajaBanco/movimientos/export', pBan('READ'), exportarMovimientosCuenta);
// Los comprobantes van en memoria antes de subirse a R2, por eso el límite de multer.
routes.post('/bankentities/cajas/:idCajaBanco/movimientos', pBan('CREATE'), csrfProtection, subirComprobantesMovimiento, crearMovimientoCuenta);
routes.post('/bankentities/toggle/:id', pBan('EDIT'), csrfProtection, toggleEntidad);
routes.get('/bankentities/detallesEntidad/:idEntidad', pBan('READ'), csrfProtection, verDetallesEntidad);
routes.post('/bankentities/editar/:idEntidad', pBan('EDIT'), csrfProtection, editarEntidad);

// QR de pago web — solo admin autenticado (la app monta este router detrás de
// rutaProtegida + verificarRol('ADMIN')). El rate limit va antes de multer para
// no gastar ancho de banda ni memoria en subidas que ya están por encima del tope.
routes.get('/bankentities/:idEntidad/qr', pBan('READ'), csrfProtection, previewQrEntidad);
routes.post('/bankentities/:idEntidad/qr', pBan('EDIT'), qrUploadRateLimit, recibirQr, subirQrEntidad);
routes.post('/bankentities/:idEntidad/qr/toggle', pBan('EDIT'), csrfProtection, toggleQrEntidad);
routes.get('/api/bankentities/:idEntidad/transacciones', pBan('READ'), getTransaccionesEntidad);

//PROVEDORES
routes.get('/provedores/', pPro('READ'), dashboardSupplier);
routes.get('/provedores/new/', pPro('CREATE'), newSupplier);
routes.get('/provedores/ver/:idProveedor', pPro('READ'), csrfProtection, verProveedor);
routes.post('/provedores/editar/:idProveedor', pPro('EDIT'), csrfProtection, actualizarProveedor);
routes.get('/api/provedores/facturas-pendientes', pPro('READ'), getFacturasPendientesProveedores);
routes.get('/api/provedores/factura/:idFacturaPro/detalle', pPro('READ'), getDetalleFacturaPendiente);
routes.post('/api/provedores/factura/:idFacturaPro/abonar', pPro('EDIT'), registrarAbonoProveedor);
routes.get('/api/provedores/abono/:idCuentaPorPagar/tirilla', pPro('READ'), getTirillaAbonoProveedor);


//EMPLEADOS
routes.get('/personal', pPer('READ'), dashboardEmployees);
routes.get('/personal/new', pPer('CREATE'), newEmployer);
routes.post('/personal/new', pPer('CREATE'), uploadMixed.fields([
    { name: 'fotoEmpleado', maxCount: 1 },
    { name: 'documentos', maxCount: 10 }
]), saveEmployee);

routes.get('/personal/ver/:idEmpleado', pPer('READ'), verEmpleado);
routes.post('/personal/ver/:idEmpleado', pPer('EDIT'), uploadMixed.fields([
    { name: 'fotoEmpleado', maxCount: 1 },
    { name: 'documentos', maxCount: 10 }
]), actualizarEmpleado);
routes.post('/personal/documentos/eliminar/:idDocumento', pPer('DELETE'), csrfProtection, eliminarDocumentoEmpleado);
routes.post('/personal/estado/:idEmpleado', pPer('EDIT'), csrfProtection, cambiarEstadoEmpleado);



routes.get('/clientes', pCli('READ'), dashboardCustomers);
routes.get('/clientes/nuevo', pCli('CREATE'), newCliente);
routes.post('/clientes/nuevo', pCli('CREATE'), uploadMixed.fields([{ name: 'documentos', maxCount: 10 }]), saveCliente);
routes.get('/clientes/editar/:idCliente', pCli('EDIT'), editarClienteForm);
routes.post('/clientes/editar/:idCliente', pCli('EDIT'), uploadMixed.fields([{ name: 'documentos', maxCount: 10 }]), updateCliente);
routes.get('/api/clientes/stats', pCli('READ'), getClientesStats);
routes.get('/api/clientes/check-doc/:numero', pCli('READ'), checkDocumentoCliente);
routes.get('/json/clientes/lista', pCli('READ'), filterClientesListJson);
routes.get('/api/clientes/:idCliente/perfil', pCli('READ'),    getClientePerfil);
routes.get('/api/clientes/:idCliente/historial', pCli('READ'), getClienteHistorial);
routes.get('/api/clientes/:idCliente/archivos', pCli('READ'),  getClienteArchivos);
routes.post('/api/clientes/archivos/:idDocumento/eliminar', pCli('DELETE'), eliminarDocumentoCliente);
routes.post('/api/clientes/:idCliente/credito', pCli('EDIT'), activarCreditoCliente);

routes.get('/pedidos', pPed('READ'), dashboardOrders);
routes.get('/configuracion', pCfg('READ'), dashboardSettings);
routes.get('/configuracion/importaciones', pCfg('READ'), formularioImportaciones);
routes.post('/configuracion/importaciones',
    pCfg('CREATE'),
    uploadExcel.single('archivo'),
    csrfProtection,
    procesarImportacionExcel);


routes.get('/frontend', baseFrondend);


//****************[POST]**********************/
//routes.post('/tiendas/nueva',csrfProtection, storeRegisterValidation, storeBasicTaxDataValidation, postNuevaTienda)
routes.post('/tiendas/new/', pTie('CREATE'), saveStoreBasic)


routes.post('/inventario/ingreso',
    uploadImages.array('imagenes', MAX_IMAGENES),
    csrfProtection,
    pInv('CREATE'),
    productBasicValidation,
    saveProduct
);

// RUTA PARA GUARDAR PROVEDOR
routes.post('/provedores/new', pPro('CREATE'),
    uploadMixed.array('documentos', 10), // Usamos el nuevo middleware
    csrfProtection,
    saveSupplier
);


//Ruta para la dosificacion
routes.get('/dosificaciones/', pDos('READ'), homeDose); //DASHBOARD
routes.get('/dosificaciones/new/', pDos('CREATE'), newDose);//Load paginna guardar
routes.post('/dosificaciones/guardar', pDos('CREATE'), guardarDosificacion)
routes.get('/dosificaciones/ver/:idDosificacion', pDos('READ'), verDosificacion)
routes.post('/dosificaciones/trasladar', pDos('EDIT'), csrfProtection, trasladarPacks);








routes.post('/inventario/editar/:idProducto',
    uploadImages.array('imagenes', MAX_IMAGENES),
    csrfProtection,
    pInv('EDIT'),
    productBasicValidation,
    saveProduct);


/************************[JSON]******************************/

routes.use('/json', apiRateLimit);
routes.use('/api', apiRateLimit);

//- Consultas de referencia y de unicidad. Quedan SIN permiso de módulo a propósito: las
//- usan los formularios de casi todos los módulos —municipios en la ficha de un cliente y
//- en la de una tienda, la verificación de SKU al crear un producto— y atarlas a un
//- recurso rompería el formulario del módulo vecino. No exponen datos de negocio: devuelven
//- catálogos públicos o un sí/no de "este valor ya está usado".
routes.get('/json/municipios/:departamentoId', municipiosJson)
routes.get('/json/categorias/:idCategoria', categoriasJson);
routes.get('/json/sku/:checkSku', skuJson);
routes.get('/json/ean/:checkEan', eanJson);
// Sugerencia de familia mientras se escribe el nombre del producto (querystring, no params:
// el nombre lleva espacios y acentos).
routes.get('/json/familia/sugerencias', pInv('READ'), familiaSugerenciasJson);
routes.get('/json/productos/', pInv('READ'), filterProductListJson)
routes.get('/json/imageProduct/:idProducto', pInv('READ'), jsonImageProduct)
routes.get('/json/unicidad/:tipo/:valor', jsonUnicidad)
routes.get('/json/personal/documento/:tipo/:numero', pPer('READ'), checkDocumentoPersonal);
routes.get('/json/personal/email/:email', pPer('READ'), checkEmailPersonal);
routes.get('/json/personal/lista', pPer('READ'), filterEmployeeListJson);
routes.get('/json/personal/codigo/:codigo', pPer('READ'), buscarEmpleadoPorCodigo);
routes.get('/json/permisos/recursos/:tipo', pPer('READ'), jsonPermisosRecursos);
routes.get('/json/permisos/acciones', pPer('READ'), jsonPermisosAcciones);
routes.get('/json/provedores/', pPro('READ'), filterSupplierListJson);
routes.get('/json/inventario-tienda/:idPuntoDeVenta', pTie('READ'), filterStoreInventoryJson);
routes.get('/json/tiendas/', async (req, res) => {
    const tiendas = await PuntosDeVenta.findAll({ attributes: ['idPuntoDeVenta', 'nombreComercial'] });
    res.json(tiendas);
});

// SSE admin
routes.get('/sse', adminSseConnect);

// Stats tiendas hoy
routes.get('/api/tiendas/stats-hoy', pTie('READ'), getTiendasStatsHoy);
routes.get('/api/personal/:idEmpleado/stats-mes', pPer('READ'), getStatsVendedorMes);
routes.get('/api/tiendas/:idPuntoDeVenta/stats-hoy-detalle', pTie('READ'), getTiendaStatsHoyDetalle);
routes.get('/api/tiendas/:idPuntoDeVenta/facturas', pTie('READ'), getFacturasJSON);
routes.get('/api/tiendas/:idPuntoDeVenta/facturas/export', pTie('READ'), exportarFacturasTienda);
routes.get('/api/tiendas/:idPuntoDeVenta/cajas-abiertas', pTie('READ'), getCajasAbiertasPorFecha);
routes.post('/api/tiendas/:idPuntoDeVenta/autorizar-factura-extemporanea', pTie('EDIT'), csrfProtection, autorizarFacturaExtemporanea);
routes.get('/api/tiendas/:idPuntoDeVenta/cajas-cerradas', pTie('READ'), getCajasCerradasAdmin);
routes.get('/api/tiendas/:idPuntoDeVenta/cierres-lista', pTie('READ'),  getCierresCajaListaJSON);
routes.get('/api/tiendas/:idPuntoDeVenta/cierre/:idCajaTienda', pTie('READ'),           getCierreCajaDatosJSON);
routes.get('/api/tiendas/:idPuntoDeVenta/cierre/:idCajaTienda/facturas', pTie('READ'),  getCierreFacturasJSON);
routes.get('/api/tiendas/:idPuntoDeVenta/cierre/:idCajaTienda/egresos', pTie('READ'),   getCierreEgresosJSON);
routes.get('/api/tiendas/:idPuntoDeVenta/traslados', pTie('READ'),      getTrasladosTiendaJSON);
routes.get('/tiendas/:idPuntoDeVenta/cuadre/:idCajaTienda/pdf', pTie('READ'), getAdminCuadrePDF);
routes.get('/api/tiendas/:idPuntoDeVenta/pagos-hoy/:metodoPago', pTie('READ'), getPagosHoyPorMetodo);
routes.get('/api/tiendas/:idPuntoDeVenta/documentos', pTie('READ'),                           getTiendaDocumentos);
routes.post('/api/tiendas/:idPuntoDeVenta/documentos/subir', pTie('EDIT'), uploadMixed.array('documentos', 10), subirDocumentoTienda);
routes.post('/api/tiendas/documentos/:idDocumento/eliminar', pTie('DELETE'),                    eliminarDocumentoTienda);
routes.get('/api/factura/:id/tirilla', pTie('READ'), getTirillaPDF);

// API CHECKS
routes.get('/api/check-nit/:nit', checkNitSupplier);
routes.get('/api/inventario/:idProducto/stock-total', pInv('READ'), stockTotalProducto);
routes.get('/api/inventario/:idProducto/unidades-vendidas', pInv('READ'), unidadesVendidasProducto);
routes.get('/api/inventario/:idProducto/dias-inventario', pInv('READ'), diasInventarioProducto);
routes.get('/api/inventario/:idProducto/stock-por-tienda', pInv('READ'), stockPorTiendaProducto);
routes.get('/api/inventario/:idProducto/ventas-historico', pInv('READ'), ventasHistoricoProducto);
routes.get('/api/inventario/:idProducto/ventas-por-tienda', pInv('READ'), ventasPorTiendaProducto);
routes.post('/api/inventario/:idProducto/traslado', pInv('EDIT'), csrfProtection, trasladarProductoAdmin);


// DASHBOARD PRINCIPAL
routes.get('/api/dashboard/stock-bajo-global', pInv('READ'),    getStockBajoGlobal);
routes.get('/api/dashboard/stock-bajo-por-tienda', pInv('READ'), getStockBajoPorTienda);
routes.get('/api/dashboard/ventas-pdv-30d', pTie('READ'),        getVentasPdv30d);
routes.get('/api/dashboard/cartera-urgente', pPro('READ'),       getCarteraUrgente);

routes.get('/api/dosificaciones/stats-global', pDos('READ'), widgetGlobales);
routes.get('/api/pack/:idPack/historial', pDos('READ'), historialPack);

routes.get('/api/dosificaciones/productos/:id', pDos('READ'), obtenerProductosPorDose);
routes.get('/api/dosificaciones/metadata/:id', pDos('READ'), obtenerMetadataDose);
routes.get('/dosificaciones/etiquetas/unica/:idPack/', pDos('READ'), imprimirEtiquetasPorPack);
routes.get('/dosificaciones/comprobante/:idTraslado', pDos('READ'), imprimirComprobanteTraslado);
routes.get('/dosificaciones/guia/:idDosificacion', pDos('READ'), imprimirGuiaEmpaque);

routes.get('/dosificaciones/etiquetas/:idDosificacion/:numLote', pDos('READ'), imprimirEtiquetasLote);
routes.get('/api/dosificaciones/:query', pDos('READ'), obtenerDosificacionesPaginadas)








export default routes