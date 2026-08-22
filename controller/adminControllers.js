import { fileURLToPath } from 'url';
import path from 'path';
const __filename_admin = fileURLToPath(import.meta.url);
const __dirname_admin  = path.dirname(__filename_admin);
const LOGO_PATH_ADMIN  = path.resolve(__dirname_admin, '../public/img/logo.png');

import { validationResult } from "express-validator";
import { uuidV7 } from "../helpers/uuidV7.js";
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import sharp from 'sharp';
import { Upload } from "@aws-sdk/lib-storage";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "../config/r2.js";
import dotenv from 'dotenv';
import db from "../config/bd.js";
import { Departamentos, Municipios, PuntosDeVenta, RegimenFacturacion, Atributos, Categorias, Productos, VariacionesProducto, Imagenes, CategoriasDeProvedores, Documentacion, Provedores, Stock, Pack, Empleados, Usuarios, Egresos, FacturaClientes, DetallesFactura, DetallesPagosFactura, Clientes, ClientesTributario, ClientesUbicacion, CajaTienda, PermisosRecursos, PermisosAcciones, UserPermisos, Entidades, FacturaProveedores, DetallesFacturaProvedores, CuentasPorPagar, Traslados, DetalleTraslados, Familia, CajasYBancos, MovimientosCajasBancos, TrasladoEfectivo, TrasladoEfectivoHistorial } from "../models/index.js";
import { addClient, removeClient, sendEvent, broadcast } from '../helpers/sseManager.js';
import { resumenPendientes, listarPendientesDeCuenta } from '../helpers/trasladosPendientes.js';
import { invalidarContadoresAdmin } from '../middleware/adminMenuMiddleware.js';
import { generarPDFTraslado, buscarTrasladoParaPDF } from '../helpers/pdfTraslado.js';
import responsabiliidadFiscal from '../src/json/responsabilidadFiscal.json' with { type: 'json' };
import tipoPersonaJuridica from '../src/json/tipoPersonaJuridica.json' with {type: 'json'}
import tipoFacturas from '../src/json/tipoFacturas.json' with {type: 'json'}
import tipoIdentificacion from '../src/json/tipoIdentificacionPersonas.json' with {type: 'json'}
import contratosLaborales from '../src/json/contratosLaborales.json' with {type: 'json'}
import { limpiarPrecio, sanitizarHTML, getAvailability, normalizarFamilia, familiaDesdeNombre, prefijoFamilia } from '../helpers/helpers.js'
import { generarSlugDe, slugUnico, normalizarSku13, resolverIdFamilia } from '../helpers/productos.js'
import {mailWelcomeEmployer} from '../helpers/mailNewEmployer.js'
import { Sequelize, Op, where, fn, col, literal } from "sequelize";
import { _generarPDFCuadre, _calcularTransaccionesCaja } from './storeControllers.js';
import { resolverIds } from '../middlewares/verificarPermisoEmpleado.js';
import { crearConCodigo } from '../helpers/secuencias.js';
import { validarImagen, aWebp } from '../helpers/imagenSegura.js';
import ExcelJS from 'exceljs';
import { tituloLista } from '../helpers/textoLista.js';


dotenv.config();

// ─── CONSTANTES COMPARTIDAS ──────────────────────────────────────────────────
const METODOS_PAGO = ['Efectivo', 'Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito'];

// ─── HELPERS INTERNOS ────────────────────────────────────────────────────────

// Devuelve { inicio, fin } para el día de hoy (00:00:00 → 23:59:59)
const _hoyRango = () => {
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
    const fin    = new Date(); fin.setHours(23, 59, 59, 999);
    return { inicio, fin };
};

// Resuelve el rango de fechas de un cierre de caja. Retorna { caja, inicio, fin } o null.
const _getRangoCaja = async (idCajaTienda, idPuntoDeVenta) => {
    const caja = await CajaTienda.findOne({
        where: { idCajaTienda, idPuntoDeVenta },
        attributes: ['idCajaTienda', 'fechaApertura', 'fechaCierre', 'ventasTotales', 'egresosTotales', 'ventasEfectivo', 'ventasMediosElectronicos', 'estado']
    });
    if (!caja) return null;
    const inicio = caja.fechaApertura ? new Date(caja.fechaApertura) : (() => {
        const d = new Date(caja.fechaCierre);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
    })();
    const fin = caja.fechaCierre ? new Date(caja.fechaCierre) : new Date();
    return { caja, inicio, fin };
};

// Calcula ventas y desglose de pagos de un PDV en un rango. Retorna { ventas, pagos, totalFacturas }.
const _getVentasPeriodo = async (idPuntoDeVenta, desde, hasta = null) => {
    const whereFactura = { idPuntoDeVenta, createdAt: hasta ? { [Op.between]: [desde, hasta] } : { [Op.gte]: desde } };
    const facturas = await FacturaClientes.findAll({ attributes: ['idFacturaCliente'], where: whereFactura, raw: true });

    const pagos = Object.fromEntries(METODOS_PAGO.map(m => [m, 0]));
    let ventas = 0;

    if (facturas.length) {
        const ids = facturas.map(f => f.idFacturaCliente);
        const [detallesRows, pagosRows] = await Promise.all([
            DetallesFactura.findAll({
                attributes: [[fn('SUM', col('total')), 'suma']],
                where: { idFacturaCliente: { [Op.in]: ids } }, raw: true
            }),
            DetallesPagosFactura.findAll({
                attributes: ['metodoPago', [fn('SUM', col('valor')), 'total']],
                where: { idFacturaCliente: { [Op.in]: ids } },
                group: ['metodoPago'], raw: true
            })
        ]);
        ventas = parseFloat(detallesRows[0]?.suma || 0);
        for (const r of pagosRows) {
            if (Object.prototype.hasOwnProperty.call(pagos, r.metodoPago))
                pagos[r.metodoPago] = parseFloat(r.total || 0);
        }
    }

    return { ventas, pagos, totalFacturas: facturas.length };
};

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
    const listaPuntosDeVenta = await PuntosDeVenta.findAll({
        raw: true,
        attributes: ['idPuntoDeVenta', 'nombreComercial', 'taxId']
    });

    const { inicio: hoyInicio, fin: hoyFin } = _hoyRango();

    const cajasHoy = await CajaTienda.findAll({
        raw: true,
        attributes: ['idPuntoDeVenta', 'estado', 'fechaApertura', 'fechaCierre'],
        where: { fechaApertura: { [Op.between]: [hoyInicio, hoyFin] } }
    });

    const cajasMap = {};
    for (const c of cajasHoy) cajasMap[c.idPuntoDeVenta] = c;

    const tiendas = listaPuntosDeVenta.map(t => {
        const caja = cajasMap[t.idPuntoDeVenta];
        let estadoCaja = 'cerrada';
        // 'auditoria' es la caja que se está cuadrando: sigue abierta hasta que se cierre.
        // Con solo 'abierto', el tablero mostraba como cerrada una tienda que estaba
        // contando su cajón.
        if (caja && ['abierto', 'auditoria'].includes(caja.estado) && !caja.fechaCierre) estadoCaja = 'abierta';
        else if (caja && caja.fechaCierre) estadoCaja = 'cuadrada';
        return { ...t, estadoCaja };
    });

    return res.status(201).render('./administrador/layout', {
        pagina: "Dashboard",
        csrfToken: req.csrfToken(),
        currentPath: req.path,
        listaPuntosDeVenta: tiendas
    });
}




//PRINCIPAL TIENDAS
const dashboardStores = async (req, res) => {

    const listaPuntosDeVenta = await PuntosDeVenta.findAll({
        raw: true,
        attributes: ['idPuntoDeVenta', 'nombreComercial', 'taxId']
    });

    const { inicio: hoyInicio, fin: hoyFin } = _hoyRango();

    const cajasHoy = await CajaTienda.findAll({
        raw: true,
        attributes: ['idPuntoDeVenta', 'estado', 'fechaApertura', 'fechaCierre'],
        where: { fechaApertura: { [Op.between]: [hoyInicio, hoyFin] } }
    });

    const cajasMap = {};
    for (const c of cajasHoy) {
        cajasMap[c.idPuntoDeVenta] = c;
    }

    const tiendas = listaPuntosDeVenta.map(t => {
        const caja = cajasMap[t.idPuntoDeVenta];
        let estadoCaja = 'cerrada';
        // 'auditoria' es la caja que se está cuadrando: sigue abierta hasta que se cierre.
        // Con solo 'abierto', el tablero mostraba como cerrada una tienda que estaba
        // contando su cajón.
        if (caja && ['abierto', 'auditoria'].includes(caja.estado) && !caja.fechaCierre) estadoCaja = 'abierta';
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
    // Familias existentes para el datalist del formulario: escribir el nombre exacto de una
    // que ya existe es lo que hace que el producto caiga en ese grupo y no en uno nuevo.
    const familias = await Familia.findAll({ attributes: ['idFamilia', 'nombreFamilia'], order: [['nombreFamilia', 'ASC']] })


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
        familias,
        btnName: "Guardar Producto"

    })
}


//
const billingToday = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    return res.render('./administrador/stores/views/listaFacturasDia', { idPuntoDeVenta, csrfToken: req.csrfToken() });
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
            order: [['createdAt', 'DESC'], ['idFacturaCliente', 'ASC']],
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
    return res.render('./administrador/stores/views/documentacionTienda', {
        idPuntoDeVenta,
        csrfToken: req.csrfToken()
    });
};

// ── CIERRE DE CAJA: renderiza el partial ─────────────────────────────────────
const storeCierresCaja = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    return res.render('./administrador/stores/views/cierresCaja', { idPuntoDeVenta });
};

// ── TRASLADOS TIENDA: renderiza el partial ────────────────────────────────────
const storeTrasladosTienda = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    return res.render('./administrador/stores/views/trasladosTienda', { idPuntoDeVenta });
};

// ── API: lista de cierres de caja de un PDV ──────────────────────────────────
const getCierresCajaListaJSON = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    try {
        const cierres = await CajaTienda.findAll({
            where: { idPuntoDeVenta, estado: 'cerrado' },
            attributes: ['idCajaTienda', 'fechaApertura', 'fechaCierre'],
            order: [['fechaCierre', 'DESC']],
            limit: 90
        });
        return res.json({
            success: true,
            cierres: cierres.map(c => ({
                idCajaTienda: c.idCajaTienda,
                fechaApertura: c.fechaApertura,
                fechaCierre:   c.fechaCierre
            }))
        });
    } catch (e) {
        console.error('getCierresCajaListaJSON:', e);
        return res.status(500).json({ success: false });
    }
};

// ── API: datos de un cierre específico (stats + desglose de medios de pago) ──
const getCierreCajaDatosJSON = async (req, res) => {
    const { idPuntoDeVenta, idCajaTienda } = req.params;
    try {
        const rango = await _getRangoCaja(idCajaTienda, idPuntoDeVenta);
        if (!rango) return res.status(404).json({ success: false, mensaje: 'Caja no encontrada.' });
        const { caja, inicio, fin } = rango;

        const cajaConEmpleados = await CajaTienda.findOne({
            where: { idCajaTienda, idPuntoDeVenta },
            include: [
                { model: Empleados, as: 'empleadoApertura', attributes: ['PrimerNombre', 'PrimerApellido'] },
                { model: Empleados, as: 'empleadoCierre',   attributes: ['PrimerNombre', 'PrimerApellido'] }
            ]
        });

        const facturas = await FacturaClientes.findAll({
            where: { idPuntoDeVenta, createdAt: { [Op.between]: [inicio, fin] } },
            attributes: ['idFacturaCliente'],
            include: [{
                model: DetallesPagosFactura, as: 'pagos',
                attributes: ['metodoPago', 'valor'],
                include: [{ model: Entidades, as: 'entidad', attributes: ['nombreEntidad'] }]
            }]
        });

        const mediosMap = {};
        for (const f of facturas) {
            for (const p of f.pagos) {
                if (p.metodoPago === 'Efectivo') continue;
                const metodo  = p.metodoPago;
                const entidad = p.entidad?.nombreEntidad || metodo;
                if (!mediosMap[metodo]) mediosMap[metodo] = {};
                mediosMap[metodo][entidad] = (mediosMap[metodo][entidad] || 0) + (parseFloat(p.valor) || 0);
            }
        }
        const mediosPago = Object.entries(mediosMap).map(([metodo, ents]) => ({
            metodo,
            entidades: Object.entries(ents).map(([nombre, valor]) => ({ nombre, valor: Math.round(valor) }))
        }));

        return res.json({
            success: true,
            caja: {
                idCajaTienda:              caja.idCajaTienda,
                fechaApertura:             caja.fechaApertura,
                fechaCierre:               caja.fechaCierre,
                empleadoApertura: `${cajaConEmpleados.empleadoApertura?.PrimerNombre || ''} ${cajaConEmpleados.empleadoApertura?.PrimerApellido || ''}`.trim() || '—',
                empleadoCierre:   `${cajaConEmpleados.empleadoCierre?.PrimerNombre   || ''} ${cajaConEmpleados.empleadoCierre?.PrimerApellido   || ''}`.trim() || '—',
                ventasTotales:             Math.round(parseFloat(caja.ventasTotales)             || 0),
                egresosTotales:            Math.round(parseFloat(caja.egresosTotales)            || 0),
                ventasEfectivo:            Math.round(parseFloat(caja.ventasEfectivo)            || 0),
                ventasMediosElectronicos:  Math.round(parseFloat(caja.ventasMediosElectronicos)  || 0),
                estado: caja.estado
            },
            mediosPago
        });
    } catch (e) {
        console.error('getCierreCajaDatosJSON:', e);
        return res.status(500).json({ success: false });
    }
};

// ── API: facturas del período de un cierre ────────────────────────────────────
const getCierreFacturasJSON = async (req, res) => {
    const { idPuntoDeVenta, idCajaTienda } = req.params;
    const { pagina = 1 } = req.query;
    try {
        const rango = await _getRangoCaja(idCajaTienda, idPuntoDeVenta);
        if (!rango) return res.status(404).json({ success: false });
        const { inicio, fin } = rango;
        const limite = parseInt(process.env.LIMIT_PER_PAGE) || 15;
        const offset = (parseInt(pagina) - 1) * limite;

        const { count, rows } = await FacturaClientes.findAndCountAll({
            where: { idPuntoDeVenta, createdAt: { [Op.between]: [inicio, fin] } },
            include: [
                { model: Clientes,              as: 'cliente',  attributes: ['razon_social', 'primer_nombre', 'primer_apellido'], required: false },
                { model: DetallesFactura,        as: 'detalles', attributes: ['total'], required: false },
                { model: DetallesPagosFactura,   as: 'pagos',
                    attributes: ['metodoPago', 'valor'],
                    required: false,
                    include: [{ model: Entidades, as: 'entidad', attributes: ['nombreEntidad'] }]
                }
            ],
            order: [['createdAt', 'ASC'], ['idFacturaCliente', 'ASC']],
            limit: limite, offset, distinct: true
        });

        const facturas = rows.map(f => {
            const totalVenta    = f.detalles.reduce((s, d) => s + parseFloat(d.total || 0), 0);
            const cli           = f.cliente;
            const nombreCliente = f.idCliente === '0'
                ? 'Consumidor Final'
                : (cli?.razon_social || `${cli?.primer_nombre || ''} ${cli?.primer_apellido || ''}`.trim() || 'N/A');
            const metodos = [...new Set(f.pagos.map(p => p.entidad?.nombreEntidad || p.metodoPago))].join(', ');
            return {
                idFacturaCliente: f.idFacturaCliente,
                nroFactura:  `${f.prefijo || ''}${f.numeroFactura}`,
                cliente:     nombreCliente,
                hora:        f.horaEmision || '',
                total:       Math.round(totalVenta),
                metodos
            };
        });

        return res.json({
            success: true, facturas,
            totalPaginas: Math.ceil(count / limite),
            paginaActual: parseInt(pagina), total: count
        });
    } catch (e) {
        console.error('getCierreFacturasJSON:', e);
        return res.status(500).json({ success: false });
    }
};

// ── API: egresos del período de un cierre ─────────────────────────────────────
const getCierreEgresosJSON = async (req, res) => {
    const { idPuntoDeVenta, idCajaTienda } = req.params;
    try {
        const rango = await _getRangoCaja(idCajaTienda, idPuntoDeVenta);
        if (!rango) return res.status(404).json({ success: false });
        const { inicio, fin } = rango;

        const egresos = await Egresos.findAll({
            where: { idPuntoDeVenta, createdAt: { [Op.between]: [inicio, fin] } },
            include: [{ model: Empleados, as: 'empleado', attributes: ['PrimerNombre', 'PrimerApellido'] }],
            order: [['createdAt', 'ASC']]
        });

        return res.json({
            success: true,
            egresos: egresos.map(e => ({
                idEgreso:    e.idEgreso,
                referencia:  e.referencia  || '—',
                descripcion: e.descripcion || '—',
                empleado:    e.empleado ? `${e.empleado.PrimerNombre} ${e.empleado.PrimerApellido}` : '—',
                tipo:        e.tipo || 'Egreso',
                valor:       Math.round(parseFloat(e.valorEgreso) || 0),
                estado:      e.estado
            }))
        });
    } catch (e) {
        console.error('getCierreEgresosJSON:', e);
        return res.status(500).json({ success: false });
    }
};

// ── API: traslados de un PDV (como origen o destino) ─────────────────────────
const getTrasladosTiendaJSON = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    const { estado, pagina = 1 } = req.query;
    try {
        const limite = parseInt(process.env.LIMIT_PER_PAGE) || 15;
        const offset = (parseInt(pagina) - 1) * limite;

        const where = { [Op.or]: [{ idOrigen: idPuntoDeVenta }, { idDestino: idPuntoDeVenta }] };
        if (estado) where.estado = estado;

        const { count, rows } = await Traslados.findAndCountAll({
            where,
            include: [
                { model: PuntosDeVenta,    as: 'origen',  attributes: ['nombreComercial'] },
                { model: PuntosDeVenta,    as: 'destino', attributes: ['nombreComercial'] },
                { model: DetalleTraslados, as: 'items',   attributes: ['idDetalleTraslado'] }
            ],
            order: [['fechaEnvio', 'DESC']],
            limit: limite, offset, distinct: true
        });

        return res.json({
            success: true,
            traslados: rows.map(t => ({
                idTraslado:     t.idTraslado,
                codigoTraslado: t.codigoTraslado,
                origen:         t.origen?.nombreComercial  || '—',
                destino:        t.destino?.nombreComercial || '—',
                fechaEnvio:     t.fechaEnvio,
                fechaRecepcion: t.fechaRecepcion,
                estado:         t.estado,
                nroItems:       t.items?.length || 0,
                esOrigen:       t.idOrigen === idPuntoDeVenta
            })),
            totalPaginas: Math.ceil(count / limite),
            paginaActual: parseInt(pagina), total: count
        });
    } catch (e) {
        console.error('getTrasladosTiendaJSON:', e);
        return res.status(500).json({ success: false });
    }
};


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

const stockPorTiendaProducto = async (req, res) => {
    const { idProducto } = req.params;
    const UMBRAL_BAJO = 5;
    try {
        const filas = await db.query(`
            SELECT pdv.idPuntoDeVenta AS idPuntoVenta, pdv.nombreComercial AS nombre, pdv.tipo AS tipo, SUM(s.cantidadExistente) AS total
            FROM STOCKS s
            INNER JOIN PUNTO_DE_VENTA pdv ON s.idPuntoVenta = pdv.idPuntoDeVenta
            WHERE s.idProducto = :idProducto AND s.cantidadExistente > 0
            GROUP BY s.idPuntoVenta, pdv.idPuntoDeVenta, pdv.nombreComercial, pdv.tipo
            ORDER BY total DESC
        `, { replacements: { idProducto }, type: db.QueryTypes.SELECT });

        const datos = filas.map(r => ({
            idPuntoVenta: r.idPuntoVenta,
            nombre: r.nombre,
            tipo:   r.tipo,
            total:  parseInt(r.total) || 0,
            bajo:   (parseInt(r.total) || 0) <= UMBRAL_BAJO
        }));

        return res.json({ success: true, datos, umbral: UMBRAL_BAJO });
    } catch (e) {
        console.error('stockPorTiendaProducto:', e);
        return res.status(500).json({ success: false });
    }
};

const trasladarProductoAdmin = async (req, res) => {
    const { idProducto } = req.params;
    const { idOrigen, idDestino, cantidad, notas } = req.body;
    const idAdmin = req.usuario?.idUsuario;

    if (!idOrigen || !idDestino || !cantidad || !idProducto) {
        return res.status(400).json({ success: false, mensaje: 'Datos incompletos.' });
    }
    if (idOrigen === idDestino) {
        return res.status(400).json({ success: false, mensaje: 'El origen y destino deben ser distintos.' });
    }
    const cant = parseInt(cantidad);
    if (isNaN(cant) || cant <= 0) {
        return res.status(400).json({ success: false, mensaje: 'Cantidad inválida.' });
    }

    const t = await db.transaction();
    try {
        const stockRows = await Stock.findAll({
            where: { idProducto, idPuntoVenta: idOrigen, cantidadExistente: { [Op.gt]: 0 } },
            order: [['createdAt', 'ASC']],
            lock: t.LOCK.UPDATE,
            transaction: t
        });
        const totalDisp = stockRows.reduce((s, r) => s + parseFloat(r.cantidadExistente), 0);
        if (totalDisp < cant) {
            await t.rollback();
            return res.status(400).json({ success: false, mensaje: `Stock insuficiente. Disponible: ${totalDisp}, solicitado: ${cant}.` });
        }

        let restante = cant;
        for (const row of stockRows) {
            if (restante <= 0) break;
            const disp = parseFloat(row.cantidadExistente);
            if (disp <= restante) {
                await row.update({ cantidadExistente: 0 }, { transaction: t });
                restante -= disp;
            } else {
                await row.update({ cantidadExistente: disp - restante }, { transaction: t });
                restante = 0;
            }
        }

        const traslado = await crearConCodigo(Traslados, 'codigoTraslado', 'TR-', 'traslado', {
            idOrigen,
            idDestino,
            idUsuarioDespacha: idAdmin,
            notas:             notas || null,
            estado:            'EN_TRANSITO'
        }, t);

        await DetalleTraslados.create({
            idTraslado: traslado.idTraslado,
            idPack:     null,
            idProducto,
            cantidad:   cant
        }, { transaction: t });

        await t.commit();

        const pendientes = await Traslados.count({
            where: { idDestino, estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] } }
        });
        broadcast(idDestino, 'new_traslado', { codigo, pendientes });

        return res.json({ success: true, idTraslado: traslado.idTraslado, codigo });
    } catch (e) {
        // El try tiene trabajo después del commit: si algo falla ahí, la transacción ya está
        // cerrada y un rollback lanzaría otro error, dejando la petición sin respuesta.
        if (!t.finished) await t.rollback().catch(() => {});
        console.error('trasladarProductoAdmin:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

const ventasHistoricoProducto = async (req, res) => {
    const { idProducto } = req.params;
    try {
        const fechaHasta = req.query.hasta ? new Date(req.query.hasta) : new Date();
        const fechaDesde = req.query.desde ? new Date(req.query.desde) : new Date(fechaHasta.getTime() - 30 * 24 * 60 * 60 * 1000);
        fechaHasta.setHours(23, 59, 59, 999);
        fechaDesde.setHours(0, 0, 0, 0);

        const datos = await db.query(`
            SELECT DATE(fc.fechaEmision) AS fecha, SUM(df.cantidad) AS unidades
            FROM DETALLES_FACTURA df
            INNER JOIN FACTURA_CLIENTES fc ON df.idFacturaCliente = fc.idFacturaCliente
            WHERE df.idProducto = :idProducto
              AND fc.fechaEmision BETWEEN :desde AND :hasta
            GROUP BY DATE(fc.fechaEmision)
            ORDER BY fecha ASC
        `, { replacements: { idProducto, desde: fechaDesde, hasta: fechaHasta }, type: db.QueryTypes.SELECT });

        return res.json({ success: true, datos: datos.map(r => ({ fecha: r.fecha, unidades: parseInt(r.unidades) || 0 })) });
    } catch (e) {
        console.error('ventasHistoricoProducto:', e);
        return res.status(500).json({ success: false });
    }
};

const ventasPorTiendaProducto = async (req, res) => {
    const { idProducto } = req.params;
    try {
        const fechaHasta = req.query.hasta ? new Date(req.query.hasta) : new Date();
        const fechaDesde = req.query.desde ? new Date(req.query.desde) : new Date(fechaHasta.getTime() - 30 * 24 * 60 * 60 * 1000);
        fechaHasta.setHours(23, 59, 59, 999);
        fechaDesde.setHours(0, 0, 0, 0);

        const filas = await db.query(`
            SELECT pdv.nombreComercial AS nombre, SUM(df.cantidad) AS unidades
            FROM DETALLES_FACTURA df
            INNER JOIN FACTURA_CLIENTES fc ON df.idFacturaCliente = fc.idFacturaCliente
            INNER JOIN PUNTO_DE_VENTA pdv ON fc.idPuntoDeVenta = pdv.idPuntoDeVenta
            WHERE df.idProducto = :idProducto
              AND fc.fechaEmision BETWEEN :desde AND :hasta
            GROUP BY fc.idPuntoDeVenta, pdv.nombreComercial
            ORDER BY unidades DESC
        `, { replacements: { idProducto, desde: fechaDesde, hasta: fechaHasta }, type: db.QueryTypes.SELECT });

        const total = filas.reduce((s, r) => s + (parseInt(r.unidades) || 0), 0);
        const tiendas = filas.map(r => ({
            nombre:   r.nombre,
            unidades: parseInt(r.unidades) || 0,
            pct:      total > 0 ? Math.round((parseInt(r.unidades) / total) * 1000) / 10 : 0
        }));

        return res.json({ success: true, tiendas, total });
    } catch (e) {
        console.error('ventasPorTiendaProducto:', e);
        return res.status(500).json({ success: false });
    }
};



const editarProducto = async (req, res) => {

    const { idProducto } = req.params;


    try {
        const [categorias, atributos, familias, producto, variacionesDb] = await Promise.all([
            Categorias.findAll(),
            Atributos.findAll(),
            Familia.findAll({ attributes: ['idFamilia', 'nombreFamilia'], order: [['nombreFamilia', 'ASC']] }),
            Productos.findByPk(idProducto, {
                include: [
                    { association: 'imagenes' },
                    // El nombre de la familia vive en FAMILIA: sin este include el formulario
                    // no tiene qué mostrar en el campo al editar.
                    { association: 'familia' },
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
            familias,
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
    const [categoriasProvedores, departamentos, puntosDeVenta] = await Promise.all([
        CategoriasDeProvedores.findAll({ raw: true }),
        Departamentos.findAll({ raw: true }),
        PuntosDeVenta.findAll({ attributes: ['idPuntoDeVenta', 'nombreComercial'], raw: true })
    ]);
    return res.status(201).render('./administrador/inventarios/batch', {
        pagina: "Orden de Compra",
        subPagina: "Nueva Orden de Compra",
        csrfToken: req.csrfToken(),
        currentPath: '/inventario',
        subPath: 'batch',
        btnName: 'Guardar Orden de Compra',
        categoriasProvedores,
        departamentos,
        puntosDeVenta
    });
}

const saveBatchOrder = async (req, res) => {
    const { idProveedor, nroFactura, fechaFactura, esCredito, fechaPago, valorAbono, idPuntoVentaDestino, productos } = req.body;

    // ── Validaciones backend ──────────────────────────────────
    if (!idProveedor || !nroFactura || !fechaFactura || !idPuntoVentaDestino) {
        return res.status(400).json({ success: false, mensaje: 'Faltan datos requeridos: proveedor, nro factura, fecha o destino.' });
    }

    const creditoBool  = esCredito === 'true' || esCredito === true;
    const valorAbonoN  = parseFloat(valorAbono) || 0;
    const hoy          = new Date().toISOString().split('T')[0];

    if (creditoBool) {
        if (!fechaPago || fechaPago <= hoy) {
            return res.status(400).json({ success: false, mensaje: 'La fecha de pago debe ser posterior a hoy.' });
        }
        if (valorAbonoN < 0) {
            return res.status(400).json({ success: false, mensaje: 'El valor abonado no puede ser negativo.' });
        }
    }

    let productosArr = [];
    try { productosArr = JSON.parse(productos || '[]'); } catch { productosArr = []; }
    if (!Array.isArray(productosArr) || productosArr.length === 0) {
        return res.status(400).json({ success: false, mensaje: 'Debes agregar al menos un producto.' });
    }
    for (const p of productosArr) {
        if (!p.idProducto) return res.status(400).json({ success: false, mensaje: `Producto sin idProducto: ${p.sku || ''}` });
        if (!p.cantidad || parseInt(p.cantidad) <= 0) return res.status(400).json({ success: false, mensaje: `Cantidad inválida en "${p.nombre || p.sku}"` });
        if (!p.valorUnidad || parseFloat(p.valorUnidad) <= 0) return res.status(400).json({ success: false, mensaje: `Valor unitario inválido en "${p.nombre || p.sku}"` });
    }

    const archivos     = req.files?.facturas || [];
    const extsPermitidas = ['pdf','jpg','jpeg','png','gif','xls','xlsx'];
    for (const file of archivos) {
        const ext = file.originalname.split('.').pop().toLowerCase();
        if (!extsPermitidas.includes(ext)) {
            return res.status(400).json({ success: false, mensaje: `Archivo "${file.originalname}" no permitido. Solo: PDF, JPG, PNG, GIF, XLS.` });
        }
    }

    // ── Cálculos ──────────────────────────────────────────────
    const valorNeto      = productosArr.reduce((acc, p) => acc + (parseFloat(p.valorUnidad) || 0) * (parseInt(p.cantidad) || 0), 0);
    const valorImpuestos = productosArr.reduce((acc, p) => acc + (parseFloat(p.impuestos)   || 0), 0);
    const valorTotal     = valorNeto + valorImpuestos;

    if (creditoBool && valorAbonoN >= valorTotal) {
        return res.status(400).json({ success: false, mensaje: 'El valor abonado debe ser menor al total de la factura.' });
    }

    const uploadedKeys = [];
    const t = await db.transaction();

    try {
        // ── FACTURA_PROVEEDORES ───────────────────────────────
        const factura = await FacturaProveedores.create({
            idProveedor,
            nroFactura,
            fechaFactura,
            esCredito: creditoBool,
            fechaVencimiento: creditoBool && fechaPago ? fechaPago : null,
            idPuntoVentaDestino,
            valorNeto,
            valorImpuestos,
            valorTotal,
            estado: creditoBool ? 'Pendiente' : 'Pagada',
            notas: creditoBool && valorAbonoN > 0 ? `Abono inicial: ${valorAbonoN}` : null
        }, { transaction: t });

        // ── DETALLES_FACTURA_PROVEEDORES + STOCKS ─────────────
        for (const prod of productosArr) {
            const cantidad    = parseInt(prod.cantidad) || 0;
            const valorUnidad = parseFloat(prod.valorUnidad) || 0;
            const impuestos   = parseFloat(prod.impuestos) || 0;
            const subtotal    = cantidad * valorUnidad;
            const total       = subtotal + impuestos;

            await DetallesFacturaProvedores.create({
                idFacturaPro: factura.idFacturaPro,
                idProducto:   prod.idProducto,
                cantidad,
                valorUnidad,
                impuestos,
                tipoImpuesto: prod.tipoImpuesto === 'porcentaje' ? 'porcentaje' : 'valor',
                subtotal,
                total
            }, { transaction: t });

            await Stock.create({
                idPuntoVenta:      idPuntoVentaDestino,
                idFacturaPro:      factura.idFacturaPro,
                idProducto:        prod.idProducto,
                cantidadExistente: cantidad,
                cantidadOriginal:  cantidad,
                valorUnidad:       cantidad > 0 ? total / cantidad : 0,
                estadoInterno:     'SUELTO'
            }, { transaction: t });
        }

        // ── CUENTAS_POR_PAGAR ─────────────────────────────────
        if (creditoBool && valorAbonoN > 0) {
            await CuentasPorPagar.create({
                idFacturaPro:  factura.idFacturaPro,
                fechaAbono:    new Date(),
                totalFactura:  valorTotal,
                valorAbono:    valorAbonoN,
                valorPorPagar: valorTotal - valorAbonoN
            }, { transaction: t });
        }

        // ── ARCHIVOS → R2 ─────────────────────────────────────
        if (archivos.length > 0) {
            const docsData = await Promise.all(archivos.map(async (file, idx) => {
                const isImage = file.mimetype.startsWith('image/');
                const ext = file.originalname.split('.').pop().toLowerCase();
                const safeName = nroFactura.replace(/[^a-zA-Z0-9]/g, '-');
                const r2Key = `documentacion/facturas-proveedor/${safeName}-${Date.now()}-${idx}.${isImage ? 'webp' : ext}`;

                let bufferToUpload = file.buffer;
                let contentType    = file.mimetype;
                if (isImage) {
                    bufferToUpload = await sharp(file.buffer)
                        .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 85 })
                        .toBuffer();
                    contentType = 'image/webp';
                }

                await new Upload({
                    client: s3Client,
                    params: { Bucket: process.env.R2_BUCKET_NAME, Key: r2Key, Body: bufferToUpload, ContentType: contentType }
                }).done();
                uploadedKeys.push(r2Key);

                return {
                    idPropietario:   factura.idFacturaPro,
                    nombreDocumento: file.originalname,
                    keyName:         r2Key,
                    formato:         isImage ? 'WEBP' : ext.toUpperCase(),
                    pertenece:       'orden_compra'
                };
            }));

            await Documentacion.bulkCreate(docsData, { transaction: t });
        }

        await t.commit();
        return res.json({ success: true, mensaje: 'Orden de compra registrada correctamente.', idFactura: factura.idFacturaPro });

    } catch (error) {
        await t.rollback();
        if (uploadedKeys.length > 0) {
            await Promise.allSettled(uploadedKeys.map(key =>
                s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }))
            ));
        }
        console.error('Error en saveBatchOrder:', error);
        return res.status(500).json({ success: false, mensaje: 'Error interno al guardar la orden de compra.' });
    }
}



//************[TIENDAS]*******************//
const verTienda = async (req, res) => {

    const { idPuntoDeVenta } = req.params
    const [puntoVenta, cajaEnCuadre] = await Promise.all([
        PuntosDeVenta.findOne({ where: { idPuntoDeVenta } }),
        // La caja trabada en 'auditoria', si la hay. Con eso el encabezado puede ofrecer
        // el botón de destrabar sin que nadie tenga que entrar a la base a mirarlo.
        CajaTienda.findOne({
            where: { idPuntoDeVenta, estado: 'auditoria', fechaCierre: null },
            attributes: ['idCajaTienda', 'codigo', 'cuadreDesde'],
            raw: true
        })
    ])

    return res.status(201).render('./administrador/stores/viewStore', {
        pagina: req.path,
        subPagina: "Estado de la tienda ",
        csrfToken: req.csrfToken(),
        currentPath: '/tiendas',
        subPath: process.env.R2_PUBLIC_URL,

        dato: puntoVenta,
        cajaEnCuadre
    })
}

// POST /admin/tiendas/:idPuntoDeVenta/destrabar-cuadre
//
// Suelta a mano una caja que quedó en 'auditoria'. El candado ya caduca solo, pero la
// espera es de media hora y una tienda que no puede facturar no espera media hora: esto
// es la salida inmediata para quien la está atendiendo por teléfono.
//
// No cierra la caja ni toca ninguna cifra: solo devuelve el estado a 'abierto', que es
// exactamente lo que habría hecho el navegador del operador si hubiera podido avisar.
const destrabarCuadreTienda = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    try {
        const [filas] = await CajaTienda.update(
            { estado: 'abierto', cuadreDesde: null },
            { where: { idPuntoDeVenta, estado: 'auditoria', fechaCierre: null } }
        );

        if (!filas) {
            return res.status(409).json({ success: false, mensaje: 'Esa tienda no tiene ninguna caja trabada en cuadre.' });
        }

        // Al punto de venta, para que el cristal del POS se levante sin recargar.
        try { broadcast(idPuntoDeVenta, 'caja_en_cuadre', { enCuadre: false }); } catch (_) {}

        console.warn(`[cuadre] caja de ${idPuntoDeVenta} destrabada a mano por el usuario ${req.usuario?.idUsuario}`);
        return res.json({ success: true, mensaje: 'La caja quedó liberada: la tienda ya puede facturar.' });
    } catch (e) {
        console.error('destrabarCuadreTienda:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo liberar la caja.' });
    }
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
    const { departamentos, ciudades } = await obtenerDatosSelectores(puntoVenta?.departamento);


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
    });
};

