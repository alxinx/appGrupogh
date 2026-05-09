import { validationResult } from "express-validator";
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import sharp from 'sharp';
import { Upload } from "@aws-sdk/lib-storage";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "../config/r2.js";
import dotenv from 'dotenv';
import db from "../config/bd.js";
import { Departamentos, Municipios, PuntosDeVenta, RegimenFacturacion, Atributos, Categorias, Productos, VariacionesProducto, Imagenes, CategoriasDeProvedores, Documentacion, Provedores, Stock, Pack, Empleados, Usuarios, Egresos, FacturaClientes, DetallesFactura, DetallesPagosFactura, Clientes, CajaTienda, PermisosRecursos, PermisosAcciones, UserPermisos, Entidades } from "../models/index.js";
import { addClient, removeClient, sendEvent, broadcast } from '../helpers/sseManager.js';
import responsabiliidadFiscal from '../src/json/responsabilidadFiscal.json' with { type: 'json' };
import tipoPersonaJuridica from '../src/json/tipoPersonaJuridica.json' with {type: 'json'}
import tipoFacturas from '../src/json/tipoFacturas.json' with {type: 'json'}
import tipoIdentificacion from '../src/json/tipoIdentificacionPersonas.json' with {type: 'json'}
import contratosLaborales from '../src/json/contratosLaborales.json' with {type: 'json'}
import { limpiarPrecio, sanitizarHTML, getAvailability } from '../helpers/helpers.js'
import {mailWelcomeEmployer} from '../helpers/mailNewEmployer.js'
import { Sequelize, Op, where, fn, col } from "sequelize";
import { _generarPDFCuadre } from './storeControllers.js';


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
    });

    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);
    const hoyFin = new Date();
    hoyFin.setHours(23, 59, 59, 999);

    const cajasHoy = await CajaTienda.findAll({
        raw: true,
        attributes: ['idPuntoDeVenta', 'estado', 'fechaApertura', 'fechaCierre'],
        where: {
            fechaApertura: { [Op.between]: [hoyInicio, hoyFin] }
        }
    });

    const cajasMap = {};
    for (const c of cajasHoy) {
        cajasMap[c.idPuntoDeVenta] = c;
    }

    const tiendas = listaPuntosDeVenta.map(t => {
        const caja = cajasMap[t.idPuntoDeVenta];
        let estadoCaja = 'cerrada';
        if (caja && caja.estado === 'abierto' && !caja.fechaCierre) estadoCaja = 'abierta';
        else if (caja && caja.fechaCierre) estadoCaja = 'cuadrada';
        return { ...t, estadoCaja };
    });

    return res.status(201).render('./administrador/stores/homeStores', {
        pagina: "Tiendas",
        subPagina: "Gestión Tiendas",
        csrfToken: req.csrfToken(),
        currentPath: req.path,
        listaPuntosDeVenta: tiendas
    });
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
    return res.render('./administrador/stores/views/listaFacturasDia', { idPuntoDeVenta });
};

const getFacturasJSON = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    const { fecha, pagina = 1, exportar } = req.query;

    try {
        const _hoy = new Date();
        const fechaHoy = `${_hoy.getFullYear()}-${String(_hoy.getMonth()+1).padStart(2,'0')}-${String(_hoy.getDate()).padStart(2,'0')}`;
        const fechaFiltro = fecha || fechaHoy;
        const limite  = exportar === '1' ? 2000 : (parseInt(process.env.LIMIT_PER_PAGE) || 15);
        const offset  = exportar === '1' ? 0 : (parseInt(pagina) - 1) * limite;

        const { count, rows } = await FacturaClientes.findAndCountAll({
            where: { idPuntoDeVenta, fechaEmision: fechaFiltro },
            include: [
                {
                    model: Clientes, as: 'cliente',
                    attributes: ['razon_social', 'primer_nombre', 'primer_apellido', 'tipo_documento', 'numero_doc'],
                    required: false
                },
                {
                    model: Empleados, as: 'vendedor',
                    attributes: ['PrimerNombre', 'PrimerApellido', 'codigoEmpleado'],
                    required: false
                },
                {
                    model: DetallesFactura, as: 'detalles',
                    attributes: ['cantidad', 'total'],
                    required: false
                },
                {
                    model: DetallesPagosFactura, as: 'pagos',
                    attributes: ['metodoPago'],
                    required: false
                }
            ],
            order: [['createdAt', 'DESC']],
            limit: limite,
            offset,
            distinct: true
        });

        const facturasMapped = rows.map(f => {
            const totalVenta   = f.detalles.reduce((s, d) => s + parseFloat(d.total || 0), 0);
            const nroItems     = f.detalles.reduce((s, d) => s + parseInt(d.cantidad || 0), 0);
            const metodos      = [...new Set(f.pagos.map(p => p.metodoPago))].join(', ');
            const cli          = f.cliente;
            const nombreCliente = f.idCliente === '0'
                ? 'Consumidor Final'
                : (cli?.razon_social || `${cli?.primer_nombre || ''} ${cli?.primer_apellido || ''}`.trim() || 'N/A');
            const docCliente   = cli ? `${cli.tipo_documento || ''} ${cli.numero_doc || ''}`.trim() : '';
            const vendedor     = f.vendedor
                ? `${f.vendedor.PrimerNombre} ${f.vendedor.PrimerApellido}`
                : 'N/A';
            return {
                idFacturaCliente: f.idFacturaCliente,
                nroFactura:  `${f.prefijo || ''}${f.numeroFactura}`,
                cliente:     nombreCliente,
                docCliente,
                fechaEmision: f.fechaEmision,
                horaEmision:  f.horaEmision || '',
                total:        totalVenta,
                metodos,
                nroItems,
                vendedor
            };
        });

        return res.json({
            success: true,
            facturas: facturasMapped,
            totalPaginas: exportar === '1' ? 1 : Math.ceil(count / limite),
            paginaActual: parseInt(pagina),
            total: count
        });
    } catch (e) {
        console.error('getFacturasJSON:', e);
        return res.status(500).json({ success: false });
    }
};


const storeInventory = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    return res.render('./administrador/stores/partials/inventoryList', {
        idPuntoDeVenta,
        csrfToken: req.csrfToken()
    });
}

const storeEmployers = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    try {
        const empleados = await Empleados.findAll({
            where: { idPuntoDeVenta },
            attributes: ['idEmpleado', 'PrimerNombre', 'PrimerApellido', 'emailEmpleado', 'NumeroDocumento', 'telefonoContacto', 'codigoEmpleado', 'estado'],
            include: [{ model: PuntosDeVenta, as: 'sede', attributes: ['nombreComercial'] }],
            order: [['PrimerNombre', 'ASC']],
        });

        const estadoBadge = (estado) => {
            const map = {
                activo:     'bg-emerald-100 text-emerald-700',
                suspendido: 'bg-yellow-100 text-yellow-700',
                despedido:  'bg-red-100 text-red-700',
                vacaciones: 'bg-blue-100 text-blue-700',
                enfermedad: 'bg-orange-100 text-orange-700',
                licencia:   'bg-purple-100 text-purple-700',
                otro:       'bg-gray-100 text-gray-600',
            };
            const cls = map[estado] || map.otro;
            return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}">${estado}</span>`;
        };

        const filas = empleados.length === 0
            ? `<tr><td colspan="6" class="px-6 py-10 text-center text-slate-400 text-sm">
                   <i class="fi-rr-user-slash text-2xl block mb-2"></i>
                   No hay empleados asignados a esta tienda.
               </td></tr>`
            : empleados.map(e => {
                const sede = e.sede ? e.sede.nombreComercial : '<span class="text-gray-400 italic text-xs">Sin sede</span>';
                return `
                <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td class="px-6 py-4">
                        <p class="font-bold text-slate-800">${e.PrimerNombre} ${e.PrimerApellido}</p>
                        <p class="text-xs text-slate-400">${e.emailEmpleado || ''}</p>
                        <p class="mt-0.5">${estadoBadge(e.estado)}</p>
                    </td>
                    <td class="px-4 py-4 text-center text-sm text-slate-600">${e.NumeroDocumento || '--'}</td>
                    <td class="px-4 py-4 text-center text-sm text-slate-600">${e.telefonoContacto || '--'}</td>
                    <td class="px-4 py-4 text-center">
                        <span
                            class="codigo-empleado font-mono text-xs bg-slate-100 px-2 py-1 rounded cursor-pointer select-none"
                            style="filter:blur(5px); transition:filter 0.25s ease;"
                            title="Doble clic para revelar"
                        >${e.codigoEmpleado}</span>
                    </td>
                    <td class="px-4 py-4 text-center text-sm text-slate-600">${sede}</td>
                    <td class="px-6 py-4 text-center">
                        <a href="/admin/personal/ver/${e.idEmpleado}" class="btn btn-secondary text-xs">
                            <i class="fi-rr-eye text-xs"></i> Ver más
                        </a>
                    </td>
                </tr>`;
            }).join('');

        res.send(`
            <div class="bg-gray-50 rounded-t-2xl p-3 shadow-sm border border-slate-100 overflow-hidden">
                <h2 class="h2 text-gh-primaryHover">
                    <i class="fi-rr-users-alt"></i> Personal Asignado
                </h2>
                <p class="text-sm text-slate-400">Empleados vinculados a este punto de venta</p>
                <div class="overflow-x-auto pt-4">
                    <table class="w-full text-left text-2xs border-collapse">
                        <thead>
                            <tr class="border-b border-gh-primaryHover text-sm transition-colors">
                                <th class="px-6 py-4 text-gray-600">Empleado</th>
                                <th class="px-4 py-4 text-center text-gray-600">Documento</th>
                                <th class="px-4 py-4 text-center text-gray-600">Teléfono</th>
                                <th class="px-4 py-4 text-center text-gray-600">Código</th>
                                <th class="px-4 py-4 text-center text-gray-600">Sede Asignada</th>
                                <th class="px-6 py-4 text-center text-gray-600"></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">${filas}</tbody>
                    </table>
                </div>
                <div class="px-4 py-4 bg-slate-50/30 border-t border-slate-100">
                    <p class="text-xs text-slate-400">${empleados.length} empleado${empleados.length !== 1 ? 's' : ''} en esta tienda</p>
                </div>
            </div>
        `);
    } catch (error) {
        console.error('Error en storeEmployers:', error);
        return res.status(500).send(`<div class="p-6 text-center text-red-500">Error al cargar empleados.</div>`);
    }
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

