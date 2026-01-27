import express from "express";
import csrf from 'csurf';
const csrfProtection = csrf({ cookie: true });
import { dashboard,  dashboardStores, newStore, verTienda, editarTienda, postNuevaTienda, postEditStore, dashboardInventorys, newProduct, saveProduct, listaProductos,verProducto, editarProducto, dosificar, dashboardCustomers, dashboardEmployees, dashboardOrders, dashboardSettings, municipiosJson, categoriasJson, skuJson, eanJson, filterProductListJson, jsonImageProduct, jsonUnicidad, baseFrondend} from "../controller/adminControllers.js"

import {storeRegisterValidation, storeBasicTaxDataValidation, productBasicValidation} from '../middlewares/fieldValidations.js';
import uploadImages from '../middlewares/uploadImages.js';
const routes = express.Router();



//*********************************[GETS ROUTES]**********************************/

routes.get("/", dashboard);

//TIENDAS
routes.get('/tiendas',dashboardStores);
    routes.get('/tiendas/new',newStore);
    //routes.get('/tiendas/nueva',newStore);
    routes.get('/tiendas/verPunto/:idPuntoDeVenta',verTienda);
    routes.get('/tiendas/editar/:idPuntoDeVenta',editarTienda);
    

//INVENTARIOS Y PRODUCTOS.
routes.get('/inventario/ingreso',csrfProtection,dashboardInventorys);
    routes.get('/inventario/listado',listaProductos);
    routes.get('/inventario/ver/:idProducto', verProducto)
    routes.get('/inventario/editar/:idProducto', editarProducto)
    routes.get('/inventario/dosificar/', dosificar)
    

routes.get('/clientes',dashboardCustomers);
routes.get('/personal',dashboardEmployees);
routes.get('/pedidos',dashboardOrders);
routes.get('/configuracion',dashboardSettings);


routes.get('/frontend',baseFrondend);


//****************[POST]**********************/
routes.post('/tiendas/nueva',csrfProtection, storeRegisterValidation, storeBasicTaxDataValidation, postNuevaTienda)


routes.post('/inventario/ingreso', 
    uploadImages.array('imagenes', 10), 
    csrfProtection,                     
    productBasicValidation,             
    saveProduct                              
);


routes.post('/inventario/editar/:idProducto',
    uploadImages.array('imagenes', 10), 
    csrfProtection, 
    productBasicValidation,                 
    saveProduct);



//routes.post('/tiendas/new', storeRegisterValidation, postNewStore)

routes.post('/tiendas/editar/:idPuntoDeVenta', csrfProtection, storeRegisterValidation, postEditStore)

/************************[JSON]******************************/

routes.get('/json/municipios/:departamentoId', municipiosJson)
routes.get('/json/categorias/:idCategoria', categoriasJson  );
routes.get('/json/sku/:checkSku', skuJson  );
routes.get('/json/ean/:checkEan', eanJson  );
routes.get('/json/productos/', filterProductListJson)
routes.get('/json/imageProduct/:idProducto', jsonImageProduct)
routes.get('/json/unicidad/:tipo/:valor', jsonUnicidad)



export default routes