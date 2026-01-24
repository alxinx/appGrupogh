import express from "express";
import csrf from 'csurf';
const csrfProtection = csrf({ cookie: true });
import { dashboard,  dashboardStores, newStore, verTienda, editarTienda, postNuevaTienda, postEditStore, dashboardInventorys, newProduct, listaProductos,verProducto, dosificar, dashboardCustomers, dashboardEmployees, dashboardOrders, dashboardSettings, municipiosJson, categoriasJson, skuJson, eanJson, baseFrondend} from "../controller/adminControllers.js"

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
    routes.get('/inventario/ver/', verProducto)
    routes.get('/inventario/dosificar/', dosificar)
    

routes.get('/clientes',dashboardCustomers);
routes.get('/personal',dashboardEmployees);
routes.get('/pedidos',dashboardOrders);
routes.get('/configuracion',dashboardSettings);


routes.get('/frontend',baseFrondend);


//****************[POST]**********************/
routes.post('/tiendas/nueva',csrfProtection, storeRegisterValidation, storeBasicTaxDataValidation, postNuevaTienda)

routes.post('/inventario/ingreso', 
    uploadImages.array('imagenes', 10), // 1. Multer procesa los binarios y el body
    csrfProtection,                     // 2. Ahora que req.body existe, validamos el token
    productBasicValidation,             // 3. Validaciones de texto
    newProduct                          // 4. Controlador final
);


//routes.post('/tiendas/new', storeRegisterValidation, postNewStore)

routes.post('/tiendas/editar/:idPuntoDeVenta', csrfProtection, storeRegisterValidation, postEditStore)

/************************[JSON]******************************/

routes.get('/json/municipios/:departamentoId', municipiosJson)
routes.get('/json/categorias/:idCategoria', categoriasJson  );
routes.get('/json/sku/:checkSku', skuJson  );
routes.get('/json/ean/:checkEan', eanJson  );



export default routes