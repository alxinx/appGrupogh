import express from "express";
import csrf from 'csurf';
const routes = express.Router(); // 2. Definir router antes de usarlo
const csrfProtection = csrf({ cookie: true });
import { dashboard, dashboardStores, newStore, saveStoreBasic, verTienda, editarTienda, dashboardInventorys, storeInventory, billingToday, storeEmployers, storeDocuments, saveProduct, listaProductos, verProducto, stockTotalProducto, unidadesVendidasProducto, diasInventarioProducto, stockPorTiendaProducto, ventasHistoricoProducto, ventasPorTiendaProducto, editarProducto, batchBuyOrder, saveBatchOrder, dashboardCustomers, dashboardEmployees, newEmployer, saveEmployee,checkDocumentoPersonal,
checkEmailPersonal, filterEmployeeListJson, buscarEmpleadoPorCodigo, dashboardOrders, dashboardSupplier, newSupplier, verProveedor, actualizarProveedor, saveSupplier, checkNitSupplier, dashboardSettings, municipiosJson, categoriasJson, skuJson, eanJson, filterProductListJson, jsonImageProduct, jsonUnicidad, baseFrondend, filterSupplierListJson, filterStoreInventoryJson, imprimirEtiquetaSKU,
adminSseConnect, getTiendasStatsHoy, getTiendaStatsHoyDetalle, getFacturasJSON,
jsonPermisosRecursos, jsonPermisosAcciones,
verEmpleado, actualizarEmpleado, eliminarDocumentoEmpleado, cambiarEstadoEmpleado,
getPagosHoyPorMetodo,
listarEntidades, crearEntidad, toggleEntidad, verDetallesEntidad, editarEntidad, getTransaccionesEntidad,
getStatsVendedorMes,
getCajasCerradasAdmin,
getAdminCuadrePDF,
getStockBajoGlobal, getStockBajoPorTienda, getVentasPdv30d,
getClientesStats, filterClientesListJson, getClientePerfil, getClienteHistorial, getClienteArchivos, eliminarDocumentoCliente, activarCreditoCliente, newCliente, saveCliente, editarClienteForm, updateCliente, checkDocumentoCliente,
getFacturasPendientesProveedores, getDetalleFacturaPendiente, registrarAbonoProveedor, getTirillaAbonoProveedor,
storeCierresCaja, storeTrasladosTienda,
getCierresCajaListaJSON, getCierreCajaDatosJSON, getCierreFacturasJSON, getCierreEgresosJSON, getTrasladosTiendaJSON } from "../controller/adminControllers.js"
import { getTirillaPDF } from "../controller/storeControllers.js"
import { PuntosDeVenta } from "../models/index.js";

//CONTROLADOR DOSIFICACIOONES:
import { guardarDosificacion, homeDose, newDose, obtenerDosificacionesPaginadas, obtenerProductosPorDose, verDosificacion, obtenerMetadataDose, widgetGlobales, trasladarPacks, imprimirEtiquetasLote, imprimirEtiquetasPorPack, imprimirComprobanteTraslado, historialPack } from '../controller/dosificacionController.js'


import { storeRegisterValidation, storeBasicTaxDataValidation, productBasicValidation } from '../middlewares/fieldValidations.js';
import uploadImages from '../middlewares/uploadImages.js';
import uploadMixed from '../middlewares/uploadMixed.js'; // Importamos el middleware mixto
import apiRateLimit from '../middlewares/apiRateLimit.js';



//*********************************[GETS ROUTES]**********************************/

routes.get("/", dashboard);

//TIENDAS
routes.get('/tiendas', dashboardStores);
routes.get('/tiendas/new', newStore);
routes.get('/tiendas/ver/:idPuntoDeVenta', verTienda);
routes.get('/tiendas/partials/facturacionHoy/:idPuntoDeVenta', billingToday)
routes.get('/tiendas/partials/inventario/:idPuntoDeVenta', storeInventory)
routes.get('/tiendas/partials/empleados/:idPuntoDeVenta', storeEmployers)
routes.get('/tiendas/partials/documentacion/:idPuntoDeVenta', storeDocuments)
routes.get('/tiendas/partials/cierresCaja/:idPuntoDeVenta',   storeCierresCaja)
routes.get('/tiendas/partials/traslados/:idPuntoDeVenta',     storeTrasladosTienda)

//routes.get('/tiendas/nueva',newStore);
//routes.get('/tiendas/verPunto/:idPuntoDeVenta',verTienda);
routes.get('/tiendas/editar/:idPuntoDeVenta', editarTienda);


