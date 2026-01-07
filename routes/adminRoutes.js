import express from "express";
import { dashboard,  dashboardStores, newStore, verTienda, editarTienda, postNuevaTienda, postEditStore, dashboardInventorys, dashboardCustomers, dashboardEmployees, dashboardOrders, dashboardSettings, municipiosJson, baseFrondend} from "../controller/adminControllers.js"

import {storeRegisterValidation, storeBasicTaxDataValidation} from '../middlewares/fieldValidations.js';

const routes = express.Router();



//*********************************[GETS ROUTES]**********************************/

routes.get("/", dashboard);
routes.get('/tiendas',dashboardStores);
    routes.get('/tiendas/new',newStore);
    routes.get('/tiendas/nueva',newStore);
    routes.get('/tiendas/verPunto/:idPuntoDeVenta',verTienda);
    routes.get('/tiendas/editar/:idPuntoDeVenta',editarTienda);
    
routes.get('/inventario',dashboardInventorys);
routes.get('/clientes',dashboardCustomers);
routes.get('/personal',dashboardEmployees);
routes.get('/pedidos',dashboardOrders);
routes.get('/configuracion',dashboardSettings);
routes.get('/json/municipios/:departamentoId', municipiosJson)

routes.get('/frontend',baseFrondend);


//****************[POST]**********************/
routes.post('/tiendas/nueva', storeRegisterValidation, storeBasicTaxDataValidation, postNuevaTienda)
//routes.post('/tiendas/new', storeRegisterValidation, postNewStore)

routes.post('/tiendas/editar/:idPuntoDeVenta', storeRegisterValidation, postEditStore)


export default routes