// ─── NUEVO CLIENTE — FORMULARIO ───────────────────────────────────────────────
const newCliente = async (req, res) => {
    try {
        const departamentos = await Departamentos.findAll({ raw: true, order: [['nombre', 'ASC']] });
        return res.render('./administrador/customers/new', {
            pagina: 'Clientes',
            subPagina: 'Nuevo Cliente',
            csrfToken: req.csrfToken(),
            currentPath: req.path,
            departamentos
        });
    } catch (e) {
        console.error('newCliente:', e);
        return res.redirect('/admin/clientes');
    }
};

// ─── NUEVO CLIENTE — GUARDAR ──────────────────────────────────────────────────
const saveCliente = async (req, res) => {
    const {
        tipo_persona, tipo_documento, numero_doc, digito_verif,
        primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
        razon_social, email, telefono, genero,
        regimen_fiscal, condicion_tributaria,
        ciiu, descripcion_ciiu, fecha_rut,
        idDepartamento, idMunicipio, direccion, codigo_postal
    } = req.body;

    // Validación mínima
    const esEmpresa = tipo_persona === 'J';
    if (esEmpresa && !razon_social?.trim())
        return res.status(400).json({ success: false, mensaje: 'La razón social es requerida.' });
    if (!esEmpresa && !primer_nombre?.trim())
        return res.status(400).json({ success: false, mensaje: 'El primer nombre es requerido.' });
    if (!numero_doc?.trim())
        return res.status(400).json({ success: false, mensaje: 'El número de documento es requerido.' });

    try {
        // Unicidad de numero_doc (guard previo a la transacción)
        const existe = await Clientes.findOne({ where: { numero_doc: numero_doc.trim() } });
        if (existe) return res.status(400).json({ success: false, mensaje: `El documento ${numero_doc.trim()} ya está registrado para otro cliente.` });
    } catch (e) {
        console.error('saveCliente – check unicidad:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al validar el documento.' });
    }

    const toPascal = (str) => str
        ? str.trim().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        : null;

    let t = null;
    const uploadedKeys = [];

    try {
        t = await db.transaction();

        // 1. Crear cliente
        const cliente = await Clientes.create({
            tipo_persona:     tipo_persona || 'N',
            tipo_documento:   esEmpresa ? 'NIT' : (tipo_documento || 'CC'),
            numero_doc:       numero_doc.trim(),
            digito_verif:     esEmpresa ? (digito_verif?.trim() || null) : null,
            razon_social:     esEmpresa ? toPascal(razon_social) : null,
            primer_nombre:    !esEmpresa ? toPascal(primer_nombre) : null,
            segundo_nombre:   !esEmpresa ? toPascal(segundo_nombre) : null,
            primer_apellido:  !esEmpresa ? toPascal(primer_apellido) : null,
            segundo_apellido: !esEmpresa ? toPascal(segundo_apellido) : null,
            email:            email?.trim().toLowerCase() || null,
            telefono:         telefono?.trim() || null,
            genero:           !esEmpresa ? (genero || null) : null,
            activo:           true,
            credito:          false
        }, { transaction: t });

        const idCliente = cliente.idCliente;

        // 2. Datos tributarios
        await ClientesTributario.create({
            idCliente,
            regimen_fiscal:     regimen_fiscal || '49',
            gran_contribuyente: condicion_tributaria === 'gran_contribuyente',
            autorretenedor:     condicion_tributaria === 'autorretenedor',
            agente_retencion:   condicion_tributaria === 'agente_retencion',
            obligado_aduanero:  condicion_tributaria === 'obligado_aduanero',
            ciiu:               ciiu?.trim() || null,
            descripcion_ciiu:   toPascal(descripcion_ciiu),
            fecha_rut:          fecha_rut || null
        }, { transaction: t });

        // 3. Ubicación
        if (idDepartamento || direccion?.trim()) {
            const [deptoRow, munRow] = await Promise.all([
                idDepartamento ? Departamentos.findOne({ where: { id: idDepartamento }, raw: true }) : null,
                idMunicipio    ? Municipios.findOne({ where: { id: idMunicipio }, raw: true })        : null
            ]);
            await ClientesUbicacion.create({
                idCliente,
                idDepartamento:     idDepartamento || null,
                nombreDepartamento: deptoRow?.nombre || null,
                idMunicipio:        idMunicipio || null,
                nombreMunicipio:    munRow?.nombre || null,
                direccion:          toPascal(direccion),
                codigo_postal:      codigo_postal?.trim() || null,
                es_principal:       true
            }, { transaction: t });
        }

        // 4. Documentos (solo si vienen archivos)
        const archivos = req.files?.documentos || [];
        if (archivos.length > 0) {
            const docsData = [];
            await Promise.all(archivos.map(async (file, idx) => {
                const ext           = file.originalname.split('.').pop().toLowerCase();
                const isImg         = file.mimetype.startsWith('image/');
                const nombreArchivo = `cli-${idCliente}-${Date.now()}-${idx}.${isImg ? 'webp' : ext}`;
                const r2Key         = `documentacion/clientes/${nombreArchivo}`;

                let bufferToUpload = file.buffer;
                let contentType    = file.mimetype;
                if (isImg) {
                    bufferToUpload = await sharp(file.buffer)
                        .resize(1500, 1500, { fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toBuffer();
                    contentType = 'image/webp';
                }

                await new Upload({
                    client: s3Client,
                    params: { Bucket: process.env.R2_BUCKET_NAME, Key: r2Key, Body: bufferToUpload, ContentType: contentType }
                }).done();

                uploadedKeys.push(r2Key);
                docsData.push({
                    idPropietario:   idCliente,
                    nombreDocumento: file.originalname,
                    keyName:         r2Key,
                    formato:         isImg ? 'WEBP' : ext.toUpperCase(),
                    pertenece:       'cliente'
                });
            }));
            await Documentacion.bulkCreate(docsData, { transaction: t });
        }

        await t.commit();
        return res.json({ success: true, idCliente });

    } catch (e) {
        if (t) await t.rollback().catch(() => {});
        if (uploadedKeys.length > 0) {
            await Promise.allSettled(uploadedKeys.map(key =>
                s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }))
            ));
        }
        console.error('saveCliente:', e.message, e.stack);
        return res.status(500).json({ success: false, mensaje: e.message || 'Error al guardar el cliente.' });
    }
};

// ─── EDITAR CLIENTE — FORMULARIO ─────────────────────────────────────────────
const editarClienteForm = async (req, res) => {
    const { idCliente } = req.params;
    try {
        const [cliente, tributario, ubicacion, departamentos] = await Promise.all([
            Clientes.findByPk(idCliente, { raw: true }),
            ClientesTributario.findOne({ where: { idCliente }, raw: true }),
            ClientesUbicacion.findOne({ where: { idCliente, es_principal: true }, raw: true }),
            Departamentos.findAll({ raw: true, order: [['nombre', 'ASC']] })
        ]);
        if (!cliente) return res.redirect('/admin/clientes');

        let municipios = [];
        if (ubicacion?.idDepartamento) {
            municipios = await Municipios.findAll({ where: { departamento_id: ubicacion.idDepartamento }, raw: true });
        }

        let condicion_tributaria = null;
        if (tributario) {
            if (tributario.gran_contribuyente)  condicion_tributaria = 'gran_contribuyente';
            else if (tributario.autorretenedor)  condicion_tributaria = 'autorretenedor';
            else if (tributario.agente_retencion) condicion_tributaria = 'agente_retencion';
            else if (tributario.obligado_aduanero) condicion_tributaria = 'obligado_aduanero';
        }

        return res.render('./administrador/customers/new', {
            pagina: 'Clientes',
            subPagina: 'Editar Cliente',
            currentPath: req.path,
            modoEdicion: true,
            cliente,
            tributario: tributario || {},
            ubicacion: ubicacion || {},
            municipios,
            condicion_tributaria,
            departamentos
        });
    } catch (e) {
        console.error('editarClienteForm:', e);
        return res.redirect('/admin/clientes');
    }
};

// ─── EDITAR CLIENTE — GUARDAR ─────────────────────────────────────────────────
const updateCliente = async (req, res) => {
    const { idCliente } = req.params;
    const {
        tipo_persona, tipo_documento, numero_doc, digito_verif,
        primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
        razon_social, email, telefono, genero,
        regimen_fiscal, condicion_tributaria,
        ciiu, descripcion_ciiu, fecha_rut,
        idDepartamento, idMunicipio, direccion, codigo_postal
    } = req.body;

    const esEmpresa = tipo_persona === 'J';
    if (esEmpresa && !razon_social?.trim())
        return res.status(400).json({ success: false, mensaje: 'La razón social es requerida.' });
    if (!esEmpresa && !primer_nombre?.trim())
        return res.status(400).json({ success: false, mensaje: 'El primer nombre es requerido.' });
    if (!numero_doc?.trim())
        return res.status(400).json({ success: false, mensaje: 'El número de documento es requerido.' });

    try {
        const existe = await Clientes.findOne({ where: { numero_doc: numero_doc.trim(), idCliente: { [Op.ne]: idCliente } } });
        if (existe) return res.status(400).json({ success: false, mensaje: `El documento ${numero_doc.trim()} ya está registrado para otro cliente.` });
    } catch (e) {
        console.error('updateCliente – check unicidad:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al validar el documento.' });
    }

    const toPascal = (str) => str
        ? str.trim().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        : null;

    let t = null;
    const uploadedKeys = [];

    try {
        t = await db.transaction();

        await Clientes.update({
            tipo_persona:     tipo_persona || 'N',
            tipo_documento:   esEmpresa ? 'NIT' : (tipo_documento || 'CC'),
            numero_doc:       numero_doc.trim(),
            digito_verif:     esEmpresa ? (digito_verif?.trim() || null) : null,
            razon_social:     esEmpresa ? toPascal(razon_social) : null,
            primer_nombre:    !esEmpresa ? toPascal(primer_nombre) : null,
            segundo_nombre:   !esEmpresa ? toPascal(segundo_nombre) : null,
            primer_apellido:  !esEmpresa ? toPascal(primer_apellido) : null,
            segundo_apellido: !esEmpresa ? toPascal(segundo_apellido) : null,
            email:            email?.trim().toLowerCase() || null,
            telefono:         telefono?.trim() || null,
            genero:           !esEmpresa ? (genero || null) : null
        }, { where: { idCliente }, transaction: t });

        const trib = await ClientesTributario.findOne({ where: { idCliente } });
        const tributarioData = {
            idCliente,
            regimen_fiscal:     regimen_fiscal || '49',
            gran_contribuyente: condicion_tributaria === 'gran_contribuyente',
            autorretenedor:     condicion_tributaria === 'autorretenedor',
            agente_retencion:   condicion_tributaria === 'agente_retencion',
            obligado_aduanero:  condicion_tributaria === 'obligado_aduanero',
            ciiu:               ciiu?.trim() || null,
            descripcion_ciiu:   toPascal(descripcion_ciiu),
            fecha_rut:          fecha_rut || null
        };
        if (trib) {
            await trib.update(tributarioData, { transaction: t });
        } else {
            await ClientesTributario.create(tributarioData, { transaction: t });
        }

        if (idDepartamento || direccion?.trim()) {
            const [deptoRow, munRow] = await Promise.all([
                idDepartamento ? Departamentos.findOne({ where: { id: idDepartamento }, raw: true }) : null,
                idMunicipio    ? Municipios.findOne({ where: { id: idMunicipio }, raw: true })        : null
            ]);
            const ubicData = {
                idCliente,
                idDepartamento:     idDepartamento || null,
                nombreDepartamento: deptoRow?.nombre || null,
                idMunicipio:        idMunicipio || null,
                nombreMunicipio:    munRow?.nombre || null,
                direccion:          toPascal(direccion),
                codigo_postal:      codigo_postal?.trim() || null,
                es_principal:       true
            };
            const ubic = await ClientesUbicacion.findOne({ where: { idCliente, es_principal: true } });
            if (ubic) {
                await ubic.update(ubicData, { transaction: t });
            } else {
                await ClientesUbicacion.create(ubicData, { transaction: t });
            }
        }

        const archivos = req.files?.documentos || [];
        if (archivos.length > 0) {
            const docsData = [];
            await Promise.all(archivos.map(async (file, idx) => {
                const ext           = file.originalname.split('.').pop().toLowerCase();
                const isImg         = file.mimetype.startsWith('image/');
                const nombreArchivo = `cli-${idCliente}-${Date.now()}-${idx}.${isImg ? 'webp' : ext}`;
                const r2Key         = `documentacion/clientes/${nombreArchivo}`;

                let bufferToUpload = file.buffer;
                let contentType    = file.mimetype;
                if (isImg) {
                    bufferToUpload = await sharp(file.buffer)
                        .resize(1500, 1500, { fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toBuffer();
                    contentType = 'image/webp';
                }

                await new Upload({
                    client: s3Client,
                    params: { Bucket: process.env.R2_BUCKET_NAME, Key: r2Key, Body: bufferToUpload, ContentType: contentType }
                }).done();

                uploadedKeys.push(r2Key);
                docsData.push({
                    idPropietario:   idCliente,
                    nombreDocumento: file.originalname,
                    keyName:         r2Key,
                    formato:         isImg ? 'WEBP' : ext.toUpperCase(),
                    pertenece:       'cliente'
                });
            }));
            await Documentacion.bulkCreate(docsData, { transaction: t });
        }

        await t.commit();
        return res.json({ success: true, idCliente });

    } catch (e) {
        if (t) await t.rollback().catch(() => {});
        if (uploadedKeys.length > 0) {
            await Promise.allSettled(uploadedKeys.map(key =>
                s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }))
            ));
        }
        console.error('updateCliente:', e.message, e.stack);
        return res.status(500).json({ success: false, mensaje: e.message || 'Error al actualizar el cliente.' });
    }
};

