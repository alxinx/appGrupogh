import {validationResult } from "express-validator";
import { Departamentos, Municipios, PuntosDeVenta, RegimenFacturacion } from "../models/index.js";
import responsabiliidadFiscal from '../src/json/responsabilidadFiscal.json' with { type: 'json' };
import tipoPersonaJuridica from '../src/json/tipoPersonaJuridica.json' with {type :'json'}
import tipoFacturas from '../src/json/tipoFacturas.json' with {type : 'json'}

import { Sequelize, Op, where} from "sequelize";

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
    responsabiliidadFiscal
    return res.status(201).render('./administrador/stores/nueva', {
        pagina: "Tiendas",
        subPagina : "Nueva Tienda",
        csrfToken : req.csrfToken(),
        currentPath: '/tiendas',
        responsabiliidadFiscal : responsabiliidadFiscal,
        tipoPersonaJuridica : tipoPersonaJuridica,
        tipoFacturas : tipoFacturas,
        departamentos : dptos,
        btn : "Crear Nuevo Punto De Venta"
    })
}

//PRINCIPAL INVENTARIOS
const dashboardInventorys = async (req, res)=>{
    
}



//************[TIENDAS]*******************//
const verTienda = async (req,res)=>{

    const {idPuntoDeVenta }=req.params
    const puntoVenta = await PuntosDeVenta.findOne({
        where : { idPuntoDeVenta : idPuntoDeVenta}
    })
    return res.status(201).render('./administrador/stores/viewStore', {
        pagina: req.path,
        subPagina : "Estado de la tienda ",
        csrfToken : req.csrfToken(),
        currentPath: '/tiendas',
        dato : puntoVenta,
    })
}


const editarTienda = async (req,res)=>{

    const {idPuntoDeVenta }=req.params
    const puntoVenta = await PuntosDeVenta.findOne({
        where : { idPuntoDeVenta : idPuntoDeVenta}
    })


    const departamentos = await Departamentos.findAll({ raw: true });
        let ciudades = [];        
        ciudades = await Municipios.findAll({
            where: { departamento_id: puntoVenta.departamento},
            raw: true
        });
    return res.status(201).render('./administrador/stores/editStore', {
        pagina: req.path,
        subPagina : "Editar Tienda ",
        csrfToken : req.csrfToken(),
        currentPath: '/tiendas',
        dato : puntoVenta,
        departamentos : departamentos,
        ciudades: ciudades,
        btn : "Editar Tienda"

    })
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
     return res.status(201).render('./administrador/settings', {
        pagina: "Configuración",
        csrfToken : req.csrfToken(),
        currentPath: req.path
    })
} 


//************************[POST CONTROLLERS] ************************ */


