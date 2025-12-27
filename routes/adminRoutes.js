import express from "express";
import { dashboard,  dashboardStores, newStore,postNewStore, dashboardInventorys, dashboardCustomers, dashboardEmployees, dashboardOrders, dashboardSettings, baseFrondend} from "../controller/adminControllers.js"

import {storeRegisterValidation} from '../middlewares/fieldValidations.js';

const routes = express.Router();



//*********************************[GETS ROUTES]**********************************/

routes.get("/", dashboard);
routes.get('/tiendas',dashboardStores);
    routes.get('/tiendas/new',newStore);
    
routes.get('/inventario',dashboardInventorys);
routes.get('/clientes',dashboardCustomers);
routes.get('/personal',dashboardEmployees);
routes.get('/pedidos',dashboardOrders);
routes.get('/configuracion',dashboardSettings);

routes.get('/frontend',baseFrondend);


//****************[POST]**********************/
routes.post('/tiendas/new', storeRegisterValidation, postNewStore)


export default routes