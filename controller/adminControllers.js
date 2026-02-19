import { validationResult } from "express-validator";
import sharp from 'sharp';
import { Upload } from "@aws-sdk/lib-storage";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "../config/r2.js";
import dotenv from 'dotenv';
import db from "../config/bd.js";
import { Departamentos, Municipios, PuntosDeVenta, RegimenFacturacion, Atributos, Categorias, Productos, VariacionesProducto, Imagenes, CategoriasDeProvedores, Documentacion, Provedores } from "../models/index.js";
import responsabiliidadFiscal from '../src/json/responsabilidadFiscal.json' with { type: 'json' };
import tipoPersonaJuridica from '../src/json/tipoPersonaJuridica.json' with {type: 'json'}
import tipoFacturas from '../src/json/tipoFacturas.json' with {type: 'json'}
import { limpiarPrecio, sanitizarHTML } from '../helpers/helpers.js'
import { Sequelize, Op, where } from "sequelize";

dotenv.config();


//************************[GET CONTROLLERS] ************************ */

//PRINCIPAL ADMINISTRADOR


const baseFrondend = async (req, res) => {
    return res.status(201).render('./administrador/baseFrontends', {
        pagina: "Dashboard",
        csrfToken: req.csrfToken(),
        currentPath: req.path

    })
}
const dashboard = async (req, res) => {

    return res.status(201).render('./administrador/layout', {
        pagina: "Pagina Principal",
        csrfToken: req.csrfToken(),
        currentPath: req.path

    })
}




//PRINCIPAL TIENDAS
const dashboardStores = async (req, res) => {

    const listaPuntosDeVenta = await PuntosDeVenta.findAll({
        raw: true,
        attributes: ['idPuntoDeVenta', 'nombreComercial', 'taxId']
    })

    return res.status(201).render('./administrador/stores/homeStores', {
        pagina: "Tiendas",
        subPagina: "Gestión Tiendas",
        csrfToken: req.csrfToken(),
        currentPath: req.path,
        listaPuntosDeVenta: listaPuntosDeVenta

    })
}


//
const newStore = async (req, res) => {

    const dptos = await Departamentos.findAll({
        raw: true,
        attributes: ['id', 'nombre']
    })
    responsabiliidadFiscal
    return res.status(201).render('./administrador/stores/new', {

        pagina: "Tiendas",
        subPagina: "Nueva Tienda",
        csrfToken: req.csrfToken(),
        currentPath: '/tiendas',
        responsabiliidadFiscal: responsabiliidadFiscal,
        tipoPersonaJuridica: tipoPersonaJuridica,
        tipoFacturas: tipoFacturas,
        departamentos: dptos,
        btn: "Crear Nuevo Punto De Venta"
    })
}



//GUARDO DATOS BÁSICOS DE LA TIENDA.

const saveStoreBasic = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(err => `• ${err.msg}`).join('<br>');
        return res.status(400).json({ success: false, mensaje: errorMessages });
    }

    const {
        idPuntoDeVenta, razonSocial, nombreComercial, tipo, direccionPrincipal,
        departamento, ciudad, telefono, activa,
        taxId, DV, prefijo, resolucionFacturacion, emailRut, footerBill,
        responsabilidades, tipo_organizacion, tipoFactura,
        fechaEmision, fechaVencimiento, nroInicio, nroFin
    } = req.body;

    // 1. LIMPIEZA DE DATOS: Convertir strings vacíos en null para que Sequelize no valide
    const nitLimpio = (taxId && taxId.trim() !== "") ? taxId.trim() : null;
    const dvLimpio = (DV && DV.trim() !== "") ? DV.trim() : null;

    const t = await db.transaction();

    try {
        let sede;

        // --- LÓGICA PASO 1: DATOS BÁSICOS ---
        const datosSede = {
            razonSocial,
            nombreComercial,
            tipo,
            direccionPrincipal,
            departamento,
            ciudad,
            telefono,
            activa: activa === 'on' || activa === true,
            // IMPORTANTE: El nombre de la propiedad debe ser igual al del modelo (taxId y DV)
            taxId: nitLimpio,
            DV: dvLimpio,
            prefijo,
            resolucionFacturacion,
            emailRut,
            footerBill
        };

        if (idPuntoDeVenta && idPuntoDeVenta !== "" && idPuntoDeVenta !== "undefined") {
            sede = await PuntosDeVenta.findByPk(idPuntoDeVenta, { transaction: t });
            if (!sede) {
                await t.rollback();
                return res.status(404).json({ success: false, mensaje: 'La sede no existe' });
            }
            await sede.update(datosSede, { transaction: t });
        } else {
            sede = await PuntosDeVenta.create(datosSede, { transaction: t });
        }

        // --- LÓGICA PASO 2: RÉGIMEN TRIBUTARIO (Solo si hay NIT) ---
        if (nitLimpio) {
            const [regimen, created] = await RegimenFacturacion.findOrCreate({
                where: { idPuntoDeVenta: sede.idPuntoDeVenta, activa: true },
                defaults: {
                    idPuntoDeVenta: sede.idPuntoDeVenta,
                    razonSocial,
                    taxId: nitLimpio,
                    DV: dvLimpio,
                    prefijo,
                    resolucionFacturacion, responsabilidades,
                    tipo_organizacion, tipoFactura,
                    fechaEmision: fechaEmision || null,
                    fechaVencimiento: fechaVencimiento || null,
                    nroInicio: nroInicio || 0,
                    nroFin: nroFin || 1000000
                },
                transaction: t
            });

            if (!created) {
                await regimen.update({
                    razonSocial,
                    taxId: nitLimpio,
                    DV: dvLimpio,
                    prefijo,
                    resolucionFacturacion, responsabilidades,
                    tipo_organizacion, tipoFactura,
                    fechaEmision: fechaEmision || null,
                    fechaVencimiento: fechaVencimiento || null,
                    nroInicio: nroInicio || 0,
                    nroFin: nroFin || 1000000
                }, { transaction: t });
            }
        }

        await t.commit();
        return res.json({
            success: true,
            idPuntoDeVenta: sede.idPuntoDeVenta,
            mensaje: 'Información guardada correctamente'
        });

    } catch (error) {
        await t.rollback();
        if (error.name === 'SequelizeValidationError' || error.name === 'SequelizeUniqueConstraintError') {
            const erroresSequelize = error.errors.map(err => `• ${err.message}`).join('<br>');
            return res.status(400).json({ success: false, mensaje: erroresSequelize });
        }
        console.error("ERROR EN SAVE_STORE_BASIC:", error);
        return res.status(500).json({ success: false, mensaje: 'Error interno en el servidor' });
    }
};