//INVENTARIOS Y PRODUCTOS.
routes.get('/inventario/ingreso', csrfProtection, dashboardInventorys);
routes.get('/inventario/listado', listaProductos);
routes.get('/inventario/ver/:idProducto', verProducto)
routes.get('/inventario/editar/:idProducto', editarProducto)
routes.get('/inventario/batch/', batchBuyOrder)
routes.post('/inventario/batch/',
    uploadMixed.fields([{ name: 'facturas', maxCount: 5 }]),
    csrfProtection,
    saveBatchOrder
)
routes.get('/inventario/etiqueta-sku/:idProducto', imprimirEtiquetaSKU)


//ENTIDADES BANCARIAS
routes.get('/bankentities/listado', csrfProtection, listarEntidades);
routes.post('/bankentities/crear', csrfProtection, crearEntidad);
routes.post('/bankentities/toggle/:id', csrfProtection, toggleEntidad);
routes.get('/bankentities/detallesEntidad/:idEntidad', csrfProtection, verDetallesEntidad);
routes.post('/bankentities/editar/:idEntidad', csrfProtection, editarEntidad);
routes.get('/api/bankentities/:idEntidad/transacciones', getTransaccionesEntidad);

//PROVEDORES
routes.get('/provedores/', dashboardSupplier);
routes.get('/provedores/new/', newSupplier);
routes.get('/provedores/ver/:idProveedor', csrfProtection, verProveedor);
routes.post('/provedores/editar/:idProveedor', csrfProtection, actualizarProveedor);
routes.get('/api/provedores/facturas-pendientes', getFacturasPendientesProveedores);
routes.get('/api/provedores/factura/:idFacturaPro/detalle', getDetalleFacturaPendiente);
routes.post('/api/provedores/factura/:idFacturaPro/abonar', registrarAbonoProveedor);
routes.get('/api/provedores/abono/:idCuentaPorPagar/tirilla', getTirillaAbonoProveedor);


//EMPLEADOS
routes.get('/personal', dashboardEmployees);
routes.get('/personal/new', newEmployer);
routes.post('/personal/new', uploadMixed.fields([
    { name: 'fotoEmpleado', maxCount: 1 },
    { name: 'documentos', maxCount: 10 }
]), saveEmployee);

routes.get('/personal/ver/:idEmpleado', verEmpleado);
routes.post('/personal/ver/:idEmpleado', uploadMixed.fields([
    { name: 'fotoEmpleado', maxCount: 1 },
    { name: 'documentos', maxCount: 10 }
]), actualizarEmpleado);
routes.post('/personal/documentos/eliminar/:idDocumento', csrfProtection, eliminarDocumentoEmpleado);
routes.post('/personal/estado/:idEmpleado', csrfProtection, cambiarEstadoEmpleado);



routes.get('/clientes', dashboardCustomers);
routes.get('/clientes/nuevo', newCliente);
routes.post('/clientes/nuevo', uploadMixed.fields([{ name: 'documentos', maxCount: 10 }]), saveCliente);
routes.get('/clientes/editar/:idCliente', editarClienteForm);
routes.post('/clientes/editar/:idCliente', uploadMixed.fields([{ name: 'documentos', maxCount: 10 }]), updateCliente);
routes.get('/api/clientes/stats', getClientesStats);
routes.get('/api/clientes/check-doc/:numero', checkDocumentoCliente);
routes.get('/json/clientes/lista', filterClientesListJson);
routes.get('/api/clientes/:idCliente/perfil',    getClientePerfil);
routes.get('/api/clientes/:idCliente/historial', getClienteHistorial);
routes.get('/api/clientes/:idCliente/archivos',  getClienteArchivos);
routes.post('/api/clientes/archivos/:idDocumento/eliminar', eliminarDocumentoCliente);
routes.post('/api/clientes/:idCliente/credito', activarCreditoCliente);

routes.get('/pedidos', dashboardOrders);
routes.get('/configuracion', dashboardSettings);


routes.get('/frontend', baseFrondend);


//****************[POST]**********************/
//routes.post('/tiendas/nueva',csrfProtection, storeRegisterValidation, storeBasicTaxDataValidation, postNuevaTienda)
routes.post('/tiendas/new/', saveStoreBasic)


routes.post('/inventario/ingreso',
    uploadImages.array('imagenes', 10),
    csrfProtection,
    productBasicValidation,
    saveProduct
);

// RUTA PARA GUARDAR PROVEDOR
routes.post('/provedores/new',
    uploadMixed.array('documentos', 10), // Usamos el nuevo middleware
    csrfProtection,
    saveSupplier
);


//Ruta para la dosificacion
routes.get('/dosificaciones/', homeDose); //DASHBOARD
routes.get('/dosificaciones/new/', newDose);//Load paginna guardar
routes.post('/dosificaciones/guardar', guardarDosificacion)
routes.get('/dosificaciones/ver/:idDosificacion', verDosificacion)
routes.post('/dosificaciones/trasladar', csrfProtection, trasladarPacks);








routes.post('/inventario/editar/:idProducto',
    uploadImages.array('imagenes', 10),
    csrfProtection,
    productBasicValidation,
    saveProduct);