// ─── STATS CLIENTES ───────────────────────────────────────────────────────────
const getClientesStats = async (req, res) => {
    try {
        const ahora  = new Date();
        const hace7  = new Date(ahora); hace7.setDate(ahora.getDate() - 7);   hace7.setHours(0, 0, 0, 0);
        const hace14 = new Date(ahora); hace14.setDate(ahora.getDate() - 14); hace14.setHours(0, 0, 0, 0);
        const hace30 = new Date(ahora); hace30.setDate(ahora.getDate() - 30); hace30.setHours(0, 0, 0, 0);
        const hace60 = new Date(ahora); hace60.setDate(ahora.getDate() - 60); hace60.setHours(0, 0, 0, 0);

        const [
            nuevosActual,
            nuevosAnterior,
            recurrentesRows,
            ticketActualRows,
            ticketAnteriorRows,
            vipRows
        ] = await Promise.all([
            Clientes.count({ where: { idCliente: { [Op.ne]: '0' }, createdAt: { [Op.gte]: hace7 } } }),
            Clientes.count({ where: { idCliente: { [Op.ne]: '0' }, createdAt: { [Op.between]: [hace14, hace7] } } }),

            db.query(`
                SELECT COUNT(*) AS total FROM (
                    SELECT idCliente FROM FACTURA_CLIENTES
                    WHERE createdAt >= :hace14 AND idCliente != '0'
                    GROUP BY idCliente
                    HAVING COUNT(*) > 1
                ) sub
            `, { replacements: { hace14 }, type: db.QueryTypes.SELECT }),

            db.query(`
                SELECT COALESCE(SUM(df.total) / NULLIF(COUNT(DISTINCT fc.idFacturaCliente), 0), 0) AS ticket
                FROM FACTURA_CLIENTES fc
                INNER JOIN DETALLES_FACTURA df ON df.idFacturaCliente = fc.idFacturaCliente
                WHERE fc.createdAt >= :hace30 AND fc.idCliente != '0'
            `, { replacements: { hace30 }, type: db.QueryTypes.SELECT }),

            db.query(`
                SELECT COALESCE(SUM(df.total) / NULLIF(COUNT(DISTINCT fc.idFacturaCliente), 0), 0) AS ticket
                FROM FACTURA_CLIENTES fc
                INNER JOIN DETALLES_FACTURA df ON df.idFacturaCliente = fc.idFacturaCliente
                WHERE fc.createdAt >= :hace60 AND fc.createdAt < :hace30 AND fc.idCliente != '0'
            `, { replacements: { hace60, hace30 }, type: db.QueryTypes.SELECT }),

            db.query(`
                SELECT COUNT(DISTINCT idCliente) AS total FROM (
                    SELECT idCliente FROM FACTURA_CLIENTES
                    WHERE createdAt >= :hace14 AND idCliente != '0'
                    GROUP BY idCliente
                    HAVING COUNT(*) > 5

                    UNION

                    SELECT fc.idCliente
                    FROM FACTURA_CLIENTES fc
                    INNER JOIN (
                        SELECT idFacturaCliente, SUM(total) AS totalFactura
                        FROM DETALLES_FACTURA
                        GROUP BY idFacturaCliente
                    ) df ON df.idFacturaCliente = fc.idFacturaCliente
                    WHERE fc.createdAt >= :hace30 AND df.totalFactura >= 1000000
                          AND fc.idCliente != '0'
                    GROUP BY fc.idCliente
                    HAVING COUNT(*) >= 3
                ) vip
            `, { replacements: { hace14, hace30 }, type: db.QueryTypes.SELECT })
        ]);

        const totalNuevos = nuevosActual || 0;
        const pctNuevos   = nuevosAnterior > 0
            ? Math.round(((totalNuevos - nuevosAnterior) / nuevosAnterior) * 100)
            : null;

        const ticketAct = Math.round(parseFloat(ticketActualRows[0]?.ticket)  || 0);
        const ticketAnt = Math.round(parseFloat(ticketAnteriorRows[0]?.ticket) || 0);
        const pctTicket = ticketAnt > 0
            ? Math.round(((ticketAct - ticketAnt) / ticketAnt) * 100)
            : null;

        return res.json({
            success: true,
            nuevos:      { total: totalNuevos, pct: pctNuevos },
            recurrentes: { total: parseInt(recurrentesRows[0]?.total) || 0 },
            ticket:      { valor: ticketAct, pct: pctTicket },
            vip:         { total: parseInt(vipRows[0]?.total) || 0 }
        });
    } catch (e) {
        console.error('getClientesStats:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── PERFIL CLIENTE ───────────────────────────────────────────────────────────
const getClientePerfil = async (req, res) => {
    const { idCliente } = req.params;
    try {
        const hace14 = new Date(); hace14.setDate(hace14.getDate() - 14); hace14.setHours(0,0,0,0);
        const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30); hace30.setHours(0,0,0,0);

        const [cliente, ubicacion, statsRows, vendedorRows, vip5, vip3] = await Promise.all([
            Clientes.findOne({
                where: { idCliente },
                raw: true,
                attributes: ['idCliente','tipo_persona','tipo_documento','numero_doc',
                             'primer_nombre','primer_apellido','razon_social',
                             'email','telefono','genero','activo','credito','createdAt']
            }),

            db.query(`
                SELECT direccion, nombreMunicipio, nombreDepartamento
                FROM CLIENTES_UBICACION
                WHERE idCliente = :idCliente AND es_principal = 1
                LIMIT 1
            `, { replacements: { idCliente }, type: db.QueryTypes.SELECT }),

            db.query(`
                SELECT MAX(fc.fechaEmision) AS ultimaCompra,
                       COUNT(DISTINCT fc.idFacturaCliente) AS totalPedidos,
                       COALESCE(SUM(df.total), 0) AS totalComprado,
                       COALESCE(SUM(CASE WHEN fc.estado = 'pendiente' THEN df.total ELSE 0 END), 0) AS cartera,
                       COALESCE(SUM(CASE WHEN fc.estado = 'liquidada' THEN df.total ELSE 0 END), 0) AS totalPagado
                FROM FACTURA_CLIENTES fc
                INNER JOIN DETALLES_FACTURA df ON df.idFacturaCliente = fc.idFacturaCliente
                WHERE fc.idCliente = :idCliente
            `, { replacements: { idCliente }, type: db.QueryTypes.SELECT }),

            db.query(`
                SELECT TRIM(CONCAT(COALESCE(e.PrimerNombre,''), ' ', COALESCE(e.PrimerApellido,''))) AS vendedor
                FROM FACTURA_CLIENTES fc
                LEFT JOIN EMPLEADOS e ON e.idEmpleado = fc.idEmpleado
                WHERE fc.idCliente = :idCliente AND fc.idEmpleado IS NOT NULL
                ORDER BY fc.createdAt DESC LIMIT 1
            `, { replacements: { idCliente }, type: db.QueryTypes.SELECT }),

            db.query(`
                SELECT COUNT(*) AS cnt FROM FACTURA_CLIENTES
                WHERE idCliente = :idCliente AND createdAt >= :hace14
            `, { replacements: { idCliente, hace14 }, type: db.QueryTypes.SELECT }),

            db.query(`
                SELECT COUNT(*) AS cnt
                FROM FACTURA_CLIENTES fc
                INNER JOIN (SELECT idFacturaCliente, SUM(total) AS totalFactura FROM DETALLES_FACTURA GROUP BY idFacturaCliente) df
                    ON df.idFacturaCliente = fc.idFacturaCliente
                WHERE fc.idCliente = :idCliente AND fc.createdAt >= :hace30 AND df.totalFactura >= 1000000
            `, { replacements: { idCliente, hace30 }, type: db.QueryTypes.SELECT })
        ]);

        if (!cliente) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });

        const st  = statsRows[0] || {};
        const ubi = ubicacion[0] || {};
        const esVip = parseInt(vip5[0]?.cnt) > 5 || parseInt(vip3[0]?.cnt) >= 3;
        const puedeActivarCredito = await _tienePermisoCredito(req.usuario);

        return res.json({
            success: true,
            cliente,
            ubicacion: ubi,
            stats: {
                ultimaCompra:  st.ultimaCompra || null,
                totalPedidos:  parseInt(st.totalPedidos)    || 0,
                totalComprado: parseFloat(st.totalComprado) || 0,
                cartera:       parseFloat(st.cartera)       || 0,
                totalPagado:   parseFloat(st.totalPagado)   || 0,
                vendedor:      vendedorRows[0]?.vendedor?.trim() || null
            },
            esVip,
            puedeActivarCredito
        });
    } catch (e) {
        console.error('getClientePerfil:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── ARCHIVOS DEL CLIENTE ────────────────────────────────────────────────────
const getClienteArchivos = async (req, res) => {
    const { idCliente } = req.params;
    try {
        const docs = await Documentacion.findAll({
            where: { idPropietario: idCliente, pertenece: 'cliente' },
            order: [['createdAt', 'DESC']],
            raw: true
        });
        const r2Base = process.env.R2_PUBLIC_URL;
        const archivos = docs.map(d => ({
            idDocumento:    d.idDocumento,
            nombreDocumento: d.nombreDocumento,
            formato:        d.formato,
            url:            `${r2Base}/${d.keyName}`,
            createdAt:      d.createdAt
        }));
        return res.json({ success: true, archivos });
    } catch (e) {
        console.error('getClienteArchivos:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── ELIMINAR DOCUMENTO DE CLIENTE ───────────────────────────────────────────
const eliminarDocumentoCliente = async (req, res) => {
    const { idDocumento } = req.params;
    try {
        const doc = await Documentacion.findOne({ where: { idDocumento, pertenece: 'cliente' } });
        if (!doc) return res.status(404).json({ success: false, mensaje: 'Documento no encontrado' });
        await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: doc.keyName })).catch(() => {});
        await doc.destroy();
        return res.json({ success: true });
    } catch (e) {
        console.error('eliminarDocumentoCliente:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al eliminar el documento' });
    }
};

// ─── HISTORIAL DE COMPRAS DEL CLIENTE ────────────────────────────────────────
const getClienteHistorial = async (req, res) => {
    const { idCliente } = req.params;
    const { pagina = 1 } = req.query;
    const limite = 6;
    const offset = (parseInt(pagina) - 1) * limite;
    try {
        const [rows, countRows] = await Promise.all([
            db.query(`
                SELECT fc.idFacturaCliente, fc.prefijo, fc.numeroFactura,
                       fc.fechaEmision, fc.horaEmision, fc.estado,
                       SUM(df.total) AS total,
                       GROUP_CONCAT(DISTINCT p.nombreProducto ORDER BY p.nombreProducto SEPARATOR ', ') AS concepto,
                       TRIM(CONCAT(COALESCE(e.PrimerNombre,''), ' ', COALESCE(e.PrimerApellido,''))) AS vendedor
                FROM FACTURA_CLIENTES fc
                INNER JOIN DETALLES_FACTURA df ON df.idFacturaCliente = fc.idFacturaCliente
                LEFT JOIN PRODUCTOS p ON p.idProducto = df.idProducto
                LEFT JOIN EMPLEADOS e ON e.idEmpleado = fc.idEmpleado
                WHERE fc.idCliente = :idCliente
                GROUP BY fc.idFacturaCliente, fc.prefijo, fc.numeroFactura,
                         fc.fechaEmision, fc.horaEmision, fc.estado, e.PrimerNombre, e.PrimerApellido
                ORDER BY fc.createdAt DESC
                LIMIT :limite OFFSET :offset
            `, { replacements: { idCliente, limite, offset }, type: db.QueryTypes.SELECT }),

            db.query(`SELECT COUNT(*) AS total FROM FACTURA_CLIENTES WHERE idCliente = :idCliente`,
                { replacements: { idCliente }, type: db.QueryTypes.SELECT })
        ]);

        const total = parseInt(countRows[0]?.total) || 0;
        return res.json({
            success:        true,
            facturas:       rows,
            totalPaginas:   Math.ceil(total / limite),
            paginaActual:   parseInt(pagina),
            totalRegistros: total
        });
    } catch (e) {
        console.error('getClienteHistorial:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── CHECK UNICIDAD DOCUMENTO CLIENTE ────────────────────────────────────────
const checkDocumentoCliente = async (req, res) => {
    const { numero } = req.params;
    const { exclude } = req.query;
    try {
        const where = { numero_doc: numero.trim() };
        if (exclude) where.idCliente = { [Op.ne]: exclude };
        const cliente = await Clientes.findOne({ where });
        return res.json({ exists: !!cliente });
    } catch (e) {
        console.error('checkDocumentoCliente:', e);
        return res.status(500).json({ exists: false });
    }
};

// ─── HELPER PERMISO CRÉDITO ──────────────────────────────────────────────────
const _tienePermisoCredito = async (usuario) => {
    if (!usuario) return false;

    const [recurso, acciones] = await Promise.all([
        PermisosRecursos.findOne({
            where: { nombreRecurso: 'Autorizacion de creditos' },
            raw: true
        }),
        PermisosAcciones.findAll({
            where: { nombreAccion: { [Op.in]: ['CREATE', 'EDIT'] } },
            attributes: ['idAccion'],
            raw: true
        })
    ]);

    if (!recurso || !acciones.length) return false;

    const accionIds = acciones.map(a => a.idAccion);
    const permiso = await UserPermisos.findOne({
        where: {
            idUsuario: usuario.idUsuario,
            idRecurso: recurso.idRecurso,
            idAccion:  { [Op.in]: accionIds }
        }
    });
    return !!permiso;
};

// ─── ACTIVAR CRÉDITO DE CLIENTE ──────────────────────────────────────────────
const activarCreditoCliente = async (req, res) => {
    const { idCliente } = req.params;
    try {
        if (!(await _tienePermisoCredito(req.usuario)))
            return res.status(403).json({ success: false, mensaje: 'Sin autorización para activar créditos' });

        const cliente = await Clientes.findByPk(idCliente);
        if (!cliente) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });

        await cliente.update({ credito: true });
        return res.json({ success: true });
    } catch (e) {
        console.error('activarCreditoCliente:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── LISTA CLIENTES PAGINADA ──────────────────────────────────────────────────
const filterClientesListJson = async (req, res) => {
    try {
        const { busqueda = '', pagina = 1 } = req.query;
        const limite = parseInt(process.env.LIMIT_PER_PAGE) || 10;
        const offset = (parseInt(pagina) - 1) * limite;
        const term   = busqueda.trim();
        const termLike = term ? `%${term}%` : null;

        const whereClause = termLike
            ? `AND (c.primer_nombre LIKE :term OR c.primer_apellido LIKE :term
                    OR c.razon_social LIKE :term OR c.numero_doc LIKE :term)`
            : '';

        const [rows, countRows] = await Promise.all([
            db.query(`
                SELECT
                    c.idCliente,
                    c.primer_nombre, c.primer_apellido, c.razon_social,
                    c.tipo_documento, c.numero_doc,
                    uf.fechaEmision AS ultimaCompra,
                    TRIM(CONCAT(COALESCE(e.PrimerNombre,''), ' ', COALESCE(e.PrimerApellido,''))) AS vendedor
                FROM CLIENTES c
                LEFT JOIN (
                    SELECT fc.idCliente,
                           ANY_VALUE(fc.fechaEmision) AS fechaEmision,
                           ANY_VALUE(fc.idEmpleado)   AS idEmpleado
                    FROM FACTURA_CLIENTES fc
                    INNER JOIN (
                        SELECT idCliente, MAX(createdAt) AS maxFecha
                        FROM FACTURA_CLIENTES
                        WHERE idCliente != '0'
                        GROUP BY idCliente
                    ) lf ON lf.idCliente = fc.idCliente AND fc.createdAt = lf.maxFecha
                    GROUP BY fc.idCliente
                ) uf ON uf.idCliente = c.idCliente
                LEFT JOIN EMPLEADOS e ON e.idEmpleado = uf.idEmpleado
                WHERE c.idCliente != '0' ${whereClause}
                ORDER BY c.createdAt DESC
                LIMIT :limite OFFSET :offset
            `, { replacements: { term: termLike, limite, offset }, type: db.QueryTypes.SELECT }),

            db.query(`
                SELECT COUNT(*) AS total
                FROM CLIENTES c
                WHERE c.idCliente != '0' ${whereClause}
            `, { replacements: { term: termLike }, type: db.QueryTypes.SELECT })
        ]);

        const total = parseInt(countRows[0]?.total) || 0;

        return res.json({
            success:        true,
            clientes:       rows,
            totalPaginas:   Math.ceil(total / limite),
            paginaActual:   parseInt(pagina),
            totalRegistros: total,
        });
    } catch (e) {
        console.error('filterClientesListJson:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar clientes' });
    }
};



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
        subPagina: "Configuración",
        csrfToken: req.csrfToken(),
        currentPath: req.path
    })
}



//PROVEDORES

const dashboardSupplier = async (req, res) => {

    const hoySQL       = new Date().toISOString().split('T')[0];
    const en3DiasSQL   = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

    const [categorias, [[statsCP]], [[statsVencer]], [[statsVencidas]]] = await Promise.all([
        CategoriasDeProvedores.findAll(),
        db.query(`
            SELECT
                COUNT(*) AS totalFacturas,
                COALESCE(SUM(
                    COALESCE(
                        (SELECT valorPorPagar FROM CUENTAS_POR_PAGAR
                         WHERE idFacturaPro = fp.idFacturaPro
                         ORDER BY createdAt DESC LIMIT 1),
                        fp.valorTotal
                    )
                ), 0) AS totalPorPagar
            FROM FACTURA_PROVEEDORES fp
            WHERE fp.estado = 'Pendiente'
        `),
        db.query(`
            SELECT COUNT(*) AS total
            FROM FACTURA_PROVEEDORES
            WHERE estado = 'Pendiente'
              AND fechaVencimiento IS NOT NULL
              AND fechaVencimiento >= :hoy
              AND fechaVencimiento <= :en3Dias
        `, { replacements: { hoy: hoySQL, en3Dias: en3DiasSQL } }),
        db.query(`
            SELECT COUNT(*) AS total
            FROM FACTURA_PROVEEDORES
            WHERE estado = 'Pendiente'
              AND fechaVencimiento IS NOT NULL
              AND fechaVencimiento < :hoy
        `, { replacements: { hoy: hoySQL } })
    ]);

    const fmtCOP = v => '$' + new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

    return res.status(201).render('./administrador/supplier/homeSupplier', {
        pagina: "Provedores",
        subPagina: "Gestión Provedores",
        csrfToken: req.csrfToken(),
        currentPath: req.path,
        categorias,
        cuentasPorPagar: {
            total: parseInt(statsCP.totalFacturas)    || 0,
            monto: fmtCOP(parseFloat(statsCP.totalPorPagar) || 0)
        },
        facturasPorVencer: parseInt(statsVencer.total)  || 0,
        facturasVencidas:  parseInt(statsVencidas.total) || 0
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
            order: [['createdAt', 'DESC'], ['idEmpleado', 'ASC']],
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



const skuUnico13 = async (base, { transaction = null, usados = new Set() } = {}) => {
    const limpio = normalizarSku13(base);
    if (!limpio) return '';

    let candidato = limpio;
    let n = 2;
    while (usados.has(candidato) || await Productos.findOne({
        where: { sku: candidato },
        attributes: ['idProducto'],
        ...(transaction ? { transaction } : {})
    })) {
        const sufijo = String(n++);
        candidato = `${limpio.slice(0, 13 - sufijo.length)}${sufijo}`;
    }
    usados.add(candidato);
    return candidato;
};

const saveProduct = async (req, res, next) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
        return res.status(400).json({
            errores: errores.array().reduce((acc, err) => ({ ...acc, [err.path]: err.msg }), {})
        });
    }


    try {
        const { idProducto, categorias, variantes_finales, imagenes_borrar, variantes_sku, imagenes_color_nuevas, imagenes_color_existentes } = req.body;
        const csrfToken = req.csrfToken();

        // 1. Sanitización de Datos
        const idCategoriaParaDB = Array.isArray(categorias) ? categorias.join('|') : categorias;
        const precioVentaPublicoFinal = parseInt(limpiarPrecio(req.body.precioVentaPublicoFinal));
        const precioVentaMayorista = parseInt(limpiarPrecio(req.body.precioVentaMayorista));
        const precioVentaMayoristaSurtido = parseInt(limpiarPrecio(req.body.precioVentaMayoristaSurtido)) || 0;
        // TEMPORAL. Mismo tratamiento que los precios: el formulario manda "$8.000" con
        // separadores, así que hay que limpiarlo antes de guardarlo como DECIMAL.
        const costo = parseInt(limpiarPrecio(req.body.costo)) || 0;
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

        // 1.1 Si hay más de una combinación talla+color, cada una es un PRODUCTO
        // independiente (su propio SKU, nombre y fotos) — no una variante de un mismo producto.
        const variacionesSeleccionadas = JSON.parse(variantes_finales || '{}');
        const skuPorCombinacion = JSON.parse(variantes_sku || '{}');
        const combos = [];
        Object.entries(variacionesSeleccionadas).forEach(([talla, colores]) => {
            (colores || []).forEach(idColor => combos.push({ idTalla: talla, idColor, idAtributos: `${talla}|${idColor}` }));
        });

        // Regla: TODO producto queda en una familia. El formulario manda el NOMBRE; acá se
        // resuelve a la fila de FAMILIA (se crea si no existe) y se guarda la FK.
        //
        // Si el campo viene vacío se deduce del nombre del producto, y de dónde se saca
        // depende del tipo de alta:
        //   · varias combinaciones talla×color → el nombre tecleado ES el artículo
        //     ("Blusa Greicy"), porque el color se le agrega después a cada variante.
        //   · producto único → el nombre ya incluye la variante ("Blusa Greicy - Rojo"),
        //     así que se toma el prefijo; usarlo entero daría una familia por producto.
        //
        // En ambos casos findOrCreate hace que caiga en la familia existente si ya la hay.
        const nombreFamilia = normalizarFamilia(req.body.familia)
            || (combos.length > 1 ? familiaDesdeNombre(nombreProducto) : prefijoFamilia(nombreProducto));
        const idFamiliaParaDB = await resolverIdFamilia(nombreFamilia);

        if (combos.length > 1) {
            const mapaColorNuevas = JSON.parse(imagenes_color_nuevas || '{}'); // fileIndex -> idColor
            const indicesPorColor = {};
            Object.entries(mapaColorNuevas).forEach(([idx, idColor]) => {
                if (!indicesPorColor[idColor]) indicesPorColor[idColor] = [];
                indicesPorColor[idColor].push(parseInt(idx));
            });

            const idsAtributos = [...new Set(combos.flatMap(c => [c.idTalla, c.idColor]))];
            const atributos = await Atributos.findAll({ where: { idAtributo: idsAtributos } });
            const nombrePorAtributo = Object.fromEntries(atributos.map(a => [String(a.idAtributo), a.valor]));

            const t = await db.transaction();
            const idsCreados = [];
            const skusUsados = new Set();
            try {
                for (const combo of combos) {
                    const skuCombo = await skuUnico13(skuPorCombinacion[combo.idAtributos], {
                        transaction: t,
                        usados: skusUsados
                    });
                    if (!skuCombo) throw new Error(`Falta el SKU para la combinación ${combo.idAtributos}`);

                    const nombreColor = nombrePorAtributo[combo.idColor] || '';
                    const nombreTalla = nombrePorAtributo[combo.idTalla] || '';
                    const partesNombre = [nombreProducto, nombreColor];
                    if (nombreTalla && nombreTalla.toLowerCase() !== 'unica') partesNombre.push(nombreTalla);
                    const nombreFinal = partesNombre.filter(Boolean).join(' ');

                    const nuevoProducto = await Productos.create({
                        nombreProducto: nombreFinal,
                        slug: await slugUnico(generarSlugDe(nombreFinal), { transaction: t }),
                        sku: skuCombo,
                        ean: null,
                        // Todas las combinaciones de esta alta son el mismo artículo, así que
                        // comparten familia. Si el usuario no puso una, se propone el nombre
                        // base del producto — que es exactamente lo que las agrupa.
                        idFamilia: idFamiliaParaDB,
                        idCategoria: idCategoriaParaDB,
                        precioVentaPublicoFinal,
                        precioVentaMayorista,
                        precioVentaMayoristaSurtido,
                        costo,
                        descripcion: descripcionLimpia,
                        activo,
                        web,
                        tags: req.body.tags
                    }, { transaction: t });

                    await VariacionesProducto.create({
                        idProducto: nuevoProducto.idProducto,
                        idAtributos: combo.idAtributos,
                        valor: 0
                    }, { transaction: t });

                    idsCreados.push({ idProducto: nuevoProducto.idProducto, sku: skuCombo, idColor: combo.idColor });
                }
                await t.commit();
            } catch (errorTransaccion) {
                await t.rollback();
                throw errorTransaccion;
            }

            // Subida de imágenes por producto (fuera de la transacción: son llamadas a R2, no a la BD)
            if (req.files && req.files.length > 0) {
                for (const creado of idsCreados) {
                    const indices = indicesPorColor[creado.idColor] || [];
                    let esPrimera = true;
                    for (const idx of indices) {
                        const file = req.files[idx];
                        if (!file) continue;
                        const nombreArchivo = `${creado.sku}-${Date.now()}-${idx}.webp`;
                        const bufferOptimizado = await sharp(file.buffer)
                            .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
                            .webp({ quality: 80 })
                            .toBuffer();
                        await new Upload({
                            client: s3Client,
                            params: { Bucket: process.env.R2_BUCKET_NAME, Key: `productos/${nombreArchivo}`, Body: bufferOptimizado, ContentType: 'image/webp' }
                        }).done();
                        await Imagenes.create({
                            idProducto: creado.idProducto,
                            nombreImagen: nombreArchivo,
                            tipo: esPrimera ? 'principal' : 'galeria'
                        });
                        esPrimera = false;
                    }
                }
            }

            return res.json({
                success: true,
                mensaje: `${idsCreados.length} productos creados correctamente`,
                idProducto: idsCreados[0]?.idProducto,
                idsProductos: idsCreados.map(c => c.idProducto)
            });
        }

        let producto;
        // También acá: el slug viene del formulario y puede repetir el de otro producto.
        // Al editar se excluye el propio, para que conservar su slug no cuente como choque.
        const slugLibre = await slugUnico(slug, { idProductoActual: idProducto || null });
        const datosParaDB = {
            nombreProducto,
            slug: slugLibre,
            sku: normalizarSku13(req.body.sku),
            ean: req.body.ean,
            idFamilia: idFamiliaParaDB,
            idCategoria: idCategoriaParaDB,
            precioVentaPublicoFinal,
            precioVentaMayorista,
            precioVentaMayoristaSurtido,
            costo,
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

        // 3. Reconstrucción de Variaciones (aquí combos.length es 0 o 1: producto único, sin split)
        await VariacionesProducto.destroy({ where: { idProducto: idReal } });
        const variacionesFinales = [];

        Object.entries(variacionesSeleccionadas).forEach(([talla, colores]) => {
            colores.forEach(idColor => {
                const idAtributos = `${talla}|${idColor}`;
                variacionesFinales.push({
                    idProducto: idReal,
                    idAtributos,
                    sku: skuPorCombinacion[idAtributos] || null,
                    valor: 0
                });
            });
        });
        if (variacionesFinales.length > 0) await VariacionesProducto.bulkCreate(variacionesFinales);

        // 3.1 Emparejar imágenes ya existentes con su color (modo edición)
        const mapaColorExistentes = JSON.parse(imagenes_color_existentes || '{}');
        for (const [idMultimedia, idColor] of Object.entries(mapaColorExistentes)) {
            await Imagenes.update({ idAtributoColor: idColor }, { where: { idMultimedia } });
        }

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
            const mapaColorNuevas = JSON.parse(imagenes_color_nuevas || '{}');

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
                    idAtributoColor: mapaColorNuevas[index] || null,
                    tipo: (!tienePrincipal && index === 0) ? 'principal' : 'galeria'
                };
            });
            const imagenesData = await Promise.all(uploadPromises);
            await Imagenes.bulkCreate(imagenesData);
        }

        // 6. Respuesta final (Fuera de los bloques condicionales)
        res.json({ success: true, mensaje: 'Producto procesado con éxito', idProducto: idReal });

    } catch (error) {

        if (error.name === 'SequelizeUniqueConstraintError') {
            // Nombrar el campo: con "un valor único ya está en uso" el usuario no sabe cuál
            // corregir. Ojo con el `path`: es el nombre del ÍNDICE que rechazó MySQL, no el
            // del campo — coincide con la columna solo cuando el índice es autogenerado.
            // (`familia` no aparece acá: su índice no es único, varios productos la comparten.)
            const ETIQUETA_CAMPO_UNICO = {
                sku: 'Uno de los SKU de las variantes',
                ean: 'El EAN'
            };
            const campo = ETIQUETA_CAMPO_UNICO[error.errors?.[0]?.path] || 'Un valor único';
            return res.status(400).json({ mensaje: `${campo} ya está en uso por otro producto o variante.` });
        }

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


// Sugerencia de familia a partir del nombre que se está escribiendo.
//
// Los nombres del catálogo comparten prefijo y se diferencian al final por el color o la
// talla ("Blusa Greicy - Rojo", "Blusa Greicy - Negro"), así que el prefijo de las primeras
// palabras es lo que identifica al artículo. Con dos palabras alcanza para separar
// "Blusa Greicy" de "Blusa Polo Ny" sin dejar afuera a los hermanos.
const familiaSugerenciasJson = async (req, res) => {
    try {
        const nombre = normalizarFamilia(req.query.nombre);
        // Sin al menos dos palabras el prefijo sería tan corto que traería medio catálogo.
        if (!nombre) return res.json({ success: true, prefijo: null, familias: [], parecidos: 0 });

        const prefijo = prefijoFamilia(nombre);
        if (!prefijo || prefijo.length < 3) return res.json({ success: true, prefijo: null, familias: [], parecidos: 0 });

        // `escape` de los comodines: un nombre con % o _ buscaría cualquier cosa.
        const patron = prefijo.replace(/[%_\\]/g, c => `\\${c}`) + '%';

        // El LIMIT acota el trabajo aunque el prefijo sea muy común; para sugerir alcanza.
        // La colación por defecto de MySQL es case-insensitive, así que no hace falta UPPER().
        // El include trae el nombre de la familia en la MISMA consulta (sin N+1).
        const parecidos = await Productos.findAll({
            where: {
                nombreProducto: { [Op.like]: patron },
                // Al editar, el propio producto no es un "parecido" de sí mismo.
                ...(req.query.idProducto ? { idProducto: { [Op.ne]: req.query.idProducto } } : {})
            },
            attributes: ['idProducto', 'nombreProducto', 'idFamilia'],
            include: [{ model: Familia, as: 'familia', attributes: ['idFamilia', 'nombreFamilia'], required: false }],
            limit: 50
        });

        // Se agrupa en memoria sobre un máximo de 50 filas ya traídas: una consulta, sin N+1.
        const conteo = new Map();
        parecidos.forEach(p => {
            if (!p.familia) return;
            const clave = p.familia.idFamilia;
            const actual = conteo.get(clave) || { idFamilia: clave, familia: p.familia.nombreFamilia, productos: 0 };
            actual.productos += 1;
            conteo.set(clave, actual);
        });

        const familias = [...conteo.values()].sort((a, b) => b.productos - a.productos);

        return res.json({
            success:   true,
            prefijo,                      // familia propuesta si todavía no existe ninguna
            familias,                     // familias ya usadas por productos parecidos
            parecidos: parecidos.length,
            ejemplos:  parecidos.slice(0, 5).map(p => p.nombreProducto)

        });
    } catch (error) {
        console.error('[familiaSugerencias]', error);
        return res.status(500).json({ success: false, mensaje: 'Error en el servidor' });
    }
};

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
            // createdAt solo no alcanza como orden: una importación masiva (u otro alta por
            // lote) deja muchos productos con el mismo segundo exacto — 423 productos de esta
            // tabla comparten un único valor de createdAt ahora mismo. Sin un desempate único
            // MySQL no garantiza el mismo orden entre páginas, y un producto puede repetirse
            // en dos páginas o saltarse una.
            order: [['createdAt', 'DESC'], ['idProducto', 'ASC']],
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
const verProveedor = async (req, res) => {
    const { idProveedor } = req.params;
    try {
        const [proveedor, categoriasProvedores, departamentos] = await Promise.all([
            Provedores.findOne({
                where: { idProveedor },
                include: [{ model: CategoriasDeProvedores, as: 'categorias', through: { attributes: [] } }]
            }),
            CategoriasDeProvedores.findAll(),
            Departamentos.findAll({ raw: true })
        ]);
        if (!proveedor) return res.redirect('/admin/provedores/');

        const facturasRaw = await FacturaProveedores.findAll({
            where: { idProveedor },
            include: [
                { model: PuntosDeVenta, as: 'destino', attributes: ['nombreComercial'] },
                { model: CuentasPorPagar, as: 'cuentasPorPagar', attributes: ['valorPorPagar', 'createdAt'], separate: true, order: [['createdAt', 'DESC']] }
            ],
            order: [['fechaFactura', 'DESC']]
        });

        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const en3Dias = new Date(hoy); en3Dias.setDate(en3Dias.getDate() + 3);
        const fmtCOP = v => '$' + new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(parseFloat(v) || 0);
        const fmtFecha = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null;

        const facturas = facturasRaw.map(f => {
            const abonos = f.cuentasPorPagar || [];
            const saldo = abonos.length > 0 ? parseFloat(abonos[0].valorPorPagar) : parseFloat(f.valorTotal);
            const fv = f.fechaVencimiento ? new Date(f.fechaVencimiento + 'T00:00:00') : null;
            let vencState = 'normal';
            if (fv && f.estado === 'Pendiente') {
                if (fv < hoy) vencState = 'vencida';
                else if (fv <= en3Dias) vencState = 'proxima';
            }
            return {
                idFacturaPro:     f.idFacturaPro,
                nroFactura:       f.nroFactura,
                fechaFactura:     fmtFecha(f.fechaFactura),
                fechaVencimiento: fmtFecha(f.fechaVencimiento),
                valorTotal:       fmtCOP(f.valorTotal),
                saldoPendiente:   f.estado === 'Pendiente' ? fmtCOP(saldo) : null,
                estado:           f.estado,
                esCredito:        f.esCredito,
                destino:          f.destino?.nombreComercial || '—',
                nroAbonos:        abonos.length,
                vencState
            };
        });

        return res.render('./administrador/supplier/ver', {
            pagina: 'Proveedor',
            subPagina: proveedor.razonSocial,
            proveedor: proveedor.toJSON(),
            categoriasActivas: proveedor.categorias.map(c => c.idCategoria),
            categoriasProvedores,
            departamentos,
            facturas,
            csrfToken: req.csrfToken(),
            currentPath: req.path
        });
    } catch (error) {
        console.error('verProveedor:', error);
        return res.status(500).send('Error al cargar el proveedor.');
    }
};

const actualizarProveedor = async (req, res) => {
    const { idProveedor } = req.params;
    try {
        const {
            razonSocial, taxIdSupplier, emailProvedor, telefonoProvedor, telefonoContacto,
            nombreContacto, direccionProvedor, ciudad, departamento, categorias
        } = req.body;

        const proveedor = await Provedores.findOne({ where: { idProveedor } });
        if (!proveedor) return res.status(404).json({ success: false, mensaje: 'Proveedor no encontrado.' });

        await proveedor.update({
            razonSocial:       razonSocial?.trim()       || proveedor.razonSocial,
            emailProvedor:     emailProvedor?.trim()     || proveedor.emailProvedor,
            telefonoProvedor:  telefonoProvedor?.trim()  || proveedor.telefonoProvedor,
            telefonoContacto:  telefonoContacto?.trim()  || proveedor.telefonoContacto,
            nombreContacto:    nombreContacto?.trim()    || proveedor.nombreContacto,
            direccionProvedor: direccionProvedor?.trim() || proveedor.direccionProvedor,
            ciudad:            ciudad?.trim()            || proveedor.ciudad,
            departamento:      departamento?.trim()      || proveedor.departamento,
        });

        // Actualizar categorías
        const cats = Array.isArray(categorias) ? categorias : (categorias ? [categorias] : []);
        const catObjs = cats.length > 0
            ? await CategoriasDeProvedores.findAll({ where: { idCategoria: cats } })
            : [];
        await proveedor.setCategorias(catObjs);

        return res.json({ success: true, mensaje: 'Proveedor actualizado correctamente.' });
    } catch (error) {
        console.error('actualizarProveedor:', error);
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar el proveedor.' });
    }
};

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
        const extsPermitidas = ['pdf','jpg','jpeg','png','webp','gif','xls','xlsx','doc','docx'];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const ext = file.originalname.split('.').pop().toLowerCase();
                if (!extsPermitidas.includes(ext)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, mensaje: `Archivo "${file.originalname}" no permitido. Solo: PDF, JPG, PNG, GIF, XLS, DOC.` });
                }
            }
        }
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
        res.json({ success: true, mensaje: 'Provedor guardado con éxito', idProveedor: nuevoProvedor.idProveedor, razonSocial: nuevoProvedor.razonSocial });

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
            order: [['createdAt', 'DESC'], ['idProveedor', 'ASC']],
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

        // 3. Get images and availability for each item — una sola consulta para toda la
        // página (no una por fila): con LIMIT_PER_PAGE alto esto era una query de imagen
        // por producto suelto en la página, N+1 clásico sobre un listado paginado.
        const idsSueltos = [...new Set(
            inventory
                .filter(item => item.tipoRecord === 'loose' || !item.idPack)
                .map(item => item.idProducto)
        )];
        const imagenesSueltas = idsSueltos.length
            ? await Imagenes.findAll({
                  where: { idProducto: { [Op.in]: idsSueltos }, tipo: 'principal' },
                  attributes: ['idProducto', 'nombreImagen'],
                  raw: true
              })
            : [];
        const mapaImagen = Object.fromEntries(imagenesSueltas.map(img => [img.idProducto, img.nombreImagen]));

        const processedInventory = inventory.map((item) => {
            let imagenUrl = '/img/avatars/bag.webp';
            let displayProducto = item.codigoEtiqueta || item.nombreProducto;
            let displaySku = item.codigoEtiqueta ? '' : item.sku;

            if (item.tipoRecord === 'loose' || !item.idPack) {
                const nombreImagen = mapaImagen[item.idProducto];
                imagenUrl = nombreImagen ? `${process.env.R2_PUBLIC_URL}/productos/${nombreImagen}` : '/img/image-default.webp';
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
        });

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
    const { ids } = req.query;

    let etiquetas = []; // [{ sku, nombre }]

    if (ids) {
        // Varios productos independientes (uno por combinación talla+color creada de una vez)
        const idsLista = ids.split(',').map(s => s.trim()).filter(Boolean);
        const productos = await Productos.findAll({
            where: { idProducto: idsLista },
            attributes: ['idProducto', 'sku', 'nombreProducto']
        });
        // Respetamos el orden en que llegaron los ids, no el orden de la consulta
        etiquetas = idsLista
            .map(id => productos.find(p => p.idProducto === id))
            .filter(Boolean)
            .map(p => ({ sku: p.sku, nombre: p.nombreProducto }));
    } else {
        const producto = await Productos.findOne({
            where: { idProducto },
            attributes: ['sku', 'nombreProducto']
        });
        if (!producto?.sku) return res.status(404).send('Producto no encontrado.');

        // Compatibilidad con productos antiguos que aún guardan variantes con SKU propio
        // dentro de un mismo producto (antes de que cada combinación fuera su propio producto).
        const variantes = await VariacionesProducto.findAll({
            where: { idProducto },
            attributes: ['sku']
        });
        const skusVariantes = variantes.filter(v => v.sku).map(v => v.sku);
        etiquetas = (skusVariantes.length > 0 ? skusVariantes : [producto.sku])
            .map(sku => ({ sku, nombre: producto.nombreProducto }));
    }

    if (etiquetas.length === 0) return res.status(404).send('Producto no encontrado.');

    // 5.5 cm = 155.91 pt (ancho) | 2.5 cm = 70.87 pt (alto)
    const W  = 155.91;
    const H  = 70.87;
    const mx = 4;
    // Reparto vertical de la etiqueta. El alto de las barras se fija acá y NO se deja
    // que salga de la proporción del PNG: el ancho del código depende de cuántos
    // caracteres tenga el SKU, así que un SKU largo daba barras más bajas que uno corto
    // y la etiqueta cambiaba de aspecto entre productos.
    const ALTO_TEXTO   = 12;              // una línea a 10 pt
    const Y_TEXTO      = H - mx - ALTO_TEXTO;
    const ALTO_BARRAS  = Y_TEXTO - mx - 2; // las barras bajan hasta 2 pt antes del nombre

    try {
        const doc = new PDFDocument({ size: [W, H], margins: { top: mx, bottom: mx, left: mx, right: mx }, autoFirstPage: false });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=sku_${etiquetas[0].sku}.pdf`);
        doc.pipe(res);

        for (const { sku, nombre } of etiquetas) {
            doc.addPage({ size: [W, H], margins: { top: mx, bottom: mx, left: mx, right: mx } });

            // Barcode (sin texto incluido, sin título)
            const buffer = await bwipjs.toBuffer({
                bcid:        'code128',
                text:        sku,
                scale:       2,
                height:      9,
                includetext: false,
            });
            // width + height juntos: se estira al área exacta. Un código de barras admite
            // el estirado vertical — el lector mide el ANCHO de las barras, no su alto.
            doc.image(buffer, mx, mx, { width: W - mx * 2, height: ALTO_BARRAS });

            // Nombre del producto centrado, pegado al pie de las barras
            doc.fontSize(10).font('Helvetica-Bold')
               .text(nombre, mx, Y_TEXTO, { width: W - mx * 2, align: 'center', lineBreak: false, ellipsis: true });
        }

        doc.end();
    } catch (e) {
        console.error('imprimirEtiquetaSKU:', e);
        res.status(500).send('Error al generar la etiqueta.');
    }
};

// ─── STATS DETALLE TIENDA HOY ─────────────────────────────────────────────────
const getTiendaStatsHoyDetalle = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    try {
        const { inicio } = _hoyRango();
        const { ventas: ventasHoy, pagos } = await _getVentasPeriodo(idPuntoDeVenta, inicio);
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
    if (!METODOS_PAGO.includes(metodo)) return res.status(400).json({ success: false, mensaje: 'Método inválido' });

    try {
        const { inicio: hoy } = _hoyRango();

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
        const { inicio: hoy } = _hoyRango();

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

        // ── 7. SSE: notificar cambio de permisos al usuario afectado ─────────────
        const idUsuarioCambiado =
            (!teniRol && tieneRol)  ? usuarioNuevo?.idUsuario :
            (teniRol)               ? empleadoActual?.idUsuario : null;

        if (idUsuarioCambiado) {
            (async () => {
                try {
                    const rows = await UserPermisos.findAll({
                        where: { idUsuario: idUsuarioCambiado },
                        include: [{
                            model: PermisosRecursos,
                            as: 'recurso',
                            where: { tipo: 'vendedor', folder: { [Op.not]: null } },
                            attributes: ['folder']
                        }],
                        attributes: [],
                        raw: true
                    });
                    const carpetasPermitidas = [...new Set(
                        rows.map(r => r['recurso.folder']).filter(Boolean)
                    )];
                    broadcast(idUsuarioCambiado, 'permissions_update', { carpetasPermitidas });
                } catch (_) {}
            })();
        }

        // ── 8. BORRAR FOTO ANTERIOR DE R2 (post-commit, best-effort) ─────────────
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
        // Las dos consultas son independientes: van en paralelo, no una tras otra.
        const [entidades, cajasYBancos] = await Promise.all([
            Entidades.findAll({
                attributes: [
                    'idEntidad', 'nombreEntidad', 'tipoEntidad', 'recibirPagosPos',
                    // Estado del QR de pago web. qrObjectKey NO se envía a la vista:
                    // la ruta del objeto en R2 no sale del backend.
                    'qrEnabled', 'qrStatus', 'qrUploadedAt'
                ],
                order: [['recibirPagosPos', 'DESC'], ['nombreEntidad', 'ASC']],
                raw: true
            }),
            CajasYBancos.findAll({
                attributes: ['idCajaBanco', 'nombreCajaBanco', 'tipo', 'referencia', 'estado'],
                // Activas primero; el id desempata para que el orden sea total y dos
                // registros con el mismo nombre no bailen entre recargas.
                order: [['estado', 'DESC'], ['nombreCajaBanco', 'ASC'], ['idCajaBanco', 'ASC']],
                raw: true
            })
        ]);

        // Saldo de cada cuenta: no hay columna de saldo, se calcula sumando sus
        // movimientos. Así el saldo nunca puede contradecir al libro que lo respalda.
        //
        // Es UNA sola consulta agrupada para todas las cuentas, no una por fila: con un
        // findAll por caja dentro del map, el número de consultas crecería con el número
        // de cuentas.
        //
        // La suma la hace MySQL sobre DECIMAL y devuelve DECIMAL: no se encadenan sumas
        // de Number en JS, que es donde aparecen los centavos fantasma.
        const saldos = await MovimientosCajasBancos.findAll({
            attributes: [
                'idCajaBanco',
                [fn('SUM', literal("CASE WHEN tipo = 'ingreso' THEN valor ELSE -valor END")), 'saldo'],
                [fn('COUNT', col('idMovimiento')), 'movimientos']
            ],
            group: ['idCajaBanco'],
            raw: true
        });
        const mapaSaldo = Object.fromEntries(saldos.map(s => [s.idCajaBanco, s]));

        // Traslados de efectivo que esta cuenta todavía no aceptó: plata que salió del
        // cajón de una tienda y no está asentada en ningún saldo. Una sola consulta
        // agrupada para todas las cuentas, no una por fila.
        const { porCuenta: trasladosPorCuenta } = await resumenPendientes();

        const conSaldo = (c) => ({
            ...c,
            saldo:       mapaSaldo[c.idCajaBanco]?.saldo ?? '0.00',
            movimientos: parseInt(mapaSaldo[c.idCajaBanco]?.movimientos) || 0,
            trasladosPendientes: trasladosPorCuenta[c.idCajaBanco] || 0
        });

        // La vista arma dos tablas distintas: efectivo por un lado, cuentas por el otro.
        const cajas  = cajasYBancos.filter(c => c.tipo === 'caja').map(conSaldo);
        const bancos = cajasYBancos.filter(c => c.tipo !== 'caja').map(conSaldo);

        return res.render('./administrador/bankentities/listado', {
            pagina: 'Cajas, bancos y métodos de pago',
            csrfToken: req.csrfToken(),
            currentPath: req.path,
            entidades,
            cajas,
            bancos,
        });
    } catch (e) {
        console.error('listarEntidades:', e);
        return res.status(500).send('Error al cargar entidades');
    }
};

// ─── PERFIL DE UNA CAJA O BANCO ──────────────────────────────────────────────

// Cuántos movimientos trae cada página del listado.
const MOVIMIENTOS_POR_PAGINA = 15;

// Suma con signo de un conjunto de movimientos: ingreso suma, egreso resta.
const SUMA_CON_SIGNO = literal("SUM(CASE WHEN tipo = 'ingreso' THEN valor ELSE -valor END)");

/**
 * El libro se ordena y se pagina por `fecha` (cuándo ocurrió el movimiento), no por
 * `createdAt` (cuándo se asentó): un depósito del viernes registrado el lunes tiene que
 * aparecer donde va, y el saldo corrido tiene que acompañarlo.
 *
 * `fecha` admite empates, así que NO es un orden total por sí sola. El desempate es
 * `idMovimiento`, que es único. Sin ese segundo criterio MySQL no garantiza el orden de
 * las filas empatadas entre una consulta y la siguiente, y con paginación por cursor eso
 * significa filas repetidas o saltadas.
 */
const ORDEN_LIBRO = [['fecha', 'DESC'], ['idMovimiento', 'DESC']];

// El cursor es la posición completa en ese orden: "<epoch>.<idMovimiento>". Solo con la
// fecha no alcanzaría para desempatar, y solo con el id no se sabría dónde entrar.
const armarCursor = (m) => `${new Date(m.fecha).getTime()}.${m.idMovimiento}`;

const leerCursor = (cursor) => {
    if (!cursor) return null;
    const corte = String(cursor).indexOf('.');
    if (corte < 1) return null;
    const ms = Number(String(cursor).slice(0, corte));
    const id = String(cursor).slice(corte + 1);
    if (!Number.isFinite(ms) || !id) return null;
    return { fecha: new Date(ms), idMovimiento: id };
};

// "Estrictamente antes que el cursor" en el orden (fecha DESC, id DESC), y su inverso.
// Escrito como OR de dos ramas porque MySQL no aprovecha el índice con una comparación
// de tuplas en Sequelize.
const antesDe = ({ fecha, idMovimiento }) => ({
    [Op.or]: [
        { fecha: { [Op.lt]: fecha } },
        { fecha, idMovimiento: { [Op.lt]: idMovimiento } }
    ]
});

const despuesDe = ({ fecha, idMovimiento }) => ({
    [Op.or]: [
        { fecha: { [Op.gt]: fecha } },
        { fecha, idMovimiento: { [Op.gt]: idMovimiento } }
    ]
});

// Filtros compartidos por el listado y por la exportación: mismo criterio, un solo lugar.
const filtrosLibro = (idCajaBanco, { desde = null, hasta = null, tipo = null } = {}) => {
    const where = { idCajaBanco };
    if (tipo === 'ingreso' || tipo === 'egreso') where.tipo = tipo;
    if (desde || hasta) {
        where.fecha = {};
        if (desde) where.fecha[Op.gte] = new Date(`${desde}T00:00:00`);
        if (hasta) where.fecha[Op.lte] = new Date(`${hasta}T23:59:59.999`);
    }
    return where;
};

/**
 * Movimientos de una cuenta, paginados por cursor (keyset).
 *
 * No usa OFFSET: este listado crece sin techo y con OFFSET la base tiene que descartar
 * todas las filas anteriores para llegar a la página pedida, así que la página 500 cuesta
 * mucho más que la 1. Además, si entra un movimiento nuevo mientras alguien pagina, el
 * OFFSET se corre y se saltan o repiten filas.
 */
const listarMovimientosCuenta = async (idCajaBanco, { cursor = null, desde = null, hasta = null, tipo = null } = {}) => {
    const where = filtrosLibro(idCajaBanco, { desde, hasta, tipo });

    // Se pide una fila de más para saber si hay página siguiente sin contar el total.
    const posicion = leerCursor(cursor);
    const filtroPagina = posicion ? { ...where, ...antesDe(posicion) } : where;
    const filas = await MovimientosCajasBancos.findAll({
        where: filtroPagina,
        include: [{ model: Empleados, as: 'empleado', attributes: ['PrimerNombre', 'PrimerApellido'], required: false }],
        order: ORDEN_LIBRO,
        limit: MOVIMIENTOS_POR_PAGINA + 1
    });

    const hayMas = filas.length > MOVIMIENTOS_POR_PAGINA;
    const pagina = hayMas ? filas.slice(0, MOVIMIENTOS_POR_PAGINA) : filas;

    // Comprobantes de toda la página en UNA consulta, no una por movimiento: con 15 filas
    // por página, hacerlo dentro del map serían 15 idas a la base por cada scroll.
    const adjuntosPorMovimiento = new Map();
    if (pagina.length) {
        const docs = await Documentacion.findAll({
            where: {
                pertenece: 'transacciones_bancarias',
                idPropietario: { [Op.in]: pagina.map(m => m.idMovimiento) }
            },
            attributes: ['idDocumento', 'idPropietario', 'nombreDocumento', 'formato', 'keyName'],
            order: [['idDocumento', 'ASC']],
            raw: true
        });
        for (const d of docs) {
            if (!adjuntosPorMovimiento.has(d.idPropietario)) adjuntosPorMovimiento.set(d.idPropietario, []);
            adjuntosPorMovimiento.get(d.idPropietario).push({
                idDocumento:     d.idDocumento,
                nombreDocumento: d.nombreDocumento,
                formato:         d.formato,
                url:             `${process.env.R2_PUBLIC_URL}/${d.keyName}`
            });
        }
    }

    // Saldo corrido: el saldo después del movimiento más nuevo de esta página es el saldo
    // total menos todo lo que ocurrió después de él. Una sola consulta agregada, no una
    // por fila.
    let saldoCorrido = 0;
    if (pagina.length) {
        const [{ total }] = await MovimientosCajasBancos.findAll({
            where: { idCajaBanco },
            attributes: [[SUMA_CON_SIGNO, 'total']],
            raw: true
        });
        const [{ posteriores }] = await MovimientosCajasBancos.findAll({
            where: { idCajaBanco, ...despuesDe(pagina[0]) },
            attributes: [[SUMA_CON_SIGNO, 'posteriores']],
            raw: true
        });
        saldoCorrido = (parseFloat(total) || 0) - (parseFloat(posteriores) || 0);
    }

    const movimientos = pagina.map((m) => {
        const valor = parseFloat(m.valor) || 0;
        const saldo = saldoCorrido;
        saldoCorrido -= (m.tipo === 'ingreso' ? valor : -valor);   // el saldo del siguiente, más viejo
        const f = new Date(m.fecha);
        return {
            idMovimiento: m.idMovimiento,
            iso:          f.toISOString().slice(0, 10),
            fecha:        f.toLocaleDateString('es-CO'),
            hora:         f.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
            tipo:         m.tipo,
            descripcion:  m.descripcion || 'Movimiento',
            referencia:   m.referencia,
            valor,
            saldo,
            usuario:      m.empleado ? `${m.empleado.PrimerNombre} ${m.empleado.PrimerApellido}` : '—',
            adjuntos:     adjuntosPorMovimiento.get(m.idMovimiento) || []
        };
    });

    return { movimientos, cursorSiguiente: hayMas ? armarCursor(pagina[pagina.length - 1]) : null };
};


// ─── ACEPTAR, RECHAZAR O ACEPTAR PARCIALMENTE UN TRASLADO ────────────────────
//
// Tres desenlaces, uno solo por petición y todos dentro de la misma transacción:
//
//   valor === despachado  → 'Recibido'      · movimiento por el total
//   0 < valor < despachado→ 'Controversia'  · movimiento por lo aceptado
//   rechazo               → 'Rechazado'     · sin movimiento
//
// Lo que NO se acepta se queda físicamente en la tienda. Como el egreso descontó el
// cajón al despachar, hay que devolvérselo: se ajusta el egreso al valor realmente
// aceptado (o se anula). Eso solo se puede hacer mientras la caja de ese turno siga
// abierta —el egreso todavía en 'pendiente'—; si ya cerró, el cuadre está firmado y no
// se toca: la diferencia queda anotada en la bitácora y avisada al punto de venta.
//
// Forma manejada de `db.transaction`: commit al resolver, rollback al lanzar. Sin
// `t.commit()` ni `t.rollback()` a mano no existe el caso de un rollback sobre una
// transacción ya cerrada, que lanzaría un segundo error dentro del catch y dejaría la
// petición colgada.

// Rechazo de negocio: sale como 422 con un motivo legible, no como un 500.
class ErrorDecision extends Error {}

const _pesosCO = (n) => `$${Math.round(parseFloat(n) || 0).toLocaleString('es-CO')}`;

// GET /admin/bankentities/empleado/validar/:codigo
//
// Dice si ese código puede resolver un traslado, ANTES de que el operador apriete un
// botón. Es exactamente la misma comprobación que hace la ruta que asienta la plata
// —código válido, empleado habilitado, permiso de Bancos—, solo que en modo consulta:
// si acá dice que sí y allá dice que no, el bug está en uno de los dos.
//
// No es un oráculo de códigos: vive detrás de verificarRol('ADMIN'), y un administrador
// ya puede ver en Personal quién tiene permiso de bancos. Lo que evita es que alguien
// llene el formulario entero para enterarse recién al final de que su código no sirve.
const validarEmpleadoBancos = async (req, res) => {
    const codigo = String(req.params.codigo || '').trim().toUpperCase();
    if (!codigo) return res.status(400).json({ success: false, mensaje: 'Código requerido.' });

    try {
        const empleado = await Empleados.findOne({
            where: { codigoEmpleado: codigo },
            attributes: ['idEmpleado', 'idUsuario', 'PrimerNombre', 'PrimerApellido', 'estado']
        });

        // Mismo criterio que verificarCodigoEmpleadoAdmin: se bloquea a quien ya no es de
        // confianza, no a quien está de licencia.
        if (!empleado || ['suspendido', 'despedido'].includes(empleado.estado))
            return res.json({ success: false, mensaje: 'Código de empleado inválido.' });

        if (!empleado.idUsuario)
            return res.json({ success: false, mensaje: 'Ese empleado no tiene acceso al sistema.' });

        const ids = await resolverIds('Bancos', 'administrativo', 'EDIT');
        if (!ids) return res.status(500).json({ success: false, mensaje: 'Configuración de permisos inválida.' });

        const permiso = await UserPermisos.findOne({
            where: { idUsuario: empleado.idUsuario, idRecurso: ids.idRecurso, idAccion: ids.idAccion },
            attributes: ['idPermiso']
        });
        if (!permiso)
            return res.json({ success: false, mensaje: 'Ese empleado no tiene permiso sobre cajas y bancos.' });

        return res.json({
            success: true,
            nombre: `${empleado.PrimerNombre} ${empleado.PrimerApellido}`.trim()
        });
    } catch (e) {
        console.error('validarEmpleadoBancos:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

const decidirTrasladoEfectivo = async (req, res) => {
    const { idTraslado } = req.params;
    const empleado = req.empleadoVerificado;
    const { decision, observacion, idCajaBancoDestino } = req.body;

    if (!['aceptar', 'rechazar'].includes(decision))
        return res.status(400).json({ success: false, mensaje: 'Decisión inválida.' });

    const valorPedido = Math.round(parseFloat(req.body.valor) || 0);

    try {
        const resultado = await db.transaction(async (t) => {
            // Lock sobre el traslado. Dos administradores con la misma pantalla abierta
            // podrían aceptarlo dos veces y asentar la plata dos veces; el lock hace que
            // el segundo espere y encuentre el estado ya cambiado.
            // El lock va SIN includes a propósito. Un `SELECT ... FOR UPDATE` con JOIN
            // bloquea también las filas de las tablas unidas, y acá eso serían el punto de
            // venta y el empleado que despachó: dos traslados de la misma tienda se
            // bloquearían entre sí sin necesidad. Los datos de contexto se leen aparte,
            // que además es lo único que hacen: nombres para armar textos.
            const traslado = await TrasladoEfectivo.findOne({
                where: { idTrasladosEfectivo: idTraslado },
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            if (!traslado) throw new ErrorDecision('El traslado no existe.');

            const [tiendaOrigen, empleadoEnvia] = await Promise.all([
                PuntosDeVenta.findByPk(traslado.idTiendaOrigen, { attributes: ['nombreComercial'], transaction: t, raw: true }),
                Empleados.findByPk(traslado.idEmpleadoEnvia,   { attributes: ['PrimerNombre', 'PrimerApellido'], transaction: t, raw: true })
            ]);
            if (traslado.estado !== 'En Transito')
                throw new ErrorDecision(`Este traslado ya fue resuelto: figura como "${traslado.estado}".`);

            const despachado = Math.round(parseFloat(traslado.valorTraslado) || 0);
            const rechaza    = decision === 'rechazar';

            // ── Destino ──────────────────────────────────────────────────────
            // Redirigir solo entre cajas, y se revalida acá: el selector del navegador
            // es comodidad, esto es lo que impide que una petición armada a mano mande
            // efectivo a un banco.
            let idDestino = traslado.idCajaBanco;
            if (idCajaBancoDestino && idCajaBancoDestino !== traslado.idCajaBanco) {
                const [origen, nueva] = await Promise.all([
                    CajasYBancos.findByPk(traslado.idCajaBanco, { attributes: ['tipo'], transaction: t }),
                    CajasYBancos.findOne({
                        where: { idCajaBanco: idCajaBancoDestino, estado: true },
                        attributes: ['idCajaBanco', 'tipo', 'nombreCajaBanco'],
                        transaction: t
                    })
                ]);
                if (!nueva)                     throw new ErrorDecision('La caja destino no existe o está inactiva.');
                if (origen?.tipo !== 'caja')    throw new ErrorDecision('Solo se puede redirigir un traslado dirigido a una caja.');
                if (nueva.tipo !== 'caja')      throw new ErrorDecision('Un traslado solo se puede redirigir hacia otra caja.');
                idDestino = nueva.idCajaBanco;
            }

            // ── Cuánto de más se puede aceptar ───────────────────────────────
            //
            // Que llegue de más pasa, y por un motivo mundano: dos billetes pegados en el
            // fajo que el operador armó. Ese fajo sale del cajón, así que lo único que
            // puede llevar de más es lo que había ahí como fondo de cambio. Por eso el
            // tope es la caja menor del turno y no un porcentaje: un excedente mayor que
            // la base no puede ser un error de conteo. Es plata que nunca fue del negocio
            // —un adelanto que un cliente dejó, los billetes que un empleado puso de su
            // bolsillo para no perder una venta por falta de vuelto— y asentarla acá la
            // convertiría en un ingreso sin dueño, imposible de devolver a quien le
            // corresponde. De paso ataja el error de tecleo: con base de $100.000,
            // escribir $10.500.000 en vez de $1.050.000 no pasa.
            //
            // Va DESPUÉS de resolver el destino porque el tope depende de a dónde entra
            // la plata, y el destino puede haberse redirigido.
            //
            // El excedente SOLO existe cuando alguien cuenta billetes, o sea cuando el
            // destino es una caja. En un banco o una billetera no hay conteo: el banco ya
            // dijo cuánto entró y el comprobante lo prueba, así que la plata que salió del
            // cajón es exactamente la que llegó. Cualquier diferencia ahí no es un
            // sobrante físico — es que el punto de venta tecleó mal el monto, y eso se
            // arregla corrigiendo el registro, no asentando plata de más.
            //
            // Sin esta distinción, un traslado de $10.000 al banco con $100.000 realmente
            // consignados quedaría con $90.000 anotados como "excedente de la caja menor",
            // que es falso, y el operador arrastrando un faltante de $90.000.
            const cuentaDestinoFinal = await CajasYBancos.findByPk(idDestino, {
                attributes: ['tipo'], transaction: t, raw: true
            });
            const destinoEsCaja = cuentaDestinoFinal?.tipo === 'caja';

            const cajaTurno = await CajaTienda.findByPk(traslado.idCajaTienda, {
                attributes: ['cajaMenor', 'fechaApertura', 'fechaCierre'], transaction: t, raw: true
            });
            const baseTurno = Math.round(parseFloat(cajaTurno?.cajaMenor) || 0);

            // El egreso que descontó el cajón. Se toma acá —y con bloqueo— porque lo
            // necesitan tanto el techo físico como el ajuste posterior, y pedirlo dos
            // veces abriría una ventana entre una lectura y la otra.
            const egresoDelTraslado = await Egresos.findOne({
                where: { idTrasladoEfectivo: idTraslado },
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            // Qué se alcanzó a arreglar en el cuadre del turno que despachó. Se declara
            // acá porque lo escriben tres caminos —el excedente, la corrección bancaria y
            // la devolución por controversia— y todos necesitan el mismo lugar.
            //   aplicado    → la caja seguía abierta y su cuadre ya refleja el cambio
            //   cajaCerrada → estaba firmada; quedó anotado y hay que ajustarlo a mano
            const ajuste = { devuelto: 0, aplicado: false, cajaCerrada: false };

            if (!rechaza && valorPedido <= 0)
                throw new ErrorDecision('El valor recibido debe ser mayor que cero. Si no recibiste nada, rechazá el traslado.');

            // ── Banco o billetera: el registro se corrige, no se acepta a medias ──
            //
            // En una cuenta bancaria nadie cuenta billetes. El banco ya dijo cuánto entró
            // y el comprobante lo prueba, así que la plata que salió del cajón es
            // exactamente la que llegó. Si el número no coincide con el que registró el
            // punto de venta, el que está mal es el número —tecleó $10.000 donde consignó
            // $100.000, o al revés—, y eso se arregla corrigiendo el dato.
            //
            // El administrador es quien lo corrige: tiene el comprobante a la vista y es
            // el responsable de que los movimientos del banco en el software digan lo
            // mismo que el extracto.
            //
            // Nada se borra: el valor originalmente registrado queda para siempre en el
            // paso de 'Salida' de la bitácora, que es append-only.
            const corrige = !rechaza && !destinoEsCaja && valorPedido !== despachado;

            if (corrige && valorPedido > despachado) {
                // Techo natural: no se pudo haber sacado del cajón más de lo que el cajón
                // tenía. Sin este límite, subregistrar el traslado sería la forma de meter
                // plata sin origen — el mismo agujero que la regla de la caja menor tapa
                // del otro lado.
                const cerrada = !!cajaTurno?.fechaCierre;
                const { sEfectivo, sEgresosEfectivo } = await _calcularTransaccionesCaja(
                    traslado.idTiendaOrigen,
                    new Date(cajaTurno.fechaApertura),
                    cerrada ? new Date(cajaTurno.fechaCierre) : new Date(),
                    cerrada ? 'liquidada' : 'pendiente',
                    t
                );
                // El egreso de ESTE traslado ya está contado dentro de `sEgresosEfectivo`.
                // Se le devuelve para saber cuánto efectivo había realmente en el cajón
                // disponible para este envío.
                const yaContado   = Math.round(parseFloat(egresoDelTraslado?.valorEgreso) || 0);
                const techoFisico = baseTurno + Math.round(sEfectivo) - (Math.round(sEgresosEfectivo) - yaContado);

                if (valorPedido > techoFisico) {
                    throw new ErrorDecision(
                        `No se pudieron consignar ${_pesosCO(valorPedido)}: en ese turno el cajón llegó a tener ${_pesosCO(techoFisico)} contando la base y las ventas en efectivo. Si el comprobante dice más, esa plata no salió de esta caja y hay que registrarla aparte.`
                    );
                }
            }

            if (!rechaza && destinoEsCaja && valorPedido > despachado + baseTurno) {
                throw new ErrorDecision(baseTurno > 0
                    ? `No podés registrar más de ${_pesosCO(despachado + baseTurno)}: lo despachado (${_pesosCO(despachado)}) más la caja menor de ese turno (${_pesosCO(baseTurno)}). Un sobrante mayor no salió del cajón y hay que registrarlo aparte, no dentro de este traslado.`
                    : `Esa caja abrió sin caja menor, así que no hay de dónde pudiera salir un sobrante: no podés registrar más de ${_pesosCO(despachado)}.`);
            }

            // En un banco el traslado pasa a valer lo corregido y no hay parcial ni
            // excedente: el número del extracto ES el traslado. En una caja, en cambio, lo
            // que ampara el traslado nunca pasa de lo despachado y el resto es excedente.
            const valorFinal = corrige ? valorPedido : despachado;
            const aceptado   = rechaza ? 0 : (destinoEsCaja ? Math.min(valorPedido, despachado) : valorPedido);
            const excedente  = (rechaza || !destinoEsCaja) ? 0 : Math.max(0, valorPedido - despachado);
            const parcial    = !rechaza && destinoEsCaja && aceptado < despachado;


            // ── Textos por defecto ───────────────────────────────────────────
            const tienda   = tituloLista(tiendaOrigen?.nombreComercial || 'el punto de venta');
            const quienEnvio = empleadoEnvia
                ? tituloLista(`${empleadoEnvia.PrimerNombre} ${empleadoEnvia.PrimerApellido}`)
                : 'el operador';
            const nota = (observacion || '').trim();

            // Texto de la corrección bancaria. Va armado por el sistema y no lo escribe
            // nadie: es la explicación de por qué el traslado ya no vale lo que decía, y
            // tiene que decir lo mismo siempre, con los dos números a la vista.
            const notaCorreccion = corrige
                ? (valorPedido > despachado
                    ? `[Corrección] El punto de venta registró ${_pesosCO(despachado)} y realmente se consignaron ${_pesosCO(valorPedido)}. Se corrigió el traslado y su egreso al valor del comprobante: esos ${_pesosCO(valorPedido - despachado)} sí salieron del cajón y no estaban registrados. El monto original queda en el paso de salida de esta bitácora.`
                    : `[Corrección] El punto de venta registró ${_pesosCO(despachado)} y realmente se consignaron ${_pesosCO(valorPedido)}. Se corrigió el traslado y su egreso al valor del comprobante: esos ${_pesosCO(despachado - valorPedido)} nunca salieron del cajón y siguen en la tienda. El monto original queda en el paso de salida de esta bitácora.`)
                : null;

            const notaFinal = notaCorreccion || nota || (rechaza
                ? `${empleado.nombre} rechazó en 100% la transacción proveniente del ${tienda} trasladado por ${quienEnvio}`
                : parcial
                    ? `${empleado.nombre} aceptó solo ${_pesosCO(aceptado)} de ${_pesosCO(despachado)} de la transacción proveniente del ${tienda} trasladado por ${quienEnvio}`
                    : `${empleado.nombre} aceptó la transacción proveniente del ${tienda} trasladado por ${quienEnvio}`);

            // ── Movimiento en la cuenta destino ──────────────────────────────
            // Solo si entró plata. Un rechazo no genera movimiento: nada llegó, y un
            // movimiento en cero ensuciaría el libro sin decir nada.
            let idMovimiento = null;
            if (aceptado > 0) {
                const movimiento = await MovimientosCajasBancos.create({
                    idCajaBanco: idDestino,
                    idEmpleado:  empleado.idEmpleado,
                    tipo:        'ingreso',
                    valor:       aceptado,
                    fecha:       new Date(),
                    referencia:  traslado.codigoTraslado,
                    descripcion: notaFinal
                }, { transaction: t });
                idMovimiento = movimiento.idMovimiento;
                // `aceptado` ya vale lo corregido cuando el destino es una cuenta
                // bancaria: es el número del comprobante, que es el que tiene que
                // aparecer en el libro para poder conciliarlo contra el extracto.
            }

            // ── El sobrante, en su propio movimiento ─────────────────────────
            //
            // Aparte y no sumado al anterior: el movimiento del traslado tiene que valer
            // exactamente lo que la tienda despachó, o conciliar contra el extracto deja
            // de ser posible. El sobrante es otro hecho y va en otra línea, con una
            // observación que dice de dónde salió para que dentro de seis meses nadie
            // tenga que adivinar por qué entraron esos pesos sueltos.
            let idMovimientoExcedente = null;
            if (excedente > 0) {
                const movExcedente = await MovimientosCajasBancos.create({
                    idCajaBanco: idDestino,
                    idEmpleado:  empleado.idEmpleado,
                    tipo:        'ingreso',
                    valor:       excedente,
                    fecha:       new Date(),
                    referencia:  traslado.codigoTraslado,
                    descripcion: `Excedente del traslado ${traslado.codigoTraslado}: se despacharon ${_pesosCO(despachado)} desde ${tienda} y se contaron ${_pesosCO(despachado + excedente)}. Los ${_pesosCO(excedente)} de diferencia salieron de la caja menor del punto de venta.`
                }, { transaction: t });
                idMovimientoExcedente = movExcedente.idMovimiento;
            }

            // ── El traslado ──────────────────────────────────────────────────
            // `update` con el estado en el WHERE y revisando filas afectadas: si otra
            // petición ganó la carrera entre el lock y esto, no se pisa su resultado.
            // Una corrección deja el traslado 'Recibido': entró completo lo que de verdad
            // se consignó. No es una controversia — no hay nada en disputa, había un
            // número mal escrito.
            const estadoFinal = rechaza ? 'Rechazado' : (parcial ? 'Controversia' : 'Recibido');
            const [filas] = await TrasladoEfectivo.update(
                {
                    estado:           estadoFinal,
                    idEmpleadoRecibe: empleado.idEmpleado,
                    idCajaBanco:      idDestino,
                    idMovimiento,
                    // En una caja `valorTraslado` NO se toca: sigue valiendo lo que el
                    // punto de venta registró y el sobrante se guarda al lado. En un banco
                    // sí se corrige, porque ahí el valor del comprobante es el único que
                    // existe y el registro anterior era simplemente un error de tecleo.
                    valorTraslado:    valorFinal,
                    valorExcedente:   excedente > 0 ? excedente : null,
                    idMovimientoExcedente
                },
                {
                    where: { idTrasladosEfectivo: idTraslado, estado: 'En Transito' },
                    transaction: t
                }
            );
            if (!filas) throw new ErrorDecision('El traslado cambió de estado mientras se resolvía. Volvé a abrirlo.');

            // ── Bitácora ─────────────────────────────────────────────────────
            await TrasladoEfectivoHistorial.create({
                idTrasladosEfectivo: idTraslado,
                idEmpleado:          empleado.idEmpleado,
                tipoTransaccion:     rechaza ? 'Rechazado' : (parcial ? 'Controversia' : 'Ingreso'),
                // Lo que efectivamente se movió: en un rechazo es el valor rechazado, que
                // es todo; en los otros dos, lo aceptado.
                valorTransaccion:    rechaza ? despachado : aceptado,
                observacion:         notaFinal
            }, { transaction: t });

            // El sobrante deja su propio paso. Es lo que alguien va a leer cuando se
            // pregunte por qué el cajón de esa tienda quedó corto ese día.
            if (excedente > 0) {
                await TrasladoEfectivoHistorial.create({
                    idTrasladosEfectivo: idTraslado,
                    idEmpleado:          empleado.idEmpleado,
                    tipoTransaccion:     'Excedente',
                    valorTransaccion:    excedente,
                    observacion:         `${empleado.nombre} contó ${_pesosCO(despachado + excedente)} sobre ${_pesosCO(despachado)} despachados desde ${tienda} por ${quienEnvio}. Los ${_pesosCO(excedente)} de más se asentaron en un movimiento aparte de la misma cuenta y se descontaron del cajón del punto de venta.`
                }, { transaction: t });

                // ── El espejo en el punto de venta ───────────────────────────
                //
                // Del cajón salió el despachado MÁS el excedente, pero el egreso solo
                // registra el despachado. Sin esta segunda línea, el cuadre le pide al
                // operador un efectivo que ya no está y el faltante aparece sin causa.
                //
                // Va como egreso APARTE y no sumado al del traslado: así el traslado y su
                // egreso siguen valiendo lo mismo —que es lo que permite conciliarlos— y
                // el sobrante queda como un hecho propio, igual que del lado de la cuenta
                // destino, donde también entró en un movimiento separado.
                //
                // Y no se toca `cajaMenor`. La resta del cuadre reparte sola: mientras
                // haya ventas en efectivo sin entregar, el excedente sale de ahí y la base
                // queda intacta; recién cuando no alcanzan, el faltante llega a la base. Y
                // cada venta en efectivo posterior lo repone antes de volverse entregable,
                // porque sube el mismo número del que se resta.
                if (egresoDelTraslado && egresoDelTraslado.estado === 'pendiente') {
                    const refBase = egresoDelTraslado.referencia || traslado.codigoTraslado;
                    await Egresos.create({
                        idPuntoDeVenta:     traslado.idTiendaOrigen,
                        idEmpleado:         traslado.idEmpleadoEnvia,
                        idCajaTienda:       traslado.idCajaTienda,
                        valorEgreso:        excedente,
                        // Sufijo y no la misma referencia: dos filas idénticas en el
                        // listado no se pueden distinguir al reclamar por una de ellas.
                        referencia:         `${refBase}-EXC`.slice(0, 50),
                        descripcion:        `Excedente del traslado ${traslado.codigoTraslado}: salieron ${_pesosCO(despachado + excedente)} del cajón y el traslado registraba ${_pesosCO(despachado)}.`.slice(0, 255),
                        metodoPago:         'Efectivo',
                        idCajaBanco:        idDestino,
                        idTrasladoEfectivo: idTraslado,
                        tipo:               'Traslado',
                        estado:             'pendiente'
                    }, { transaction: t });
                    ajuste.aplicado = true;
                } else if (egresoDelTraslado) {
                    // El cuadre de ese turno ya está firmado: no se le agregan egresos.
                    ajuste.cajaCerrada = true;
                    await TrasladoEfectivoHistorial.create({
                        idTrasladosEfectivo: idTraslado,
                        idEmpleado:          empleado.idEmpleado,
                        tipoTransaccion:     'Controversia',
                        valorTransaccion:    excedente,
                        observacion:         `Los ${_pesosCO(excedente)} de excedente no se descontaron del cajón de ${tienda}: el cuadre de ese turno ya estaba cerrado. Requiere ajuste manual.`
                    }, { transaction: t });
                }
            }

            // ── Qué pasa con el egreso que descontó el cajón ─────────────────
            //
            // El egreso baja a lo que el negocio REALMENTE recibió. Del punto de venta
            // salió, según sus propios registros, el valor despachado; pero a destino
            // llegó menos, y esa diferencia vuelve a ser responsabilidad del punto de
            // venta: es plata que reportó como enviada y que nadie recibió.
            //
            // El efecto es deliberado: el cuadre de esa caja queda corto por la
            // diferencia. Ese faltante ES el mensaje —el punto de venta tiene que
            // responder por él—, no un error del sistema. Por eso el motivo se anota
            // también en la descripción del egreso: sin eso, el vendedor ve un descuadre
            // sin explicación y no puede saber de dónde salió.
            //
            //   Rechazo total → egreso en 0: no salió nada, la plata sigue en la tienda.
            //   Parcial       → egreso = lo aceptado; la diferencia queda a cargo del PV.
            const devuelto = destinoEsCaja ? despachado - aceptado : 0;
            ajuste.devuelto = devuelto;

            // ── El egreso de una corrección bancaria ─────────────────────────
            //
            // Sube o baja hasta el valor del comprobante, que es lo que de verdad salió
            // del cajón. No es un cargo contra nadie: es el mismo hecho, bien anotado. Con
            // el egreso corregido el cuadre de ese turno cierra exacto — ni sobran los
            // pesos que nunca salieron, ni faltan los que salieron sin registrarse.
            if (corrige) {
                if (egresoDelTraslado && egresoDelTraslado.estado === 'pendiente') {
                    const marca = `[Corregido: se registró ${_pesosCO(despachado)} y se consignaron ${_pesosCO(valorPedido)}]`;
                    await egresoDelTraslado.update({
                        valorEgreso: valorPedido,
                        descripcion: `${egresoDelTraslado.descripcion ? egresoDelTraslado.descripcion + ' ' : ''}${marca}`.slice(0, 255)
                    }, { transaction: t });
                    ajuste.aplicado = true;
                } else if (egresoDelTraslado) {
                    // El cuadre de ese turno ya está firmado. Corregir el egreso cambiaría
                    // un cierre cerrado, así que no se toca y queda dicho en la bitácora.
                    ajuste.cajaCerrada = true;
                    await TrasladoEfectivoHistorial.create({
                        idTrasladosEfectivo: idTraslado,
                        idEmpleado:          empleado.idEmpleado,
                        tipoTransaccion:     'Controversia',
                        valorTransaccion:    Math.abs(valorPedido - despachado),
                        observacion:         `El egreso de ${tienda} no se corrigió: el cuadre de ese turno ya estaba cerrado. Sigue figurando por ${_pesosCO(despachado)} cuando se consignaron ${_pesosCO(valorPedido)}. Requiere ajuste manual.`
                    }, { transaction: t });
                }
            }

            if (devuelto > 0) {
                const egreso = egresoDelTraslado;

                if (egreso && egreso.estado === 'pendiente') {
                    // La caja del turno sigue abierta, así que el egreso todavía se puede
                    // ajustar al valor que el negocio recibió de verdad.
                    //
                    // Se BAJA el valor, nunca se borra la fila. EGRESOS no es `paranoid`,
                    // así que un destroy sería un DELETE físico de un registro financiero,
                    // y eso no se hace: el egreso existió y su rastro tiene que quedar. Un
                    // rechazo total lo deja en $0, y el cuadre lo lista con su motivo, que
                    // dice más que una línea que desapareció sin explicación.
                    const motivo = aceptado > 0
                        ? `[Controversia: se recibieron ${_pesosCO(aceptado)} de ${_pesosCO(despachado)}; los ${_pesosCO(devuelto)} restantes quedan a cargo del punto de venta]`
                        : '[Traslado rechazado: el efectivo volvió al punto de venta]';
                    await egreso.update({
                        valorEgreso: aceptado,
                        descripcion: `${egreso.descripcion ? egreso.descripcion + ' ' : ''}${motivo}`.slice(0, 255)
                    }, { transaction: t });
                    ajuste.aplicado = true;
                } else if (egreso) {
                    // La caja ya cerró y su cuadre está firmado: no se toca. Queda
                    // anotado como un paso más de la bitácora, que es append-only y por
                    // lo tanto es evidencia.
                    ajuste.cajaCerrada = true;
                    await TrasladoEfectivoHistorial.create({
                        idTrasladosEfectivo: idTraslado,
                        idEmpleado:          empleado.idEmpleado,
                        tipoTransaccion:     'Controversia',
                        valorTransaccion:    devuelto,
                        observacion:         `${_pesosCO(devuelto)} quedan a cargo de ${tienda}, pero el cuadre de ese turno ya está cerrado y no se modificó: esa plata figura como salida del punto de venta. Requiere ajuste manual en el cuadre.`
                    }, { transaction: t });
                }
            }

            return {
                estadoFinal, aceptado, despachado, devuelto, excedente, ajuste,
                corrige, valorCorregido: corrige ? valorPedido : null,
                idPuntoDeVenta: traslado.idTiendaOrigen,
                codigo: traslado.codigoTraslado,
                notaFinal
            };
        });

        // ── Avisos ───────────────────────────────────────────────────────────
        // Fuera de la transacción y en su propio try: un aviso que falle no puede tumbar
        // una decisión ya asentada ni dejar la respuesta sin enviar.
        try {
            broadcast('__ADMIN__', 'traslados_pendientes', await resumenPendientes());
            invalidarContadoresAdmin();

            // Al punto de venta, cuando lo que llegó no fue lo que salió —en cualquiera de
            // las dos direcciones—. Un 'Recibido' con excedente también avisa: al operador
            // le sobró plata en el fajo y tiene que saberlo ANTES de contar la base, o
            // cierra el turno sin entender por qué el fondo de cambio no da.
            if (resultado.estadoFinal !== 'Recibido' || resultado.excedente > 0 || resultado.corrige) {
                broadcast(resultado.idPuntoDeVenta, 'traslado_resuelto', {
                    idTraslado,
                    codigo:     resultado.codigo,
                    estado:     resultado.estadoFinal,
                    despachado: resultado.despachado,
                    aceptado:   resultado.aceptado,
                    devuelto:   resultado.devuelto,
                    excedente:  resultado.excedente,
                    corregido:  resultado.corrige ? resultado.valorCorregido : null,
                    // Dice si la caja de ese turno seguía abierta. Si sí, el egreso ya
                    // se ajustó y el faltante aparece solo en su cuadre; si ya había
                    // cerrado, hay que arreglarlo a mano y el operador debe saberlo.
                    ajusteAplicado: resultado.ajuste.aplicado,
                    observacion: resultado.notaFinal
                });
            }
        } catch (e) {
            console.error('decidirTrasladoEfectivo: aviso posterior falló', e);
        }

        return res.json({
            success: true,
            estado:     resultado.estadoFinal,
            aceptado:   resultado.aceptado,
            devuelto:   resultado.devuelto,
            excedente:  resultado.excedente,
            corregido:  resultado.corrige ? resultado.valorCorregido : null,
            despachado: resultado.despachado,
            codigo:     resultado.codigo,
            // El navegador abre el comprobante con el estado final.
            pdf: `/admin/bankentities/traslados/${idTraslado}/pdf`,
            avisoCajaCerrada: resultado.ajuste.cajaCerrada
        });

    } catch (e) {
        if (e instanceof ErrorDecision)
            return res.status(422).json({ success: false, mensaje: e.message });

        console.error('decidirTrasladoEfectivo:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo registrar la decisión.' });
    }
};

// GET /admin/bankentities/traslados/:idTraslado/pdf
// Sin filtro por tienda: el administrador ve los traslados de todas las sedes.
const getTrasladoPDFAdmin = async (req, res) => {
    try {
        const traslado = await buscarTrasladoParaPDF(req.params.idTraslado);
        if (!traslado) return res.status(404).send('Traslado no encontrado.');

        const buf = await generarPDFTraslado(traslado);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="traslado-${traslado.codigoTraslado}.pdf"`);
        res.setHeader('Content-Length', buf.length);
        return res.send(buf);
    } catch (e) {
        console.error('getTrasladoPDFAdmin:', e);
        return res.status(500).send('Error al generar el comprobante.');
    }
};