//***********************[INVENTARIOS]***********************//
//PRINCIPAL INVENTARIOS
const dashboardInventorys = async (req, res) => {

    //Obtengo los atributos
    const atributos = await Atributos.findAll()
    const categorias = await Categorias.findAll()


    return res.status(201).render('./administrador/inventarios/new', {
        pagina: "Inventarios y Productos",
        subPagina: "Nuevo Producto",
        csrfToken: req.csrfToken(),
        currentPath: '/inventario',
        producto: {},
        categoriasSeleccionadas: [],
        atributosSeleccionados: [],
        atributos,
        categorias,
        btnName: "Guardar Producto"

    })
}


//
const billingToday = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    res.send(`
        <div class="p-8 text-center">
            <h2 class="text-2xl font-bold text-gh-primary">SECCIÓN: FACTURACIÓN HOY</h2>
            <p class="text-slate-500">ID de la tienda: ${idPuntoDeVenta}</p>
        </div>
    `);
}


const storeInventory = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    res.send(`
        <div class="p-8 text-center">
            <h2 class="text-2xl font-bold text-gh-primary">SECCIÓN: INNVENTARIOO TIENDA</h2>
            <p class="text-slate-500">ID de la tienda: ${idPuntoDeVenta}</p>
        </div>
    `);
}

const storeEmployers = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    res.send(`
        <div class="p-8 text-center">
            <h2 class="text-2xl font-bold text-gh-primary">SECCIÓN: EMPLEADOS TIENDA</h2>
            <p class="text-slate-500">ID de la tienda: ${idPuntoDeVenta}</p>
        </div>
    `);
}


const storeDocuments = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    res.send(`
        <div class="p-8 text-center">
            <h2 class="text-2xl font-bold text-gh-primary">SECCIÓN: DOCUMENTOS TIENDA</h2>
            <p class="text-slate-500">ID de la tienda: ${idPuntoDeVenta}</p>
        </div>
    `);
}



const listaProductos = async (req, res) => {

    const categorias = await Categorias.findAll()


    return res.status(201).render('./administrador/inventarios/productList', {
        pagina: "Inventarios y Productos",
        subPagina: "Listado De Productos",
        csrfToken: req.csrfToken(),
        currentPath: '/inventario',
        subPath: 'listado',

        categorias,

    })
}



const verProducto = async (req, res) => {
    const { idProducto } = req.params;
    try {
        const [categorias, atributos, producto] = await Promise.all([
            Categorias.findAll(),
            Atributos.findAll(),
            Productos.findByPk(idProducto, {
                include: [{ association: 'imagenes' }]
            })
        ])

        if (!producto) return res.redirect('/admin/inventario/listado');


        return res.status(201).render('./administrador/inventarios/productView', {
            pagina: "Ver Producto",
            subPagina: "Producto",
            csrfToken: req.csrfToken(),
            currentPath: '/inventario',
            subPath: process.env.R2_PUBLIC_URL,
            atributos,
            categorias,
            producto,
        })

    } catch (error) {
        console.error(error);
        //res.redirect('/admin/inventario');
    }

}



const editarProducto = async (req, res) => {

    const { idProducto } = req.params;


    try {
        const [categorias, atributos, producto, variacionesDb] = await Promise.all([
            Categorias.findAll(),
            Atributos.findAll(),
            Productos.findByPk(idProducto, {
                include: [
                    { association: 'imagenes' },
                ],
            },
            ),
            VariacionesProducto.findAll({ where: { idProducto } })
        ])

        //Selecciono las categorias a las que pertenece el producto
        const categoriasId = producto.idCategoria
            ? producto.idCategoria.split(/[,|]/).map(id => parseInt(id)) : []

        if (!producto) return res.redirect('/admin/inventario/listado/')
        const variantesMapa = {};
        variacionesDb.forEach(v => {
            // Separamos el "58|15" -> [58, 15]
            const partes = v.idAtributos.split('|');
            if (partes.length === 2) {
                const idTalla = partes[0];
                const idColor = partes[1];

                if (!variantesMapa[idTalla]) {
                    variantesMapa[idTalla] = [];
                }
                // Agregamos el color a esa talla
                variantesMapa[idTalla].push(idColor);
            }
        });

        const variantesJson = JSON.stringify(variantesMapa);
        // Convertimos "58|15" en [58, 15]
        const atributosIds = variacionesDb.flatMap(
            v => v.idAtributos.split('|').map(id => parseInt(id)));

        return res.status(201).render('./administrador/inventarios/edit', {
            pagina: "Editar Producto",
            subPagina: producto.nombreProducto,
            csrfToken: req.csrfToken(),
            currentPath: '/inventario',
            subPath: 'Editar Producto',
            atributos,
            atributosSeleccionados: atributosIds,
            variantesJson: variantesJson,
            categorias,
            categoriasSeleccionadas: categoriasId,
            producto,
            subPath: process.env.R2_PUBLIC_URL,
            btnName: 'Actualizar Producto  '
        })
    } catch (error) {
        return res.redirect('/admin/inventario/listado/')
    }
}