const stockTotalProducto = async (req, res) => {
    const { idProducto } = req.params;
    try {
        const total = await Stock.sum('cantidadExistente', { where: { idProducto } });
        return res.json({ stockTotal: total || 0 });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ stockTotal: 0 });
    }
}

const unidadesVendidasProducto = async (req, res) => {
    const { idProducto } = req.params;
    try {
        const ahora   = new Date();
        const hace30  = new Date(ahora); hace30.setDate(ahora.getDate() - 30);
        const hace60  = new Date(ahora); hace60.setDate(ahora.getDate() - 60);

        const sumar = async (desde, hasta) => {
            const filas = await DetallesFactura.findAll({
                attributes: [[fn('SUM', col('DETALLES_FACTURA.cantidad')), 'total']],
                where: { idProducto },
                include: [{
                    model: FacturaClientes,
                    as: 'factura',
                    attributes: [],
                    where: { fechaEmision: { [Op.between]: [desde, hasta] } },
                    required: true
                }],
                raw: true
            });
            return parseInt(filas[0]?.total) || 0;
        };

        const [actual, anterior] = await Promise.all([
            sumar(hace30, ahora),
            sumar(hace60, hace30)
        ]);

        const variacion = anterior === 0
            ? (actual > 0 ? 100 : 0)
            : Math.round(((actual - anterior) / anterior) * 100);

        const tendencia = actual > anterior ? 'up' : actual < anterior ? 'down' : 'equal';

        return res.json({ success: true, actual, anterior, variacion, tendencia });
    } catch (error) {
        console.error('unidadesVendidasProducto:', error);
        return res.status(500).json({ success: false });
    }
}