const postNuevaTienda = async (req, res) => {
    // 1. Captura de errores de express-validator
    const erroresValidacion = validationResult(req);

     const obtenerDatosSelectores = async (idDepartamento) => {
        const [departamentos, ciudades] = await Promise.all([
            Departamentos.findAll({ raw: true }),
            idDepartamento 
                ? Municipios.findAll({ where: { departamento_id: idDepartamento }, raw: true }) 
                : Promise.resolve([])
        ]);
        return { departamentos, ciudades };
    };

    
    if (!erroresValidacion.isEmpty()) {
        const errsPorCampo = {};
        erroresValidacion.array().forEach(err => {
            if (!errsPorCampo[err.path]) errsPorCampo[err.path] = err.msg;
        });
        return res.status(201).render('./administrador/stores/nueva', {
            pagina: "Tiendas",
            subPagina : "Nueva Tienda",
            csrfToken : req.csrfToken(),
            currentPath: '/tiendas',
            departamentos : departamentos,
            ciudades: ciudades,
            activa : activa,
            dato: req.body,
            responsabiliidadFiscal : responsabiliidadFiscal,
            tipoPersonaJuridica : tipoPersonaJuridica,
            tipoFacturas : tipoFacturas,
            errores: errsPorCampo,
            pasoActivo: "1"
        });
    }



    // 2. Limpieza de datos críticos
    const { razonSocial, nombreComercial, tipo, direccionPrincipal, departamento, ciudad, telefono, activa, emailRut, footerBill, DV } = req.body;
    const nitBusqueda = req.body.taxId?.trim();
    const resFacturacion = req.body.resolucionFacturacion?.trim();

    // 3. VALIDACIONES DE DUPLICADOS (Aduana)
    if (nitBusqueda) {
        const checkTaxId = await PuntosDeVenta.findOne({ where: { taxId: nitBusqueda } });
        if (checkTaxId) {
            const { departamentos, ciudades } = await obtenerDatosSelectores(req.body?.departamento);
            return res.status(200).render('./administrador/stores/nueva', {
                pagina: "Tiendas",
                subPagina : "Nueva Tienda",
                csrfToken : req.csrfToken(),
                currentPath: '/tiendas',
                departamentos : departamentos,
                ciudades: ciudades,
                activa : activa,
                dato: req.body,
                responsabiliidadFiscal : responsabiliidadFiscal,
                tipoPersonaJuridica : tipoPersonaJuridica,
                tipoFacturas : tipoFacturas,
                errores: { msgTaxId: "El NIT ya está registrado" },
                pasoActivo: "2"
            });
        }
    }

    if (resFacturacion) {
        const checkRes = await RegimenFacturacion.findOne({
            where: {
                resolucionFacturacion: resFacturacion,
                [Op.and]: [
                    { resolucionFacturacion: { [Op.ne]: null } },
                    { resolucionFacturacion: { [Op.ne]: "" } }
                ]
            }
        });
        if (checkRes) {
            const { departamentos, ciudades } = await obtenerDatosSelectores(req.body?.departamento);
            return res.status(409).render('./administrador/stores/nueva', {
                pagina: "Tiendas",
                subPagina : "Nueva Tienda",
                csrfToken : req.csrfToken(),
                currentPath: '/tiendas',
                departamentos : departamentos,
                ciudades: ciudades,
                activa : activa,
                dato: req.body,
                responsabiliidadFiscal : responsabiliidadFiscal,
                tipoPersonaJuridica : tipoPersonaJuridica,
                tipoFacturas : tipoFacturas,
                errores: { msgTaxId: "🚨 La resolución de facturación está repetida." },
                pasoActivo: "2"
            });
        }
    }

    // 4. CREACIÓN ÚNICA DE PUNTO DE VENTA
    const nuevaTienda = await PuntosDeVenta.create({
        razonSocial,
        nombreComercial,
        tipo,
        direccionPrincipal,
        departamento,
        ciudad,
        emailRut: emailRut?.trim() || '',
        telefono,
        footerBill: footerBill || '',
        activa: activa === 'on'
    });

    const idPuntoDeVenta = nuevaTienda.idPuntoDeVenta;

    // 5. INGRESO DE DATOS TRIBUTARIOS (Si aplica)
    if (nitBusqueda) {
        let { prefijo, responsabilidades, tipo_organizacion, tipoFactura, nroInicio, nroFin, nroActual } = req.body;

        // Actualizamos la tienda usando el objeto que ya tenemos (Más eficiente)
        nuevaTienda.taxId = nitBusqueda;
        nuevaTienda.DV = DV ? Number(DV) : null;
        nuevaTienda.prefijo = prefijo?.trim() || null;
        nuevaTienda.resolucionFacturacion = resFacturacion || null;
        await nuevaTienda.save(); // ¡CON AWAIT!

        const startDate = req.body.fechaEmision?.trim() || null;
        const finishDate = req.body.fechaVencimiento?.trim() || null;

        await RegimenFacturacion.create({
            idPuntoDeVenta,
            resolucionFacturacion: resFacturacion || null,
            responsabilidades: responsabilidades?.trim() || 'R-99-PN',
            tipo_organizacion: tipo_organizacion?.trim() || null,
            tipoFactura: tipoFactura?.trim() || null,
            fechaEmision: startDate,
            fechaVencimiento: finishDate,
            nroInicio: nroInicio ? Number(nroInicio) : 0,
            nroFin: nroFin ? Number(nroFin) : 0,
            nroActual: nroActual ? Number(nroActual) : 0,
            razonSocial,
            taxId: nitBusqueda,
            DV: DV ? Number(DV) : 0,
            prefijo: prefijo?.trim() || null
        });
    }

    // 6. RESPUESTA FINAL
    const { departamentos, ciudades } = await obtenerDatosSelectores(req.body?.departamento);
    return res.render('./administrador/stores/nueva', {
        pagina: "Tiendas",
        subPagina : "Nueva Tienda",
        csrfToken : req.csrfToken(),
        currentPath: '/tiendas',
        departamentos : departamentos,
        ciudades: ciudades,
        activa : activa,
        pasoActivo: "1",
        responsabiliidadFiscal : responsabiliidadFiscal,
        tipoPersonaJuridica : tipoPersonaJuridica,
        tipoFacturas : tipoFacturas,
        successful: { mensaje: '¡Punto de venta creado con éxito! 😌' }
    });
};