const dosificar = async (req, res) => {
    return res.status(201).render('./administrador/inventarios/dose', {
        pagina: "Dosificacion de productos",
        subPagina: "Dosificar Productos",
        csrfToken: req.csrfToken(),
        currentPath: '/inventario',
        subPath: 'dosificar',
        btnName : "Pre-Calcular"
    })
}

 

// -> Guardo las facturas/ ordenes de compra y las pongo en el inventario global. 
const batchBuyOrder = async (req, res) => {
    return res.status(201).render('./administrador/inventarios/batch', {
        pagina: "Ingreso de Productos a Inventario General",
        subPagina: "Ingreso de Productos a Inventario General",
        csrfToken: req.csrfToken(),
        currentPath: '/inventario',
        subPath: 'batch',
        btnName : 'Guardar Factura'
    })
}



//************[TIENDAS]*******************//
const verTienda = async (req, res) => {

    const { idPuntoDeVenta } = req.params
    const puntoVenta = await PuntosDeVenta.findOne({
        where: { idPuntoDeVenta: idPuntoDeVenta }
    })
    return res.status(201).render('./administrador/stores/viewStore', {
        pagina: req.path,
        subPagina: "Estado de la tienda ",
        csrfToken: req.csrfToken(),
        currentPath: '/tiendas',
        subPath: process.env.R2_PUBLIC_URL,

        dato: puntoVenta,
    })
}


const editarTienda = async (req, res) => {

    const { idPuntoDeVenta } = req.params
    const puntoVenta = await PuntosDeVenta.findOne({
        where: { idPuntoDeVenta: idPuntoDeVenta }
    })

    const datosRegimenFacturacion = await RegimenFacturacion.findOne({
        where: { idPuntoDeVenta: idPuntoDeVenta },
        order: [['createdAt', 'DESC']]
    })


    const obtenerDatosSelectores = async (idDepartamento) => {
        const [departamentos, ciudades] = await Promise.all([
            Departamentos.findAll({ raw: true }),
            idDepartamento
                ? Municipios.findAll({ where: { departamento_id: idDepartamento }, raw: true })
                : Promise.resolve([])
        ]);
        return { departamentos, ciudades };
    };
    const { departamentos, ciudades } = await obtenerDatosSelectores(req.body?.departamento);


    //Formateo Fechas:
    // El símbolo ?. detiene la ejecución si el objeto es null y devuelve undefined en lugar de romper la app
    const fechaEmisionFormateada = datosRegimenFacturacion?.fechaEmision
        ? new Date(datosRegimenFacturacion.fechaEmision).toISOString().split('T')[0]
        : "";

    const fechaFinalizacionFormateada = datosRegimenFacturacion?.fechaVencimiento
        ? new Date(datosRegimenFacturacion.fechaVencimiento).toISOString().split('T')[0]
        : "";


    return res.status(201).render('./administrador/stores/new', {
        pagina: req.path,
        subPagina: "Editar Tienda",
        csrfToken: req.csrfToken(),
        currentPath: '/tiendas',
        dato: puntoVenta,
        datosRegimenFacturacion: datosRegimenFacturacion,
        fechaEmisionFormateada: fechaEmisionFormateada,
        fechaFinalizacionFormateada: fechaFinalizacionFormateada,
        responsabiliidadFiscal: responsabiliidadFiscal,
        tipoPersonaJuridica: tipoPersonaJuridica,
        tipoFacturas: tipoFacturas,
        departamentos: departamentos,
        ciudades: ciudades,
        btn: "Editar Tienda"

    })
}


//PRINCIPAL CLIENTES
const dashboardCustomers = async (req, res) => {
    return res.status(201).render('./administrador/customers', {
        pagina: "Clientes",
        csrfToken: req.csrfToken(),
        currentPath: req.path

    })
}

const dashboardEmployees = async (req, res) => {
    return res.status(201).render('./administrador/employees', {
        pagina: "Empleados",
        csrfToken: req.csrfToken(),
        currentPath: req.path
    })
}

const dashboardOrders = async (req, res) => {

}



const dashboardSettings = async (req, res) => {
    return res.status(201).render('./administrador/settings', {
        pagina: "Configuración",
        csrfToken: req.csrfToken(),
        currentPath: req.path
    })
}



//PROVEDORES