const verPerfilCajaBanco = async (req, res) => {
    try {
        const cuenta = await CajasYBancos.findByPk(req.params.idCajaBanco, { raw: true });
        if (!cuenta) return res.status(404).send('Cuenta no encontrada.');

        const inicioMes = new Date();
        inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);

        const [totales, delMes, { movimientos, cursorSiguiente }, trasladosPendientes, cajasDestino] = await Promise.all([
            MovimientosCajasBancos.findAll({
                where: { idCajaBanco: cuenta.idCajaBanco },
                attributes: [[SUMA_CON_SIGNO, 'saldo']],
                raw: true
            }),
            MovimientosCajasBancos.findAll({
                // Por `fecha`, no por `createdAt`: lo del mes es lo que ocurrió este mes,
                // aunque se haya asentado después.
                where: { idCajaBanco: cuenta.idCajaBanco, fecha: { [Op.gte]: inicioMes } },
                attributes: [
                    'tipo',
                    [fn('SUM', col('valor')), 'suma'],
                    [fn('COUNT', col('idMovimiento')), 'cantidad']
                ],
                group: ['tipo'],
                raw: true
            }),
            listarMovimientosCuenta(req.params.idCajaBanco, {}),
            // Van aparte del libro y no paginados: un traslado en tránsito todavía no es
            // un movimiento, y son pocos por definición —lo que espera aceptación—.
            listarPendientesDeCuenta(req.params.idCajaBanco),
            // Cajas a las que se podría redirigir un traslado que llegó acá.
            //
            // SOLO entre cajas. Un traslado a un banco o a una billetera ya se consignó
            // en esa cuenta concreta: la plata está en el extracto de ese banco y
            // apuntarla a otro lado sería declarar un movimiento que no ocurrió. Entre
            // cajas sí: el efectivo es físico y todavía puede terminar en otro cajón del
            // negocio, que es la corrección que esto habilita.
            //
            // Si la cuenta actual no es una caja, ni se consulta: no hay redirección
            // posible y la lista viajaría al navegador para nada.
            cuenta.tipo === 'caja'
                ? CajasYBancos.findAll({
                    where: {
                        tipo: 'caja',
                        estado: true,
                        idCajaBanco: { [Op.ne]: cuenta.idCajaBanco }
                    },
                    attributes: ['idCajaBanco', 'nombreCajaBanco', 'referencia'],
                    order: [['nombreCajaBanco', 'ASC'], ['idCajaBanco', 'ASC']],
                    raw: true
                })
                : []
        ]);

        const porTipo = Object.fromEntries(delMes.map(r => [r.tipo, r]));
        const resumen = {
            saldo:          parseFloat(totales[0]?.saldo) || 0,
            ingresosMes:    parseFloat(porTipo.ingreso?.suma) || 0,
            egresosMes:     parseFloat(porTipo.egreso?.suma) || 0,
            movimientosMes: (parseInt(porTipo.ingreso?.cantidad) || 0) + (parseInt(porTipo.egreso?.cantidad) || 0)
        };

        const ahora = new Date();
        const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();

        return res.render('./administrador/bankentities/perfilCajaBanco', {
            pagina: cuenta.nombreCajaBanco,
            csrfToken: req.csrfToken(),
            currentPath: req.path,
            cuenta,
            resumen,
            movimientos,
            cursorSiguiente,
            trasladosPendientes,
            cajasDestino,
            filtros: { desde: '', hasta: '', ahora: iso(ahora).slice(0, 16) }
        });
    } catch (e) {
        console.error('verPerfilCajaBanco:', e);
        return res.status(500).send('Error al cargar el perfil de la cuenta');
    }
};

