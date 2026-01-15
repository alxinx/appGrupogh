import express from "express";
import { dashboard,  dashboardStores, newStore, verTienda, editarTienda, postNuevaTienda, postEditStore, dashboardInventorys, listaProductos,verProducto, dosificar, dashboardCustomers, dashboardEmployees, dashboardOrders, dashboardSettings, municipiosJson, categoriasJson, skuJson, baseFrondend} from "../controller/adminControllers.js"

import {storeRegisterValidation, storeBasicTaxDataValidation} from '../middlewares/fieldValidations.js';

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
routes.get('/inventario/ingreso',dashboardInventorys);
    routes.get('/inventario/listado',listaProductos);
    routes.get('/inventario/ver/', verProducto)
    routes.get('/inventario/dosificar/', dosificar)
    
    
routes.get('/clientes',dashboardCustomers);
routes.get('/personal',dashboardEmployees);
routes.get('/pedidos',dashboardOrders);
routes.get('/configuracion',dashboardSettings);


routes.get('/frontend',baseFrondend);


//****************[POST]**********************/
routes.post('/tiendas/nueva', storeRegisterValidation, storeBasicTaxDataValidation, postNuevaTienda)
//routes.post('/tiendas/new', storeRegisterValidation, postNewStore)

routes.post('/tiendas/editar/:idPuntoDeVenta', storeRegisterValidation, postEditStore)

/************************[JSON]******************************/

routes.get('/json/municipios/:departamentoId', municipiosJson)
routes.get('/json/categorias/:idCategoria', categoriasJson  );
routes.get('/json/sku/:checkSku', skuJson  );



export default routes