const dashboardSupplier = async (req, res) => {

    const categorias = await CategoriasDeProvedores.findAll();

    return res.status(201).render('./administrador/supplier/homeSupplier', {
        pagina: "Provedores",
        subPagina: "Gestión Provedores",
        csrfToken: req.csrfToken(),
        currentPath: req.path,
        categorias
    })

}


const newSupplier = async (req, res) => {

    //Importo las categorias de los provedores;
    const categoriasProvedores = await CategoriasDeProvedores.findAll()
    const obtenerDatosSelectores = async (idDepartamento) => {
        const [departamentos, ciudades] = await Promise.all([
            Departamentos.findAll({ raw: true }),
            idDepartamento
                ? Municipios.findAll({ where: { departamento_id: idDepartamento }, raw: true })
                : Promise.resolve([])
        ]);
        return { departamentos, ciudades };
    };
    const { departamentos, ciudades } = await obtenerDatosSelectores(req.body?.departamento);



    return res.status(201).render('./administrador/supplier/new', {
        pagina: "Provedores",
        subPagina: "Nuevo Provedor",
        subPath: "nuevo provedor",
        csrfToken: req.csrfToken(),
        currentPath: req.path,
        btnName: 'Guardar',


        categoriasProvedores,
        departamentos,
        ciudades



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

        const obtenerDatosSelectores = async (idDepartamento) => {
            const [departamentos, ciudades] = await Promise.all([
                Departamentos.findAll({ raw: true }),
                idDepartamento
                    ? Municipios.findAll({ where: { departamento_id: idDepartamento }, raw: true })
                    : Promise.resolve([])
            ]);
            return { departamentos, ciudades };
        };

        const { departamentos, ciudades } = await obtenerDatosSelectores(req.body?.departamento);
        const activa = req.body.activa ? true : false

        return res.status(201).render('./administrador/stores/nueva', {
            pagina: "Tiendas",
            subPagina: "Nueva Tienda",
            csrfToken: req.csrfToken(),
            currentPath: '/tiendas',
            departamentos,
            ciudades: ciudades,
            activa: activa,
            dato: req.body,
            responsabiliidadFiscal: responsabiliidadFiscal,
            tipoPersonaJuridica: tipoPersonaJuridica,
            tipoFacturas: tipoFacturas,
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
                subPagina: "Nueva Tienda",
                csrfToken: req.csrfToken(),
                currentPath: '/tiendas',
                departamentos: departamentos,
                ciudades: ciudades,
                activa: activa,
                dato: req.body,
                responsabiliidadFiscal: responsabiliidadFiscal,
                tipoPersonaJuridica: tipoPersonaJuridica,
                tipoFacturas: tipoFacturas,
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
                subPagina: "Nueva Tienda",
                csrfToken: req.csrfToken(),
                currentPath: '/tiendas',
                departamentos: departamentos,
                ciudades: ciudades,
                activa: activa,
                dato: req.body,
                responsabiliidadFiscal: responsabiliidadFiscal,
                tipoPersonaJuridica: tipoPersonaJuridica,
                tipoFacturas: tipoFacturas,
                errores: { msgTaxId: "🚨 La resolución de facturación está repetida." },
                pasoActivo: "2"
            });
        }
    }

    const nStart = Number(req.body.nroInicio) || 0;
    const nEnd = Number(req.body.nroFin) || 0;

    if ((nStart > 0 && nEnd === 0) || (nEnd > 0 && nStart === 0)) {
        const { departamentos, ciudades } = await obtenerDatosSelectores(req.body?.departamento);
        return res.status(409).render('./administrador/stores/nueva', {
            pagina: "Tiendas",
            subPagina: "Nueva Tienda",
            csrfToken: req.csrfToken(),
            currentPath: '/tiendas',
            departamentos: departamentos,
            ciudades: ciudades,
            activa: activa,
            dato: req.body,
            responsabiliidadFiscal: responsabiliidadFiscal,
            tipoPersonaJuridica: tipoPersonaJuridica,
            tipoFacturas: tipoFacturas,
            errores: { msgTaxId: "🚨 Si ingresas un rango de facturación, debes completar tanto el número inicial como el final." },
            pasoActivo: "2"
        });
    }


    if (nEnd > 0 && nStart >= nEnd) {
        const { departamentos, ciudades } = await obtenerDatosSelectores(req.body?.departamento);
        return res.status(409).render('./administrador/stores/nueva', {
            pagina: "Tiendas",
            subPagina: "Nueva Tienda",
            csrfToken: req.csrfToken(),
            currentPath: '/tiendas',
            departamentos: departamentos,
            ciudades: ciudades,
            activa: activa,
            dato: req.body,
            responsabiliidadFiscal: responsabiliidadFiscal,
            tipoPersonaJuridica: tipoPersonaJuridica,
            tipoFacturas: tipoFacturas,
            errores: { msgTaxId: `🚨 Error en rango: El inicio (${nStart}) no puede superar al final (${nEnd}).` },
            pasoActivo: "2"
        });
    }

    const dEmision = req.body.fechaEmision?.trim() ? new Date(req.body.fechaEmision) : null;
    const dVencimiento = req.body.fechaVencimiento?.trim() ? new Date(req.body.fechaVencimiento) : null;

    if ((dEmision && !dVencimiento) || (!dEmision && dVencimiento)) {
        const { departamentos, ciudades } = await obtenerDatosSelectores(req.body?.departamento);
        return res.status(409).render('./administrador/stores/nueva', {
            pagina: "Tiendas",
            subPagina: "Nueva Tienda",
            csrfToken: req.csrfToken(),
            currentPath: '/tiendas',
            departamentos: departamentos,
            ciudades: ciudades,
            activa: activa,
            dato: req.body,
            responsabiliidadFiscal: responsabiliidadFiscal,
            tipoPersonaJuridica: tipoPersonaJuridica,
            tipoFacturas: tipoFacturas,
            errores: { msgTaxId: "🚨 Datos incompletos: Una resolución de facturación debe tener tanto fecha de emisión como de vencimiento." },
            pasoActivo: "2"
        });
    }



    if (dEmision && dVencimiento && dEmision > dVencimiento) {
        const { departamentos, ciudades } = await obtenerDatosSelectores(req.body?.departamento);
        return res.status(409).render('./administrador/stores/nueva', {
            pagina: "Tiendas",
            subPagina: "Nueva Tienda",
            csrfToken: req.csrfToken(),
            currentPath: '/tiendas',
            departamentos: departamentos,
            ciudades: ciudades,
            activa: activa,
            dato: req.body,
            responsabiliidadFiscal: responsabiliidadFiscal,
            tipoPersonaJuridica: tipoPersonaJuridica,
            tipoFacturas: tipoFacturas,
            errores: { msgTaxId: "🚨 La fecha de emisión no puede ser posterior a la de vencimiento." },
            pasoActivo: "2"
        });
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
        subPagina: "Nueva Tienda",
        csrfToken: req.csrfToken(),
        currentPath: '/tiendas',
        departamentos: departamentos,
        ciudades: ciudades,
        activa: activa,
        pasoActivo: "1",
        responsabiliidadFiscal: responsabiliidadFiscal,
        tipoPersonaJuridica: tipoPersonaJuridica,
        tipoFacturas: tipoFacturas,
        successful: { mensaje: '¡Punto de venta creado con éxito! 😌' }
    });
};