// GET /admin/bankentities/cajas/:idCajaBanco/movimientos — página siguiente por cursor
const getMovimientosCuentaJSON = async (req, res) => {
    try {
        const { cursor, desde, hasta, tipo } = req.query;
        const datos = await listarMovimientosCuenta(req.params.idCajaBanco, { cursor, desde, hasta, tipo });
        return res.json({ success: true, ...datos });
    } catch (e) {
        console.error('getMovimientosCuentaJSON:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudieron cargar los movimientos.' });
    }
};

// El mismo tope que aplica multer en middlewares/uploadComprobantes.js. Se repite acá
// porque la validación del contenido tiene que conocerlo: multer corta por tamaño de
// petición, esto corta por tamaño del archivo ya en memoria.
const MAX_BYTES_COMPROBANTE = (parseInt(process.env.MAX_MB_COMPROBANTE) || 5) * 1024 * 1024;

// POST /admin/bankentities/cajas/:idCajaBanco/movimientos
// Registra un ingreso o egreso y, si vienen, adjunta sus comprobantes en R2
// (bucket público `grupo-gh`, prefijo documentacion/transacciones/) más su fila en
// DOCUMENTACION con pertenece='transacciones_bancarias' e idPropietario = idMovimiento.
const crearMovimientoCuenta = async (req, res) => {
    const idCajaBanco = req.params.idCajaBanco;
    const subidos = [];

    try {
        const cuenta = await CajasYBancos.findByPk(idCajaBanco, { attributes: ['idCajaBanco', 'estado'] });
        if (!cuenta) return res.status(404).json({ success: false, mensaje: 'La cuenta no existe.' });
        if (!cuenta.estado) return res.status(422).json({ success: false, mensaje: 'La cuenta está inactiva: no admite movimientos.' });

        // Whitelist explícita: nada de pasarle req.body a create().
        const tipo  = req.body.tipo === 'egreso' ? 'egreso' : 'ingreso';
        const valor = parseInt(limpiarPrecio(req.body.valor)) || 0;
        if (valor <= 0) return res.status(422).json({ success: false, mensaje: 'El monto debe ser mayor que cero.' });

        const descripcion = String(req.body.descripcion || '').trim();
        if (!descripcion) return res.status(422).json({ success: false, mensaje: 'La descripción es obligatoria.' });

        const referencia = String(req.body.referencia || '').trim().slice(0, 50) || null;

        // Cuándo ocurrió el movimiento. Llega del <input type="datetime-local">, o sea en
        // la hora local de quien registra; `new Date` la interpreta en la zona horaria del
        // servidor, igual que el resto de este módulo. Si el servidor no corre en
        // America/Bogota, esto hay que normalizarlo (ver CLAUDE.md §10).
        const fecha = req.body.fecha ? new Date(req.body.fecha) : new Date();
        if (isNaN(fecha.getTime())) {
            return res.status(422).json({ success: false, mensaje: 'La fecha del movimiento no es válida.' });
        }
        // Un movimiento con fecha futura se sentaría arriba de todo y el saldo corrido de
        // las filas de abajo dejaría de coincidir con el saldo real de hoy.
        if (fecha.getTime() > Date.now() + 60_000) {
            return res.status(422).json({ success: false, mensaje: 'La fecha del movimiento no puede ser futura.' });
        }

        // Quién lo registra. El movimiento apunta a un EMPLEADO, no al usuario del panel:
        // es la ficha de la persona, que sobrevive a que se le desactive la cuenta.
        //
        // El libro es append-only: una fila mal atribuida no se corrige después. Por eso,
        // si el usuario del panel no tiene ficha de empleado, no se registra a nombre de
        // nadie más — se corta acá.
        const empleado = await Empleados.findOne({
            attributes: ['idEmpleado'],
            where: { idUsuario: req.usuario.idUsuario }
        });
        if (!empleado) {
            return res.status(422).json({
                success: false,
                mensaje: 'Tu usuario no tiene una ficha de empleado asociada, así que el movimiento no puede quedar a tu nombre. Pedí que te la creen antes de registrar movimientos.'
            });
        }

        // El id se genera antes de subir para poder nombrar los archivos con él.
        const idMovimiento = uuidV7();

        // Los archivos se suben ANTES de abrir la transacción: mantenerla abierta
        // mientras viajan bloquea filas por segundos. Si la escritura falla después,
        // se borran los objetos en el catch.
        const archivos = req.files?.comprobantes || [];
        const docs = [];
        for (const [idx, file] of archivos.entries()) {
            // El mimetype y la extensión los controla quien sube: no son evidencia de
            // nada. Lo que decide es el contenido real del buffer. El fileFilter de multer
            // ya descartó lo obvio; esto es la verificación que cuenta.
            const esPdf = file.buffer.slice(0, 5).toString('ascii') === '%PDF-';

            let cuerpo, contentType, extension;
            if (esPdf) {
                cuerpo      = file.buffer;
                contentType = 'application/pdf';
                extension   = 'pdf';
            } else {
                const revision = await validarImagen(file.buffer, {
                    minLado:  150,                     // una foto de voucher siempre supera esto
                    maxBytes: MAX_BYTES_COMPROBANTE    // el mismo tope que aplica multer
                });
                if (!revision.ok) {
                    throw Object.assign(new Error(`"${file.originalname}": ${revision.mensaje}`), { publico: true });
                }
                // Se persiste siempre convertido a WebP, nunca el archivo tal como llegó.
                cuerpo      = await aWebp(file.buffer, { anchoMaximo: 1600 });
                contentType = 'image/webp';
                extension   = 'webp';
            }

            const r2Key = `documentacion/transacciones/mov-${idMovimiento}-${Date.now()}-${idx}.${extension}`;

            await new Upload({
                client: s3Client,
                params: { Bucket: process.env.R2_BUCKET_NAME, Key: r2Key, Body: cuerpo, ContentType: contentType }
            }).done();

            subidos.push(r2Key);
            docs.push({
                idPropietario:   idMovimiento,          // el movimiento es el dueño del comprobante
                nombreDocumento: file.originalname,
                keyName:         r2Key,
                formato:         extension.toUpperCase(),
                pertenece:       'transacciones_bancarias'
            });
        }

        const t = await db.transaction();
        try {
            // Lectura con bloqueo compartido sobre la fila de la cuenta. No es por el
            // `estado` —eso ya se miró arriba— sino para serializar contra la edición de
            // la cuenta: `editarCajaBanco` toma esta misma fila en exclusiva antes de
            // decidir si la cuenta todavía no tiene movimientos. Sin este bloqueo, un
            // movimiento podría insertarse justo después de ese conteo y quedaría una
            // cuenta con movimientos a la que igual se le cambió el tipo.
            const cuentaBloqueada = await CajasYBancos.findByPk(idCajaBanco, {
                attributes: ['idCajaBanco', 'estado'],
                transaction: t,
                lock: t.LOCK.SHARE
            });
            if (!cuentaBloqueada) throw Object.assign(new Error('La cuenta no existe.'), { publico: true });
            if (!cuentaBloqueada.estado) throw Object.assign(new Error('La cuenta está inactiva: no admite movimientos.'), { publico: true });

            await MovimientosCajasBancos.create({
                idMovimiento, idCajaBanco, idEmpleado: empleado.idEmpleado,
                fecha, tipo, valor, referencia, descripcion
            }, { transaction: t });

            if (docs.length) await Documentacion.bulkCreate(docs, { transaction: t });

            await t.commit();
        } catch (e) {
            if (!t.finished) await t.rollback().catch(() => {});
            throw e;
        }

        return res.json({
            success: true,
            idMovimiento,
            adjuntos: docs.map(d => ({
                nombreDocumento: d.nombreDocumento,
                formato:         d.formato,
                url:             `${process.env.R2_PUBLIC_URL}/${d.keyName}`
            }))
        });
    } catch (e) {
        // La escritura falló: los objetos que alcanzaron a subir no deben quedar sueltos.
        await Promise.all(subidos.map(k =>
            s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: k })).catch(() => {})
        ));
        // Archivo rechazado por su contenido: el motivo le sirve a quien sube, no es
        // información interna.
        if (e.publico) {
            return res.status(422).json({ success: false, mensaje: e.message });
        }
        if (e.name === 'SequelizeValidationError') {
            return res.status(422).json({ success: false, mensaje: e.errors?.[0]?.message || 'Datos inválidos.' });
        }
        console.error('crearMovimientoCuenta:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo registrar el movimiento.' });
    }
};

// ─── INFORME DE MOVIMIENTOS EN EXCEL ─────────────────────────────────────────

// Paleta del informe. Son los mismos colores del panel, en el formato ARGB que pide
// OOXML. Se declaran una vez para que la hoja no termine con doce verdes distintos.
const XLS = {
    tinta:        'FF1E293B',   // slate-800: banner y texto fuerte
    encabezado:   'FF334155',   // slate-700: fila de títulos de la tabla
    marca:        'FFE24C95',   // gh-primaryHover: etiquetas de sección
    apagado:      'FF64748B',   // slate-500: texto secundario (4.76:1 sobre blanco)
    borde:        'FFE2E8F0',   // slate-200
    zebra:        'FFF8FAFC',   // slate-50
    blanco:       'FFFFFFFF',
    ingresoFondo: 'FFD1FAE5',   // emerald-100
    ingresoTinta: 'FF065F46',   // emerald-800
    egresoFondo:  'FFFFE4E6',   // rose-100
    egresoTinta:  'FF9F1239',   // rose-800
    negativo:     'FFB91C1C'    // red-700
};

// `#,##0` usa los separadores del Excel de quien abre el archivo, así que en un equipo
// configurado en Colombia sale $2.400.000 sin que haya que forzar el punto.
const FORMATO_PESOS = '"$"#,##0;[Red]-"$"#,##0';

const ETIQUETA_TIPO_CUENTA = { caja: 'Caja', banco: 'Banco', billetera: 'Billetera' };

// Cuántos movimientos se traen por vuelta al armar el archivo. El informe no se carga
// entero en memoria: se pide una tanda, se escribe al stream y se descarta (CLAUDE.md §11).
const TANDA_EXPORT = 500;

// Ayudas de maquetado que comparten los dos informes: la banda a todo el ancho y la
// franja de casillas etiqueta/valor. Viven acá y no dentro de cada export para que los
// dos archivos se vean como el mismo documento y no como dos hojas parecidas.
//
// `anchoTotal` es cuántas columnas ocupa la hoja: la banda las abarca todas y las
// casillas se reparten ese ancho, así el bloque de cabecera cuadra con la tabla tenga
// 8 columnas o 9.
const crearAyudasHoja = (ws, anchoTotal) => {
    // Fila combinada a lo ancho de la tabla, con un solo valor y un estilo.
    const banda = (valor, estilo, alto) => {
        const fila = ws.addRow([valor]);
        ws.mergeCells(fila.number, 1, fila.number, anchoTotal);   // el merge va antes del commit
        Object.assign(fila.getCell(1), estilo);
        if (alto) fila.height = alto;
        fila.commit();
        return fila;
    };

    // Una fila de etiquetas y otra de valores, cada casilla ocupando su tajada del ancho.
    // El reparto es entero y el sobrante va a la última, para que ninguna quede corrida.
    const casillas = (pares) => {
        const base   = Math.floor(anchoTotal / pares.length);
        const tramos = pares.map((_, i) => (i === pares.length - 1 ? anchoTotal - base * (pares.length - 1) : base));
        const desde  = tramos.map((_, i) => tramos.slice(0, i).reduce((a, b) => a + b, 1));

        const pintar = (fila, leer) => {
            pares.forEach((p, i) => {
                const c = fila.getCell(desde[i]);
                leer(c, p);
                c.alignment = { vertical: 'middle' };
                ws.mergeCells(fila.number, desde[i], fila.number, desde[i] + tramos[i] - 1);
            });
        };

        const filaEt = ws.addRow([]);
        pintar(filaEt, (c, p) => {
            c.value = p.etiqueta;
            c.font  = { name: 'Calibri', size: 8, bold: true, color: { argb: XLS.marca } };
        });
        filaEt.height = 16;
        filaEt.commit();

        const filaVal = ws.addRow([]);
        pintar(filaVal, (c, p) => {
            c.value = p.valor;
            c.font  = { name: 'Calibri', size: 11, bold: true, color: { argb: p.color || XLS.tinta } };
            if (p.formato) c.numFmt = p.formato;
        });
        filaVal.height = 20;
        filaVal.commit();
    };

    return { banda, casillas };
};