const postEditStore = async (req, res)=>{
/*
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
        return res.status(201).render('./administrador/stores/editStore', {
        pagina: "Tiendas",
        subPagina : "Nueva Tienda",
        csrfToken : req.csrfToken(),
        currentPath: '/tiendas',
        departamentos : departamentos,
        ciudades: ciudades,
        activa : activa,
        dato: req.body,
        errores  : errsPorCampo,
        btn : "Editar punto de venta"
        })
    }

    //Si los campos obligatorios estan ok. entonces procedemos a validar que los campos que deben ser únicos, no existan en la base de datos.
    const checkTaxId = await PuntosDeVenta.findOne(
        {where : {
                taxId : req.body.taxId,
                idPuntoDeVenta : {
                    [Op.ne] : req.body.idPuntoDeVenta
                }
            }}
    )   
    
    
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

        return res.status(200).render('./administrador/stores/editStore', {
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
        btn : "Intentar editar de nuevoo"
        })
    }
    //COMO YA TODO ESTA OK, PROCEDEMOS A GUARDAR. 

    //INGRESO LOS DATOS A LA BASE DE DATOS
    const {razonSocial, nombreComercial, tipo, direccionPrincipal, departamento, ciudad,telefono, taxId, DV, prefijo, resolucionFacturacion, emailRut, footerBill, idPuntoDeVenta} = req.body;
    
    const activa = req.body.activa ? true : false

    const edit = await PuntosDeVenta.findByPk(idPuntoDeVenta)
        edit.razonSocial = razonSocial,
        edit.nombreComercial = nombreComercial,
        edit.tipo = tipo,
        edit.direccionPrincipal = direccionPrincipal,
        edit.departamento = departamento,
        edit.ciudad = ciudad,
        edit.telefono = telefono,
        edit.taxId = taxId,
        edit.DV = DV,
        edit.activa = activa,
        edit.prefijo = prefijo,
        edit.resolucionFacturacion = resolucionFacturacion,
        edit.emailRut = emailRut,
        edit.footerBill = footerBill,
        edit.save()


    const idDepartamentoSeleccionado = req.body?.departamento; 
    const [departamentos, ciudades] = await Promise.all(
            [Departamentos.findAll({ raw: true }),
            idDepartamentoSeleccionado ? Municipios.findAll({ 
                    where: { departamento_id: idDepartamentoSeleccionado }, 
                    raw: true 
                }) 
                : Promise.resolve([]) // Correcto: devolvemos una promesa resuelta con array vacío
            ]);
        return res.status(200).render('./administrador/stores/editStore', {
        pagina: "Tiendas",
        subPagina : "Editar",
        csrfToken : req.csrfToken(),
        currentPath: '/tiendas',
        departamentos : departamentos,
        ciudades: ciudades,
        activa : activa,
        dato: req.body,
        successful  : {
            mensaje : "El punto ya quedo editado 😀! "
        },
        btn : "Volver a editar "
        })
        */
}


//************************[JSON CONTROLLERS] ************************ */

const municipiosJson = async(req, res)=>{
    const { departamentoId } = req.params; 
    
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
    verTienda,
    editarTienda,
    postNuevaTienda,
    postEditStore,
    dashboardInventorys,
    dashboardCustomers,
    dashboardEmployees,
    dashboardOrders,
    dashboardSettings,
    municipiosJson,
    baseFrondend
}