const saveProduct = async (req, res, next) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
        return res.status(400).json({
            errores: errores.array().reduce((acc, err) => ({ ...acc, [err.path]: err.msg }), {})
        });
    }


    try {
        const { idProducto, categorias, variantes_finales, imagenes_borrar } = req.body;
        const csrfToken = req.csrfToken();

        // 1. Sanitización de Datos
        const idCategoriaParaDB = Array.isArray(categorias) ? categorias.join('|') : categorias;
        const precioVentaPublicoFinal = parseInt(limpiarPrecio(req.body.precioVentaPublicoFinal));
        const precioVentaMayorista = parseInt(limpiarPrecio(req.body.precioVentaMayorista));
        const descripcionLimpia = sanitizarHTML(req.body.descripcion); // Usamos el name="descripcion" del pug
        const activo = req.body.activo === 'on' || req.body.activo === true;
        const web = req.body.web === 'on' || req.body.web === true;

        let producto;
        const datosParaDB = {
            nombreProducto: req.body.nombreProducto,
            sku: req.body.sku,
            ean: req.body.ean,
            idCategoria: idCategoriaParaDB,
            precioVentaPublicoFinal,
            precioVentaMayorista,
            descripcion: descripcionLimpia,
            activo,
            web,
            tags: req.body.tags // Si tu modelo tiene tags, inclúyelo aquí
        };

        // 2. Upsert
        if (idProducto && idProducto !== "" && idProducto !== "undefined") {

            producto = await Productos.findByPk(idProducto);

            if (!producto) {
                return res.status(404).json({ mensaje: 'Producto no encontrado' });
            }

            // Actualizamos usando el objeto limpio
            await producto.update(datosParaDB);
        } else {

            // Creamos usando el objeto limpio
            producto = await Productos.create(datosParaDB);
        }

        const idReal = producto.idProducto;

        // 3. Reconstrucción de Variaciones
        await VariacionesProducto.destroy({ where: { idProducto: idReal } });
        const variacionesSeleccionadas = JSON.parse(variantes_finales || '{}');
        const variacionesFinales = [];

        Object.entries(variacionesSeleccionadas).forEach(([talla, colores]) => {
            colores.forEach(idColor => {
                variacionesFinales.push({
                    idProducto: idReal,
                    idAtributos: `${talla}|${idColor}`,
                    valor: 0
                });
            });
        });
        if (variacionesFinales.length > 0) await VariacionesProducto.bulkCreate(variacionesFinales);

        // 4. Borrado de Imágenes (Bloque Independiente)
        if (imagenes_borrar) {
            const idsBorrar = Array.isArray(imagenes_borrar) ? imagenes_borrar : [imagenes_borrar];
            const imagenesAEliminar = await Imagenes.findAll({ where: { idMultimedia: idsBorrar } });


            for (const img of imagenesAEliminar) {
                const deleteParams = {
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: `productos/${img.nombreImagen}`,
                };
                await s3Client.send(new DeleteObjectCommand(deleteParams));
            }
            await Imagenes.destroy({ where: { idMultimedia: idsBorrar } });
        } // <--- AQUÍ SE CIERRA EL IF DE BORRADO

        // 5. Subida de Nuevas Imágenes (Bloque Independiente)
        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(async (file, index) => {
                const nombreArchivo = `${req.body.sku}-${Date.now()}-${index}.webp`;
                const bufferOptimizado = await sharp(file.buffer)
                    .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toBuffer();

                const parallelUploads3 = new Upload({
                    client: s3Client,
                    params: {
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: `productos/${nombreArchivo}`,
                        Body: bufferOptimizado,
                        ContentType: "image/webp",
                    },
                });

                await parallelUploads3.done();
                return {
                    idProducto: idReal,
                    nombreImagen: nombreArchivo,
                    tipo: 'galeria'
                };
            });
            const imagenesData = await Promise.all(uploadPromises);
            await Imagenes.bulkCreate(imagenesData);
        }

        // 6. Respuesta final (Fuera de los bloques condicionales)
        res.json({ success: true, mensaje: 'Producto procesado con éxito', idProducto: idReal });

    } catch (error) {


        res.status(500).json({ mensaje: 'Error interno del servidor' });
    }
};