// ─────────────────────────────────────────────────────────────────────────────
// Hoja "OF" del informe de facturación.
//
// Las facturas que el punto de venta marcó, con los datos tributarios del cliente
// abiertos en columnas. Vive en su propia función y no dentro de `exportarFacturasTienda`
// porque esa función ya mide 250 líneas y esto es un documento aparte con su propia
// cabecera, sus propias columnas y su propio criterio.
//
// Comparte `crearAyudasHoja`, los tokens `XLS` y el formato de pesos con las otras dos
// hojas: el archivo tiene que leerse como un solo documento.
// ─────────────────────────────────────────────────────────────────────────────

// Cuántas facturas OF se traen por vuelta. Igual que el resto de los informes: se pide una
// tanda, se escribe al stream y se descarta (CLAUDE.md §11).
const TANDA_OF = 300;

const construirHojaOF = async (wb, { donde, tienda, fechaListado, fFechaLarga, enlaceFactura }) => {
    // Solo las marcadas. Se apoya en el índice (idPuntoDeVenta, OF, fechaEmision).
    const dondeOF = { ...donde, OF: true };

    const totalOF = await FacturaClientes.count({ where: dondeOF });

    const ws = wb.addWorksheet('OF', {
        properties: { tabColor: { argb: XLS.marca } },
        views: [{ state: 'frozen', ySplit: 7, xSplit: 2 }],   // congela cabecera y las dos primeras columnas
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    // El orden sigue el del bloque "adquiriente" de la factura electrónica: identificación,
    // condición tributaria, actividad, domicilio fiscal, contacto. Quien transcribe a la
    // plataforma de la DIAN lee de izquierda a derecha sin saltar.
    ws.columns = [
        { key: 'nro',        width: 15 },
        { key: 'razon',      width: 34 },
        { key: 'nombres',    width: 28 },
        { key: 'tipoPer',    width: 12 },
        { key: 'tipoDoc',    width: 11 },
        { key: 'doc',        width: 18 },
        { key: 'dv',         width: 5  },
        { key: 'docCompleto',width: 20 },
        { key: 'regimen',    width: 24 },
        { key: 'respFiscal', width: 22 },
        { key: 'granC',      width: 9  },
        { key: 'autorret',   width: 9  },
        { key: 'agenteRet',  width: 9  },
        { key: 'aduanero',   width: 9  },
        { key: 'ciiu',       width: 8  },
        { key: 'descCiiu',   width: 30 },
        { key: 'fechaRut',   width: 12 },
        { key: 'pais',       width: 7  },
        { key: 'codDepto',   width: 8  },
        { key: 'depto',      width: 18 },
        { key: 'codMun',     width: 8  },
        { key: 'municipio',  width: 18 },
        { key: 'direccion',  width: 30 },
        { key: 'postal',     width: 9  },
        { key: 'email',      width: 28 },
        { key: 'telefono',   width: 15 },
        { key: 'valor',      width: 16 }
    ];

    const ANCHO = ws.columns.length;
    const { banda, casillas } = crearAyudasHoja(ws, ANCHO);

    banda(`FACTURAS MARCADAS OF  ·  ${fFechaLarga(fechaListado)}  ·  ${totalOF === 1 ? '1 factura' : totalOF + ' facturas'}`, {
        font: { name: 'Calibri', size: 9, bold: true, color: { argb: XLS.blanco } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.marca } },
        alignment: { vertical: 'middle', indent: 1 }
    }, 22);

    banda(tituloLista(tienda.nombreComercial), {
        font: { name: 'Calibri', size: 20, bold: true, color: { argb: XLS.tinta } },
        alignment: { vertical: 'middle', indent: 1 }
    }, 32);

    ws.addRow([]).commit();

    casillas([
        { etiqueta: 'RAZÓN SOCIAL',      valor: tituloLista(tienda.razonSocial || tienda.nombreComercial) },
        { etiqueta: 'FECHA DEL LISTADO', valor: fFechaLarga(fechaListado) },
        { etiqueta: 'FACTURAS OF',       valor: totalOF }
    ]);

    ws.addRow([]).commit();

    const cabecera = ws.addRow([
        'Nro Factura', 'Razón social', 'Nombres y apellidos', 'Persona',
        'Tipo doc.', 'NIT / Documento', 'DV', 'NIT completo',
        'Régimen', 'Resp. fiscal (DIAN)', 'Gran contr.', 'Autorret.', 'Ag. retención', 'Aduanero',
        'CIIU', 'Actividad económica', 'Fecha RUT',
        'País', 'Cód. dpto', 'Departamento', 'Cód. mun.', 'Municipio',
        'Dirección', 'Cód. postal', 'Email', 'Teléfono', 'Valor'
    ]);
    cabecera.height = 30;
    cabecera.eachCell((celda) => {
        celda.font = { name: 'Calibri', size: 9, bold: true, color: { argb: XLS.blanco } };
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.encabezado } };
        // Ajuste de línea: "Ag. retención" en una columna de 9 no entra en un renglón, y
        // recortado deja al lector adivinando cuál de las tres condiciones es.
        celda.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    });
    // Centradas: las cuatro condiciones, el DV y los códigos DANE. Son valores cortos y
    // centrados se barren de un vistazo; alineados a la izquierda quedan sueltos.
    [7, 11, 12, 13, 14, 18, 19, 21, 24, 27].forEach(i => {
        cabecera.getCell(i).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    cabecera.commit();

    const primeraDeDatos = cabecera.number + 1;
    let escritas = 0, mayor = 0;

    // Sí / — en vez de VERDADERO/FALSO: son cuatro columnas angostas leídas de un vistazo,
    // y el guion deja ver de inmediato cuáles condiciones aplican sin leer palabra por
    // palabra.
    const marca = (v) => (v ? 'Sí' : '—');
    const REGIMEN = { '48': '48 — Responsable de IVA', '49': '49 — No responsable de IVA' };

    for (let pagina = 0; ; pagina++) {
        const tanda = await FacturaClientes.findAll({
            where: dondeOF,
            include: [{
                model: Clientes, as: 'cliente', required: false,
                attributes: ['tipo_persona', 'tipo_documento', 'numero_doc', 'digito_verif',
                             'razon_social', 'primer_nombre', 'segundo_nombre',
                             'primer_apellido', 'segundo_apellido', 'email', 'telefono'],
                include: [
                    { model: ClientesTributario, as: 'tributario', required: false },
                    { model: ClientesUbicacion,  as: 'ubicaciones', required: false }
                ]
            },
            { model: DetallesFactura, as: 'detalles', attributes: ['total'], required: false }],
            order: [['numeroFactura', 'ASC'], ['idFacturaCliente', 'ASC']],
            limit: TANDA_OF,
            offset: pagina * TANDA_OF,
            distinct: true,
            subQuery: false
        });
        if (!tanda.length) break;

        for (const f of tanda) {
            const cli = f.cliente;
            // `hasMany`, así que llegan como arreglo aunque en la práctica sea uno solo.
            const trib = cli?.tributario?.[0]  || {};
            const ubi  = cli?.ubicaciones?.[0] || {};

            const total = f.detalles.reduce((s, d) => s + parseFloat(d.total || 0), 0);
            if (total > mayor) mayor = total;

            const nombre = f.idCliente === '0'
                ? 'Consumidor Final'
                : (cli?.razon_social
                    || [cli?.primer_nombre, cli?.segundo_nombre, cli?.primer_apellido, cli?.segundo_apellido]
                        .filter(Boolean).join(' ').trim()
                    || 'N/A');

            // Nombre completo aparte de la razón social: una persona natural no tiene razón
            // social y una jurídica no tiene nombres, así que mezclarlos en una columna
            // obliga a adivinar cuál de los dos se está leyendo.
            const nombresPersona = [cli?.primer_nombre, cli?.segundo_nombre,
                                    cli?.primer_apellido, cli?.segundo_apellido]
                                    .filter(Boolean).join(' ').trim();

            // El documento con su dígito, como se transcribe a la DIAN. Se arma acá para
            // que nadie tenga que concatenar dos columnas a mano.
            const docCompleto = cli?.numero_doc
                ? (cli.digito_verif ? `${cli.numero_doc}-${cli.digito_verif}` : cli.numero_doc)
                : '—';

            const fila = ws.addRow([
                enlaceFactura(f.idFacturaCliente, `${f.prefijo || ''}${f.numeroFactura}`),
                cli?.razon_social ? tituloLista(cli.razon_social) : '—',
                nombresPersona ? tituloLista(nombresPersona) : (f.idCliente === '0' ? 'Consumidor Final' : '—'),
                cli?.tipo_persona === 'J' ? 'Jurídica' : cli?.tipo_persona === 'N' ? 'Natural' : '—',
                cli?.tipo_documento || '—',
                cli?.numero_doc     || '—',
                cli?.digito_verif   || '—',
                docCompleto,
                REGIMEN[trib.regimen_fiscal] || trib.regimen_fiscal || '—',
                // Los códigos tal como se declararon. Vacío significa que nadie los
                // declaró todavía — distinto de R-99-PN, que es declarar que no aplica
                // ninguna. Se dice con palabras para que quien transcribe no lo confunda.
                trib.responsabilidad_fiscal || 'Sin declarar',
                marca(trib.gran_contribuyente),
                marca(trib.autorretenedor),
                marca(trib.agente_retencion),
                marca(trib.obligado_aduanero),
                trib.ciiu             || '—',
                trib.descripcion_ciiu || '—',
                trib.fecha_rut ? new Date(`${trib.fecha_rut}T00:00:00`) : '—',
                ubi.pais || '—',
                // Códigos DANE: son los que pide la plataforma de facturación, no el
                // nombre. Van al lado del nombre para poder verificar que corresponden.
                ubi.idDepartamento || '—',
                ubi.nombreDepartamento ? tituloLista(ubi.nombreDepartamento) : '—',
                ubi.idMunicipio || '—',
                ubi.nombreMunicipio    ? tituloLista(ubi.nombreMunicipio)    : '—',
                ubi.direccion || '—',
                ubi.codigo_postal || '—',
                cli?.email    || '—',
                cli?.telefono || '—',
                total
            ]);

            fila.height = 18;
            fila.eachCell({ includeEmpty: true }, (celda) => {
                celda.font = { name: 'Calibri', size: 10, color: { argb: XLS.tinta } };
                celda.alignment = { vertical: 'middle', indent: 1 };
                celda.border = { bottom: { style: 'thin', color: { argb: XLS.borde } } };
                if (escritas % 2 === 1) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.zebra } };
            });

            fila.getCell('A').font = { name: 'Consolas', size: 9, bold: true, underline: true, color: { argb: XLS.marca } };
            // Razón social y nombre en negrita: son lo que identifica al adquiriente.
            ['B', 'C'].forEach(c => { fila.getCell(c).font = { name: 'Calibri', size: 10, bold: true, color: { argb: XLS.tinta } }; });

            // Todo lo que se transcribe dígito por dígito va en monoespaciada: documentos,
            // códigos DANE, CIIU, postal y teléfono. Un 1 y un 7 mal leídos en una factura
            // electrónica la rechazan.
            ['E', 'F', 'G', 'O', 'R', 'S', 'U', 'X', 'Z'].forEach(c => {
                fila.getCell(c).font = { name: 'Consolas', size: 9, color: { argb: XLS.apagado } };
            });
            // El NIT con su dígito es el que se copia: va destacado sobre los dos que lo
            // componen, para que nadie arme la cadena a mano y se equivoque.
            fila.getCell('H').font = { name: 'Consolas', size: 10, bold: true, color: { argb: XLS.tinta } };
            fila.getCell('H').alignment = { vertical: 'middle', horizontal: 'center' };
            ['G', 'R', 'S', 'U', 'X'].forEach(c => { fila.getCell(c).alignment = { vertical: 'middle', horizontal: 'center' }; });
            fila.getCell('I').font = { name: 'Calibri', size: 9, color: { argb: XLS.apagado } };

            // Los códigos DIAN, en monoespaciada y destacados cuando existen: son lo que
            // se transcribe. "Sin declarar" se apaga, porque es la ausencia del dato.
            const cResp = fila.getCell('J');
            const declarados = cResp.value !== 'Sin declarar';
            cResp.font = declarados
                ? { name: 'Consolas', size: 9, bold: true, color: { argb: XLS.tinta } }
                : { name: 'Calibri', size: 9, italic: true, color: { argb: XLS.apagado } };

            // Las cuatro condiciones DIAN: la que aplica se ve, la que no se apaga. Es lo
            // que permite barrer la columna sin leerla.
            ['K', 'L', 'M', 'N'].forEach((c) => {
                const celda = fila.getCell(c);
                const activa = celda.value === 'Sí';
                celda.alignment = { vertical: 'middle', horizontal: 'center' };
                // El guion no se apaga hasta desaparecer: "no aplica" y "celda vacía" son
                // cosas distintas, y con el gris del borde no se distinguen.
                celda.font = activa
                    ? { name: 'Calibri', size: 10, bold: true, color: { argb: XLS.ingresoTinta } }
                    : { name: 'Calibri', size: 10, color: { argb: XLS.apagado } };
                if (activa) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.ingresoFondo } };
            });

            const cRut = fila.getCell('Q');
            if (cRut.value instanceof Date) cRut.numFmt = 'dd/mm/yyyy';
            cRut.alignment = { vertical: 'middle', horizontal: 'center' };

            // Actividad, dirección y correo: texto de apoyo, un punto más chico.
            ['P', 'T', 'V', 'W', 'Y'].forEach(c => { fila.getCell(c).font = { name: 'Calibri', size: 9, color: { argb: XLS.apagado } }; });

            const cValor = fila.getCell('AA');
            cValor.numFmt = FORMATO_PESOS;
            cValor.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XLS.ingresoTinta } };
            cValor.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };

            fila.commit();
            escritas++;
        }

        if (tanda.length < TANDA_OF) break;
    }

    if (!escritas) {
        // La hoja existe igual aunque esté vacía: si desapareciera, quien la busca no
        // sabría si es que no hubo facturas OF o si el informe se generó mal.
        banda('Ninguna factura de esta fecha fue marcada como OF.', {
            font: { name: 'Calibri', size: 11, italic: true, color: { argb: XLS.apagado } },
            alignment: { vertical: 'middle', horizontal: 'center' }
        }, 28);
    } else {
        const ultima = primeraDeDatos + escritas - 1;
        ws.addConditionalFormatting({
            ref: `AA${primeraDeDatos}:AA${ultima}`,
            rules: [{
                type: 'dataBar', gradient: true, priority: 2,
                color: { argb: 'FF10B981' },
                cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: mayor || 1 }]
            }]
        });
        ws.autoFilter = { from: { row: cabecera.number, column: 1 }, to: { row: ultima, column: ANCHO } };
    }

    await ws.commit();
    return escritas;
};

// GET /admin/bankentities/cajas/:idCajaBanco/movimientos/export
//
// Devuelve un .xlsx real (OOXML) escrito en streaming con ExcelJS. Antes se emitía
// SpreadsheetML 2003 con extensión .xls: Excel abría el archivo pero avisaba en cada
// apertura que el formato no coincidía con la extensión, y ese formato no admite barras
// de datos ni formato condicional.
const exportarMovimientosCuenta = async (req, res) => {
    try {
        const cuenta = await CajasYBancos.findByPk(req.params.idCajaBanco, { raw: true });
        if (!cuenta) return res.status(404).send('Cuenta no encontrada.');

        const { desde, hasta, tipo } = req.query;
        const where = filtrosLibro(cuenta.idCajaBanco, { desde, hasta, tipo });

        // Los totales y la escala de las barras salen de consultas agregadas, no de
        // recorrer las filas en Node: hay que conocerlos ANTES de escribir la cabecera,
        // que va arriba de todo en el archivo.
        const [resumenFiltro] = await MovimientosCajasBancos.findAll({
            where,
            attributes: [
                [fn('COUNT', col('idMovimiento')), 'cantidad'],
                [literal("COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN valor ELSE 0 END), 0)"), 'ingresos'],
                [literal("COALESCE(SUM(CASE WHEN tipo = 'egreso'  THEN valor ELSE 0 END), 0)"), 'egresos'],
                [fn('MAX', col('valor')), 'mayor']
            ],
            raw: true
        });

        const cantidad = parseInt(resumenFiltro?.cantidad) || 0;
        const ingresos = parseFloat(resumenFiltro?.ingresos) || 0;
        const egresos  = parseFloat(resumenFiltro?.egresos) || 0;
        const mayor    = parseFloat(resumenFiltro?.mayor) || 0;

        // Saldo con el que arranca el periodo: todo lo que pasó ANTES del rango pedido.
        // Sin esto la columna Saldo empieza en cero y un informe de agosto muestra saldos
        // que no son los de la cuenta, sino los acumulados del propio archivo.
        let saldo = 0;
        if (desde) {
            const [previo] = await MovimientosCajasBancos.findAll({
                where: { idCajaBanco: cuenta.idCajaBanco, fecha: { [Op.lt]: new Date(`${desde}T00:00:00`) } },
                attributes: [[SUMA_CON_SIGNO, 'saldo']],
                raw: true
            });
            saldo = parseFloat(previo?.saldo) || 0;
        }
        const saldoInicial = saldo;

        const ahora = new Date();
        const fFecha = (d) => d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
        const fHora  = (d) => d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

        const nombreArchivo = `movimientos-${cuenta.nombreCajaBanco.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '')}-${ahora.toISOString().slice(0, 10)}.xlsx`;

        // Qué abarca el archivo, en palabras. El banner lo usa para que dos exportaciones
        // de la misma cuenta con rangos distintos no sean indistinguibles una vez
        // descargadas. Se arma con los mismos filtros que la consulta, así no puede
        // describir un recorte distinto del que trae adentro.
        const dia = (iso) => fFecha(new Date(`${iso}T00:00:00`));
        const rango =
            desde && hasta ? `${dia(desde)} al ${dia(hasta)}`
            : desde        ? `Desde el ${dia(desde)}`
            : hasta        ? `Hasta el ${dia(hasta)}`
            : 'Todo el historial';
        const soloTipo = tipo === 'ingreso' ? '  ·  Solo ingresos'
                       : tipo === 'egreso'  ? '  ·  Solo egresos'
                       : '';
        const periodo = `${rango}${soloTipo}`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

        // Blindaje del stream. ExcelJS envuelve la respuesta en un archiver que sigue
        // empujando datos de forma asíncrona; si algo falla a mitad de la generación y el
        // catch corta la respuesta, ese archiver escribe sobre un stream ya cerrado. Ese
        // write emite un 'error' en `res`, y un 'error' sin oyente en un EventEmitter
        // TUMBA EL PROCESO: un informe que no se pudo armar se llevaba puesto el servidor
        // entero. Con este oyente el fallo queda en el log y la petición muere sola.
        res.on('error', (err) => console.error('exportarMovimientosCuenta: stream cortado ·', err.code || err.message));

        // Además, si el stream se rompe, `wb.commit()` no resuelve NUNCA: el archiver se
        // queda esperando un destino que ya no acepta bytes y el handler nunca termina.
        // Esta promesa hace que el `await` del final siempre termine.
        //
        // RESUELVE, no rechaza. Una versión anterior la hacía rechazar y era peor que el
        // problema: el stream se corta mucho antes de que alguien espere esta promesa, y
        // una promesa rechazada que nadie está escuchando todavía tumba el proceso igual
        // que el 'error' sin oyente que vinimos a arreglar.
        const streamRoto = new Promise((resolver) => res.once('error', () => resolver('roto')));

        // El workbook escribe directo sobre la respuesta: el archivo nunca existe completo
        // ni en memoria ni en disco.
        const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
        wb.creator = 'Grupo GH';
        wb.created = ahora;

        const ws = wb.addWorksheet('Movimientos', {
            // Se congela hasta la fila 10 inclusive, que es donde cae el encabezado de la
            // tabla: la cabecera del informe y los títulos de columna quedan fijos al
            // desplazarse. El bloque superior mide siempre lo mismo, con o sin la
            // advertencia de filtro, porque esa banda ocupa la fila que si no va vacía.
            views: [{ state: 'frozen', ySplit: 10 }],
            pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });

        ws.columns = [
            { key: 'fecha',       width: 13 },
            { key: 'hora',        width: 10 },
            { key: 'tipo',        width: 12 },
            { key: 'descripcion', width: 46 },
            { key: 'referencia',  width: 18 },
            { key: 'valor',       width: 17 },
            { key: 'saldo',       width: 17 },
            { key: 'usuario',     width: 24 }
        ];

        const { banda, casillas } = crearAyudasHoja(ws, 8);

        // ── 1. Banner y nombre de la cuenta ──────────────────────────────────
        // El banner dice qué abarca el archivo: sin eso, dos exportaciones de la misma
        // cuenta con rangos distintos son indistinguibles una vez descargadas.
        banda(`INFORME DE MOVIMIENTOS  ·  ${periodo}  ·  ${cantidad === 1 ? '1 registro' : cantidad + ' registros'}`, {
            font: { name: 'Calibri', size: 9, bold: true, color: { argb: XLS.blanco } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.tinta } },
            alignment: { vertical: 'middle', indent: 1 }
        }, 22);

        banda(tituloLista(cuenta.nombreCajaBanco), {
            font: { name: 'Calibri', size: 20, bold: true, color: { argb: XLS.tinta } },
            alignment: { vertical: 'middle', indent: 1 }
        }, 32);

        ws.addRow([]).commit();

        // ── 2. Identificación de la cuenta y del informe ─────────────────────
        casillas([
            { etiqueta: 'CUENTA',              valor: tituloLista(cuenta.nombreCajaBanco) },
            { etiqueta: 'NÚMERO O REFERENCIA', valor: cuenta.referencia || 'Sin referencia',
              color: cuenta.referencia ? XLS.tinta : XLS.apagado },
            { etiqueta: 'TIPO',                valor: ETIQUETA_TIPO_CUENTA[cuenta.tipo] || tituloLista(cuenta.tipo) },
            { etiqueta: 'GENERADO',            valor: `${fFecha(ahora)}, ${fHora(ahora)}` }
        ]);

        ws.addRow([]).commit();

        // ── 3. Cuadre del periodo ────────────────────────────────────────────
        // Las cuatro casillas cierran entre sí: inicial + ingresos − egresos = final.
        // Por eso el saldo inicial va explícito; sin él, quien lee un informe de agosto no
        // puede reconciliar los totales contra el saldo final y parece que la cuenta no da.
        const saldoFinal = saldoInicial + ingresos - egresos;
        casillas([
            { etiqueta: 'SALDO INICIAL', valor: saldoInicial, formato: FORMATO_PESOS,
              color: saldoInicial < 0 ? XLS.negativo : XLS.apagado },
            { etiqueta: 'INGRESOS',      valor: ingresos, formato: FORMATO_PESOS, color: XLS.ingresoTinta },
            { etiqueta: 'EGRESOS',       valor: egresos,  formato: FORMATO_PESOS, color: XLS.egresoTinta },
            { etiqueta: 'SALDO FINAL',   valor: saldoFinal, formato: FORMATO_PESOS,
              color: saldoFinal < 0 ? XLS.negativo : XLS.tinta }
        ]);

        // Un filtro por tipo deja la columna Saldo sin sentido contable: no se puede llevar
        // el saldo de una cuenta mirando solo la mitad de sus movimientos. Se dice, no se
        // esconde.
        if (tipo === 'ingreso' || tipo === 'egreso') {
            banda(`Filtrado solo por ${tipo}s: la columna Saldo acumula únicamente los movimientos listados y no refleja el saldo real de la cuenta.`, {
                font: { name: 'Calibri', size: 9, italic: true, color: { argb: XLS.negativo } },
                alignment: { vertical: 'middle', indent: 1 }
            }, 18);
        } else {
            ws.addRow([]).commit();
        }

        // ── 4. Encabezado de la tabla ────────────────────────────────────────
        const cabecera = ws.addRow(['Fecha', 'Hora', 'Tipo', 'Descripción', 'Referencia', 'Valor', 'Saldo', 'Registrado por']);
        cabecera.height = 22;
        cabecera.eachCell((celda) => {
            celda.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XLS.blanco } };
            celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.encabezado } };
            celda.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        });
        ['F', 'G'].forEach(c => { cabecera.getCell(c).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 }; });
        cabecera.commit();

        const filaPrimeraDeDatos = cabecera.number + 1;

        // ── 5. Movimientos, de a tandas ──────────────────────────────────────
        // De más viejo a más nuevo, para que el saldo se acumule hacia abajo. Mismo
        // desempate por id que el listado en pantalla: sin él, dos movimientos de la misma
        // fecha podrían salir en distinto orden en cada consulta y el saldo no cuadraría.
        let cursor = null;
        let escritas = 0;

        for (;;) {
            const tanda = await MovimientosCajasBancos.findAll({
                where: cursor ? { ...where, ...despuesDe(cursor) } : where,
                include: [{ model: Empleados, as: 'empleado', attributes: ['PrimerNombre', 'PrimerApellido'], required: false }],
                order: [['fecha', 'ASC'], ['idMovimiento', 'ASC']],
                limit: TANDA_EXPORT
            });
            if (!tanda.length) break;

            for (const m of tanda) {
                const valor = parseFloat(m.valor) || 0;
                const esIngreso = m.tipo === 'ingreso';
                saldo += esIngreso ? valor : -valor;

                const f = new Date(m.fecha);
                const fila = ws.addRow([
                    f,
                    f,
                    esIngreso ? 'Ingreso' : 'Egreso',
                    tituloLista(m.descripcion || ''),
                    m.referencia || '',
                    // El signo lo lleva el valor para que la barra de datos salga hacia la
                    // derecha en los ingresos y hacia la izquierda en los egresos.
                    esIngreso ? valor : -valor,
                    saldo,
                    m.empleado ? tituloLista(`${m.empleado.PrimerNombre} ${m.empleado.PrimerApellido}`) : ''
                ]);

                fila.height = 18;
                fila.eachCell({ includeEmpty: true }, (celda) => {
                    celda.font = { name: 'Calibri', size: 10, color: { argb: XLS.tinta } };
                    celda.alignment = { vertical: 'middle', indent: 1 };
                    celda.border = { bottom: { style: 'thin', color: { argb: XLS.borde } } };
                    if (escritas % 2 === 1) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.zebra } };
                });

                fila.getCell('A').numFmt = 'dd/mm/yyyy';
                fila.getCell('B').numFmt = 'hh:mm AM/PM';

                // La columna Tipo lleva el mismo código de color que el badge en pantalla.
                const cTipo = fila.getCell('C');
                cTipo.font = { name: 'Calibri', size: 10, bold: true, color: { argb: esIngreso ? XLS.ingresoTinta : XLS.egresoTinta } };
                cTipo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: esIngreso ? XLS.ingresoFondo : XLS.egresoFondo } };
                cTipo.alignment = { vertical: 'middle', horizontal: 'center' };

                fila.getCell('D').font = { name: 'Calibri', size: 10, bold: true, color: { argb: XLS.tinta } };
                fila.getCell('E').font = { name: 'Consolas', size: 9, color: { argb: XLS.apagado } };

                const cValor = fila.getCell('F');
                cValor.numFmt = FORMATO_PESOS;
                cValor.font = { name: 'Calibri', size: 10, bold: true, color: { argb: esIngreso ? XLS.ingresoTinta : XLS.egresoTinta } };
                cValor.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };

                const cSaldo = fila.getCell('G');
                cSaldo.numFmt = FORMATO_PESOS;
                cSaldo.font = { name: 'Calibri', size: 10, bold: true, color: { argb: saldo < 0 ? XLS.negativo : XLS.tinta } };
                cSaldo.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };

                fila.getCell('H').font = { name: 'Calibri', size: 10, color: { argb: XLS.apagado } };

                fila.commit();
                escritas++;
            }

            if (tanda.length < TANDA_EXPORT) break;
            cursor = tanda[tanda.length - 1];
        }

        const ultimaFila = filaPrimeraDeDatos + escritas - 1;

        if (!escritas) {
            banda('No hay movimientos en el rango seleccionado.', {
                font: { name: 'Calibri', size: 11, italic: true, color: { argb: XLS.apagado } },
                alignment: { vertical: 'middle', horizontal: 'center' }
            }, 28);
        } else {
            // Barra de datos sobre Valor: la escala va de −mayor a +mayor, así que el eje
            // cae en el centro y cada movimiento se lee contra el más grande del periodo.
            const escala = mayor > 0 ? mayor : 1;
            ws.addConditionalFormatting({
                ref: `F${filaPrimeraDeDatos}:F${ultimaFila}`,
                rules: [{
                    type: 'dataBar', gradient: true, priority: 2,
                    color: { argb: 'FF10B981' },
                    cfvo: [{ type: 'num', value: -escala }, { type: 'num', value: escala }]
                }]
            });

            ws.autoFilter = { from: { row: cabecera.number, column: 1 }, to: { row: ultimaFila, column: 8 } };
        }

        ws.commit();
        // Cierra el ZIP y termina la respuesta, o corta si el destino dejó de escuchar.
        const desenlace = await Promise.race([wb.commit().then(() => 'listo'), streamRoto]);
        if (desenlace === 'roto') { res.destroy(); return; }
    } catch (e) {
        console.error('exportarMovimientosCuenta:', e);
        // Si el archivo ya empezó a bajar no se puede mandar un 500: los encabezados
        // salieron hace rato. Se corta la descarga, que el navegador reporta como archivo
        // incompleto, y el motivo queda en el log. El oyente de 'error' puesto más arriba
        // es el que evita que los últimos bytes del archiver, al escribir sobre esta
        // respuesta ya cerrada, terminen tumbando el proceso.
        if (res.headersSent || res.writableEnded) { res.destroy(); return; }
        return res.status(500).send('No se pudo generar el archivo.');
    }
};


// ─── INFORME DE FACTURACIÓN DE UNA TIENDA EN EXCEL ───────────────────────────
//
// Mismo documento que el informe de movimientos de caja: banner, casillas de
// identificación, franja de totales y tabla con barras de datos. Cambia lo que se lista.
//
// Los totales salen del MISMO conjunto de facturas que la tabla —las de esa tienda con
// `fechaEmision` igual a la fecha elegida—, no del cuadre de caja, que agrupa por
// `createdAt` y por estado. Si se mezclaran los dos criterios, el informe mostraría un
// total que no cuadra con las facturas que él mismo lista.

