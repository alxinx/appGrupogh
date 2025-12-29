import {validationResult } from "express-validator";
import { Departamentos, Municipios, PuntosDeVenta } from "../models/index.js";

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

    const  listaPuntosDeVenta = await  PuntosDeVenta.findAll({
        raw : true,
        attributes : ['idPuntoDeVenta', 'nombreComercial', 'taxId']
    })

    return res.status(201).render('./administrador/stores', {
        pagina: "Tiendas",
        csrfToken : req.csrfToken(),
        currentPath: req.path,
        listaPuntosDeVenta : listaPuntosDeVenta
        
    })
}


//
const newStore = async (req, res)=>{

    const dptos = await  Departamentos.findAll({
        raw : true,
        attributes : ['id', 'nombre']
    })



    return res.status(201).render('./administrador/stores/new', {
        pagina: "Tiendas",
        subPagina : "Nueva Tienda",
        csrfToken : req.csrfToken(),
        currentPath: '/tiendas',
        departamentos : dptos,
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
    const errores= erroresValidacion.array();
    const errsPorCampo = {};
    errores.forEach(err => 
        {
            if (!errsPorCampo[err.path]) {
                errsPorCampo[err.path] = err.msg;
            }
    });

     const dptos = await  Departamentos.findAll({
        raw : true,
        attributes : ['id', 'nombre']
    })


    //Validamos todos los campos obligatorios, 
    if(!erroresValidacion.isEmpty()){

        
        const departamentos = await Departamentos.findAll({ raw: true });
        let ciudades = [];        
        if(req.body.departamento) {
            ciudades = await Municipios.findAll({
                where: { departamento_id: req.body.departamento },
                raw: true
            });
        }
        
        const activa = req.body.activa ? true : false
        return res.status(201).render('./administrador/stores/new', {
        pagina: "Tiendas",
        subPagina : "Nueva Tienda",
        csrfToken : req.csrfToken(),
        currentPath: '/tiendas',
        departamentos : departamentos,
        ciudades: ciudades,
        activa : activa,
        dato: req.body,
        errores  : errsPorCampo,
        btn : "Crear Nuevo Punto De Venta"
        })
    }

    //Si los campos obligatorios estan ok. entonces procedemos a validar que los campos que deben ser únicos, no existan en la base de datos.
    const checkTaxId = await PuntosDeVenta.findOne({where : {taxId : req.body.taxId}})
    if(checkTaxId){
        const activa = req.body.activa ? true : false
        const idDepartamentoSeleccionado = req.body?.departamento; 
        
        const [departamentos, ciudades] = await Promise.all(
            [Departamentos.findAll({ raw: true }),
            
            idDepartamentoSeleccionado ? Municipios.findAll({ 
                    where: { departamento_id: idDepartamentoSeleccionado }, 
                    raw: true 
                }) 
                : Promise.resolve([]) // Correcto: devolvemos una promesa resuelta con array vacío
            ]);

        return res.status(200).render('./administrador/stores/new', {
        pagina: "Tiendas",
        subPagina : "Nueva Tienda",
        csrfToken : req.csrfToken(),
        currentPath: '/tiendas',
        departamentos : departamentos,
        ciudades: ciudades,
        activa : activa,
        dato: req.body,
        errores  : {
            msgTaxId : "El NIT ya esta registrado"
        },
        btn : "Crear Nuevo Punto De Venta"
        })
    }
    //COMO YA TODO ESTA OK, PROCEDEMOS A GUARDAR. 

    //INGRESO LOS DATOS A LA BASE DE DATOS
    const {razonSocial, nombreComercial, tipo, direccionPrincipal, departamento, ciudad,telefono, taxId, DV, prefijo, resolucionFacturacion, emailRut, footerBill} = req.body;
    const activa = req.body.activa ? true : false
    const saveStore = await PuntosDeVenta.create({
       razonSocial : razonSocial,
       nombreComercial : nombreComercial,
       tipo : tipo,
       direccionPrincipal : direccionPrincipal,
       departamento : departamento,
       ciudad : ciudad,
       telefono : telefono,
       activa : activa,
       taxId : taxId,
       DV : DV,
       prefijo : prefijo,
       resolucionFacturacion : resolucionFacturacion,
       emailRut : emailRut,
       footerBill : footerBill
    })

    if(saveStore){

        const departamentos = await Departamentos.findAll({ raw: true });
        let ciudades = [];        
        if(req.body.departamento) {
            ciudades = await Municipios.findAll({
                where: { departamento_id: req.body.departamento },
                raw: true
            });
        }

        return res.status(200).render('./administrador/stores/new', {
        pagina: "Tiendas",
        subPagina : "Nueva Tienda",
        csrfToken : req.csrfToken(),
        currentPath: '/tiendas',
        departamentos : departamentos,
        ciudades: ciudades,
        successful  : {
                    mensaje : "Punto de venta registrado con éxito"
                },
        btn : "Crear Otro Punto De Venta"
        })
    }
    


    
}




//************************[JSON CONTROLLERS] ************************ */

const municipiosJson = async(req, res)=>{
    const { departamentoId } = req.params; 
    
    console.log(departamentoId)
    const  municipio = await Municipios.findAll({
        where : {departamento_id : departamentoId },
        attributes : ['id', 'nombre'],
        raw : true
    })
    return res.json(municipio)
}





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
    municipiosJson,
    baseFrondend
}