//OLD
const newProduct = async (req, res, next) => {
    const errores = validationResult(req);

    if (!errores.isEmpty()) {
        const errObj = errores.array().reduce((acc, err) => {
            acc[err.path] = err.msg;
            return acc;
        }, {});
        return res.status(400).json({
            errores: errObj
        });
    }

    try {

        //Trabajo con las categoorias y. subcategorias con las que vienne el porducto, 
        const { categorias, subcategorias } = req.body

        const todasLasCategorias = [categorias].concat(subcategorias || []);
        const idCategoriaParaDB = todasLasCategorias.filter(id => id && id !== '').join('|')

        //Sanitizo los valores de los precios y de , (de string a int y borro el punto que me envia desde el frontend)
        const precioVentaPublicoFinal = parseInt(limpiarPrecio(req.body.precioVentaPublicoFinal));
        const precioVentaMayorista = parseInt(limpiarPrecio(req.body.precioVentaMayorista));
        const descripcionLimpia = sanitizarHTML(req.body.descripcion);
        const activo = req.body.activo === 'on'; // Esto ya devuelve true o false
        const web = req.body.web === 'on';
        //Ingreso todo para que me pueda generar el ID del producto y seguir con lo siguiente! 
        // 1. Ingreso los datos  necesarios para ingresar el producto y trabajar el ID. 

        const nuevoProducto = await Productos.create({
            ...req.body,
            descripcion: descripcionLimpia,
            precioVentaPublicoFinal: precioVentaPublicoFinal,
            precioVentaMayorista: precioVentaMayorista,
            idCategoria: idCategoriaParaDB,
            activo: activo,
            web: web,
            btnName: 'Guardar Producto'

        });


        const idProducto = nuevoProducto.idProducto;

        // 2: Ingreso las variaciones del producto. (colores, y tallas)
        const variacionesSeleccionadas = JSON.parse(req.body.variantes_finales);
        const variacionesFinales = [];
        Object.entries(variacionesSeleccionadas).forEach(([talla, color]) => {
            color.forEach(idColor => {
                variacionesFinales.push({
                    idProducto: idProducto,
                    idAtributos: `${talla}|${idColor}`,
                    valor: 0,
                });
            })
        })
        await VariacionesProducto.bulkCreate(variacionesFinales)


        // 2. Aquí vendrá la lógica de Sharp para las imágenes (que haremos a continuación)
        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(async (file, index) => {
                // aqui genero  un nombre único para evitar colisiones
                const nombreArchivo = `${req.body.sku}-${Date.now()}-${index}.webp`;

                // 1. Procesamiento con Sharp (Optimización)
                const bufferOptimizado = await sharp(file.buffer)
                    .resize(1000, 1000, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .webp({ quality: 80 })
                    .toBuffer();

                // 2. Preparar subida a Cloudflare R2
                const parallelUploads3 = new Upload({
                    client: s3Client,
                    params: {
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: `productos/${nombreArchivo}`,
                        Body: bufferOptimizado,
                        ContentType: "image/webp",
                    },
                });

                // Ejecutar subida
                await parallelUploads3.done();

                // Retornar objeto para Sequelize (bulkCreate)
                return {
                    idProducto: nuevoProducto.idProducto, // Asegúrate de tener el ID del producto creado arriba
                    nombreImagen: nombreArchivo,
                    tipo: index === 0 ? 'principal' : 'galeria'
                };
            });

            // 3. Esperar a que todas suban y guardar registros en la DB
            const imagenesData = await Promise.all(uploadPromises);
            await Imagenes.bulkCreate(imagenesData); // Tu modelo de imágenes de Sequelize
        }
        // 3: Imágenes con Sharp y R2




        res.json({ success: true, mensaje: 'Producto guardado con éxito' });
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensaje: 'Error interno del servidor' });
    }
}

//************************[JSON CONTROLLERS] ************************ */

const municipiosJson = async (req, res) => {
    const { departamentoId } = req.params;

    const municipio = await Municipios.findAll({
        where: { departamento_id: departamentoId },
        attributes: ['id', 'nombre'],
        raw: true
    })
    return res.json(municipio)
}

const categoriasJson = async (req, res) => {
    const { idCategoria } = req.params;

    const categorias = await Categorias.findAll({
        where: { idPadre: idCategoria },
        attributes: ['idCategoria', 'nombreCategoria', 'tipo', 'idPadre'],
        raw: true
    })
    return res.json(categorias)
}


const skuJson = async (req, res) => {
    const { checkSku } = req.params;
    const sku = await Productos.findOne({
        where: { sku: checkSku },
        attributes: ['idProducto', 'nombreProducto', 'sku', 'ean',],
        raw: true
    })
    return res.json(sku)
}