/************************[JSON]******************************/

routes.use('/json', apiRateLimit);
routes.use('/api', apiRateLimit);

routes.get('/json/municipios/:departamentoId', municipiosJson)
routes.get('/json/categorias/:idCategoria', categoriasJson);
routes.get('/json/sku/:checkSku', skuJson);
routes.get('/json/ean/:checkEan', eanJson);
routes.get('/json/productos/', filterProductListJson)
routes.get('/json/imageProduct/:idProducto', jsonImageProduct)
routes.get('/json/unicidad/:tipo/:valor', jsonUnicidad)
routes.get('/json/personal/documento/:tipo/:numero', checkDocumentoPersonal);
routes.get('/json/personal/email/:email', checkEmailPersonal);
routes.get('/json/personal/lista', filterEmployeeListJson);
routes.get('/json/personal/codigo/:codigo', buscarEmpleadoPorCodigo);
routes.get('/json/permisos/recursos/:tipo', jsonPermisosRecursos);
routes.get('/json/permisos/acciones', jsonPermisosAcciones);
routes.get('/json/provedores/', filterSupplierListJson);
routes.get('/json/inventario-tienda/:idPuntoDeVenta', filterStoreInventoryJson);
routes.get('/json/tiendas/', async (req, res) => {
    const tiendas = await PuntosDeVenta.findAll({ attributes: ['idPuntoDeVenta', 'nombreComercial'] });
    res.json(tiendas);
});

// SSE admin
routes.get('/sse', adminSseConnect);

// Stats tiendas hoy
routes.get('/api/tiendas/stats-hoy', getTiendasStatsHoy);
routes.get('/api/personal/:idEmpleado/stats-mes', getStatsVendedorMes);
routes.get('/api/tiendas/:idPuntoDeVenta/stats-hoy-detalle', getTiendaStatsHoyDetalle);
routes.get('/api/tiendas/:idPuntoDeVenta/facturas', getFacturasJSON);
routes.get('/api/tiendas/:idPuntoDeVenta/cajas-cerradas', getCajasCerradasAdmin);
routes.get('/api/tiendas/:idPuntoDeVenta/cierres-lista',  getCierresCajaListaJSON);
routes.get('/api/tiendas/:idPuntoDeVenta/cierre/:idCajaTienda',           getCierreCajaDatosJSON);
routes.get('/api/tiendas/:idPuntoDeVenta/cierre/:idCajaTienda/facturas',  getCierreFacturasJSON);
routes.get('/api/tiendas/:idPuntoDeVenta/cierre/:idCajaTienda/egresos',   getCierreEgresosJSON);
routes.get('/api/tiendas/:idPuntoDeVenta/traslados',      getTrasladosTiendaJSON);
routes.get('/tiendas/:idPuntoDeVenta/cuadre/:idCajaTienda/pdf', getAdminCuadrePDF);
routes.get('/api/tiendas/:idPuntoDeVenta/pagos-hoy/:metodoPago', getPagosHoyPorMetodo);
routes.get('/api/factura/:id/tirilla', getTirillaPDF);

// API CHECKS
routes.get('/api/check-nit/:nit', checkNitSupplier);
routes.get('/api/inventario/:idProducto/stock-total', stockTotalProducto);
routes.get('/api/inventario/:idProducto/unidades-vendidas', unidadesVendidasProducto);
routes.get('/api/inventario/:idProducto/dias-inventario', diasInventarioProducto);
routes.get('/api/inventario/:idProducto/stock-por-tienda', stockPorTiendaProducto);
routes.get('/api/inventario/:idProducto/ventas-historico', ventasHistoricoProducto);
routes.get('/api/inventario/:idProducto/ventas-por-tienda', ventasPorTiendaProducto);


// DASHBOARD PRINCIPAL
routes.get('/api/dashboard/stock-bajo-global',    getStockBajoGlobal);
routes.get('/api/dashboard/stock-bajo-por-tienda', getStockBajoPorTienda);
routes.get('/api/dashboard/ventas-pdv-30d',        getVentasPdv30d);

routes.get('/api/dosificaciones/stats-global', widgetGlobales);
routes.get('/api/pack/:idPack/historial', historialPack);

routes.get('/api/dosificaciones/productos/:id', obtenerProductosPorDose);
routes.get('/api/dosificaciones/metadata/:id', obtenerMetadataDose);
routes.get('/dosificaciones/etiquetas/unica/:idPack/', imprimirEtiquetasPorPack);
routes.get('/dosificaciones/comprobante/:idTraslado', imprimirComprobanteTraslado);

routes.get('/dosificaciones/etiquetas/:idDosificacion/:numLote', imprimirEtiquetasLote);
routes.get('/api/dosificaciones/:query', obtenerDosificacionesPaginadas)








export default routes