// Un pago electrónico es el que no entró al cajón. `Entidad Crediticia` va aparte: es
// venta a crédito, todavía no es plata recibida.
const METODOS_ELECTRONICOS = ['Banco', 'Billetera Virtual', 'Tarjeta Credito'];

const TANDA_FACTURAS = 300;

// GET /admin/api/tiendas/:idPuntoDeVenta/facturas/export?fecha=YYYY-MM-DD
const exportarFacturasTienda = async (req, res) => {
    try {
        const { idPuntoDeVenta } = req.params;

        const tienda = await PuntosDeVenta.findByPk(idPuntoDeVenta, { raw: true });
        if (!tienda) return res.status(404).send('Tienda no encontrada.');

        const hoy = new Date();
        const fecha = req.query.fecha || `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(422).send('Fecha inválida.');

        const donde = { idPuntoDeVenta, fechaEmision: fecha };

        // Recaudo del día, en una sola consulta. El conjunto está acotado por tienda y por
        // día, así que se resuelve en memoria sin riesgo de crecer sin techo.
        const pagos = await DetallesPagosFactura.findAll({
            attributes: ['metodoPago', 'valor'],
            include: [
                { model: FacturaClientes, attributes: [], required: true, where: donde },
                { model: Entidades, as: 'entidad', attributes: ['nombreEntidad'], required: false }
            ],
            raw: true, nest: true
        });

        let sEfectivo = 0, sElectronicos = 0, sCredito = 0;
        const porEntidad = new Map();

        for (const p of pagos) {
            const valor = Math.round(parseFloat(p.valor) || 0);
            if (p.metodoPago === 'Efectivo') { sEfectivo += valor; continue; }

            // Sin entidad asociada se cae al método: un datáfono sin entidad configurada
            // igual tiene que aparecer en el desglose, no desaparecer del informe.
            const nombre = p.entidad?.nombreEntidad || p.metodoPago;
            porEntidad.set(nombre, (porEntidad.get(nombre) || 0) + valor);

            if (METODOS_ELECTRONICOS.includes(p.metodoPago)) sElectronicos += valor;
            else if (p.metodoPago === 'Entidad Crediticia') sCredito += valor;
        }

        const entidades = [...porEntidad.entries()].sort((a, b) => b[1] - a[1]);
        const totalFacturas = await FacturaClientes.count({ where: donde });

        const fFechaLarga = (d) => d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
        const fechaListado = new Date(`${fecha}T00:00:00`);

        const limpio = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '');

        // El número de factura enlaza a su tirilla. Tiene que ser absoluta: el .xlsx viaja
        // por correo y se abre en equipos que no saben de dónde salió, así que una ruta
        // relativa no lleva a ninguna parte.
        const baseUrl  = `${process.env.APP_URL}:${process.env.APP_PORT}`;
        const urlPDF   = (id) => `${baseUrl}/admin/api/factura/${id}/tirilla`;

        // ── Por qué una fórmula y no un hipervínculo de verdad ────────────────
        //
        // Un hipervínculo real obliga a ExcelJS a escribir un elemento <hyperlinks> en la
        // hoja y una relación por celda. Y su escritor en streaming lo emite ANTES de
        // <conditionalFormatting>, cuando el esquema de SpreadsheetML exige el orden
        // contrario. Excel valida ese orden y rechaza el archivo con "Encontramos un
        // problema con el contenido"; Vista Previa de macOS es más permisiva y lo abre
        // igual, así que el archivo parece sano hasta que alguien lo abre de verdad.
        //
        // `HYPERLINK()` es una fórmula: se resuelve dentro de la celda, no necesita
        // relación y no genera el elemento que rompe el orden. El enlace se comporta igual
        // al hacer clic.
        //
        // Las comillas del rótulo se duplican, que es como se escapan dentro de una cadena
        // de fórmula. Un prefijo de factura con comillas rompería el archivo entero.
        const enlaceFactura = (id, rotulo) => ({
            formula: `HYPERLINK("${urlPDF(id)}","${String(rotulo).replace(/"/g, '""')}")`
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="facturacion-${limpio(tienda.nombreComercial)}-${fecha}.xlsx"`);

        // Mismo blindaje que en exportarMovimientosCuenta, por el mismo motivo: ExcelJS
        // envuelve la respuesta en un archiver que sigue empujando bytes de forma
        // asíncrona. Si algo falla a mitad y el catch corta la respuesta, ese archiver
        // escribe sobre un stream cerrado; ese write emite un 'error' en `res`, y un
        // 'error' sin oyente TUMBA EL PROCESO. Un informe que no se pudo armar no puede
        // llevarse puesto el servidor.
        res.on('error', (err) => console.error('exportarFacturasTienda: stream cortado ·', err.code || err.message));

        // Y si el destino deja de aceptar bytes, `wb.commit()` no resuelve nunca y el
        // handler queda colgado. Esta promesa RESUELVE —no rechaza— para que el `await`
        // del final siempre termine: una promesa rechazada que todavía nadie escucha
        // tumbaría el proceso igual que el 'error' que vinimos a evitar.
        const streamRoto = new Promise((resolver) => res.once('error', () => resolver('roto')));

        const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
        wb.creator = 'Grupo GH';
        wb.created = hoy;

        // Cuánto mide el bloque de cabecera se sabe ANTES de crear la hoja porque el
        // desglose por entidad ya está calculado. Eso permite congelar exactamente hasta
        // la fila de títulos en vez de dejarla escapar al hacer scroll.
        const ALTO_BASE = 9;                                    // banner, nombre, dos franjas y separadores
        const altoEntidades = entidades.length ? entidades.length + 3 : 0;   // rótulo + títulos + filas + separador
        const filaTitulos = ALTO_BASE + altoEntidades + 1;

        const ws = wb.addWorksheet('Facturación', {
            views: [{ state: 'frozen', ySplit: filaTitulos }],
            pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });

        ws.columns = [
            { key: 'nro',      width: 16 },
            { key: 'cliente',  width: 32 },
            { key: 'doc',      width: 18 },
            { key: 'fecha',    width: 12 },
            { key: 'hora',     width: 11 },
            { key: 'valor',    width: 17 },
            { key: 'metodo',   width: 24 },
            { key: 'items',    width: 9 },
            { key: 'vendedor', width: 26 }
        ];

        const { banda, casillas } = crearAyudasHoja(ws, 9);

        // ── Banner y tienda ──────────────────────────────────────────────────
        banda(`INFORME DE FACTURACIÓN  ·  ${fFechaLarga(fechaListado)}  ·  ${totalFacturas === 1 ? '1 factura' : totalFacturas + ' facturas'}`, {
            font: { name: 'Calibri', size: 9, bold: true, color: { argb: XLS.blanco } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.tinta } },
            alignment: { vertical: 'middle', indent: 1 }
        }, 22);

        banda(tituloLista(tienda.nombreComercial), {
            font: { name: 'Calibri', size: 20, bold: true, color: { argb: XLS.tinta } },
            alignment: { vertical: 'middle', indent: 1 }
        }, 32);

        ws.addRow([]).commit();

        // El nombre comercial ya está en 20pt arriba, así que acá van los datos que
        // identifican la tienda sin repetirlo, y las dos fechas: la del listado (qué se
        // está mirando) y la de generación (cuándo se sacó el archivo). No se repite el
        // total: ése es el cierre de la franja de abajo.
        casillas([
            { etiqueta: 'RAZÓN SOCIAL',      valor: tituloLista(tienda.razonSocial || tienda.nombreComercial) },
            { etiqueta: 'DIRECCIÓN',         valor: tienda.direccionPrincipal || '—',
              color: tienda.direccionPrincipal ? XLS.tinta : XLS.apagado },
            { etiqueta: 'FECHA DEL LISTADO', valor: fFechaLarga(fechaListado) },
            { etiqueta: 'GENERADO',          valor: `${fFechaLarga(hoy)}, ${hoy.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}` }
        ]);

        ws.addRow([]).commit();

        // ── Cómo se recibió la plata ─────────────────────────────────────────
        // El crédito va aunque no se haya pedido: sin él las tres casillas no suman el
        // total y quien lee el informe no puede cuadrarlo.
        casillas([
            { etiqueta: 'VENTAS EFECTIVO',    valor: sEfectivo,     formato: FORMATO_PESOS, color: XLS.ingresoTinta },
            { etiqueta: 'MEDIOS ELECTRÓNICOS', valor: sElectronicos, formato: FORMATO_PESOS, color: 'FF1D4ED8' },
            { etiqueta: 'CRÉDITO',            valor: sCredito,      formato: FORMATO_PESOS, color: XLS.apagado },
            { etiqueta: 'TOTAL RECAUDADO',    valor: sEfectivo + sElectronicos + sCredito, formato: FORMATO_PESOS }
        ]);

        // ── Desglose por entidad ─────────────────────────────────────────────
        if (entidades.length) {
            ws.addRow([]).commit();
            banda('RECAUDO POR ENTIDAD', {
                font: { name: 'Calibri', size: 8, bold: true, color: { argb: XLS.marca } },
                alignment: { vertical: 'middle' }
            }, 16);

            const enc = ws.addRow(['Entidad', '', 'Recaudado']);
            ws.mergeCells(enc.number, 1, enc.number, 2);
            [1, 3].forEach(i => {
                const c = enc.getCell(i);
                c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: XLS.blanco } };
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.encabezado } };
                c.alignment = { vertical: 'middle', horizontal: i === 3 ? 'right' : 'left', indent: 1 };
            });
            enc.height = 18;
            enc.commit();

            entidades.forEach(([nombre, valor], i) => {
                const fila = ws.addRow([tituloLista(nombre), '', valor]);
                ws.mergeCells(fila.number, 1, fila.number, 2);
                [1, 2, 3].forEach(j => {
                    const c = fila.getCell(j);
                    c.font = { name: 'Calibri', size: 10, color: { argb: XLS.tinta } };
                    c.border = { bottom: { style: 'thin', color: { argb: XLS.borde } } };
                    if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.zebra } };
                });
                fila.getCell(1).alignment = { vertical: 'middle', indent: 1 };
                const cv = fila.getCell(3);
                cv.numFmt = FORMATO_PESOS;
                cv.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XLS.tinta } };
                cv.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
                fila.height = 17;
                fila.commit();
            });
        }

        ws.addRow([]).commit();

        // ── Tabla de facturas ────────────────────────────────────────────────
        const cabecera = ws.addRow(['Nro Factura', 'Cliente', 'Documento', 'Fecha', 'Hora', 'Valor', 'Método de pago', 'Ítems', 'Vendedor']);
        cabecera.height = 22;
        cabecera.eachCell((celda) => {
            celda.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XLS.blanco } };
            celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.encabezado } };
            celda.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        });
        ['F', 'H'].forEach(c => { cabecera.getCell(c).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 }; });
        cabecera.commit();

        const primeraDeDatos = cabecera.number + 1;
        let escritas = 0, mayor = 0;

        // De a tandas, ordenadas por número de factura. El desempate por id hace el orden
        // total: sin él dos facturas del mismo número (prefijos distintos) podrían salir
        // en distinto orden en cada tanda y repetirse o saltarse entre páginas.
        for (let pagina = 0; ; pagina++) {
            const tanda = await FacturaClientes.findAll({
                where: donde,
                include: [
                    { model: Clientes, as: 'cliente', attributes: ['razon_social', 'primer_nombre', 'primer_apellido', 'tipo_documento', 'numero_doc'], required: false },
                    { model: Empleados, as: 'vendedor', attributes: ['PrimerNombre', 'PrimerApellido'], required: false },
                    { model: DetallesFactura, as: 'detalles', attributes: ['cantidad', 'total'], required: false },
                    { model: DetallesPagosFactura, as: 'pagos', attributes: ['metodoPago'], required: false }
                ],
                order: [['numeroFactura', 'ASC'], ['idFacturaCliente', 'ASC']],
                limit: TANDA_FACTURAS,
                offset: pagina * TANDA_FACTURAS,
                distinct: true,
                subQuery: false
            });
            if (!tanda.length) break;

            for (const f of tanda) {
                const total    = f.detalles.reduce((s, d) => s + parseFloat(d.total || 0), 0);
                const items    = f.detalles.reduce((s, d) => s + parseInt(d.cantidad || 0), 0);
                const metodos  = [...new Set(f.pagos.map(p => p.metodoPago))].join(', ');
                const cli      = f.cliente;
                const cliente  = f.idCliente === '0'
                    ? 'Consumidor Final'
                    : (cli?.razon_social || `${cli?.primer_nombre || ''} ${cli?.primer_apellido || ''}`.trim() || 'N/A');
                const doc      = cli ? `${cli.tipo_documento || ''} ${cli.numero_doc || ''}`.trim() : '';

                if (total > mayor) mayor = total;

                const nro = `${f.prefijo || ''}${f.numeroFactura}`;

                const fila = ws.addRow([
                    enlaceFactura(f.idFacturaCliente, nro),
                    tituloLista(cliente),
                    doc,
                    fechaListado,
                    f.horaEmision || '',
                    total,
                    metodos,
                    items,
                    f.vendedor ? tituloLista(`${f.vendedor.PrimerNombre} ${f.vendedor.PrimerApellido}`) : ''
                ]);

                fila.height = 18;
                fila.eachCell({ includeEmpty: true }, (celda) => {
                    celda.font = { name: 'Calibri', size: 10, color: { argb: XLS.tinta } };
                    celda.alignment = { vertical: 'middle', indent: 1 };
                    celda.border = { bottom: { style: 'thin', color: { argb: XLS.borde } } };
                    if (escritas % 2 === 1) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLS.zebra } };
                });

                // Subrayado y color de marca: sin eso Excel pinta el enlace de azul con su
                // propio estilo y el informe deja de verse como los demás.
                fila.getCell('A').font = { name: 'Consolas', size: 9, bold: true, underline: true, color: { argb: XLS.marca } };
                fila.getCell('B').font = { name: 'Calibri', size: 10, bold: true, color: { argb: XLS.tinta } };
                fila.getCell('C').font = { name: 'Consolas', size: 9, color: { argb: XLS.apagado } };
                fila.getCell('D').numFmt = 'dd/mm/yyyy';

                const cValor = fila.getCell('F');
                cValor.numFmt = FORMATO_PESOS;
                cValor.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XLS.ingresoTinta } };
                cValor.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };

                fila.getCell('G').font = { name: 'Calibri', size: 9, color: { argb: XLS.apagado } };
                fila.getCell('H').alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
                fila.getCell('I').font = { name: 'Calibri', size: 10, color: { argb: XLS.apagado } };

                fila.commit();
                escritas++;
            }

            if (tanda.length < TANDA_FACTURAS) break;
        }

        if (!escritas) {
            banda('No hay facturas emitidas en esta fecha.', {
                font: { name: 'Calibri', size: 11, italic: true, color: { argb: XLS.apagado } },
                alignment: { vertical: 'middle', horizontal: 'center' }
            }, 28);
        } else {
            const ultima = primeraDeDatos + escritas - 1;
            ws.addConditionalFormatting({
                ref: `F${primeraDeDatos}:F${ultima}`,
                rules: [{
                    type: 'dataBar', gradient: true, priority: 2,
                    color: { argb: 'FF10B981' },
                    cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: mayor || 1 }]
                }]
            });
            ws.autoFilter = { from: { row: cabecera.number, column: 1 }, to: { row: ultima, column: 9 } };
        }

        ws.commit();

        // ══ HOJA "OF" ════════════════════════════════════════════════════════
        //
        // Las facturas que el punto de venta marcó como OF, con los datos tributarios del
        // cliente abiertos en columnas. Esta hoja es la que se entrega a quien la pide,
        // así que lleva el dato completo —régimen, condiciones DIAN, CIIU, RUT,
        // ubicación— y no el resumen de una línea que alcanza para el listado general.
        //
        // Va en hoja aparte y no como filas marcadas de la primera por una razón práctica:
        // son diecisiete columnas contra nueve. Mezcladas, la tabla del listado quedaría
        // vacía en dos tercios de su ancho para todas las facturas que no son OF.
        //
        // Se escribe DESPUÉS de confirmar la primera hoja: con el escritor en streaming
        // una hoja confirmada ya no admite filas, así que el orden es el orden final.
        await construirHojaOF(wb, { donde, tienda, fechaListado, fFechaLarga, enlaceFactura });

        // Cierra el ZIP y termina la respuesta, o corta si el destino dejó de escuchar.
        const desenlace = await Promise.race([wb.commit().then(() => 'listo'), streamRoto]);
        if (desenlace === 'roto') { res.destroy(); return; }
    } catch (e) {
        console.error('exportarFacturasTienda:', e);
        // Si el archivo ya empezó a bajar no se puede mandar un 500: los encabezados
        // salieron hace rato. Se corta la descarga, que el navegador reporta como archivo
        // incompleto, y el motivo queda en el log.
        if (res.headersSent || res.writableEnded) { res.destroy(); return; }
        return res.status(500).send('No se pudo generar el archivo.');
    }
};

// ─── EDICIÓN DE UNA CAJA O BANCO ─────────────────────────────────────────────
//
// Qué se puede tocar y qué no:
//
//   · `nombreCajaBanco` y `estado`: siempre. Son datos de presentación y de operación;
//     cambiarlos no altera ningún movimiento ya asentado.
//
//   · `tipo` y `referencia`: SOLO mientras la cuenta no tenga ni un movimiento. Definen
//     qué es la cuenta y contra qué se concilia. Cambiarlas con movimientos adentro
//     reescribiría el significado de un historial que es append-only justamente para que
//     no se pueda reescribir: los movimientos de una "caja" pasarían a leerse como los de
//     un "banco", y la referencia con la que se concilió un extracto dejaría de existir.
//
// La regla se resuelve entera en el servidor. Lo que mande el cliente sobre si puede o no
// editar esos campos es irrelevante: acá se vuelve a contar.

// Lee la cuenta y decide si su estructura todavía es editable.
// `bloquear` toma la fila en exclusiva para que el conteo no se quede viejo entre la
// verificación y la escritura: `crearMovimientoCuenta` pide la misma fila en modo
// compartido antes de insertar, así que las dos operaciones se serializan.
const leerCuentaEditable = async (idCajaBanco, { transaction = null, bloquear = false } = {}) => {
    const cuenta = await CajasYBancos.findByPk(idCajaBanco, {
        transaction,
        ...(bloquear ? { lock: transaction.LOCK.UPDATE } : {})
    });
    if (!cuenta) return null;

    // Basta con saber si hay al menos uno: no hace falta contar el historial entero.
    const primerMovimiento = await MovimientosCajasBancos.findOne({
        where: { idCajaBanco },
        attributes: ['idMovimiento'],
        transaction
    });

    return { cuenta, tieneMovimientos: !!primerMovimiento };
};

// GET /admin/bankentities/cajas/:idCajaBanco/editar
// Datos para abrir el modal. `puedeEditarEstructura` se calcula acá y no en la vista
// porque entre que se cargó la página y se abre el modal pudo entrar un movimiento.
const getCajaBancoEditar = async (req, res) => {
    try {
        const datos = await leerCuentaEditable(req.params.idCajaBanco);
        if (!datos) return res.status(404).json({ success: false, mensaje: 'La cuenta no existe.' });

        const { cuenta, tieneMovimientos } = datos;
        return res.json({
            success: true,
            puedeEditarEstructura: !tieneMovimientos,
            cuenta: {
                idCajaBanco:     cuenta.idCajaBanco,
                nombreCajaBanco: cuenta.nombreCajaBanco,
                tipo:            cuenta.tipo,
                referencia:      cuenta.referencia,
                estado:          cuenta.estado
            }
        });
    } catch (e) {
        console.error('getCajaBancoEditar:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo cargar la cuenta.' });
    }
};

// POST /admin/bankentities/cajas/:idCajaBanco/editar
const editarCajaBanco = async (req, res) => {
    const t = await db.transaction();
    try {
        const errores = validationResult(req);
        if (!errores.isEmpty()) {
            await t.rollback();
            return res.status(422).json({ success: false, mensaje: errores.array()[0].msg });
        }

        const datos = await leerCuentaEditable(req.params.idCajaBanco, { transaction: t, bloquear: true });
        if (!datos) {
            await t.rollback();
            return res.status(404).json({ success: false, mensaje: 'La cuenta no existe.' });
        }

        const { cuenta, tieneMovimientos } = datos;

        // Whitelist: se arma el objeto campo por campo. Nunca `req.body` completo, que
        // dejaría colar cualquier columna del modelo (CLAUDE.md §12).
        const cambios = {
            nombreCajaBanco: String(req.body.nombreCajaBanco || '').trim(),
            estado:          req.body.estado === true || req.body.estado === 'true'
        };

        if (tieneMovimientos) {
            // La cuenta ya tiene historial. El formulario no muestra estos campos, pero eso
            // es comodidad del navegador, no una garantía: si llegan igual, se rechaza.
            // Solo se ignoran en silencio cuando repiten el valor que ya está guardado,
            // que es lo que pasaría si alguien reenvía el formulario entero sin cambiarlos.
            const tipoDistinto = req.body.tipo !== undefined &&
                String(req.body.tipo).trim() !== cuenta.tipo;

            const referenciaEnviada = req.body.referencia === undefined
                ? undefined
                : (String(req.body.referencia).trim() || null);
            const referenciaDistinta = referenciaEnviada !== undefined &&
                referenciaEnviada !== cuenta.referencia;

            if (tipoDistinto || referenciaDistinta) {
                await t.rollback();
                return res.status(409).json({
                    success: false,
                    mensaje: 'Esta cuenta ya tiene movimientos registrados: el tipo y la referencia no se pueden cambiar. Cambiarlos alteraría el significado de un historial que no se puede reescribir.'
                });
            }
        } else {
            // Sin movimientos: la cuenta todavía no significa nada contra qué conciliar.
            if (req.body.tipo !== undefined) cambios.tipo = String(req.body.tipo).trim();
            if (req.body.referencia !== undefined) cambios.referencia = String(req.body.referencia).trim() || null;
        }

        // Los validadores del modelo corren dentro del update: es la barrera que no
        // depende de que la ruta tenga puesto el express-validator correcto.
        await cuenta.update(cambios, { transaction: t });
        await t.commit();

        return res.json({
            success: true,
            puedeEditarEstructura: !tieneMovimientos,
            cuenta: {
                idCajaBanco:     cuenta.idCajaBanco,
                nombreCajaBanco: cuenta.nombreCajaBanco,
                tipo:            cuenta.tipo,
                referencia:      cuenta.referencia,
                estado:          cuenta.estado
            }
        });
    } catch (e) {
        if (!t.finished) await t.rollback().catch(() => {});

        if (e.name === 'SequelizeUniqueConstraintError') {
            const campo = e.errors?.[0]?.path || '';
            return res.status(409).json({
                success: false,
                mensaje: campo.includes('referencia')
                    ? 'Ya existe otra caja o cuenta con esa referencia.'
                    : 'Ya existe otra caja o cuenta con ese nombre.'
            });
        }
        if (e.name === 'SequelizeValidationError') {
            return res.status(422).json({ success: false, mensaje: e.errors?.[0]?.message || 'Datos inválidos.' });
        }
        console.error('editarCajaBanco:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar. Intentá de nuevo.' });
    }
};

// ─── CAJAS Y BANCOS ───────────────────────────────────────────────────────────
// POST /admin/bankentities/cajas/crear
const crearCajaBanco = async (req, res) => {
    try {
        // Primera barrera: express-validator (cajaBancoValidation en la ruta).
        const errores = validationResult(req);
        if (!errores.isEmpty()) {
            return res.status(422).json({ success: false, mensaje: errores.array()[0].msg });
        }

        // Whitelist explícita: nada de pasarle req.body a create(). `estado` se lee acá
        // y no se hereda del cliente como objeto suelto.
        const datos = {
            nombreCajaBanco: String(req.body.nombreCajaBanco || '').trim(),
            tipo:            String(req.body.tipo || '').trim(),
            referencia:      req.body.referencia ? String(req.body.referencia).trim() : null,
            estado:          req.body.estado === true || req.body.estado === 'true'
        };

        // Segunda barrera: los validadores del modelo corren igual dentro de create().
        const creada = await CajasYBancos.create(datos);

        return res.json({
            success: true,
            cajaBanco: {
                idCajaBanco:     creada.idCajaBanco,
                nombreCajaBanco: creada.nombreCajaBanco,
                tipo:            creada.tipo,
                referencia:      creada.referencia,
                estado:          creada.estado
            }
        });
    } catch (e) {
        // Nombre o referencia repetidos: el índice único es la última barrera y la única
        // que resiste dos peticiones simultáneas con el mismo nombre.
        if (e.name === 'SequelizeUniqueConstraintError') {
            const campo = e.errors?.[0]?.path || '';
            const mensaje = campo.includes('referencia')
                ? 'Ya existe una caja o cuenta con esa referencia.'
                : 'Ya existe una caja o cuenta con ese nombre.';
            return res.status(409).json({ success: false, mensaje });
        }
        if (e.name === 'SequelizeValidationError') {
            return res.status(422).json({ success: false, mensaje: e.errors?.[0]?.message || 'Datos inválidos.' });
        }
        console.error('crearCajaBanco:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar. Intentá de nuevo.' });
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
                // Una caja abierta todavía no tiene quién la cierre: se muestra la raya
                // en vez de una celda vacía, que se lee como un dato que se perdió.
                empleadoCierre:   `${c.empleadoCierre?.PrimerNombre  || ''} ${c.empleadoCierre?.PrimerApellido  || ''}`.trim() || '—'
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
                { model: PuntosDeVenta, as: 'puntoDeVenta',    attributes: ['nombreComercial', 'direccionPrincipal', 'ciudad'] }
            ]
        });
        if (!caja) return res.status(404).send('Caja no encontrada.');

        const [regimen, municipio, datos] = await Promise.all([
            RegimenFacturacion.findOne({ where: { idPuntoDeVenta, activa: true } }),
            caja.puntoDeVenta?.ciudad
                ? Municipios.findOne({ where: { id: caja.puntoDeVenta.ciudad }, attributes: ['nombre'], raw: true })
                : null,
            _calcularTransaccionesCaja(idPuntoDeVenta, new Date(caja.fechaApertura), new Date(caja.fechaCierre), 'liquidada')
        ]);

        const buf = await _generarPDFCuadre({
            caja, regimen, municipio,
            sums:           { sEfectivo: datos.sEfectivo, sMedios: datos.sMedios, sCredito: datos.sCredito, sEgresos: datos.sEgresos, sVentas: datos.sVentas, sEgresosEfectivo: datos.sEgresosEfectivo, sEgresosElectronicos: datos.sEgresosElectronicos },
            txElectronicos: datos.txElectronicos,
            txCredito:      datos.txCredito,
            txEgresos:      datos.txEgresos
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="cuadre-${new Date(caja.fechaCierre).toISOString().slice(0,10)}.pdf"`);
        res.setHeader('Content-Length', buf.length);
        return res.send(buf);
    } catch (e) {
        console.error('getAdminCuadrePDF:', e);
        return res.status(500).send('Error al generar el PDF.');
    }
};