const eanJson = async (req, res) => {
    const { checkEan } = req.params;
    const ean = await Productos.findOne({
        where: { ean: checkEan },
        attributes: ['idProducto', 'nombreProducto', 'sku', 'ean',],
        raw: true
    })
    return res.json(ean)
}





const filterProductListJson = async (req, res) => {
    try {
        // 1. Capturamos la página y aseguramos que sea un número
        const { busqueda, categoria, estado, web, pagina = 1 } = req.query;
        const numPagina = parseInt(pagina) || 1;

        const limite = parseInt(process.env.LIMIT_PER_PAGE) || 10;
        const offset = (numPagina - 1) * limite;

        let condiciones = {};

        // 1. Búsqueda por texto (corregido con % al inicio y final)
        if (busqueda && busqueda.trim() !== '') {
            const term = `%${busqueda.trim()}%`;
            condiciones[Op.or] = [
                { nombreProducto: { [Op.like]: term } },
                { sku: { [Op.like]: term } },
                { ean: { [Op.like]: term } }
            ];
        }

        // 2. Filtro de Categoría (corregido)
        let categoriaId = parseInt(categoria);
        if (categoriaId > 0) {
            condiciones.idCategoria = { [Op.like]: `%${categoriaId}%` };
        }

        // 3. Filtros de Estado y Web
        if (estado && estado.trim() !== '') {
            condiciones.activo = estado;
        }
        if (web !== undefined && web !== '') {
            condiciones.web = web === 'true' ? 1 : 0;
        }



        // 2. Usamos findAndCountAll para obtener 'count' (total) y 'rows' (productos de la página)
        const { count, rows: productosInstancias } = await Productos.findAndCountAll({
            where: condiciones,
            include: [{ association: 'imagenes', required: false }],
            order: [['createdAt', 'DESC']],
            limit: limite,   // <--- VITAL: Aplicar el límite
            offset: offset,  // <--- VITAL: Aplicar el salto de registros
            distinct: true   // Evita conteos duplicados cuando hay joins
        });

        const totalPaginas = Math.ceil(count / limite);


        // 5. Respuesta JSON
        res.json({
            success: true,
            productos: productosInstancias,
            totalPaginas,
            paginaActual: numPagina,
            totalRegistros: count
        });

    } catch (error) {
        res.status(500).json({ success: false, mensaje: 'Error al procesar productos' });
    }
}


//jsonImageProduct

const jsonImageProduct = async (req, res) => {
    try {
        const { idProducto } = req.params;

        if (!idProducto) {
            return res.status(400).json({
                success: false,
                mensaje: 'idProducto es obligatorio'
            });
        }

        const imagen = await Imagenes.findOne({
            where: {
                idProducto,
                tipo: 'principal'
            }
        });

        res.json({
            success: true,
            imagen
        });

    } catch (error) {
        console.error('jsonImageProduct:', error);
        res.status(500).json({
            success: false,
            mensaje: 'Error al obtener imagen'
        });
    }
};


//Valido si un sku o un ean existen en un registro distinto al que estoy editando.
const jsonUnicidad = async (req, res) => {
    const { tipo, valor } = req.params; // tipo = 'sku' o 'ean'
    const { idProductoActual } = req.query; // Para ignorar el propio producto en edición

    try {
        const query = { [tipo]: valor };

        // Si estamos editando, buscamos otro producto que tenga ese código, excluyendo al actual
        const donde = idProductoActual
            ? { ...query, idProducto: { [Op.ne]: idProductoActual } }
            : query;

        const producto = await Productos.findOne({
            where: donde,
            attributes: ['idProducto', 'nombreProducto']
        });

        res.json(producto);
    } catch (error) {
        res.status(500).json({ error: 'Error al validar código' });
    }
};



//************************[PROVEDORES API & ACTIONS]************************ */



//Verifico nits de provedores. 
const checkNitSupplier = async (req, res) => {
    const { nit } = req.params;
    try {
        const existing = await Provedores.findOne({ where: { taxIdSupplier: nit } });
        // Retornamos true si existe, false si no
        return res.json({ exists: !!existing });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error al verificar NIT' });
    }
};

