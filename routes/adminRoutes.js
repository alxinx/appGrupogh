import express from "express";
import csrf from 'csurf';
const routes = express.Router(); // 2. Definir router antes de usarlo
const csrfProtection = csrf({ cookie: true });
import { dashboard, dashboardStores, newStore, saveStoreBasic, verTienda, editarTienda, dashboardInventorys, storeInventory, billingToday, storeEmployers, storeDocuments, saveProduct, listaProductos, verProducto, editarProducto, batchBuyOrder, dashboardCustomers, dashboardEmployees, newEmployer, saveEmployee,checkDocumentoPersonal,
checkEmailPersonal, dashboardOrders, dashboardSupplier, newSupplier, saveSupplier, checkNitSupplier, dashboardSettings, municipiosJson, categoriasJson, skuJson, eanJson, filterProductListJson, jsonImageProduct, jsonUnicidad, baseFrondend, filterSupplierListJson, filterStoreInventoryJson } from "../controller/adminControllers.js"
import { PuntosDeVenta } from "../models/index.js";

//CONTROLADOR DOSIFICACIOONES:
import { guardarDosificacion, homeDose, newDose, obtenerDosificacionesPaginadas, obtenerProductosPorDose, verDosificacion, obtenerMetadataDose, widgetGlobales, trasladarPacks, imprimirEtiquetasLote, imprimirEtiquetasPorPack } from '../controller/dosificacionController.js'


import { storeRegisterValidation, storeBasicTaxDataValidation, productBasicValidation } from '../middlewares/fieldValidations.js';
import uploadImages from '../middlewares/uploadImages.js';
import uploadMixed from '../middlewares/uploadMixed.js'; // Importamos el middleware mixto



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

//routes.get('/tiendas/nueva',newStore);
//routes.get('/tiendas/verPunto/:idPuntoDeVenta',verTienda);
routes.get('/tiendas/editar/:idPuntoDeVenta', editarTienda);


//INVENTARIOS Y PRODUCTOS.
routes.get('/inventario/ingreso', csrfProtection, dashboardInventorys);
routes.get('/inventario/listado', listaProductos);
routes.get('/inventario/ver/:idProducto', verProducto)
routes.get('/inventario/editar/:idProducto', editarProducto)
routes.get('/inventario/batch/', batchBuyOrder)


//PROVEDORES
routes.get('/provedores/', dashboardSupplier);
routes.get('/provedores/new/', newSupplier);


//EMPLEADOS
routes.get('/personal', dashboardEmployees);
routes.get('/personal/new', newEmployer);
routes.post('/personal/new', uploadMixed.fields([
    { name: 'fotoEmpleado', maxCount: 1 },
    { name: 'documentos', maxCount: 10 }
]), saveEmployee);



routes.get('/clientes', dashboardCustomers);

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
routes.post('/dosificaciones/trasladar', csrfProtection, trasladarPacks)








routes.post('/inventario/editar/:idProducto',
    uploadImages.array('imagenes', 10),
    csrfProtection,
    productBasicValidation,
    saveProduct);


/************************[JSON]******************************/



routes.get('/json/municipios/:departamentoId', municipiosJson)
routes.get('/json/categorias/:idCategoria', categoriasJson);
routes.get('/json/sku/:checkSku', skuJson);
routes.get('/json/ean/:checkEan', eanJson);
routes.get('/json/productos/', filterProductListJson)
routes.get('/json/imageProduct/:idProducto', jsonImageProduct)
routes.get('/json/unicidad/:tipo/:valor', jsonUnicidad)
routes.get('/json/personal/documento/:tipo/:numero', checkDocumentoPersonal);
routes.get('/json/personal/email/:email', checkEmailPersonal);
routes.get('/json/provedores/', filterSupplierListJson);
routes.get('/json/inventario-tienda/:idPuntoDeVenta', filterStoreInventoryJson);
routes.get('/json/tiendas/', async (req, res) => {
    const tiendas = await PuntosDeVenta.findAll({ attributes: ['idPuntoDeVenta', 'nombreComercial'] });
    res.json(tiendas);
});

// API CHECKS
routes.get('/api/check-nit/:nit', checkNitSupplier);


routes.get('/api/dosificaciones/stats-global', widgetGlobales);

routes.get('/api/dosificaciones/productos/:id', obtenerProductosPorDose);
routes.get('/api/dosificaciones/metadata/:id', obtenerMetadataDose);
routes.get('/dosificaciones/etiquetas/unica/:idPack/', imprimirEtiquetasPorPack);

routes.get('/dosificaciones/etiquetas/:idDosificacion/:numLote', imprimirEtiquetasLote);
routes.get('/api/dosificaciones/:query', obtenerDosificacionesPaginadas)








export default routes