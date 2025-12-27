import {validationResult } from "express-validator";

//************************[GET CONTROLLERS] ************************ */
 
//PRINCIPAL ADMINISTRADOR


const baseFrondend = async (req, res)=>{
    return res.status(201).render('./administrador/baseFrontends', { pagina: "Dashboard",
        csrfToken : req.csrfToken(),
        currentPath: req.path
        
    })
} 
const dashboard = async (req, res)=>{

    return res.status(201).render('./administrador/layout', {
        pagina: "Pagina Principal",
        csrfToken : req.csrfToken(),
        currentPath: req.path
        
    })
}




//PRINCIPAL TIENDAS
const dashboardStores = async (req, res)=>{
    return res.status(201).render('./administrador/stores', {
        pagina: "Tiendas",
        csrfToken : req.csrfToken(),
        currentPath: req.path,
        
        
    })
}


//
const newStore = async (req, res)=>{
    return res.status(201).render('./administrador/stores/new', {
        pagina: "Tiendas",
        subPagina : "Nueva Tienda",
        csrfToken : req.csrfToken(),
        currentPath: req.path,
        btn : "Crear Nuevo Punto De Venta"
        
    })
}

//PRINCIPAL INVENTARIOS
const dashboardInventorys = async (req, res)=>{
    
}


//PRINCIPAL CLIENTES
const dashboardCustomers = async (req, res)=>{
    return res.status(201).render('./administrador/customers', {
        pagina: "Clientes",
        csrfToken : req.csrfToken(),
        currentPath: req.path
        
    })
}   

const dashboardEmployees = async (req, res)=>{
    return res.status(201).render('./administrador/employees', {
        pagina: "Empleados",
        csrfToken : req.csrfToken(),
        currentPath: req.path
    })
} 

const dashboardOrders = async (req, res)=>{
    
} 



const dashboardSettings = async (req, res)=>{

    //
     return res.status(201).render('./administrador/settings', {
        pagina: "Configuración",
        csrfToken : req.csrfToken(),
        currentPath: req.path
    })
} 


//************************[POST CONTROLLERS] ************************ */

const postNewStore = async (req, res)=>{

    const erroresValidacion = validationResult(req);
    const  {razonSocial, tipo, direccionPrincipal, departamento, ciudad, telefono, activa, taxId, DV, prefijo, resolucionFacturacion, emailRut, footerBill} = req.body
    const errores= erroresValidacion.array();
    const errsPorCampo = {};
    errores.forEach(err => 
        {
            if (!errsPorCampo[err.path]) {
                errsPorCampo[err.path] = err.msg;
            }
    });

    return res.status(201).render('./administrador/stores/new', {
        pagina: "Tiendas",
        subPagina : "Nueva Tienda",
        csrfToken : req.csrfToken(),
        currentPath: req.path,

        errores  : errsPorCampo,
        btn : "Crear Nuevo Punto De Venta"
        
    })
}




//************************[JSON CONTROLLERS] ************************ */

export {
    dashboard,
    dashboardStores,
    newStore,
    postNewStore,
    dashboardInventorys,
    dashboardCustomers,
    dashboardEmployees,
    dashboardOrders,
    dashboardSettings,
    baseFrondend
}