const saveSupplier = async (req, res) => {
    // 1. Validación básica de campos requeridos (backend backup)
    const { razonSocial, nit, nombreContacto, telefonoContacto, emailProvedor, direccionProvedor, departamentoSelect, ciudadSelect, "categorias[]": categorias } = req.body;

    // Categorias puede venir como string único o array de strings
    let categoriasArray = [];
    if (Array.isArray(categorias)) {
        categoriasArray = categorias;
    } else if (categorias) {
        categoriasArray = [categorias];
    } else if (req.body.categorias) {
        // Si viene como "categorias" en lugar de "categorias[]" (depende de como lo envíe el frontend)
        if (Array.isArray(req.body.categorias)) categoriasArray = req.body.categorias;
        else categoriasArray = [req.body.categorias];
    }

    if (!razonSocial || !nit || categoriasArray.length === 0) {
        return res.status(400).json({ success: false, mensaje: 'Faltan datos obligatorios (Razón Social, NIT o Categorías).' });
    }

    const t = await db.transaction();
    const uploadedFiles = []; // Track uploaded files for rollback

    try {
        // 2. Crear Provedor
        const nuevoProvedor = await Provedores.create({
            razonSocial,
            taxIdSupplier: nit,
            nombreContacto,
            telefonoContacto,
            emailProvedor,
            direccionProvedor,
            departamento: departamentoSelect,
            ciudad: ciudadSelect,
            estado: true
        }, { transaction: t });

        const idProveedor = nuevoProvedor.idProveedor;

        // 3. Asociar Categorías
        if (categoriasArray.length > 0) {
            await nuevoProvedor.addCategorias(categoriasArray, { transaction: t });
        }

        // 4. Procesar Documentos (Upload to R2)
        if (req.files && req.files.length > 0) {
            // Usamos un loop para subir secuencialmente y poder hacer track o map async
            // Preferimos map async para velocidad, pero hay que capturar r2Key

            const docsData = [];

            // Procesamos subidas
            await Promise.all(req.files.map(async (file, index) => {
                const isImage = file.mimetype.startsWith('image/');
                const ext = file.originalname.split('.').pop();
                const nombreArchivo = `doc-${nit}-${Date.now()}-${index}.${isImage ? 'webp' : ext}`;
                const r2Key = `documentacion/provedores/${nombreArchivo}`;

                let bufferToUpload = file.buffer;
                let contentType = file.mimetype;

                if (isImage) {
                    bufferToUpload = await sharp(file.buffer)
                        .resize(1500, 1500, { fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toBuffer();
                    contentType = 'image/webp';
                }

                const upload = new Upload({
                    client: s3Client,
                    params: {
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: r2Key,
                        Body: bufferToUpload,
                        ContentType: contentType,
                    }
                });

                await upload.done();
                uploadedFiles.push(r2Key); // Add to rollback list

                docsData.push({
                    idPropietario: idProveedor,
                    nombreDocumento: file.originalname,
                    keyName: r2Key,
                    formato: isImage ? 'WEBP' : ext.toUpperCase(),
                    pertenece: 'provedor'
                });
            }));

            // Guardar metadata en DB
            if (docsData.length > 0) {
                await Documentacion.bulkCreate(docsData, { transaction: t });
            }
        }

        await t.commit();
        res.json({ success: true, mensaje: 'Provedor guardado con éxito' });

    } catch (error) {
        await t.rollback();
        console.error("Error en saveSupplier:", error);

        // ROLLBACK R2: Eliminar archivos subidos si falla la transacción
        if (uploadedFiles.length > 0) {
            console.log(`Realizando rollback de ${uploadedFiles.length} archivos en R2...`);
            try {
                // DeleteObjectCommand requiere client.send
                await Promise.all(uploadedFiles.map(key =>
                    s3Client.send(new DeleteObjectCommand({
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: key
                    }))
                ));
                console.log("Rollback R2 completado.");
            } catch (r2Error) {
                console.error("Error crítico: Falló el rollback de R2", r2Error);
            }
        }

        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ success: false, mensaje: 'El NIT ya existe en la base de datos.' });
        }
        res.status(500).json({ success: false, mensaje: 'Error interno del servidor al guardar proveedor' });
    }
}; 


const filterSupplierListJson = async (req, res) => {
    try {
        const { busqueda, categoria, pagina = 1 } = req.query;
        //const limit = 10;
        const limit = parseInt(process.env.LIMIT_PER_PAGE) || 10;
        const offset = (pagina - 1) * limit;

        const whereCondition = {};

        // Filtro por búsqueda (Nombre, NIT, Contacto)
        if (busqueda) {
            whereCondition[Sequelize.Op.or] = [
                { razonSocial: { [Sequelize.Op.like]: `%${busqueda}%` } },
                { taxIdSupplier: { [Sequelize.Op.like]: `%${busqueda}%` } },
                { nombreContacto: { [Sequelize.Op.like]: `%${busqueda}%` } }
            ];
        }

        // Configuración de filtro por categoría (requiere include)
        const includeOptions = [
            {
                model: CategoriasDeProvedores,
                as: 'categorias',
                attributes: ['idCategoria', 'nombre'],
                through: { attributes: [] } // No traer atributos de la tabla intermedia
            }
        ];

        // Si hay filtro de categoría, lo aplicamos en el include
        if (categoria) {
            includeOptions[0].where = { idCategoria: categoria };
        }

        const { count, rows } = await Provedores.findAndCountAll({
            where: whereCondition,
            include: includeOptions,
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true // Importante para contar correctamente con includes
        });

        res.json({
            success: true,
            provedores: rows,
            totalPaginas: Math.ceil(count / limit),
            paginaActual: parseInt(pagina),
            totalRegistros: count
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, mensaje: 'Error al obtener proveedores' });
    }
};

export {
    dashboard,
    dashboardStores,
    newStore, // [DELETE?]
    saveStoreBasic,
    verTienda,
    editarTienda,
    postNuevaTienda,
    //postEditStore,
    dashboardInventorys,
    billingToday,
    storeInventory,
    storeEmployers,
    storeDocuments,
    saveProduct, editarProducto, listaProductos, verProducto, newProduct,
    batchBuyOrder,
    dosificar,
    dashboardSupplier, newSupplier, saveSupplier, checkNitSupplier,
    dashboardCustomers,
    dashboardEmployees,
    dashboardOrders,
    dashboardSettings,
    municipiosJson,
    categoriasJson,
    skuJson,
    eanJson,
    filterProductListJson,
    jsonImageProduct,
    jsonUnicidad,
    baseFrondend,
    filterSupplierListJson
}