// ─── DASHBOARD: STOCK BAJO GLOBAL ────────────────────────────────────────────
const getStockBajoGlobal = async (req, res) => {
    try {
        const filas = await db.query(`
            SELECT p.nombreProducto, p.sku, SUM(s.cantidadExistente) AS total
            FROM STOCKS s
            INNER JOIN PRODUCTOS p ON s.idProducto = p.idProducto
            WHERE s.idProducto IS NOT NULL
            GROUP BY s.idProducto, p.nombreProducto, p.sku
            HAVING total > 0
            ORDER BY total ASC
            LIMIT 10
        `, { type: db.QueryTypes.SELECT });

        const productos = filas.map(r => ({
            nombre: r.nombreProducto,
            sku:    r.sku,
            total:  parseInt(r.total) || 0
        }));
        return res.json({ success: true, productos });
    } catch (e) {
        console.error('getStockBajoGlobal:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── DASHBOARD: STOCK BAJO POR TIENDA ────────────────────────────────────────
const getStockBajoPorTienda = async (req, res) => {
    try {
        const filas = await db.query(`
            SELECT pdv.idPuntoDeVenta, pdv.nombreComercial,
                   p.nombreProducto, p.sku,
                   SUM(s.cantidadExistente) AS total
            FROM STOCKS s
            INNER JOIN PRODUCTOS p   ON s.idProducto  = p.idProducto
            INNER JOIN PUNTO_DE_VENTA pdv ON s.idPuntoVenta = pdv.idPuntoDeVenta
            WHERE s.idProducto IS NOT NULL AND s.cantidadExistente > 0
            GROUP BY s.idPuntoVenta, s.idProducto,
                     pdv.idPuntoDeVenta, pdv.nombreComercial,
                     p.nombreProducto, p.sku
            ORDER BY pdv.idPuntoDeVenta, total ASC
        `, { type: db.QueryTypes.SELECT });

        const tiendaMap = new Map();
        for (const r of filas) {
            if (!tiendaMap.has(r.idPuntoDeVenta))
                tiendaMap.set(r.idPuntoDeVenta, { nombre: r.nombreComercial, productos: [] });
            const t = tiendaMap.get(r.idPuntoDeVenta);
            if (t.productos.length < 4)
                t.productos.push({ nombre: r.nombreProducto, sku: r.sku, total: parseInt(r.total) || 0 });
        }

        const tiendas = [...tiendaMap.values()].filter(t => t.productos.length > 0);
        return res.json({ success: true, tiendas });
    } catch (e) {
        console.error('getStockBajoPorTienda:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── DASHBOARD: VENTAS POR PDV ÚLTIMOS 30D ───────────────────────────────────
const getVentasPdv30d = async (req, res) => {
    try {
        const desde = new Date();
        desde.setDate(desde.getDate() - 29);
        desde.setHours(0, 0, 0, 0);

        const filas = await db.query(`
            SELECT fc.idPuntoDeVenta, pdv.nombreComercial AS tienda,
                   DATE(fc.createdAt) AS dia, SUM(df.total) AS suma
            FROM FACTURA_CLIENTES fc
            INNER JOIN DETALLES_FACTURA df  ON df.idFacturaCliente = fc.idFacturaCliente
            INNER JOIN PUNTO_DE_VENTA   pdv ON pdv.idPuntoDeVenta  = fc.idPuntoDeVenta
            WHERE fc.createdAt >= :desde
            GROUP BY fc.idPuntoDeVenta, pdv.nombreComercial, DATE(fc.createdAt)
            ORDER BY dia ASC
        `, { replacements: { desde }, type: db.QueryTypes.SELECT });

        const hoy = new Date();
        const fechas = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(hoy);
            d.setDate(d.getDate() - i);
            fechas.push(d.toISOString().slice(0, 10));
        }

        const pdvMap = new Map();
        for (const r of filas) {
            if (!pdvMap.has(r.idPuntoDeVenta))
                pdvMap.set(r.idPuntoDeVenta, { nombre: r.tienda, datos: {} });
            const diaStr = r.dia instanceof Date
                ? r.dia.toISOString().slice(0, 10)
                : String(r.dia).slice(0, 10);
            pdvMap.get(r.idPuntoDeVenta).datos[diaStr] = Math.round(parseFloat(r.suma || 0));
        }

        const series = [...pdvMap.values()].map(p => ({
            nombre:  p.nombre,
            valores: fechas.map(f => p.datos[f] || 0)
        }));

        return res.json({ success: true, fechas, series });
    } catch (e) {
        console.error('getVentasPdv30d:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── DASHBOARD: CARTERA URGENTE ──────────────────────────────────────────────
const getCarteraUrgente = async (req, res) => {
    try {
        const filas = await db.query(`
            SELECT
                c.idCliente,
                COALESCE(c.razon_social,
                    CONCAT(COALESCE(c.primer_nombre,''), ' ', COALESCE(c.primer_apellido,''))) AS nombreCliente,
                c.tipo_documento,
                c.numero_doc,
                c.digito_verif,
                SUM(df_sum.totalFactura)                              AS totalBruto,
                SUM(COALESCE(pago_sum.totalPagado, 0))               AS totalAbonado,
                SUM(df_sum.totalFactura) - SUM(COALESCE(pago_sum.totalPagado, 0)) AS saldoPendiente,
                MAX(DATEDIFF(CURDATE(), fc.fechaVencimiento))        AS diasEnMora,
                COUNT(DISTINCT fc.idFacturaCliente)                   AS nroFacturas
            FROM FACTURA_CLIENTES fc
            INNER JOIN CLIENTES c ON c.idCliente = fc.idCliente
            INNER JOIN (
                SELECT idFacturaCliente, SUM(total) AS totalFactura
                FROM DETALLES_FACTURA GROUP BY idFacturaCliente
            ) df_sum ON df_sum.idFacturaCliente = fc.idFacturaCliente
            LEFT JOIN (
                SELECT idFacturaCliente, SUM(valor) AS totalPagado
                FROM DETALLES_PAGOS_FACTURA GROUP BY idFacturaCliente
            ) pago_sum ON pago_sum.idFacturaCliente = fc.idFacturaCliente
            WHERE fc.estado = 'pendiente'
              AND fc.fechaVencimiento IS NOT NULL
              AND fc.fechaVencimiento < CURDATE()
            GROUP BY c.idCliente, c.razon_social, c.primer_nombre, c.primer_apellido,
                     c.tipo_documento, c.numero_doc, c.digito_verif
            HAVING saldoPendiente > 0
            ORDER BY diasEnMora DESC
            LIMIT 10
        `, { type: db.QueryTypes.SELECT });

        const [{ totalEnMora }] = await db.query(`
            SELECT COUNT(DISTINCT idCliente) AS totalEnMora
            FROM FACTURA_CLIENTES
            WHERE estado = 'pendiente' AND fechaVencimiento IS NOT NULL AND fechaVencimiento < CURDATE()
        `, { type: db.QueryTypes.SELECT });

        const clientes = filas.map(r => ({
            idCliente:      r.idCliente,
            nombre:         r.nombreCliente.trim(),
            tipoDoc:        r.tipo_documento,
            nroDoc:         r.numero_doc,
            digitoVerif:    r.digito_verif,
            saldoPendiente: Math.round(parseFloat(r.saldoPendiente) || 0),
            diasEnMora:     parseInt(r.diasEnMora) || 0,
            nroFacturas:    parseInt(r.nroFacturas) || 0
        }));

        return res.json({ success: true, clientes, totalEnMora: parseInt(totalEnMora) || 0 });
    } catch (e) {
        console.error('getCarteraUrgente:', e);
        return res.status(500).json({ success: false });
    }
};

// ─── TIRILLA ABONO PROVEEDOR ──────────────────────────────────────────────────
const getTirillaAbonoProveedor = async (req, res) => {
    const { idCuentaPorPagar } = req.params;
    try {
        const cuenta = await CuentasPorPagar.findOne({
            where: { idCuentaPorPagar },
            include: [{
                model: FacturaProveedores, as: 'factura',
                include: [{ model: Provedores, as: 'proveedor', attributes: ['razonSocial', 'taxIdSupplier'] }]
            }]
        });
        if (!cuenta) return res.status(404).json({ success: false, mensaje: 'Registro no encontrado.' });

        const todosLosAbonos = await CuentasPorPagar.findAll({
            where: { idFacturaPro: cuenta.idFacturaPro },
            order: [['fechaAbono', 'ASC']],
            attributes: ['idCuentaPorPagar', 'fechaAbono', 'valorAbono', 'valorPorPagar']
        });

        const regimen       = await RegimenFacturacion.findOne();
        const saldoAnterior = parseFloat(cuenta.valorPorPagar) + parseFloat(cuenta.valorAbono);
        const abono         = parseFloat(cuenta.valorAbono);
        const saldoActual   = parseFloat(cuenta.valorPorPagar);
        const totalFactura  = parseFloat(cuenta.totalFactura);
        const fecha         = new Date(cuenta.fechaAbono);

        const fmtCOP = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v);
        const fmtFecha = d => d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const fmtHora  = d => d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

        const W      = 227;
        const MARGIN = 10;
        const CW     = W - MARGIN * 2;

        const docHeight = 480 + Math.max(0, todosLosAbonos.length - 1) * 13;
        const doc = new PDFDocument({
            size: [W, docHeight],
            margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
            autoFirstPage: true
        });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        const pdfEnd = new Promise(r => doc.on('end', r));

        const hr = () => {
            doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CW, doc.y).strokeColor('#aaa').lineWidth(0.4).stroke();
            doc.moveDown(0.35);
        };
        const hrDot = () => {
            doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CW, doc.y).dash(2, { space: 2 }).strokeColor('#bbb').lineWidth(0.4).stroke().undash();
            doc.moveDown(0.35);
        };
        const rowKV = (label, value, boldValue = false) => {
            const y = doc.y;
            doc.font('Helvetica').fontSize(7).text(label, MARGIN, y, { width: CW * 0.58 });
            doc.font(boldValue ? 'Helvetica-Bold' : 'Helvetica').fontSize(7)
               .text(value, MARGIN + CW * 0.58, y, { width: CW * 0.42, align: 'right' });
            doc.y = y + 11;
        };

        // ── Cabecera ────────────────────────────────────────────
        const LOGO_SIZE = 50;
        const logoX = MARGIN + (CW - LOGO_SIZE) / 2;
        try { doc.image(LOGO_PATH_ADMIN, logoX, MARGIN, { width: LOGO_SIZE, height: LOGO_SIZE }); } catch {}
        doc.y = MARGIN + LOGO_SIZE + 4;

        doc.font('Helvetica-Bold').fontSize(9).text(regimen?.razonSocial || 'EMPRESA', MARGIN, doc.y, { width: CW, align: 'center' });
        if (regimen?.taxId) doc.font('Helvetica').fontSize(6.5).text(`NIT: ${regimen.taxId}${regimen.DV ? '-' + regimen.DV : ''}`, MARGIN, doc.y, { width: CW, align: 'center' });

        doc.moveDown(0.4); hr();

        // ── Título ──────────────────────────────────────────────
        doc.font('Helvetica-Bold').fontSize(8.5).text('COMPROBANTE DE ABONO', MARGIN, doc.y, { width: CW, align: 'center' });
        doc.font('Helvetica').fontSize(6.5).text(`${fmtFecha(fecha)}  ${fmtHora(fecha)}`, MARGIN, doc.y, { width: CW, align: 'center' });

        doc.moveDown(0.4); hr();

        // ── Datos factura ───────────────────────────────────────
        rowKV('Factura No:', cuenta.factura?.nroFactura || '—');
        rowKV('Proveedor:', cuenta.factura?.proveedor?.razonSocial || '—');
        if (cuenta.factura?.proveedor?.taxIdSupplier) rowKV('NIT Proveedor:', cuenta.factura.proveedor.taxIdSupplier);

        doc.moveDown(0.2); hr();

        // ── Valores ─────────────────────────────────────────────
        rowKV('Total Factura:', fmtCOP(totalFactura));
        doc.moveDown(0.15);
        hrDot();
        rowKV('Saldo Anterior:', fmtCOP(saldoAnterior));
        rowKV('Abono:', fmtCOP(abono), true);
        doc.moveDown(0.15); hrDot();
        rowKV('Saldo Actual:', fmtCOP(saldoActual), true);

        doc.moveDown(0.5); hr();

        // ── Historial de abonos ─────────────────────────────────
        doc.font('Helvetica-Bold').fontSize(7).text('HISTORIAL DE ABONOS', MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.3);

        // Cabecera de columnas
        const colFecha  = CW * 0.38;
        const colAbono  = CW * 0.32;
        const colSaldo  = CW * 0.30;
        const yTh = doc.y;
        doc.font('Helvetica-Bold').fontSize(6)
            .text('Fecha',   MARGIN,                    yTh, { width: colFecha })
            .text('Abono',   MARGIN + colFecha,          yTh, { width: colAbono,  align: 'right' })
            .text('Saldo',   MARGIN + colFecha + colAbono, yTh, { width: colSaldo, align: 'right' });
        doc.y = yTh + 9;
        hrDot();

        todosLosAbonos.forEach(a => {
            const isActual = a.idCuentaPorPagar === parseInt(idCuentaPorPagar);
            const font  = isActual ? 'Helvetica-Bold' : 'Helvetica';
            const yRow  = doc.y;
            doc.font(font).fontSize(6)
                .text(new Date(a.fechaAbono).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                      MARGIN, yRow, { width: colFecha })
                .text(fmtCOP(parseFloat(a.valorAbono)),   MARGIN + colFecha,           yRow, { width: colAbono,  align: 'right' })
                .text(fmtCOP(parseFloat(a.valorPorPagar)), MARGIN + colFecha + colAbono, yRow, { width: colSaldo, align: 'right' });
            doc.y = yRow + 11;
        });

        doc.moveDown(0.4); hr();

        // ── Firma ───────────────────────────────────────────────
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(6.5).text('Recibe:', MARGIN, doc.y, { width: CW });
        doc.moveDown(2.5);
        doc.moveTo(MARGIN + 10, doc.y).lineTo(MARGIN + CW - 10, doc.y).strokeColor('#444').lineWidth(0.5).stroke();
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(6).text('Firma y nombre de quien recibe', MARGIN, doc.y, { width: CW, align: 'center' });

        doc.end();
        await pdfEnd;

        const pdfBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="abono-${cuenta.factura?.nroFactura || idCuentaPorPagar}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        return res.send(pdfBuffer);

    } catch (error) {
        console.error('getTirillaAbonoProveedor:', error);
        return res.status(500).json({ success: false, mensaje: 'Error al generar la tirilla.' });
    }
};

// ─── FACTURAS PENDIENTES PROVEEDORES ─────────────────────────────────────────
const PER_PAGE_FP = 5;

const getFacturasPendientesProveedores = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    try {
        const { count, rows: facturas } = await FacturaProveedores.findAndCountAll({
            where: { estado: 'Pendiente' },
            include: [{ model: Provedores, as: 'proveedor', attributes: ['razonSocial'] }],
            order: [['fechaVencimiento', 'ASC']],
            limit: PER_PAGE_FP,
            offset: (page - 1) * PER_PAGE_FP,
            distinct: true
        });

        // El "último abono" de cada factura sale de UNA consulta para toda la página, no
        // de una por factura: ordenada por idFacturaPro y createdAt DESC, la primera fila
        // que aparece de cada factura es la más reciente.
        const facturaIds = facturas.map(f => f.idFacturaPro);
        const cuentas = facturaIds.length
            ? await CuentasPorPagar.findAll({
                  where: { idFacturaPro: { [Op.in]: facturaIds } },
                  order: [['idFacturaPro', 'ASC'], ['createdAt', 'DESC']],
                  raw: true
              })
            : [];
        const mapaUltimaCuenta = {};
        for (const c of cuentas) {
            if (!(c.idFacturaPro in mapaUltimaCuenta)) mapaUltimaCuenta[c.idFacturaPro] = c;
        }

        const result = facturas.map(f => {
            const ultima = mapaUltimaCuenta[f.idFacturaPro];
            return {
                idFacturaPro:     f.idFacturaPro,
                nroFactura:       f.nroFactura,
                fechaFactura:     f.fechaFactura,
                fechaVencimiento: f.fechaVencimiento,
                valorTotal:       parseFloat(f.valorTotal),
                proveedor:        f.proveedor?.razonSocial || 'N/A',
                valorPorPagar:    ultima ? parseFloat(ultima.valorPorPagar) : parseFloat(f.valorTotal)
            };
        });

        return res.json({ success: true, facturas: result, total: count, paginaActual: page, totalPaginas: Math.ceil(count / PER_PAGE_FP) });
    } catch (error) {
        console.error('getFacturasPendientesProveedores:', error);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar facturas.' });
    }
};

const getDetalleFacturaPendiente = async (req, res) => {
    const { idFacturaPro } = req.params;
    try {
        const factura = await FacturaProveedores.findOne({
            where: { idFacturaPro },
            include: [{ model: Provedores, as: 'proveedor', attributes: ['razonSocial', 'taxIdSupplier'] }]
        });
        if (!factura) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada.' });

        const abonos = await CuentasPorPagar.findAll({
            where: { idFacturaPro },
            order: [['createdAt', 'ASC']]
        });

        const ultima = abonos.length > 0 ? abonos[abonos.length - 1] : null;

        return res.json({
            success: true,
            factura: {
                idFacturaPro:     factura.idFacturaPro,
                nroFactura:       factura.nroFactura,
                fechaFactura:     factura.fechaFactura,
                fechaVencimiento: factura.fechaVencimiento,
                valorTotal:       parseFloat(factura.valorTotal),
                valorPorPagar:    ultima ? parseFloat(ultima.valorPorPagar) : parseFloat(factura.valorTotal),
                proveedor:        factura.proveedor?.razonSocial || 'N/A',
                nit:              factura.proveedor?.taxIdSupplier || ''
            },
            abonos: abonos.map(a => ({
                fechaAbono:    a.fechaAbono,
                valorAbono:    parseFloat(a.valorAbono),
                valorPorPagar: parseFloat(a.valorPorPagar)
            }))
        });
    } catch (error) {
        console.error('getDetalleFacturaPendiente:', error);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar detalle.' });
    }
};

const registrarAbonoProveedor = async (req, res) => {
    const { idFacturaPro } = req.params;
    const valorAbono = parseFloat(req.body.valorAbono) || 0;

    if (valorAbono <= 0) return res.status(400).json({ success: false, mensaje: 'El valor del abono debe ser mayor a 0.' });

    const t = await db.transaction();
    try {
        const factura = await FacturaProveedores.findOne({ where: { idFacturaPro } });
        if (!factura) { await t.rollback(); return res.status(404).json({ success: false, mensaje: 'Factura no encontrada.' }); }

        const ultima = await CuentasPorPagar.findOne({
            where: { idFacturaPro },
            order: [['createdAt', 'DESC']]
        });
        const valorPorPagarActual = ultima ? parseFloat(ultima.valorPorPagar) : parseFloat(factura.valorTotal);

        if (valorAbono > valorPorPagarActual) {
            await t.rollback();
            return res.status(400).json({ success: false, mensaje: `El abono no puede superar el saldo pendiente.` });
        }

        const nuevoSaldo = valorPorPagarActual - valorAbono;

        const nuevaCuenta = await CuentasPorPagar.create({
            idFacturaPro,
            fechaAbono:    new Date(),
            totalFactura:  parseFloat(factura.valorTotal),
            valorAbono,
            valorPorPagar: nuevoSaldo
        }, { transaction: t });

        if (nuevoSaldo <= 0) await factura.update({ estado: 'Pagada' }, { transaction: t });

        await t.commit();
        return res.json({
            success:          true,
            mensaje:          nuevoSaldo <= 0 ? 'Factura pagada completamente.' : 'Abono registrado correctamente.',
            pagada:           nuevoSaldo <= 0,
            saldoRestante:    nuevoSaldo,
            idCuentaPorPagar: nuevaCuenta.idCuentaPorPagar
        });
    } catch (error) {
        await t.rollback();
        console.error('registrarAbonoProveedor:', error);
        return res.status(500).json({ success: false, mensaje: 'Error al registrar el abono.' });
    }
};

// ─── DOCUMENTOS DE TIENDA ────────────────────────────────────────────────────

const _ALLOWED_DOC_EXTS  = ['jpg', 'jpeg', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
const _ALLOWED_DOC_MIMES = [
    'image/jpeg',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
];
const _MAX_DOC_SIZE = 5 * 1024 * 1024;

const getTiendaDocumentos = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    try {
        const docs = await Documentacion.findAll({
            where: { idPropietario: idPuntoDeVenta, pertenece: 'punto_venta' },
            order: [['createdAt', 'DESC']],
            raw: true
        });
        const r2Base = process.env.R2_PUBLIC_URL;
        const archivos = docs.map(d => ({
            idDocumento:     d.idDocumento,
            nombreDocumento: d.nombreDocumento,
            formato:         d.formato,
            url:             `${r2Base}/${d.keyName}`,
            createdAt:       d.createdAt
        }));
        return res.json({ success: true, archivos });
    } catch (e) {
        console.error('getTiendaDocumentos:', e);
        return res.status(500).json({ success: false });
    }
};

const subirDocumentoTienda = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    const archivos = req.files || [];
    if (!archivos.length) return res.status(400).json({ success: false, mensaje: 'No se recibió ningún archivo.' });

    const tienda = await PuntosDeVenta.findByPk(idPuntoDeVenta);
    if (!tienda) return res.status(404).json({ success: false, mensaje: 'Tienda no encontrada.' });

    const uploadedKeys = [];
    try {
        const docsData = await Promise.all(archivos.map(async (file, idx) => {
            const ext = file.originalname.split('.').pop().toLowerCase();
            if (!_ALLOWED_DOC_EXTS.includes(ext) || !_ALLOWED_DOC_MIMES.includes(file.mimetype))
                throw new Error(`Tipo de archivo no permitido: ${file.originalname}`);
            if (file.size > _MAX_DOC_SIZE)
                throw new Error(`El archivo "${file.originalname}" supera los 5MB.`);

            const safePdv = idPuntoDeVenta.replace(/[^a-zA-Z0-9]/g, '-');
            const r2Key   = `documentacion/tiendas/${safePdv}-${Date.now()}-${idx}.${ext}`;

            await new Upload({
                client: s3Client,
                params: { Bucket: process.env.R2_BUCKET_NAME, Key: r2Key, Body: file.buffer, ContentType: file.mimetype }
            }).done();
            uploadedKeys.push(r2Key);

            return { idPropietario: idPuntoDeVenta, nombreDocumento: file.originalname, keyName: r2Key, formato: ext.toUpperCase(), pertenece: 'punto_venta' };
        }));

        const creados  = await Documentacion.bulkCreate(docsData);
        const r2Base   = process.env.R2_PUBLIC_URL;
        const resultado = creados.map(d => ({
            idDocumento:     d.idDocumento,
            nombreDocumento: d.nombreDocumento,
            formato:         d.formato,
            url:             `${r2Base}/${d.keyName}`
        }));
        return res.json({ success: true, archivos: resultado });

    } catch (e) {
        await Promise.allSettled(uploadedKeys.map(k =>
            s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: k }))
        ));
        console.error('subirDocumentoTienda:', e);
        return res.status(500).json({ success: false, mensaje: e.message || 'Error al subir el archivo.' });
    }
};

const eliminarDocumentoTienda = async (req, res) => {
    const { idDocumento } = req.params;
    try {
        const doc = await Documentacion.findOne({ where: { idDocumento, pertenece: 'punto_venta' } });
        if (!doc) return res.status(404).json({ success: false, mensaje: 'Documento no encontrado.' });
        await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: doc.keyName })).catch(() => {});
        await doc.destroy();
        return res.json({ success: true });
    } catch (e) {
        console.error('eliminarDocumentoTienda:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al eliminar el documento.' });
    }
};

// ── Helper: verifica si req.usuario tiene permiso Tiendas UPDATE+CREATE ─────────
const _tienePermisoTiendas = async (req) => {
    if (req.usuario?.permisos === 'ADMIN') return true;
    const idUsuario = req.usuario?.idUsuario;
    if (!idUsuario) return false;
    const [idsE, idsC] = await Promise.all([
        resolverIds('tiendas', 'administrativo', 'EDIT'),
        resolverIds('tiendas', 'administrativo', 'CREATE')
    ]);
    if (!idsE || !idsC) return false;
    const [pE, pC] = await Promise.all([
        UserPermisos.findOne({ where: { idUsuario, idRecurso: idsE.idRecurso, idAccion: idsE.idAccion }, attributes: ['idPermiso'] }),
        UserPermisos.findOne({ where: { idUsuario, idRecurso: idsC.idRecurso, idAccion: idsC.idAccion }, attributes: ['idPermiso'] })
    ]);
    return !!(pE && pC);
};

// Verifica que un idUsuario tenga permisos administrativos sobre tiendas (ADMIN o EDIT+CREATE)
const _verificarPermisoEmpleadoAdmin = async (idUsuario) => {
    const usuario = await Usuarios.findOne({ where: { idUsuario }, attributes: ['permisos'], raw: true });
    if (!usuario) return false;
    if (usuario.permisos === 'ADMIN') return true;
    const [idsE, idsC] = await Promise.all([
        resolverIds('tiendas', 'administrativo', 'EDIT'),
        resolverIds('tiendas', 'administrativo', 'CREATE')
    ]);
    if (!idsE || !idsC) return false;
    const [pE, pC] = await Promise.all([
        UserPermisos.findOne({ where: { idUsuario, idRecurso: idsE.idRecurso, idAccion: idsE.idAccion }, attributes: ['idPermiso'] }),
        UserPermisos.findOne({ where: { idUsuario, idRecurso: idsC.idRecurso, idAccion: idsC.idAccion }, attributes: ['idPermiso'] })
    ]);
    return !!(pE && pC);
};

// ── Cajas abiertas (estado != cerrado) de una fecha para admin ───────────────
const getCajasAbiertasPorFecha = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    const { fecha } = req.query;
    try {
        const _hoy = new Date();
        const fechaFiltro = fecha || `${_hoy.getFullYear()}-${String(_hoy.getMonth()+1).padStart(2,'0')}-${String(_hoy.getDate()).padStart(2,'0')}`;
        const inicio = new Date(`${fechaFiltro}T00:00:00`);
        const fin    = new Date(`${fechaFiltro}T23:59:59`);

        // Mismo umbral que dashboardStores en storeControllers
        const maxCajaHours = parseInt(process.env.MAX_CAJA_HOURS) || 0;
        const limiteCaja = new Date();
        if (maxCajaHours > 0) {
            limiteCaja.setTime(limiteCaja.getTime() - maxCajaHours * 60 * 60 * 1000);
        } else {
            limiteCaja.setHours(0, 0, 0, 0);
        }

        const [cajas, tienePermiso] = await Promise.all([
            CajaTienda.findAll({
                where: {
                    idPuntoDeVenta,
                    estado: { [Op.ne]: 'cerrado' },
                    fechaApertura: {
                        [Op.gte]: inicio,
                        [Op.lte]: fin,
                        [Op.lt]:  limiteCaja
                    }
                },
                attributes: ['idCajaTienda', 'codigo', 'fechaApertura', 'estado', 'permite_factura_extemporanea', 'cupo_facturas_extemporaneas'],
                include: [{ model: Empleados, as: 'empleadoApertura', attributes: ['PrimerNombre', 'PrimerApellido'] }],
                order: [['fechaApertura', 'ASC']]
            }),
            _tienePermisoTiendas(req)
        ]);

        return res.json({
            success: true,
            tienePermiso,
            cajas: cajas.map(c => ({
                idCajaTienda:      c.idCajaTienda,
                codigo:            c.codigo || `#${c.idCajaTienda}`,
                fechaApertura:     c.fechaApertura,
                estado:            c.estado,
                tieneExtemporanea: c.permite_factura_extemporanea,
                cupoExtemporanea:  c.cupo_facturas_extemporaneas,
                empleadoApertura:  `${c.empleadoApertura?.PrimerNombre || ''} ${c.empleadoApertura?.PrimerApellido || ''}`.trim()
            }))
        });
    } catch (e) {
        console.error('getCajasAbiertasPorFecha:', e);
        return res.status(500).json({ success: false });
    }
};

// ── Autorizar facturas extemporáneas ──────────────────────────────────────────
const autorizarFacturaExtemporanea = async (req, res) => {
    const { idPuntoDeVenta } = req.params;
    const { idCajaTienda, cantidadFacturas, codigoEmpleado } = req.body;
    try {
        const cantidad = parseInt(cantidadFacturas);
        if (!idCajaTienda || !cantidad || cantidad <= 0)
            return res.status(400).json({ success: false, mensaje: 'Datos inválidos.' });
        if (!String(codigoEmpleado || '').trim())
            return res.status(400).json({ success: false, mensaje: 'Código de empleado requerido.' });

        if (!(await _tienePermisoTiendas(req)))
            return res.status(403).json({ success: false, mensaje: 'Sin permiso para autorizar facturas extemporáneas.' });

        // Buscar empleado por código (sin restricción de tienda)
        const empleado = await Empleados.findOne({
            where: { codigoEmpleado: String(codigoEmpleado).trim().toUpperCase() },
            attributes: ['idEmpleado', 'idUsuario']
        });
        if (!empleado)
            return res.status(400).json({ success: false, mensaje: 'Código de empleado no válido.' });

        if (!empleado.idUsuario)
            return res.status(403).json({ success: false, mensaje: 'El empleado no tiene usuario vinculado.' });

        if (!(await _verificarPermisoEmpleadoAdmin(empleado.idUsuario)))
            return res.status(403).json({ success: false, mensaje: 'El empleado no tiene permisos administrativos sobre tiendas.' });

        const caja = await CajaTienda.findOne({
            where: { idCajaTienda, idPuntoDeVenta, estado: { [Op.ne]: 'cerrado' } }
        });
        if (!caja)
            return res.status(404).json({ success: false, mensaje: 'Caja no encontrada o ya cerrada.' });

        await caja.update({ permite_factura_extemporanea: true, cupo_facturas_extemporaneas: cantidad });

        return res.json({ success: true });
    } catch (e) {
        console.error('autorizarFacturaExtemporanea:', e);
        return res.status(500).json({ success: false, mensaje: 'Error interno.' });
    }
};

export {
    dashboard,
    dashboardStores,
    newStore, // [DELETE?]
    saveStoreBasic,
    verTienda,
    destrabarCuadreTienda,
    editarTienda,
    postNuevaTienda,
    dashboardInventorys,
    billingToday,
    storeInventory,
    storeEmployers,
    storeDocuments,
    saveProduct, editarProducto, listaProductos, verProducto, stockTotalProducto, unidadesVendidasProducto, diasInventarioProducto, stockPorTiendaProducto, ventasHistoricoProducto, ventasPorTiendaProducto, newProduct, trasladarProductoAdmin,
    batchBuyOrder, saveBatchOrder,
    dosificar,
    dashboardSupplier,
    newSupplier,
    verProveedor, actualizarProveedor,
    saveSupplier, checkNitSupplier,
    dashboardCustomers, newCliente, saveCliente, editarClienteForm, updateCliente, checkDocumentoCliente, getClientesStats, filterClientesListJson, getClientePerfil, getClienteHistorial, getClienteArchivos, eliminarDocumentoCliente, activarCreditoCliente,
    dashboardEmployees, newEmployer, saveEmployee, checkDocumentoPersonal, checkEmailPersonal, filterEmployeeListJson, buscarEmpleadoPorCodigo,

    dashboardOrders,
    dashboardSettings,
    municipiosJson,
    categoriasJson,
    skuJson,
    eanJson,
    familiaSugerenciasJson,
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
    getFacturasJSON, exportarFacturasTienda,
    getCajasAbiertasPorFecha,
    autorizarFacturaExtemporanea,
    jsonPermisosRecursos,
    jsonPermisosAcciones,
    verEmpleado, actualizarEmpleado, eliminarDocumentoEmpleado, cambiarEstadoEmpleado,
    getPagosHoyPorMetodo,
    listarEntidades, crearEntidad, crearCajaBanco, getCajaBancoEditar, editarCajaBanco, verPerfilCajaBanco, decidirTrasladoEfectivo, validarEmpleadoBancos, getTrasladoPDFAdmin, getMovimientosCuentaJSON, crearMovimientoCuenta, exportarMovimientosCuenta, toggleEntidad, verDetallesEntidad, editarEntidad, getTransaccionesEntidad,
    getStatsVendedorMes,
    getCajasCerradasAdmin,
    getAdminCuadrePDF,
    storeCierresCaja,
    storeTrasladosTienda,
    getCierresCajaListaJSON,
    getCierreCajaDatosJSON,
    getCierreFacturasJSON,
    getCierreEgresosJSON,
    getTrasladosTiendaJSON,
    getStockBajoGlobal,
    getStockBajoPorTienda,
    getVentasPdv30d,
    getCarteraUrgente,
    getFacturasPendientesProveedores, getDetalleFacturaPendiente, registrarAbonoProveedor, getTirillaAbonoProveedor,
    getTiendaDocumentos, subirDocumentoTienda, eliminarDocumentoTienda,
}