const diasInventarioProducto = async (req, res) => {
    const { idProducto } = req.params;
    const DIAS = 14;

    try {
        const desde = new Date();
        desde.setDate(desde.getDate() - DIAS);

        // 1. Ponderado diario: unidades vendidas en los últimos 14 días / 14
        const filasVentas = await DetallesFactura.findAll({
            attributes: [[fn('SUM', col('DETALLES_FACTURA.cantidad')), 'total']],
            where: { idProducto },
            include: [{
                model: FacturaClientes,
                as: 'factura',
                attributes: [],
                where: { fechaEmision: { [Op.gte]: desde } },
                required: true
            }],
            raw: true
        });
        const vendidos14d    = parseInt(filasVentas[0]?.total) || 0;
        const ponderadoDiario = vendidos14d / DIAS;

        // 2. Stock actual
        const stockActual = await Stock.sum('cantidadExistente', {
            where: { idProducto, cantidadExistente: { [Op.gt]: 0 } }
        }) || 0;

        // 3. Días de inventario
        const dias = ponderadoDiario > 0
            ? Math.round(stockActual / ponderadoDiario)
            : stockActual > 0 ? 999 : 0;

        // 4. Estado
        let estado, mensaje;
        if (dias <= 10)       { estado = 'critico';    mensaje = 'URGE REPONER INVENTARIO'; }
        else if (dias <= 20)  { estado = 'alerta';     mensaje = 'Te recomiendo hacer reposición'; }
        else                  { estado = 'suficiente'; mensaje = 'Hay suficiente inventario'; }

        return res.json({ success: true, dias, estado, mensaje, stockActual, ponderadoDiario: Math.round(ponderadoDiario * 10) / 10 });
    } catch (error) {
        console.error('diasInventarioProducto:', error);
        return res.status(500).json({ success: false });
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



//DASHBOARD DOSIDI
const dosificar = async (req, res) => {
    return res.status(201).render('./administrador/dose/new', {
        pagina: "Dosificacion de productos",
        subPagina: "Dosificar Productos",
        csrfToken: req.csrfToken(),
        currentPath: '/inventario',
        subPath: 'dosificar',
        btnName: "Pre-Calcular"
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
        btnName: 'Guardar Factura'
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



//***************************[EMPLEADOS]*************************************/

//HOME
const dashboardEmployees = async (req, res) => {
    try {
        const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
        const r2 = process.env.R2_PUBLIC_URL || '';

        // Top 3 vendedores del mes (solo usuarios con rol STORE)
        const topVendedores = await db.query(`
            SELECT
                e.idEmpleado,
                e.PrimerNombre,
                e.PrimerApellido,
                e.imagen,
                SUM(df.total)                       AS totalVendido,
                COUNT(DISTINCT fc.idFacturaCliente) AS nroFacturas
            FROM FACTURA_CLIENTES fc
            INNER JOIN DETALLES_FACTURA df ON df.idFacturaCliente = fc.idFacturaCliente
            INNER JOIN EMPLEADOS e          ON e.idEmpleado = fc.idEmpleado
            INNER JOIN USUARIOS u           ON u.idUsuario  = e.idUsuario
            WHERE fc.createdAt >= :inicioMes
              AND fc.idEmpleado IS NOT NULL
              AND e.deletedAt  IS NULL
              AND u.permisos   = 'STORE'
            GROUP BY e.idEmpleado, e.PrimerNombre, e.PrimerApellido, e.imagen
            ORDER BY totalVendido DESC
            LIMIT 3
        `, { replacements: { inicioMes }, type: Sequelize.QueryTypes.SELECT });

        // Top productos del vendedor #1
        let topProductos = [];
        if (topVendedores.length > 0) {
            topProductos = await db.query(`
                SELECT
                    p.nombreProducto,
                    SUM(df.cantidad) AS unidades
                FROM FACTURA_CLIENTES fc
                INNER JOIN DETALLES_FACTURA df ON df.idFacturaCliente = fc.idFacturaCliente
                INNER JOIN PRODUCTOS p          ON p.idProducto = df.idProducto
                WHERE fc.createdAt  >= :inicioMes
                  AND fc.idEmpleado  = :idEmpleado
                GROUP BY p.idProducto, p.nombreProducto
                ORDER BY unidades DESC
                LIMIT 3
            `, { replacements: { inicioMes, idEmpleado: topVendedores[0].idEmpleado }, type: Sequelize.QueryTypes.SELECT });
        }

        // Construir URLs de imagen
        const vendedores = topVendedores.map(v => ({
            ...v,
            totalVendido: Math.round(parseFloat(v.totalVendido || 0)),
            fotoUrl: v.imagen ? `${r2}/${v.imagen}` : null,
        }));

        return res.render('./administrador/employeers/homeEmployees', {
            pagina: 'Empleados',
            subPagina: 'Dashboard Empleados',
            subPath: 'dashboard',
            csrfToken: req.csrfToken(),
            currentPath: req.path,
            vendedores,
            topProductos,
        });
    } catch (e) {
        console.error('dashboardEmployees:', e);
        return res.render('./administrador/employeers/homeEmployees', {
            pagina: 'Empleados',
            subPagina: 'Dashboard Empleados',
            subPath: 'dashboard',
            csrfToken: req.csrfToken(),
            currentPath: req.path,
            vendedores: [],
            topProductos: [],
        });
    }
}


const newEmployer = async (req, res) => {

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

    // Obtener puntos de venta y bodegas para el select condicional
    const puntosDeVenta = await PuntosDeVenta.findAll({
        where: {
            tipo: { [Op.in]: ['Punto de venta', 'Bodega'] }
        },
        raw: true
    });

    return res.status(201).render('./administrador/employeers/new', {
        pagina: "Empleados",
        subPagina: 'Nuevo Empleado',
        subPath: 'newEmployer',
        csrfToken: req.csrfToken(),
        currentPath: req.path,
        departamentos: departamentos,
        ciudades: ciudades,
        tipoIdentificacion,
        contratosLaborales,
        puntosDeVenta,
        btnName: 'Guardar Empleado'
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

const checkDocumentoPersonal = async (req, res) => {
    const { tipo, numero } = req.params;
    const { exclude } = req.query;
    try {
        const where = { TipoDocumento: tipo, NumeroDocumento: numero };
        if (exclude) where.idEmpleado = { [Op.ne]: exclude };
        const empleado = await Empleados.findOne({ where });
        return res.json({ exists: !!empleado });
    } catch (error) {
        console.error("Error en checkDocumentoPersonal:", error);
        return res.status(500).json({ success: false });
    }
}

const checkEmailPersonal = async (req, res) => {
    const { email } = req.params;
    const { exclude } = req.query;
    try {
        const where = { emailEmpleado: email };
        if (exclude) where.idEmpleado = { [Op.ne]: exclude };
        const empleado = await Empleados.findOne({ where });
        return res.json({ exists: !!empleado });
    } catch (error) {
        console.error("Error en checkEmailPersonal:", error);
        return res.status(500).json({ success: false });
    }
}

const filterEmployeeListJson = async (req, res) => {
    try {
        const { busqueda, pagina = 1 } = req.query;
        const limite = parseInt(process.env.LIMIT_PER_PAGE) || 10;
        const offset = (parseInt(pagina) - 1) * limite;

        let condiciones = {};
        if (busqueda && busqueda.trim() !== '') {
            const term = `%${busqueda.trim()}%`;
            condiciones[Op.or] = [
                { PrimerNombre: { [Op.like]: term } },
                { PrimerApellido: { [Op.like]: term } },
                { NumeroDocumento: { [Op.like]: term } },
                { emailEmpleado: { [Op.like]: term } },
                { codigoEmpleado: { [Op.like]: term } },
            ];
        }

        const { count, rows: empleados } = await Empleados.findAndCountAll({
            where: condiciones,
            include: [{ model: PuntosDeVenta, as: 'sede', attributes: ['idPuntoDeVenta', 'nombreComercial'] }],
            order: [['createdAt', 'DESC']],
            limit: limite,
            offset,
            distinct: true,
        });

        return res.json({
            success: true,
            empleados,
            totalPaginas: Math.ceil(count / limite),
            paginaActual: parseInt(pagina),
            totalRegistros: count,
        });
    } catch (error) {
        console.error('Error en filterEmployeeListJson:', error);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar empleados' });
    }
}

const buscarEmpleadoPorCodigo = async (req, res) => {
    const { codigo } = req.params;
    try {
        const empleado = await Empleados.findOne({
            where: { codigoEmpleado: codigo.trim().toUpperCase() },
            attributes: ['idEmpleado', 'PrimerNombre', 'PrimerApellido', 'codigoEmpleado']
        });
        if (!empleado) return res.json({ success: false });
        return res.json({
            success: true,
            idEmpleado: empleado.idEmpleado,
            nombre: `${empleado.PrimerNombre} ${empleado.PrimerApellido}`
        });
    } catch (error) {
        console.error('Error en buscarEmpleadoPorCodigo:', error);
        return res.status(500).json({ success: false });
    }
};

const saveEmployee = async (req, res) => {
    const {
        PrimerNombre, OtrosNombres, PrimerApellido, SegundoApellido,
        TipoDocumento, NumeroDocumento, fechaNacimiento, direccionResidencia,
        departamentoSelect, ciudadSelect, emailEmpleado, telefonoContacto,
        contactoEmergencia, telefonoEmergencia, fechaIngreso, tipoContrato,
        cargo, salarioBase, comisiones, idPuntoDeVenta
    } = req.body;

    const t = await db.transaction();
    const uploadedFiles = [];

    try {
        // 1. Generar código de empleado aleatorio de 5 dígitos
        let codigoUnico = false;
        let codigoEmpleado;
        while (!codigoUnico) {
            codigoEmpleado = Math.floor(10000 + Math.random() * 90000).toString();
            const exists = await Empleados.findOne({ where: { codigoEmpleado } });
            if (!exists) codigoUnico = true;
        }

        // 2. Determinar idPuntoDeVenta final
        const administrativeId = '00000000-0000-0000-0000-000000000000';
        const finalIdPuntoDeVenta = (cargo === 'vendedor' || cargo === 'bodega') ? (idPuntoDeVenta || administrativeId) : administrativeId;

        // 3. Crear registro de empleado
        const empleado = await Empleados.create({
            idPuntoDeVenta: finalIdPuntoDeVenta,
            TipoDocumento,
            NumeroDocumento,
            PrimerNombre,
            OtrosNombres,
            PrimerApellido,
            SegundoApellido,
            telefonoContacto,
            emailEmpleado,
            fechaIngreso,
            fechaNacimiento,
            departamento: departamentoSelect,
            ciudad: ciudadSelect,
            direccionResidencia,
            contactoEmergencia,
            telefonoEmergencia,
            tipoContrato,
            cargo,
            salarioBase: limpiarPrecio(salarioBase),
            comisiones: comisiones === 'on',
            codigoEmpleado,
            estado: 'activo'
        }, { transaction: t });

        // 3. Crear Usuario si aplica
        let usuarioCreado = null;
        const rolesConUsuario = {
            'vendedor': 'STORE',
            'bodega': 'EMPLOYER',
            'administrativo': 'ADMIN'
        };

        if (rolesConUsuario[cargo]) {
            usuarioCreado = await Usuarios.create({
                nombreUsuario: PrimerNombre,
                apellidoUsuario: PrimerApellido,
                emailUsuario: emailEmpleado,
                password: NumeroDocumento,
                permisos: rolesConUsuario[cargo]
            }, { transaction: t });

            await empleado.update({ idUsuario: usuarioCreado.idUsuario }, { transaction: t });
            
            // 4. Enviar Email (Nodemailer)
                mailWelcomeEmployer({ emailEmpleado, PrimerNombre, codigoEmpleado });
        }

        // 5. Procesar Foto (perfil/)
        if (req.files && req.files.fotoEmpleado) {
            const file = req.files.fotoEmpleado[0];
            const namePhoto = `perfil-${NumeroDocumento}-${Date.now()}.webp`;
            const keyPhoto = `documentacion/empleados/perfil/${namePhoto}`;

            const buffer = await sharp(file.buffer)
                .resize(500, 500, { fit: 'cover' })
                .webp({ quality: 80 })
                .toBuffer();

            const upload = new Upload({
                client: s3Client,
                params: {
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: keyPhoto,
                    Body: buffer,
                    ContentType: 'image/webp'
                }
            });

            await upload.done();
            uploadedFiles.push(keyPhoto);
            await empleado.update({ imagen: keyPhoto }, { transaction: t });
        }

        // 6. Guardar permisos en USER_PERMISOS
        if (usuarioCreado && req.body.permisosJSON) {
            const parsed = JSON.parse(req.body.permisosJSON);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const filas = parsed.map(({ idRecurso, idAccion }) => ({
                    idUsuario: usuarioCreado.idUsuario,
                    idRecurso,
                    idAccion,
                }));
                await UserPermisos.bulkCreate(filas, { transaction: t });
            }
        }

        // 7. Procesar Documentos (empleados/)
        if (req.files && req.files.documentos) {
            const docsData = await Promise.all(req.files.documentos.map(async (file, idx) => {
                const ext = file.originalname.split('.').pop();
                const nameDoc = `doc-${NumeroDocumento}-${Date.now()}-${idx}.${ext}`;
                const keyDoc = `documentacion/empleados/${nameDoc}`;

                const upload = new Upload({
                    client: s3Client,
                    params: {
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: keyDoc,
                        Body: file.buffer,
                        ContentType: file.mimetype
                    }
                });

                await upload.done();
                uploadedFiles.push(keyDoc);

                return {
                    idPropietario: empleado.idEmpleado,
                    nombreDocumento: file.originalname,
                    keyName: keyDoc,
                    formato: ext.toUpperCase(),
                    pertenece: 'empleado'
                };
            }));

            await Documentacion.bulkCreate(docsData, { transaction: t });
        }

        await t.commit();
        res.json({ success: true, mensaje: 'Empleado registrado con éxito. Código: ' + codigoEmpleado });

    } catch (error) {
        await t.rollback();
        console.error("ERROR SAVE_EMPLOYEE:", error);

        // Rollback R2
        if (uploadedFiles.length > 0) {
            await Promise.all(uploadedFiles.map(key =>
                s3Client.send(new DeleteObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: key
                }))
            )).catch(err => console.error("Error rollback R2:", err));
        }

        res.status(500).json({ success: false, mensaje: 'Error al registrar el empleado: ' + error.message });
    }
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
        const slug = req.body.slug?.trim() ||
            req.body.nombreProducto.toString().toLowerCase().trim()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-');

        const nombreProducto = req.body.nombreProducto
            .trim()
            .toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase());

        let producto;
        const datosParaDB = {
            nombreProducto,
            slug,
            sku: req.body.sku,
            ean: req.body.ean,
            idCategoria: idCategoriaParaDB,
            precioVentaPublicoFinal,
            precioVentaMayorista,
            descripcion: descripcionLimpia,
            activo,
            web,
            tags: req.body.tags
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
            const tienePrincipal = await Imagenes.findOne({
                where: { idProducto: idReal, tipo: 'principal' }
            });

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
                    tipo: (!tienePrincipal && index === 0) ? 'principal' : 'galeria'
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




        res.json({ success: true, mensaje: 'Producto guardado con éxito', idProducto: nuevoProducto.idProducto });
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
    try {
        const { checkSku } = req.params;
        const sku = await Productos.findOne({
            where: { sku: checkSku },
            attributes: ['idProducto', 'nombreProducto', 'sku', 'ean'],
            raw: true
        });

        if (!sku) {
            return res.status(404).json({ msg: 'Producto no encontrado' });
        }

        return res.json(sku);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ msg: 'Error en el servidor' });
    }
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

        const ids = productosInstancias.map(p => p.idProducto);
        const stockRows = await Stock.findAll({
            where: { idProducto: { [Op.in]: ids } },
            attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'stockGlobal']],
            group: ['idProducto'],
            raw: true
        });
        const mapStock = Object.fromEntries(stockRows.map(r => [r.idProducto, parseInt(r.stockGlobal) || 0]));

        const productos = productosInstancias.map(p => ({
            ...p.toJSON(),
            stockGlobal: mapStock[p.idProducto] || 0
        }));

        // 5. Respuesta JSON
        res.json({
            success: true,
            productos,
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

const filterStoreInventoryJson = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    const { busqueda, pagina } = req.query;
    const limit = parseInt(process.env.LIMIT_PER_PAGE) || 5;
    const offset = (parseInt(pagina) - 1) * limit;

    try {
        const searchPattern = `%${busqueda || ''}%`;

        // 1. Get total count for pagination (using UNION)
        const countQuery = `
            SELECT COUNT(*) as total FROM (
                SELECT s.idStock
                FROM STOCKS s
                LEFT JOIN PRODUCTOS p ON s.idProducto = p.idProducto
                LEFT JOIN PACKS pk ON s.idPack = pk.idPack
                WHERE s.idPuntoVenta = :idPuntoDeVenta 
                AND s.idPack IS NOT NULL
                AND (p.nombreProducto LIKE :search OR p.sku LIKE :search OR pk.codigoEtiqueta LIKE :search)
                
                UNION ALL
                
                SELECT s.idProducto
                FROM STOCKS s
                LEFT JOIN PRODUCTOS p ON s.idProducto = p.idProducto
                WHERE s.idPuntoVenta = :idPuntoDeVenta 
                AND s.idPack IS NULL
                AND (p.nombreProducto LIKE :search OR p.sku LIKE :search)
                GROUP BY s.idProducto
            ) as combined`;

        const [countResult] = await db.query(countQuery, {
            replacements: { idPuntoDeVenta, search: searchPattern },
            type: Sequelize.QueryTypes.SELECT
        });

        const totalItems = countResult.total;
        const totalPaginas = Math.ceil(totalItems / limit);

        // 2. Get the paginated data
        const dataQuery = `
            SELECT 
                s.idStock, 
                s.idPack, 
                s.idProducto, 
                s.cantidadExistente as cantidad,
                p.nombreProducto,
                p.sku,
                pk.codigoEtiqueta,
                'pack' as tipoRecord
            FROM STOCKS s
            LEFT JOIN PRODUCTOS p ON s.idProducto = p.idProducto
            LEFT JOIN PACKS pk ON s.idPack = pk.idPack
            WHERE s.idPuntoVenta = :idPuntoDeVenta 
            AND s.idPack IS NOT NULL
            AND (p.nombreProducto LIKE :search OR p.sku LIKE :search OR pk.codigoEtiqueta LIKE :search)
            
            UNION ALL
            
            SELECT 
                NULL as idStock,
                NULL as idPack,
                s.idProducto,
                SUM(s.cantidadExistente) as cantidad,
                p.nombreProducto,
                p.sku,
                NULL as codigoEtiqueta,
                'loose' as tipoRecord
            FROM STOCKS s
            LEFT JOIN PRODUCTOS p ON s.idProducto = p.idProducto
            WHERE s.idPuntoVenta = :idPuntoDeVenta 
            AND s.idPack IS NULL
            AND (p.nombreProducto LIKE :search OR p.sku LIKE :search)
            GROUP BY s.idProducto

            ORDER BY CASE WHEN cantidad <= 0 THEN 1 ELSE 0 END ASC, nombreProducto ASC
            LIMIT :limit OFFSET :offset`;

        const inventory = await db.query(dataQuery, {
            replacements: { idPuntoDeVenta, search: searchPattern, limit, offset },
            type: Sequelize.QueryTypes.SELECT
        });

        // 3. Get images and availability for each item
        const processedInventory = await Promise.all(inventory.map(async (item) => {
            let imagenUrl = '/img/avatars/bag.webp';
            let displayProducto = item.codigoEtiqueta || item.nombreProducto;
            let displaySku = item.codigoEtiqueta ? '' : item.sku;

            if (item.tipoRecord === 'loose' || !item.idPack) {
                const img = await Imagenes.findOne({
                    where: { idProducto: item.idProducto, tipo: 'principal' }
                });
                imagenUrl = img ? `${process.env.R2_PUBLIC_URL}/productos/${img.nombreImagen}` : '/img/image-default.webp';
                displayProducto = item.nombreProducto;
                displaySku = item.sku;
            }

            const availability = getAvailability(item.cantidad);

            return {
                ...item,
                imagenUrl,
                displayProducto,
                displaySku,
                availability
            };
        }));

        res.json({
            success: true,
            inventory: processedInventory,
            totalPaginas,
            paginaActual: parseInt(pagina) || 1
        });

    } catch (error) {
        console.error("ERROR EN filterStoreInventoryJson:", error);
        res.status(500).json({ success: false, mensaje: 'Error al cargar el inventario' });
    }
}

// ─── ETIQUETA SKU (PDF 5.5×2.5 cm landscape) ────────────────────────────────
const imprimirEtiquetaSKU = async (req, res) => {
    const { idProducto } = req.params;

    const producto = await Productos.findOne({
        where: { idProducto },
        attributes: ['sku', 'nombreProducto']
    });
    if (!producto?.sku) return res.status(404).send('Producto no encontrado.');

    const sku = producto.sku;
    const nombre = producto.nombreProducto;

    // 5.5 cm = 155.91 pt (ancho) | 2.5 cm = 70.87 pt (alto)
    const W  = 155.91;
    const H  = 70.87;
    const mx = 4;

    try {
        const doc = new PDFDocument({ size: [W, H], margins: { top: mx, bottom: mx, left: mx, right: mx } });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=sku_${sku}.pdf`);
        doc.pipe(res);

        // Barcode (sin texto incluido, sin título)
        const buffer = await bwipjs.toBuffer({
            bcid:        'code128',
            text:        sku,
            scale:       2,
            height:      9,
            includetext: false,
        });
        doc.image(buffer, mx, mx, { width: W - mx * 2 });

        // Nombre del producto centrado bajo el barcode
        doc.fontSize(10).font('Helvetica-Bold')
           .text(nombre, mx, 50, { width: W - mx * 3, align: 'center' });

        doc.end();
    } catch (e) {
        console.error('imprimirEtiquetaSKU:', e);
        res.status(500).send('Error al generar la etiqueta.');
    }
};

// ─── STATS DETALLE TIENDA HOY ─────────────────────────────────────────────────
const METODOS_PAGO = ['Efectivo', 'Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito'];

const getTiendaStatsHoyDetalle = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    try {
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

        const facturasHoy = await FacturaClientes.findAll({
            attributes: ['idFacturaCliente'],
            where: { idPuntoDeVenta, createdAt: { [Op.gte]: hoy } },
            raw: true
        });

        let ventasHoy = 0;
        const pagos = Object.fromEntries(METODOS_PAGO.map(m => [m, 0]));

        if (facturasHoy.length) {
            const ids = facturasHoy.map(f => f.idFacturaCliente);
            const [detallesRows, pagosRows] = await Promise.all([
                DetallesFactura.findAll({
                    attributes: [[fn('SUM', col('total')), 'suma']],
                    where: { idFacturaCliente: { [Op.in]: ids } },
                    raw: true
                }),
                DetallesPagosFactura.findAll({
                    attributes: ['metodoPago', [fn('SUM', col('valor')), 'total']],
                    where: { idFacturaCliente: { [Op.in]: ids } },
                    group: ['metodoPago'],
                    raw: true
                })
            ]);
            ventasHoy = parseFloat(detallesRows[0]?.suma || 0);
            for (const r of pagosRows) {
                if (Object.prototype.hasOwnProperty.call(pagos, r.metodoPago)) {
                    pagos[r.metodoPago] = parseFloat(r.total || 0);
                }
            }
        }

        return res.json({ success: true, ventasHoy, pagos });
    } catch (e) {
        console.error('getTiendaStatsHoyDetalle:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── PAGOS HOY POR MÉTODO ─────────────────────────────────────────────────────
const getPagosHoyPorMetodo = async (req, res) => {
    const { idPuntoDeVenta, metodoPago } = req.params;
    const metodo = decodeURIComponent(metodoPago);
    const metodosValidos = ['Efectivo', 'Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito'];
    if (!metodosValidos.includes(metodo)) return res.status(400).json({ success: false, mensaje: 'Método inválido' });

    try {
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

        const facturasHoy = await FacturaClientes.findAll({
            attributes: ['idFacturaCliente', 'prefijo', 'numeroFactura', 'horaEmision'],
            where: { idPuntoDeVenta, createdAt: { [Op.gte]: hoy } },
            raw: true
        });

        if (!facturasHoy.length) return res.json({ success: true, movimientos: [], total: 0 });

        const ids = facturasHoy.map(f => f.idFacturaCliente);
        const facturaMap = Object.fromEntries(facturasHoy.map(f => [f.idFacturaCliente, f]));

        const pagos = await DetallesPagosFactura.findAll({
            attributes: ['idFacturaCliente', 'valor', 'nroReferencia'],
            where: { idFacturaCliente: { [Op.in]: ids }, metodoPago: metodo },
            order: [['create_at', 'ASC']],
            raw: true
        });

        const movimientos = pagos.map(p => {
            const f = facturaMap[p.idFacturaCliente] || {};
            return {
                nroFactura: `${f.prefijo || ''}${f.numeroFactura || '—'}`,
                hora: f.horaEmision || '—',
                valor: parseFloat(p.valor),
                referencia: p.nroReferencia || '—'
            };
        });

        const total = movimientos.reduce((s, m) => s + m.valor, 0);
        return res.json({ success: true, movimientos, total });
    } catch (e) {
        console.error('getPagosHoyPorMetodo:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── ADMIN SSE ───────────────────────────────────────────────────────────────
const adminSseConnect = (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    addClient('__ADMIN__', res);
    const hb = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
        clearInterval(hb);
        removeClient('__ADMIN__', res);
    });
};

// ─── STATS TIENDAS HOY ────────────────────────────────────────────────────────
const getTiendasStatsHoy = async (req, res) => {
    try {
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

        const [facturasHoy, egresosRows] = await Promise.all([
            FacturaClientes.findAll({
                attributes: ['idPuntoDeVenta', 'idFacturaCliente'],
                where: { createdAt: { [Op.gte]: hoy } },
                raw: true
            }),
            Egresos.findAll({
                attributes: ['idPuntoDeVenta', [fn('SUM', col('valorEgreso')), 'totalEgresos']],
                where: { createdAt: { [Op.gte]: hoy } },
                group: ['idPuntoDeVenta'],
                raw: true
            })
        ]);

        // Agrupar ventas por PDV usando DetallesFactura
        const ventaMap = {};
        if (facturasHoy.length) {
            const factIds = facturasHoy.map(f => f.idFacturaCliente);
            const detallesRows = await DetallesFactura.findAll({
                attributes: ['idFacturaCliente', [fn('SUM', col('total')), 'suma']],
                where: { idFacturaCliente: { [Op.in]: factIds } },
                group: ['idFacturaCliente'],
                raw: true
            });
            const pdvMap = Object.fromEntries(facturasHoy.map(f => [f.idFacturaCliente, f.idPuntoDeVenta]));
            for (const row of detallesRows) {
                const pdv = pdvMap[row.idFacturaCliente];
                ventaMap[pdv] = (ventaMap[pdv] || 0) + parseFloat(row.suma || 0);
            }
        }

        const egresoMap = Object.fromEntries(egresosRows.map(r => [r.idPuntoDeVenta, parseFloat(r.totalEgresos || 0)]));

        const pdvs = await PuntosDeVenta.findAll({ attributes: ['idPuntoDeVenta'], raw: true });
        const stats = pdvs.map(p => ({
            idPuntoDeVenta: p.idPuntoDeVenta,
            ventasHoy: ventaMap[p.idPuntoDeVenta] || 0,
            egresosHoy: egresoMap[p.idPuntoDeVenta] || 0
        }));

        const ventasGlobalesHoy = Math.round(Object.values(ventaMap).reduce((a, b) => a + b, 0));

        // Ticket promedio hoy
        const totalFacturasHoy   = facturasHoy.length;
        const ticketPromedioHoy  = totalFacturasHoy > 0 ? Math.round(ventasGlobalesHoy / totalFacturasHoy) : 0;

        // Mismo día hace 7 días
        const hace7dias    = new Date(); hace7dias.setDate(hace7dias.getDate() - 7); hace7dias.setHours(0, 0, 0, 0);
        const hace7diasFin = new Date(hace7dias); hace7diasFin.setHours(23, 59, 59, 999);

        const facturasHace7dias = await FacturaClientes.findAll({
            attributes: ['idFacturaCliente'],
            where: { createdAt: { [Op.between]: [hace7dias, hace7diasFin] } },
            raw: true
        });

        let ticketPromedioAnterior = 0;
        if (facturasHace7dias.length) {
            const factIds7   = facturasHace7dias.map(f => f.idFacturaCliente);
            const detalles7  = await DetallesFactura.findAll({
                attributes: [[fn('SUM', col('total')), 'suma']],
                where: { idFacturaCliente: { [Op.in]: factIds7 } },
                raw: true
            });
            const total7 = parseFloat(detalles7[0]?.suma || 0);
            ticketPromedioAnterior = facturasHace7dias.length > 0 ? Math.round(total7 / facturasHace7dias.length) : 0;
        }

        const ticketPct = ticketPromedioAnterior > 0
            ? Math.round(((ticketPromedioHoy - ticketPromedioAnterior) / ticketPromedioAnterior) * 100)
            : null;

        // Ventas del mes actual por día
        const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
        const diasTranscurridos = new Date().getDate();

        const ventasPorDia = await db.query(`
            SELECT DATE(fc.createdAt) AS dia, SUM(df.total) AS suma
            FROM FACTURA_CLIENTES fc
            INNER JOIN DETALLES_FACTURA df ON df.idFacturaCliente = fc.idFacturaCliente
            WHERE fc.createdAt >= :inicioMes
            GROUP BY DATE(fc.createdAt)
            ORDER BY dia ASC
        `, { replacements: { inicioMes }, type: Sequelize.QueryTypes.SELECT });

        const ventasMes = Math.round(ventasPorDia.reduce((a, r) => a + parseFloat(r.suma || 0), 0));

        // Últimos 7 días (con días sin ventas = 0)
        const hoyDate = new Date();
        const ultimos7 = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(hoyDate);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const found = ventasPorDia.find(r => {
                const diaStr = r.dia instanceof Date ? r.dia.toISOString().slice(0, 10) : String(r.dia).slice(0, 10);
                return diaStr === key;
            });
            ultimos7.push(found ? Math.round(parseFloat(found.suma)) : 0);
        }

        // Totales globales por método de pago
        let pagosGlobales = { efectivo: 0, transBill: 0, tCredito: 0, creditos: 0 };
        if (facturasHoy.length) {
            const factIds = facturasHoy.map(f => f.idFacturaCliente);
            const pagosRows = await DetallesPagosFactura.findAll({
                attributes: ['metodoPago', [fn('SUM', col('valor')), 'total']],
                where: { idFacturaCliente: { [Op.in]: factIds } },
                group: ['metodoPago'],
                raw: true
            });
            for (const r of pagosRows) {
                const v = Math.round(parseFloat(r.total || 0));
                if (r.metodoPago === 'Efectivo')                                       pagosGlobales.efectivo  += v;
                else if (r.metodoPago === 'Banco' || r.metodoPago === 'Billetera Virtual') pagosGlobales.transBill += v;
                else if (r.metodoPago === 'Tarjeta Credito')                           pagosGlobales.tCredito  += v;
                else if (r.metodoPago === 'Entidad Crediticia')                        pagosGlobales.creditos  += v;
            }
        }

        return res.json({ success: true, stats, ventasGlobalesHoy, pagosGlobales, ticketPromedio: ticketPromedioHoy, ticketPct, ventasMes, diasTranscurridos, ultimos7 });
    } catch (e) {
        console.error('getTiendasStatsHoy:', e);
        return res.status(500).json({ success: false });
    }
};

const verEmpleado = async (req, res) => {
    const { idEmpleado } = req.params;
    try {
        const [empleado, documentos, departamentos, puntosDeVenta] = await Promise.all([
            Empleados.findByPk(idEmpleado, { raw: true }),
            Documentacion.findAll({
                where: { idPropietario: idEmpleado, pertenece: 'empleado' },
                order: [['createdAt', 'DESC']],
                raw: true
            }),
            Departamentos.findAll({ raw: true }),
            PuntosDeVenta.findAll({
                where: { tipo: { [Op.in]: ['Punto de venta', 'Bodega'] } },
                raw: true
            })
        ]);

        if (!empleado) return res.redirect('/admin/personal');

        const [ciudades, permisosEmpleado] = await Promise.all([
            Municipios.findAll({ where: { departamento_id: empleado.departamento }, raw: true }),
            empleado.idUsuario
                ? UserPermisos.findAll({ where: { idUsuario: empleado.idUsuario }, attributes: ['idRecurso', 'idAccion'], raw: true })
                : []
        ]);

        return res.render('./administrador/employeers/ver', {
            pagina: 'Empleados',
            subPagina: `${empleado.PrimerNombre} ${empleado.PrimerApellido}`,
            csrfToken: req.csrfToken(),
            currentPath: req.path,
            empleado,
            documentos,
            departamentos,
            ciudades,
            tipoIdentificacion,
            contratosLaborales,
            puntosDeVenta,
            permisosEmpleado,
            btnName: 'Actualizar Empleado',
            r2PublicUrl: process.env.R2_PUBLIC_URL
        });
    } catch (error) {
        console.error('verEmpleado:', error);
        res.redirect('/admin/personal');
    }
};

const actualizarEmpleado = async (req, res) => {
    const { idEmpleado } = req.params;

    // ── 1. EXTRAER CAMPOS ────────────────────────────────────────────────────────
    const {
        PrimerNombre, OtrosNombres, PrimerApellido, SegundoApellido,
        TipoDocumento, NumeroDocumento, fechaNacimiento, direccionResidencia,
        departamentoSelect, ciudadSelect, emailEmpleado, telefonoContacto,
        contactoEmergencia, telefonoEmergencia, fechaIngreso, tipoContrato,
        cargo, salarioBase, comisiones, idPuntoDeVenta
    } = req.body;

    // ── 2. VALIDACIÓN ────────────────────────────────────────────────────────────
    const errores = {};
    if (!PrimerNombre?.trim())  errores.PrimerNombre  = 'El primer nombre es requerido';
    if (!PrimerApellido?.trim()) errores.PrimerApellido = 'El primer apellido es requerido';

    const tiposDocValidos = ['CC', 'CE', 'TI', 'NIT', 'PP'];
    if (!TipoDocumento || !tiposDocValidos.includes(TipoDocumento))
        errores.TipoDocumento = 'Selecciona un tipo de documento válido';
    if (!NumeroDocumento?.trim())
        errores.NumeroDocumento = 'El número de documento es requerido';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailEmpleado?.trim() || !emailRegex.test(emailEmpleado.trim()))
        errores.emailEmpleado = 'Ingresa un email válido';

    if (!fechaIngreso?.trim())
        errores.fechaIngreso = 'La fecha de ingreso es requerida';

    const contratosValidos = ['1', '2', '3', '4', '5', '6'];
    if (!tipoContrato || !contratosValidos.includes(String(tipoContrato)))
        errores.tipoContrato = 'Selecciona un tipo de contrato válido';

    const cargosValidos = ['vendedor', 'bodega', 'administrativo', 'operario', 'otro'];
    if (!cargo || !cargosValidos.includes(cargo))
        errores.cargo = 'El área de desempeño es inválida';

    if (!departamentoSelect || isNaN(parseInt(departamentoSelect)))
        errores.departamento = 'El departamento es requerido';
    if (!ciudadSelect || isNaN(parseInt(ciudadSelect)))
        errores.ciudad = 'La ciudad es requerida';

    if (Object.keys(errores).length)
        return res.status(422).json({ success: false, mensaje: 'Revisa los campos marcados', errores });

    // ── 3. CARGAR ESTADO ACTUAL DEL EMPLEADO ─────────────────────────────────────
    const empleadoActual = await Empleados.findByPk(idEmpleado, { raw: true });
    if (!empleadoActual) return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });

    const rolesConUsuario = { vendedor: 'STORE', bodega: 'EMPLOYER', administrativo: 'ADMIN' };
    const teniRol  = !!rolesConUsuario[empleadoActual.cargo];   // tenía cuenta de acceso
    const tieneRol = !!rolesConUsuario[cargo];                  // necesita cuenta de acceso

    // ── 4. PRE-TRANSACCIÓN: crear usuario si pasa de sin-rol → con-rol ───────────
    // (fuera de la transacción para no bloquear el pool de conexiones MySQL)
    let usuarioNuevo = null;
    if (!teniRol && tieneRol) {
        try {
            const [u] = await Usuarios.findOrCreate({
                where: { emailUsuario: emailEmpleado.trim() },
                defaults: {
                    nombreUsuario:   PrimerNombre.trim(),
                    apellidoUsuario: PrimerApellido.trim(),
                    password:        NumeroDocumento.trim(),
                    permisos:        rolesConUsuario[cargo],
                },
            });
            usuarioNuevo = u;
        } catch (userErr) {
            console.error('actualizarEmpleado — crear usuario:', userErr.message);
            return res.status(500).json({ success: false, mensaje: 'No se pudo crear el acceso del usuario.' });
        }
    }

    // ── 5. TRANSACCIÓN PRINCIPAL ─────────────────────────────────────────────────
    const t = await db.transaction();
    const uploadedFiles = [];

    try {
        const empleado = await Empleados.findByPk(idEmpleado, { transaction: t });

        // 5.1 FOTO: subir primero a R2, actualizar DB, borrar la vieja DESPUÉS del commit
        let nuevaFotoKey = null;
        if (req.files?.fotoEmpleado?.[0]) {
            const file = req.files.fotoEmpleado[0];
            const allowedImg = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
            if (!allowedImg.includes(file.mimetype))
                throw new Error('Formato de foto no válido. Usa JPG, PNG o WebP.');
            if (file.size > 5 * 1024 * 1024)
                throw new Error('La foto no puede superar 5 MB.');

            const keyPhoto = `documentacion/empleados/perfil/perfil-${NumeroDocumento}-${Date.now()}.webp`;
            const buffer   = await sharp(file.buffer).resize(500, 500, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
            await new Upload({ client: s3Client, params: { Bucket: process.env.R2_BUCKET_NAME, Key: keyPhoto, Body: buffer, ContentType: 'image/webp' } }).done();
            uploadedFiles.push(keyPhoto);
            nuevaFotoKey = keyPhoto;
        }

        // 5.2 DOCUMENTOS: validar, subir a R2
        const allowedDoc = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ];
        let docsData = [];
        if (req.files?.documentos?.length) {
            docsData = await Promise.all(req.files.documentos.map(async (file, idx) => {
                if (!allowedDoc.includes(file.mimetype))
                    throw new Error(`Formato no válido: "${file.originalname}". Usa PDF, Word, Excel o imagen.`);
                if (file.size > 5 * 1024 * 1024)
                    throw new Error(`"${file.originalname}" supera el límite de 5 MB.`);

                const ext    = file.originalname.split('.').pop();
                const keyDoc = `documentacion/empleados/doc-${NumeroDocumento}-${Date.now()}-${idx}.${ext}`;
                await new Upload({ client: s3Client, params: { Bucket: process.env.R2_BUCKET_NAME, Key: keyDoc, Body: file.buffer, ContentType: file.mimetype } }).done();
                uploadedFiles.push(keyDoc);
                return { idPropietario: idEmpleado, nombreDocumento: file.originalname, keyName: keyDoc, formato: ext.toUpperCase(), pertenece: 'empleado' };
            }));
        }

        // 5.3 ACTUALIZAR TABLA EMPLEADOS
        const administrativeId = '00000000-0000-0000-0000-000000000000';
        const finalIdPuntoDeVenta = (cargo === 'vendedor' || cargo === 'bodega')
            ? (idPuntoDeVenta || administrativeId)
            : administrativeId;

        const updatePayload = {
            idPuntoDeVenta: finalIdPuntoDeVenta,
            TipoDocumento, NumeroDocumento: NumeroDocumento.trim(),
            PrimerNombre: PrimerNombre.trim(), OtrosNombres: OtrosNombres?.trim() || null,
            PrimerApellido: PrimerApellido.trim(), SegundoApellido: SegundoApellido?.trim() || null,
            telefonoContacto, emailEmpleado: emailEmpleado.trim(),
            fechaIngreso, fechaNacimiento: fechaNacimiento || null,
            departamento: departamentoSelect, ciudad: ciudadSelect,
            direccionResidencia, contactoEmergencia, telefonoEmergencia,
            tipoContrato, cargo,
            salarioBase: limpiarPrecio(salarioBase),
            comisiones: comisiones === 'on',
        };
        if (nuevaFotoKey) updatePayload.imagen = nuevaFotoKey;

        await empleado.update(updatePayload, { transaction: t });

        // 5.4 LÓGICA DE CARGO / USUARIO ──────────────────────────────────────────

        if (!teniRol && tieneRol && usuarioNuevo) {
            // CASO A: sin rol → con rol  (usuario ya creado pre-transacción)
            await empleado.update({ idUsuario: usuarioNuevo.idUsuario }, { transaction: t });

            if (req.body.permisosJSON) {
                const parsed = JSON.parse(req.body.permisosJSON);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    await UserPermisos.bulkCreate(
                        parsed.map(({ idRecurso, idAccion }) => ({ idUsuario: usuarioNuevo.idUsuario, idRecurso, idAccion })),
                        { transaction: t }
                    );
                }
            }

            // Email de bienvenida (fire-and-forget, no bloquea la transacción)
            mailWelcomeEmployer({ emailEmpleado: emailEmpleado.trim(), PrimerNombre: PrimerNombre.trim(), codigoEmpleado: empleadoActual.codigoEmpleado }).catch(() => {});

        } else if (teniRol && !tieneRol) {
            // CASO B: con rol → sin rol  → eliminar permisos y usuario
            if (empleadoActual.idUsuario) {
                await UserPermisos.destroy({ where: { idUsuario: empleadoActual.idUsuario }, transaction: t });
                await Usuarios.destroy({ where: { idUsuario: empleadoActual.idUsuario }, transaction: t });
                await empleado.update({ idUsuario: null }, { transaction: t });
            }

        } else if (teniRol && tieneRol && empleadoActual.idUsuario) {
            // CASO C: mantiene (o cambia) rol → sincronizar usuario + diff de permisos
            const usuario = await Usuarios.findByPk(empleadoActual.idUsuario, { transaction: t });
            if (usuario) {
                await usuario.update({
                    permisos:        rolesConUsuario[cargo],
                    emailUsuario:    emailEmpleado.trim(),
                    nombreUsuario:   PrimerNombre.trim(),
                    apellidoUsuario: PrimerApellido.trim(),
                }, { transaction: t });
            }

            if (req.body.permisosJSON !== undefined) {
                const deseados = JSON.parse(req.body.permisosJSON);
                const actuales = await UserPermisos.findAll({
                    where: { idUsuario: empleadoActual.idUsuario },
                    raw: true,
                    transaction: t,
                });

                const actualSet   = new Set(actuales.map(p => `${p.idRecurso}:${p.idAccion}`));
                const deseadoSet  = new Set(deseados.map(p => `${p.idRecurso}:${p.idAccion}`));
                const porAgregar  = deseados.filter(p => !actualSet.has(`${p.idRecurso}:${p.idAccion}`));
                const porEliminar = actuales.filter(p => !deseadoSet.has(`${p.idRecurso}:${p.idAccion}`));

                if (porAgregar.length) {
                    await UserPermisos.bulkCreate(
                        porAgregar.map(({ idRecurso, idAccion }) => ({ idUsuario: empleadoActual.idUsuario, idRecurso, idAccion })),
                        { transaction: t }
                    );
                }
                for (const p of porEliminar) {
                    await UserPermisos.destroy({
                        where: { idUsuario: empleadoActual.idUsuario, idRecurso: p.idRecurso, idAccion: p.idAccion },
                        transaction: t,
                    });
                }
            }
        }

        // 5.5 INSERTAR REGISTROS DE DOCUMENTOS EN DB
        if (docsData.length) await Documentacion.bulkCreate(docsData, { transaction: t });

        // ── 6. COMMIT ────────────────────────────────────────────────────────────
        await t.commit();

        // ── 7. BORRAR FOTO ANTERIOR DE R2 (post-commit, best-effort) ─────────────
        if (nuevaFotoKey && empleadoActual.imagen) {
            s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: empleadoActual.imagen })).catch(() => {});
        }

        res.json({ success: true, mensaje: 'Empleado actualizado con éxito.' });

    } catch (error) {
        await t.rollback().catch(() => {});
        if (uploadedFiles.length) {
            await Promise.all(
                uploadedFiles.map(key => s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key })))
            ).catch(() => {});
        }
        console.error('actualizarEmpleado:', error);
        res.status(500).json({ success: false, mensaje: 'Error al actualizar: ' + error.message });
    }
};

const eliminarDocumentoEmpleado = async (req, res) => {
    const { idDocumento } = req.params;
    try {
        const doc = await Documentacion.findByPk(idDocumento);
        if (!doc) return res.status(404).json({ success: false, mensaje: 'Documento no encontrado' });
        await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: doc.keyName })).catch(() => {});
        await doc.destroy();
        res.json({ success: true });
    } catch (error) {
        console.error('eliminarDocumentoEmpleado:', error);
        res.status(500).json({ success: false, mensaje: 'Error al eliminar el documento' });
    }
};

const cambiarEstadoEmpleado = async (req, res) => {
    const { idEmpleado } = req.params;
    const { estado } = req.body;

    const estadosValidos = ['activo', 'suspendido', 'despedido', 'vacaciones', 'enfermedad', 'licencia', 'otro'];
    if (!estado || !estadosValidos.includes(estado))
        return res.status(422).json({ success: false, mensaje: 'Estado inválido.' });

    try {
        const empleado = await Empleados.findByPk(idEmpleado, { raw: true });
        if (!empleado) return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado.' });

        const t = await db.transaction();
        try {
            await Empleados.update({ estado }, { where: { idEmpleado }, transaction: t });

            if (empleado.idUsuario) {
                if (estado === 'activo') {
                    // Restaurar acceso: hashear NumeroDocumento como nueva contraseña
                    const usuario = await Usuarios.findByPk(empleado.idUsuario, { transaction: t });
                    if (usuario) {
                        usuario.password = empleado.NumeroDocumento;
                        await usuario.save({ transaction: t });
                    }
                } else {
                    // Bloquear acceso: poner password = '0' via query raw (bypass hooks)
                    await db.query(
                        "UPDATE USUARIOS SET password = '0' WHERE idUsuario = :idUsuario",
                        { replacements: { idUsuario: empleado.idUsuario }, transaction: t }
                    );
                }
            }

            await t.commit();
            res.json({ success: true, mensaje: `Estado actualizado a "${estado}".` });
        } catch (err) {
            await t.rollback().catch(() => {});
            throw err;
        }
    } catch (error) {
        console.error('cambiarEstadoEmpleado:', error);
        res.status(500).json({ success: false, mensaje: 'Error al cambiar el estado: ' + error.message });
    }
};

// ─── ENTIDADES BANCARIAS ──────────────────────────────────────────────────────
const listarEntidades = async (req, res) => {
    try {
        const entidades = await Entidades.findAll({ order: [['recibirPagosPos', 'DESC'], ['nombreEntidad', 'ASC']], raw: true });
        return res.render('./administrador/bankentities/listado', {
            pagina: 'Entidades Bancarias',
            csrfToken: req.csrfToken(),
            currentPath: req.path,
            entidades,
        });
    } catch (e) {
        console.error('listarEntidades:', e);
        return res.status(500).send('Error al cargar entidades');
    }
};

const crearEntidad = async (req, res) => {
    try {
        const { nombreEntidad, tipoEntidad, recibirPagosPos } = req.body;
        const tiposValidos = ['Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito'];
        if (!nombreEntidad?.trim() || !tiposValidos.includes(tipoEntidad))
            return res.status(422).json({ success: false, mensaje: 'Datos inválidos.' });

        const entidad = await Entidades.create({
            nombreEntidad: nombreEntidad.trim(),
            tipoEntidad,
            recibirPagosPos: recibirPagosPos === true || recibirPagosPos === 'true',
        });
        return res.json({ success: true, entidad: entidad.toJSON() });
    } catch (e) {
        console.error('crearEntidad:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al crear la entidad.' });
    }
};

const toggleEntidad = async (req, res) => {
    try {
        const { id } = req.params;
        const { recibirPagosPos } = req.body;
        const [updated] = await Entidades.update(
            { recibirPagosPos: recibirPagosPos === true || recibirPagosPos === 'true' },
            { where: { idEntidad: id } }
        );
        if (!updated) return res.status(404).json({ success: false, mensaje: 'Entidad no encontrada.' });
        return res.json({ success: true });
    } catch (e) {
        console.error('toggleEntidad:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar.' });
    }
};

const verDetallesEntidad = async (req, res) => {
    try {
        const { idEntidad } = req.params;
        const entidadInst = await Entidades.findByPk(idEntidad);
        if (!entidadInst) return res.status(404).send('Entidad no encontrada');
        const entidad = entidadInst.toJSON();
        return res.render('./administrador/bankentities/detallesEntidad', {
            pagina: entidad.nombreEntidad,
            csrfToken: req.csrfToken(),
            currentPath: req.path,
            entidad,
        });
    } catch (e) {
        console.error('verDetallesEntidad:', e);
        return res.status(500).send('Error al cargar entidad');
    }
};

const editarEntidad = async (req, res) => {
    try {
        const { idEntidad } = req.params;
        const { nombreEntidad, tipoEntidad, recibirPagosPos } = req.body;
        const tiposValidos = ['Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito'];
        if (!nombreEntidad?.trim() || !tiposValidos.includes(tipoEntidad))
            return res.status(422).json({ success: false, mensaje: 'Datos inválidos.' });

        const [updated] = await Entidades.update(
            {
                nombreEntidad: nombreEntidad.trim(),
                tipoEntidad,
                recibirPagosPos: recibirPagosPos === true || recibirPagosPos === 'true',
            },
            { where: { idEntidad } }
        );
        if (!updated) return res.status(404).json({ success: false, mensaje: 'Entidad no encontrada.' });
        return res.json({ success: true, mensaje: 'Entidad actualizada correctamente.' });
    } catch (e) {
        console.error('editarEntidad:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar la entidad.' });
    }
};

const getTransaccionesEntidad = async (req, res) => {
    try {
        const { idEntidad } = req.params;
        const { pagina = 1, exportar, desde, hasta, referencia } = req.query;
        const limit = parseInt(process.env.LIMIT_PER_PAGE) || 10;
        const offset = (parseInt(pagina) - 1) * limit;

        let dateFilter = '';
        const replacements = { idEntidad };

        if (desde) { dateFilter += ' AND fc.fechaEmision >= :desde'; replacements.desde = desde; }
        if (hasta) { dateFilter += ' AND fc.fechaEmision <= :hasta'; replacements.hasta = hasta; }
        if (referencia) { dateFilter += ' AND dpf.nroReferencia LIKE :referencia'; replacements.referencia = `%${referencia}%`; }

        const countSql = `
            SELECT COUNT(*) as total
            FROM DETALLES_PAGOS_FACTURA dpf
            INNER JOIN FACTURA_CLIENTES fc ON dpf.idFacturaCliente = fc.idFacturaCliente
            WHERE dpf.idEntidad = :idEntidad${dateFilter}
        `;

        const dataSql = `
            SELECT
                CONCAT(COALESCE(fc.prefijo,''), fc.numeroFactura) AS nroFactura,
                pdv.nombreComercial AS tienda,
                fc.fechaEmision,
                fc.horaEmision,
                dpf.valor,
                dpf.nroReferencia
            FROM DETALLES_PAGOS_FACTURA dpf
            INNER JOIN FACTURA_CLIENTES fc ON dpf.idFacturaCliente = fc.idFacturaCliente
            INNER JOIN PUNTO_DE_VENTA pdv ON fc.idPuntoDeVenta = pdv.idPuntoDeVenta
            WHERE dpf.idEntidad = :idEntidad${dateFilter}
            ORDER BY fc.fechaEmision DESC, fc.horaEmision DESC
            ${exportar === '1' ? '' : 'LIMIT :limit OFFSET :offset'}
        `;

        const countResult = await db.query(countSql, { replacements, type: Sequelize.QueryTypes.SELECT });
        const total = countResult[0]?.total || 0;

        if (exportar !== '1') { replacements.limit = limit; replacements.offset = offset; }
        const transacciones = await db.query(dataSql, { replacements, type: Sequelize.QueryTypes.SELECT });

        return res.json({
            success: true,
            transacciones,
            total,
            totalPaginas: Math.ceil(total / limit),
            paginaActual: parseInt(pagina),
        });
    } catch (e) {
        console.error('getTransaccionesEntidad:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al obtener transacciones.' });
    }
};

const getStatsVendedorMes = async (req, res) => {
    try {
        const { idEmpleado } = req.params;
        const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);

        const [resumen, topProductos] = await Promise.all([
            db.query(`
                SELECT
                    COUNT(DISTINCT fc.idFacturaCliente) AS nroFacturas,
                    COALESCE(SUM(df.total), 0)          AS totalVendido
                FROM FACTURA_CLIENTES fc
                INNER JOIN DETALLES_FACTURA df ON df.idFacturaCliente = fc.idFacturaCliente
                WHERE fc.idEmpleado = :idEmpleado
                  AND fc.createdAt >= :inicioMes
            `, { replacements: { idEmpleado, inicioMes }, type: Sequelize.QueryTypes.SELECT }),

            db.query(`
                SELECT
                    p.nombreProducto,
                    SUM(df.cantidad) AS unidades,
                    SUM(df.total)    AS totalProducto
                FROM FACTURA_CLIENTES fc
                INNER JOIN DETALLES_FACTURA df ON df.idFacturaCliente = fc.idFacturaCliente
                INNER JOIN PRODUCTOS p          ON p.idProducto = df.idProducto
                WHERE fc.idEmpleado = :idEmpleado
                  AND fc.createdAt >= :inicioMes
                GROUP BY p.idProducto, p.nombreProducto
                ORDER BY unidades DESC
                LIMIT 5
            `, { replacements: { idEmpleado, inicioMes }, type: Sequelize.QueryTypes.SELECT }),
        ]);

        const nroFacturas    = parseInt(resumen[0]?.nroFacturas   || 0);
        const totalVendido   = Math.round(parseFloat(resumen[0]?.totalVendido || 0));
        const ticketPromedio = nroFacturas > 0 ? Math.round(totalVendido / nroFacturas) : 0;

        return res.json({
            success: true,
            nroFacturas,
            totalVendido,
            ticketPromedio,
            topProductos: topProductos.map(p => ({
                nombreProducto: p.nombreProducto,
                unidades:       Math.round(parseFloat(p.unidades      || 0)),
                totalProducto:  Math.round(parseFloat(p.totalProducto || 0)),
            })),
        });
    } catch (e) {
        console.error('getStatsVendedorMes:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al calcular estadísticas.' });
    }
};

const jsonPermisosRecursos = async (req, res) => {
    try {
        const { tipo } = req.params;
        const recursos = await PermisosRecursos.findAll({
            where: { tipo },
            attributes: ['idRecurso', 'nombreRecurso'],
            order: [['nombreRecurso', 'ASC']],
        });
        res.json(recursos);
    } catch (e) {
        res.status(500).json({ error: 'Error al obtener recursos' });
    }
};

const jsonPermisosAcciones = async (req, res) => {
    try {
        const acciones = await PermisosAcciones.findAll({
            attributes: ['idAccion', 'nombreAccion'],
            order: [['nombreAccion', 'ASC']],
        });
        res.json(acciones);
    } catch (e) {
        res.status(500).json({ error: 'Error al obtener acciones' });
    }
};

// ── Cajas cerradas de una fecha para admin ────────────────────────────────────
const getCajasCerradasAdmin = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    const { fecha } = req.query;

    try {
        const _hoy = new Date();
        const fechaFiltro = fecha || `${_hoy.getFullYear()}-${String(_hoy.getMonth()+1).padStart(2,'0')}-${String(_hoy.getDate()).padStart(2,'0')}`;

        const inicio = new Date(`${fechaFiltro}T00:00:00`);
        const fin    = new Date(`${fechaFiltro}T23:59:59`);

        const cajas = await CajaTienda.findAll({
            where: {
                idPuntoDeVenta,
                estado: 'cerrado',
                fechaApertura: { [Op.between]: [inicio, fin] }
            },
            include: [
                { model: Empleados, as: 'empleadoApertura', attributes: ['PrimerNombre', 'PrimerApellido'] },
                { model: Empleados, as: 'empleadoCierre',   attributes: ['PrimerNombre', 'PrimerApellido'] }
            ],
            order: [['fechaApertura', 'ASC']]
        });

        return res.json({
            success: true,
            cajas: cajas.map(c => ({
                idCajaTienda:    c.idCajaTienda,
                apertura:        c.fechaApertura,
                cierre:          c.fechaCierre,
                empleadoApertura: `${c.empleadoApertura?.PrimerNombre || ''} ${c.empleadoApertura?.PrimerApellido || ''}`.trim(),
                empleadoCierre:   `${c.empleadoCierre?.PrimerNombre  || ''} ${c.empleadoCierre?.PrimerApellido  || ''}`.trim()
            }))
        });
    } catch (e) {
        console.error('getCajasCerradasAdmin:', e);
        return res.status(500).json({ success: false });
    }
};

// ── PDF cuadre de caja desde admin ───────────────────────────────────────────
const getAdminCuadrePDF = async (req, res) => {
    const { idPuntoDeVenta, idCajaTienda } = req.params;

    try {
        const caja = await CajaTienda.findOne({
            where: { idCajaTienda, idPuntoDeVenta, estado: 'cerrado' },
            include: [
                { model: Empleados,    as: 'empleadoApertura', attributes: ['PrimerNombre', 'PrimerApellido'] },
                { model: Empleados,    as: 'empleadoCierre',   attributes: ['PrimerNombre', 'PrimerApellido'] },
                { model: PuntosDeVenta, as: 'puntoDeVenta',    attributes: ['nombreComercial'] }
            ]
        });
        if (!caja) return res.status(404).send('Caja no encontrada.');

        const fecha  = new Date(caja.fechaCierre);
        const inicio = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), 0, 0, 0);
        const fin    = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), 23, 59, 59);

        const [egresosRows, facturas] = await Promise.all([
            Egresos.findAll({
                where: { idPuntoDeVenta, estado: 'liquidada', createdAt: { [Op.between]: [inicio, fin] } },
                attributes: ['referencia', 'descripcion', 'valorEgreso'], raw: true
            }),
            FacturaClientes.findAll({
                where: { idPuntoDeVenta, estado: 'liquidada', createdAt: { [Op.between]: [inicio, fin] } },
                attributes: ['prefijo', 'numeroFactura'],
                include: [{ model: DetallesPagosFactura, as: 'pagos', include: [{ model: Entidades, as: 'entidad', attributes: ['nombreEntidad'] }] }]
            })
        ]);

        const txEgresos = egresosRows.map(e => ({ referencia: e.referencia || '—', descripcion: e.descripcion || '—', valor: Math.round(parseFloat(e.valorEgreso) || 0) }));
        const txElectronicos = [], txCredito = [];
        for (const f of facturas) {
            for (const p of f.pagos) {
                const val = Math.round(parseFloat(p.valor) || 0);
                if (['Banco', 'Billetera Virtual', 'Tarjeta Credito'].includes(p.metodoPago))
                    txElectronicos.push({ entidad: p.entidad?.nombreEntidad || p.metodoPago, referencia: p.nroReferencia || '—', valor: val });
                else if (p.metodoPago === 'Entidad Crediticia')
                    txCredito.push({ entidad: p.entidad?.nombreEntidad || '—', referencia: p.nroReferencia || '—', valor: val });
            }
        }

        const buf = await _generarPDFCuadre(caja, txEgresos, txElectronicos, txCredito, fecha);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="cuadre-${fecha.toISOString().slice(0,10)}.pdf"`);
        res.setHeader('Content-Length', buf.length);
        return res.send(buf);
    } catch (e) {
        console.error('getAdminCuadrePDF:', e);
        return res.status(500).send('Error al generar el PDF.');
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
    dashboardInventorys,
    billingToday,
    storeInventory,
    storeEmployers,
    storeDocuments,
    saveProduct, editarProducto, listaProductos, verProducto, stockTotalProducto, unidadesVendidasProducto, diasInventarioProducto, newProduct,
    batchBuyOrder,
    dosificar,
    dashboardSupplier,
    newSupplier,
    saveSupplier, checkNitSupplier,
    dashboardCustomers,
    dashboardEmployees, newEmployer, saveEmployee, checkDocumentoPersonal, checkEmailPersonal, filterEmployeeListJson, buscarEmpleadoPorCodigo,

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
    filterSupplierListJson,
    filterStoreInventoryJson,
    imprimirEtiquetaSKU,
    adminSseConnect,
    getTiendasStatsHoy,
    getTiendaStatsHoyDetalle,
    getFacturasJSON,
    jsonPermisosRecursos,
    jsonPermisosAcciones,
    verEmpleado, actualizarEmpleado, eliminarDocumentoEmpleado, cambiarEstadoEmpleado,
    getPagosHoyPorMetodo,
    listarEntidades, crearEntidad, toggleEntidad, verDetallesEntidad, editarEntidad, getTransaccionesEntidad,
    getStatsVendedorMes,
    getCajasCerradasAdmin,
    getAdminCuadrePDF,
}