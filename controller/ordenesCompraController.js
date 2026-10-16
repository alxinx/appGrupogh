import { Op, UniqueConstraintError } from 'sequelize';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import PDFDocument from 'pdfkit';
import db from '../config/bd.js';
import {
    OrdenesCompra, DetallesOrdenCompra, OrdenesCompraHistorial, Provedores, CategoriasDeProvedores,
    Departamentos, Municipios, Atributos
} from '../models/index.js';
import { crearConCodigo } from '../helpers/secuencias.js';
import { money } from '../helpers/formatMoney.js';
import {
    TIPOS_ORDEN, ESTADOS_ORDEN, IVA_PORCENTAJE_DEFECTO, UNIDAD_ETIQUETA_CORTA, coloresSimplesDisponibles, materialesDisponibles,
    validarLineaOrden, calcularTotalesOrden, validarCabeceraOrden, validarColorNuevo,
    validarEdicionOrden, permiteEditarLineasOrden, permiteRecibirOrden, validarRecepcionOrden, registrarMovimientoOrden
} from '../helpers/ordenesCompra.js';

const SECUENCIA_ORDEN = 'orden_compra_insumo';
const PREFIJO_ORDEN = 'OC-';
const __dirname_ordenes = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH_ORDENES = path.resolve(__dirname_ordenes, '../public/img/logo.png');

// Resuelve ciudad/departamento (códigos DIVIPOLA en PROVEDORES, CLAUDE.md §6) de VARIAS
// filas de una sola vez — dos consultas con Op.in, nunca un findOne por proveedor dentro
// de un map/forEach (CLAUDE.md §7, prevención de N+1).
const resolverUbicacionesProveedores = async (proveedores) => {
    const idsCiudad = [...new Set(proveedores.map(p => p.ciudad).filter(Boolean))];
    const idsDepto   = [...new Set(proveedores.map(p => p.departamento).filter(Boolean))];
    const [municipios, departamentos] = await Promise.all([
        idsCiudad.length ? Municipios.findAll({ where: { id: { [Op.in]: idsCiudad } }, attributes: ['id', 'nombre'], raw: true }) : [],
        idsDepto.length  ? Departamentos.findAll({ where: { id: { [Op.in]: idsDepto } }, attributes: ['id', 'nombre'], raw: true }) : []
    ]);
    const mapaMunicipios   = new Map(municipios.map(m => [m.id, m.nombre]));
    const mapaDepartamentos = new Map(departamentos.map(d => [d.id, d.nombre]));
    return { mapaMunicipios, mapaDepartamentos };
};

// Una sola función para "Enviada" en vez de repetir ESTADOS_ORDEN.find(...) en el PDF, el
// resumen de edición y el historial de movimientos.
const etiquetaEstado = (valor) => ESTADOS_ORDEN.find(e => e.valor === valor)?.etiqueta || valor;

// Ícono de cada fila del historial de movimientos (ordenCompraDetalle.pug) — solo estética,
// el texto real es `resumen`.
const ICONO_ACCION_HISTORIAL = {
    creacion:   'fi-rr-plus',
    edicion:    'fi-rr-edit',
    conversion: 'fi-rr-exchange',
    recepcion:  'fi-rr-box-check'
};

const inicialesProveedor = (nombre) =>
    String(nombre || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '—';

// Años/meses desde createdAt — lo único "real" que se puede mostrar hoy del historial de
// un proveedor (no hay calificación ni % de cumplimiento en ningún lado de la base de
// datos: inventarlos para un proveedor REAL, con nombre real, sería al revés del criterio
// de helpers/insumos.js —ahí el relleno es para proveedores FICTICIOS—, así que acá
// simplemente no se muestran).
const antiguedadDesde = (fecha) => {
    const meses = Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
    if (meses < 1) return 'Nuevo este mes';
    if (meses < 12) return `${meses} mes${meses === 1 ? '' : 'es'}`;
    const anios = Math.floor(meses / 12);
    return `${anios} año${anios === 1 ? '' : 's'}`;
};

const presentarProveedorPicker = (p, mapaMunicipios, mapaDepartamentos) => ({
    idProveedor:    p.idProveedor,
    razonSocial:    p.razonSocial,
    iniciales:      inicialesProveedor(p.razonSocial),
    tipoDocumento:  p.tipoDocumento,
    documento:      p.taxIdSupplier,
    nombreContacto: p.nombreContacto,
    telefono:       p.telefonoContacto || p.telefonoProvedor || null,
    correo:         p.emailProvedor,
    ciudad:         mapaMunicipios.get(p.ciudad) || null,
    departamento:   mapaDepartamentos.get(p.departamento) || null,
    activo:         Boolean(p.estado),
    antiguedad:     antiguedadDesde(p.createdAt),
    categorias:     (p.categorias || []).map(c => c.nombre)
});

// GET /admin/insumos/compra — pantalla de armado de la orden. El proveedor NO llega
// precargado (se busca en vivo, ver buscarProveedoresOrden); colores y materiales sí,
// porque son catálogos chicos que ya se traen completos en el resto del módulo
// (helpers/insumos.js, mismo criterio que homeInsumos).
const homeOrdenCompra = async (req, res) => {
    try {
        const [colores, materiales] = await Promise.all([
            coloresSimplesDisponibles(),
            materialesDisponibles()
        ]);
        return res.render('./administrador/produccion/ordenCompra', {
            pagina: 'Insumos',
            subPagina: 'Compra de insumos',
            csrfToken: req.csrfToken(),
            currentPath: '/insumos',
            titulo: 'Compra de insumos',
            subtitulo: 'Gestiona las compras de insumos y materias primas a tus proveedores.',
            icono: 'fi-rr-shopping-bag',
            tiposOrden: TIPOS_ORDEN,
            ivaPorcentaje: IVA_PORCENTAJE_DEFECTO,
            colores,
            materiales
        });
    } catch (e) {
        console.error('ordenesCompraController(home):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

// GET /admin/insumos/compra/proveedores?q=... — picker con búsqueda en vivo. Resultados
// reales de PROVEDORES (no hay una tabla aparte para esto, CLAUDE.md §3): mismo criterio
// de búsqueda que filterSupplierListJson (razón social / NIT / contacto), pero acá se
// recorta a unos pocos resultados para un desplegable, no una tabla paginada.
const LIMITE_RESULTADOS_PICKER = 8;
const buscarProveedoresOrden = async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, proveedores: [] });

    try {
        const proveedores = await Provedores.findAll({
            where: {
                [Op.or]: [
                    { razonSocial: { [Op.like]: `%${q}%` } },
                    { taxIdSupplier: { [Op.like]: `%${q}%` } },
                    { nombreContacto: { [Op.like]: `%${q}%` } }
                ]
            },
            include: [{ model: CategoriasDeProvedores, as: 'categorias', attributes: ['nombre'], through: { attributes: [] } }],
            order: [['razonSocial', 'ASC']],
            limit: LIMITE_RESULTADOS_PICKER
        });

        const { mapaMunicipios, mapaDepartamentos } = await resolverUbicacionesProveedores(proveedores);
        return res.json({
            success: true,
            proveedores: proveedores.map(p => presentarProveedorPicker(p, mapaMunicipios, mapaDepartamentos))
        });
    } catch (e) {
        console.error('ordenesCompraController(buscarProveedores):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo buscar proveedores.' });
    }
};

// GET /admin/insumos/compra/proveedores/:idProveedor — tarjeta completa al seleccionar uno
// del picker, más su historial real de órdenes (la tabla recién existe: para un proveedor
// nuevo sale vacío, y es lo correcto — no se inventa nada acá).
const HISTORIAL_ORDENES_LIMITE = 5;
const verProveedorOrden = async (req, res) => {
    try {
        const proveedor = await Provedores.findOne({
            where: { idProveedor: req.params.idProveedor },
            include: [{ model: CategoriasDeProvedores, as: 'categorias', attributes: ['nombre'], through: { attributes: [] } }]
        });
        if (!proveedor) return res.status(404).json({ success: false, mensaje: 'Ese proveedor no existe.' });

        const { mapaMunicipios, mapaDepartamentos } = await resolverUbicacionesProveedores([proveedor]);

        const ordenes = await OrdenesCompra.findAll({
            where: { idProveedor: proveedor.idProveedor },
            attributes: ['idOrdenCompra', 'numeroOrden', 'estado', 'total', 'createdAt'],
            order: [['createdAt', 'DESC']],
            limit: HISTORIAL_ORDENES_LIMITE,
            raw: true
        });

        // Conteo de líneas por orden en una sola consulta agrupada — no un COUNT por cada
        // orden dentro de un map (CLAUDE.md §7).
        const idsOrdenes = ordenes.map(o => o.idOrdenCompra);
        const conteos = idsOrdenes.length
            ? await DetallesOrdenCompra.findAll({
                where: { idOrdenCompra: { [Op.in]: idsOrdenes } },
                attributes: ['idOrdenCompra', [db.fn('COUNT', db.col('idDetalleOrdenCompra')), 'nItems']],
                group: ['idOrdenCompra'],
                raw: true
            })
            : [];
        const mapaConteos = new Map(conteos.map(c => [c.idOrdenCompra, Number(c.nItems)]));

        return res.json({
            success: true,
            proveedor: presentarProveedorPicker(proveedor, mapaMunicipios, mapaDepartamentos),
            historial: ordenes.map(o => ({
                idOrdenCompra: o.idOrdenCompra,
                numeroOrden: o.numeroOrden,
                estado: o.estado,
                total: Number(o.total),
                fecha: o.createdAt,
                nItems: mapaConteos.get(o.idOrdenCompra) || 0
            }))
        });
    } catch (e) {
        console.error('ordenesCompraController(verProveedor):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo cargar el proveedor.' });
    }
};

// Validación compartida de cabecera + líneas — usada tanto por "Guardar borrador" como por
// "Crear orden de compra" (guardarBorradorOrden / crearOrdenCompra), para no repetir la
// misma pasada de validarCabeceraOrden/validarLineaOrden dos veces.
const validarOrdenCompleta = async (body) => {
    const { errores: erroresCabecera, datos: cabecera } = await validarCabeceraOrden(body);

    const lineasBody = Array.isArray(body.lineas) ? body.lineas : [];
    const erroresLineas = [];
    const lineasValidas = [];
    if (!lineasBody.length) {
        erroresLineas.push({ indice: -1, mensaje: 'Agrega al menos un insumo a la orden.' });
    }
    for (let i = 0; i < lineasBody.length; i++) {
        const { errores, datos } = await validarLineaOrden(lineasBody[i]);
        if (errores) erroresLineas.push({ indice: i, errores });
        else lineasValidas.push(datos);
    }

    const errores = { ...(erroresCabecera || {}), ...(erroresLineas.length ? { lineas: erroresLineas } : {}) };
    if (Object.keys(errores).length) return { errores };
    return { cabecera, lineas: lineasValidas };
};

// Inserta la orden + sus líneas dentro de una sola transacción (CLAUDE.md §9: toda
// operación que cree una factura/orden con su detalle va en `db.transaction`), y deja una
// fila en ORDENES_COMPRA_HISTORIAL por cada orden creada — "todos los movimientos se
// registran" empieza desde el momento en que la orden nace, no solo en sus ediciones.
//
// Una orden de compra es de un solo proveedor; una cotización puede pedirse a varios a la
// vez (cabecera.idProveedores trae más de uno) — acá se crea UNA fila de ORDENES_COMPRA
// por proveedor, cada una con su propio numeroOrden (crearConCodigo, nunca compartido) y
// su propia copia de las líneas. Si hay más de un proveedor, todas quedan unidas por
// idGrupoCotizacion para poder mostrarlas juntas en el historial; si es una sola, va en
// null — no tiene con qué agruparse.
const insertarOrden = async ({ cabecera, lineas, estado, usuario, empleadoAutoriza, transaction }) => {
    // Si el proveedor ya cotizó los valores con IVA incluido, no se suma nada encima —
    // porcentajeIva queda en 0 para ESTA orden (se congela, igual que cualquier otro
    // porcentajeIva del proyecto: no es una tasa global, es la que aplicó esa compra).
    const porcentajeIva = cabecera.ivaIncluido ? 0 : IVA_PORCENTAJE_DEFECTO;
    const { subtotal, valorIva, total } = calcularTotalesOrden(lineas, porcentajeIva);
    const idGrupoCotizacion = cabecera.idProveedores.length > 1 ? randomUUID() : null;
    const etiquetaTipo = cabecera.tipo === 'cotizacion' ? 'cotización' : 'orden de compra';

    const ordenes = [];
    for (const idProveedor of cabecera.idProveedores) {
        const orden = await crearConCodigo(OrdenesCompra, 'numeroOrden', PREFIJO_ORDEN, SECUENCIA_ORDEN, {
            tipo: cabecera.tipo,
            estado,
            idProveedor,
            idGrupoCotizacion,
            origen: 'operador', // la única vía que existe hoy para crear una orden — CLAUDE.md, ver models/OrdenesCompra.js
            fechaOrden: cabecera.fechaOrden,
            fechaEntregaEstimada: cabecera.fechaEntregaEstimada,
            subtotal,
            porcentajeIva,
            valorIva,
            total,
            notas: cabecera.notas,
            idUsuarioCrea: usuario.idUsuario,
            idEmpleadoAutoriza: empleadoAutoriza?.idEmpleado ?? null,
            empleadoAutorizaNombre: empleadoAutoriza?.nombre ?? null,
            empleadoAutorizaCodigo: empleadoAutoriza?.codigoEmpleado ?? null
        }, transaction);

        await DetallesOrdenCompra.bulkCreate(
            lineas.map(l => ({ ...l, idOrdenCompra: orden.idOrdenCompra })),
            { transaction }
        );

        await registrarMovimientoOrden({
            idOrdenCompra: orden.idOrdenCompra,
            accion: 'creacion',
            resumen: estado === 'borrador'
                ? `Guardó el borrador con ${lineas.length} insumo${lineas.length === 1 ? '' : 's'} por $${money(total)}.`
                : `Creó la ${etiquetaTipo} con ${lineas.length} insumo${lineas.length === 1 ? '' : 's'} por $${money(total)}.`,
            usuario,
            empleado: empleadoAutoriza,
            transaction
        });

        ordenes.push(orden);
    }

    return ordenes;
};

// POST /admin/insumos/compra/borrador — "Guardar borrador": no pide código de empleado,
// igual que el alta de un insumo (solo el permiso de sesión, pIns('CREATE') en la ruta).
const guardarBorradorOrden = async (req, res) => {
    const { errores, cabecera, lineas } = await validarOrdenCompleta(req.body);
    if (errores) return res.status(400).json({ success: false, errores, mensaje: 'Revisa los campos marcados.' });

    try {
        const ordenes = await db.transaction(async (transaction) =>
            insertarOrden({ cabecera, lineas, estado: 'borrador', usuario: req.usuario, empleadoAutoriza: null, transaction })
        );
        return res.json({
            success: true,
            mensaje: ordenes.length > 1 ? `${ordenes.length} borradores guardados.` : 'Borrador guardado.',
            ordenes: ordenes.map(o => ({ idOrdenCompra: o.idOrdenCompra, numeroOrden: o.numeroOrden }))
        });
    } catch (e) {
        console.error('ordenesCompraController(borrador):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar el borrador. Intenta de nuevo.' });
    }
};

// POST /admin/insumos/compra — "Crear orden de compra". Llega detrás de
// verificarCodigoEmpleadoAdmin + verificarPermisoEmpleado (routes/adminRoutes.js, mismo
// candado que editar/suspender un insumo): el código de empleado es imperativo para pasar
// de borrador a una orden formal.
const crearOrdenCompra = async (req, res) => {
    const { errores, cabecera, lineas } = await validarOrdenCompleta(req.body);
    if (errores) return res.status(400).json({ success: false, errores, mensaje: 'Revisa los campos marcados.' });

    try {
        const ordenes = await db.transaction(async (transaction) =>
            insertarOrden({
                cabecera, lineas, estado: 'enviada',
                usuario: req.usuario,
                empleadoAutoriza: req.empleadoVerificado,
                transaction
            })
        );
        return res.json({
            success: true,
            mensaje: ordenes.length > 1 ? `${ordenes.length} cotizaciones creadas.` : 'Orden de compra creada.',
            ordenes: ordenes.map(o => ({ idOrdenCompra: o.idOrdenCompra, numeroOrden: o.numeroOrden }))
        });
    } catch (e) {
        console.error('ordenesCompraController(crear):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo crear la orden. Intenta de nuevo.' });
    }
};

// POST /admin/insumos/compra/colores — alta de un color SIMPLE nuevo desde la caja de
// colores de "Agregar insumo", cuando el que hace falta no está en el catálogo. Mismo
// permiso que el resto del módulo (pIns('CREATE') en la ruta): no pide código de empleado,
// es una extensión del catálogo, no un compromiso con un proveedor (igual criterio que el
// alta de un insumo, que tampoco lo pide).
const crearColorSimple = async (req, res) => {
    const { errores, datos } = await validarColorNuevo(req.body);
    if (errores) return res.status(400).json({ success: false, errores, mensaje: 'Revisa los campos marcados.' });

    try {
        const color = await Atributos.create(datos);
        return res.json({ success: true, mensaje: 'Color agregado.', color: { idAtributo: color.idAtributo, valor: color.valor, codigo1: color.codigo1 } });
    } catch (e) {
        if (e instanceof UniqueConstraintError) {
            return res.status(409).json({ success: false, errores: { valor: 'Ese color ya existe.' }, mensaje: 'Revisa los campos marcados.' });
        }
        console.error('ordenesCompraController(crearColor):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo agregar el color. Intenta de nuevo.' });
    }
};

// GET /admin/insumos/compra/historial — "Historial de compras" (submenú de Insumos): toda
// orden/cotización ya creada, real (la tabla la llena homeOrdenCompra; acá solo se lista).
const homeHistorialCompras = async (req, res) => {
    try {
        return res.render('./administrador/produccion/historialCompras', {
            pagina: 'Insumos',
            subPagina: 'Historial de compras',
            csrfToken: req.csrfToken(),
            currentPath: '/insumos',
            titulo: 'Historial de compras',
            subtitulo: 'Órdenes de compra y cotizaciones a proveedores.',
            icono: 'fi-rr-clock-three',
            tiposOrden: TIPOS_ORDEN,
            estadosOrden: ESTADOS_ORDEN
        });
    } catch (e) {
        console.error('ordenesCompraController(homeHistorial):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

// GET /admin/insumos/compra/historial/json — datos del listado, paginados (mismo patrón
// que filterSupplierListJson/supplierList.js: busqueda + filtros + pagina, generarPaginacion
// de src/js/paginador.js en el cliente). ORDER BY con desempate por idOrdenCompra —
// createdAt solo no alcanza cuando una cotización crea varias filas en la misma
// transacción, prácticamente en el mismo instante (CLAUDE.md §8, orden total).
const LIMITE_HISTORIAL_PAGINA = 15;
const historialComprasJson = async (req, res) => {
    try {
        const { busqueda, estado, tipo, pagina = 1 } = req.query;
        const limit = LIMITE_HISTORIAL_PAGINA;
        const paginaNum = Math.max(1, parseInt(pagina, 10) || 1);
        const offset = (paginaNum - 1) * limit;

        const where = {};
        if (estado && ESTADOS_ORDEN.some(e => e.valor === estado)) where.estado = estado;
        if (tipo && TIPOS_ORDEN.some(t => t.valor === tipo)) where.tipo = tipo;
        if (busqueda) {
            where[Op.or] = [
                { numeroOrden: { [Op.like]: `%${busqueda}%` } },
                { '$proveedor.razonSocial$': { [Op.like]: `%${busqueda}%` } }
            ];
        }

        const { count, rows } = await OrdenesCompra.findAndCountAll({
            where,
            include: [{ model: Provedores, as: 'proveedor', attributes: ['razonSocial'], required: false }],
            attributes: ['idOrdenCompra', 'numeroOrden', 'tipo', 'estado', 'total', 'origen', 'idGrupoCotizacion', 'empleadoAutorizaNombre', 'createdAt'],
            order: [['createdAt', 'DESC'], ['idOrdenCompra', 'DESC']],
            limit, offset,
            distinct: true
        });

        // Conteo de líneas por orden en una sola consulta agrupada, no un COUNT por cada
        // fila dentro de un map (CLAUDE.md §7).
        const idsOrdenes = rows.map(o => o.idOrdenCompra);
        const conteos = idsOrdenes.length
            ? await DetallesOrdenCompra.findAll({
                where: { idOrdenCompra: { [Op.in]: idsOrdenes } },
                attributes: ['idOrdenCompra', [db.fn('COUNT', db.col('idDetalleOrdenCompra')), 'nItems']],
                group: ['idOrdenCompra'],
                raw: true
            })
            : [];
        const mapaConteos = new Map(conteos.map(c => [c.idOrdenCompra, Number(c.nItems)]));

        return res.json({
            success: true,
            ordenes: rows.map(o => ({
                idOrdenCompra: o.idOrdenCompra,
                numeroOrden: o.numeroOrden,
                tipo: o.tipo,
                estado: o.estado,
                total: Number(o.total),
                // 'operador' siempre hoy (no existe todavía ningún proceso automático que
                // cree órdenes) — la columna es real, no relleno, ver models/OrdenesCompra.js.
                origen: o.origen,
                proveedor: o.proveedor?.razonSocial || '—',
                autorizadoPor: o.empleadoAutorizaNombre,
                esCotizacionGrupo: Boolean(o.idGrupoCotizacion),
                fecha: o.createdAt,
                nItems: mapaConteos.get(o.idOrdenCompra) || 0
            })),
            totalPaginas: Math.max(1, Math.ceil(count / limit)),
            paginaActual: paginaNum,
            totalRegistros: count
        });
    } catch (e) {
        console.error('ordenesCompraController(historialJson):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo cargar el historial.' });
    }
};

// Trae una orden con todo lo que su detalle/PDF necesita en una sola consulta (proveedor +
// categorías + líneas + el color real de cada línea) — nunca un findOne por línea dentro de
// un map (CLAUDE.md §7).
const cargarOrdenParaDetalle = (idOrdenCompra) => OrdenesCompra.findOne({
    where: { idOrdenCompra },
    include: [
        { model: Provedores, as: 'proveedor', include: [{ model: CategoriasDeProvedores, as: 'categorias', attributes: ['nombre'], through: { attributes: [] } }] },
        {
            model: DetallesOrdenCompra, as: 'detalles',
            include: [{ model: Atributos, as: 'color', attributes: ['idAtributo', 'valor', 'codigo1'] }]
        }
    ],
    order: [[{ model: DetallesOrdenCompra, as: 'detalles' }, 'idDetalleOrdenCompra', 'ASC']]
});

// GET /admin/insumos/compra/:idOrdenCompra — detalle de una orden/cotización ya creada:
// cambiar su estado, notas y fecha estimada de entrega (cualquier tipo y estado, sin un
// flujo forzado — el operador decide la transición), y agregar/quitar insumos SOLO si
// permiteEditarLineasOrden lo permite (helpers/ordenesCompra.js: cotización que no llegó a
// un estado terminal). El proveedor nunca se toca acá — cambiar a quién se le compró es
// una orden distinta, no una edición.
const verOrdenCompra = async (req, res) => {
    try {
        const orden = await cargarOrdenParaDetalle(req.params.idOrdenCompra);
        if (!orden) return res.status(404).send('Esa orden no existe.');

        const { mapaMunicipios, mapaDepartamentos } = await resolverUbicacionesProveedores([orden.proveedor]);
        const proveedor = presentarProveedorPicker(orden.proveedor, mapaMunicipios, mapaDepartamentos);

        // idMaterial e idAtributoColor viajan además de nombreMaterial/colorNombre: son los
        // que necesita el modal de edición (src/js/ordenCompraDetalle.js) para reseleccionar
        // el insumo y el color exactos al editar una línea existente. cantidadRecibida es
        // null hasta que se confirma la recepción de esa línea (ver "Recibir orden").
        const lineas = orden.detalles.map(d => ({
            idDetalleOrdenCompra: d.idDetalleOrdenCompra,
            idMaterial: d.idMaterial,
            nombreMaterial: d.nombreMaterial,
            codigoMaterialDxf: d.codigoMaterialDxf,
            cantidad: Number(d.cantidad),
            unidadCompra: d.unidadCompra,
            valorUnitario: Number(d.valorUnitario),
            valorTotal: Number(d.valorTotal),
            idAtributoColor: d.idAtributoColor,
            colorNombre: d.color?.valor || null,
            colorHex: d.color?.codigo1 || null,
            caracteristicas: d.caracteristicas || {},
            cantidadRecibida: d.cantidadRecibida === null ? null : Number(d.cantidadRecibida)
        }));

        // Las demás órdenes de la misma cotización, si la hubo (idGrupoCotizacion) — para
        // no tener que ir al historial a ver a quién más se le pidió lo mismo.
        let hermanas = [];
        if (orden.idGrupoCotizacion) {
            const filas = await OrdenesCompra.findAll({
                where: { idGrupoCotizacion: orden.idGrupoCotizacion, idOrdenCompra: { [Op.ne]: orden.idOrdenCompra } },
                include: [{ model: Provedores, as: 'proveedor', attributes: ['razonSocial'] }],
                attributes: ['idOrdenCompra', 'numeroOrden', 'estado', 'total'],
                order: [['numeroOrden', 'ASC']]
            });
            hermanas = filas.map(h => ({
                idOrdenCompra: h.idOrdenCompra, numeroOrden: h.numeroOrden, estado: h.estado,
                total: Number(h.total), proveedor: h.proveedor?.razonSocial || '—'
            }));
        }

        const permiteLineas = permiteEditarLineasOrden(orden);
        const [colores, materiales] = permiteLineas
            ? await Promise.all([coloresSimplesDisponibles(), materialesDisponibles()])
            : [[], []];

        // Bitácora completa de la orden — quién hizo qué y cuándo (CLAUDE.md, append-only,
        // igual criterio que PEDIDOS_WEB_HISTORIAL_ESTADO). Más reciente primero.
        const movimientos = await OrdenesCompraHistorial.findAll({
            where: { idOrdenCompra: orden.idOrdenCompra },
            order: [['createdAt', 'DESC'], ['idHistorial', 'DESC']]
        });
        const historial = movimientos.map(h => ({
            accion: h.accion,
            icono: ICONO_ACCION_HISTORIAL[h.accion] || 'fi-rr-info',
            resumen: h.resumen,
            // El empleado que autorizó con su código, si lo hubo; si no (ej. "Guardar
            // borrador", que no lo pide), queda el nombre de quien tenía la sesión — nunca
            // el código, en ningún caso (CLAUDE.md §6).
            quien: h.empleadoNombre || h.usuarioNombre,
            fecha: new Date(h.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' })
        }));

        return res.render('./administrador/produccion/ordenCompraDetalle', {
            pagina: 'Insumos',
            subPagina: 'Compra de insumos',
            csrfToken: req.csrfToken(),
            currentPath: '/insumos',
            titulo: orden.numeroOrden,
            subtitulo: TIPOS_ORDEN.find(t => t.valor === orden.tipo)?.etiqueta || orden.tipo,
            icono: 'fi-rr-file-invoice',
            orden: {
                idOrdenCompra: orden.idOrdenCompra,
                numeroOrden: orden.numeroOrden,
                tipo: orden.tipo,
                estado: orden.estado,
                fechaOrden: orden.fechaOrden,
                fechaEntregaEstimada: orden.fechaEntregaEstimada,
                notas: orden.notas,
                subtotal: Number(orden.subtotal),
                porcentajeIva: Number(orden.porcentajeIva),
                valorIva: Number(orden.valorIva),
                total: Number(orden.total),
                origen: orden.origen,
                // Solo el nombre llega a la vista — el código de empleado es una
                // credencial y nunca se imprime salvo que lo pidan explícitamente
                // (mismo criterio que el historial de precios, CLAUDE.md §6).
                empleadoAutorizaNombre: orden.empleadoAutorizaNombre,
                createdAt: orden.createdAt
            },
            proveedor,
            lineas,
            hermanas,
            historial,
            permiteEditarLineas: permiteLineas,
            permiteRecibir: permiteRecibirOrden(orden),
            tiposOrden: TIPOS_ORDEN,
            estadosOrden: ESTADOS_ORDEN,
            colores,
            materiales
        });
    } catch (e) {
        console.error('ordenesCompraController(verOrden):', e);
        return res.status(500).send('No se pudo cargar la orden.');
    }
};

// POST /admin/insumos/compra/:idOrdenCompra — "Guardar cambios": estado + notas + fecha
// estimada de entrega, y (si permiteEditarLineasOrden) insumos agregados/quitados, todo en
// una sola acción. Llega detrás de verificarCodigoEmpleadoAdmin + verificarPermisoEmpleado
// (routes/adminRoutes.js, mismo candado que editar un insumo): el código de empleado es
// imperativo para tocar una orden ya creada, igual que para crearla.
const guardarEdicionOrden = async (req, res) => {
    try {
        const ordenActual = await OrdenesCompra.findOne({
            where: { idOrdenCompra: req.params.idOrdenCompra },
            include: [{ model: DetallesOrdenCompra, as: 'detalles', attributes: ['idDetalleOrdenCompra'] }]
        });
        if (!ordenActual) return res.status(404).json({ success: false, mensaje: 'Esa orden no existe.' });

        const idsLineasActuales = ordenActual.detalles.map(d => d.idDetalleOrdenCompra);
        const { errores, datos } = await validarEdicionOrden(req.body, {
            tipo: ordenActual.tipo,
            estado: ordenActual.estado,
            fechaOrden: ordenActual.fechaOrden,
            idsLineasActuales
        });
        if (errores) return res.status(400).json({ success: false, errores, mensaje: 'Revisa los campos marcados.' });

        const totalFinal = idsLineasActuales.length - datos.idsLineasEliminar.length + datos.lineasNuevas.length;
        if (datos.permiteLineas && totalFinal <= 0) {
            return res.status(400).json({ success: false, mensaje: 'La orden no puede quedar sin insumos — agrega al menos uno antes de quitar los demás.' });
        }

        const estadoAnterior = ordenActual.estado;
        let totales;
        try {
            await db.transaction(async (transaction) => {
                if (datos.idsLineasEliminar.length) {
                    await DetallesOrdenCompra.destroy({
                        where: { idDetalleOrdenCompra: { [Op.in]: datos.idsLineasEliminar }, idOrdenCompra: ordenActual.idOrdenCompra },
                        transaction
                    });
                }
                if (datos.lineasNuevas.length) {
                    await DetallesOrdenCompra.bulkCreate(
                        datos.lineasNuevas.map(l => ({ ...l, idOrdenCompra: ordenActual.idOrdenCompra })),
                        { transaction }
                    );
                }

                // Totales recalculados sobre lo que de verdad quedó en la base, no sobre lo
                // que mandó el navegador — misma garantía que cualquier total de factura.
                const lineasVigentes = await DetallesOrdenCompra.findAll({
                    where: { idOrdenCompra: ordenActual.idOrdenCompra },
                    attributes: ['valorTotal'],
                    transaction, raw: true
                });
                totales = calcularTotalesOrden(
                    lineasVigentes.map(l => ({ valorTotal: Number(l.valorTotal) })),
                    ordenActual.porcentajeIva
                );

                // Condicional al estado leído al abrir la pantalla (CLAUDE.md §9): si otra
                // pestaña ya la cambió mientras tanto, esta escritura no la pisa en silencio.
                const [filas] = await OrdenesCompra.update({
                    estado: datos.estado,
                    notas: datos.notas,
                    fechaEntregaEstimada: datos.fechaEntregaEstimada,
                    subtotal: totales.subtotal,
                    valorIva: totales.valorIva,
                    total: totales.total
                }, {
                    where: { idOrdenCompra: ordenActual.idOrdenCompra, estado: estadoAnterior },
                    transaction
                });
                if (!filas) throw new Error('CONFLICTO_CONCURRENCIA');

                // Resumen de lo que de verdad cambió — solo las partes que cambiaron, no una
                // foto completa de "antes/después" de todo el formulario.
                const partes = [];
                if (datos.estado !== estadoAnterior) {
                    partes.push(`Cambió el estado de ${etiquetaEstado(estadoAnterior)} a ${etiquetaEstado(datos.estado)}.`);
                }
                if (datos.notas !== (ordenActual.notas || null)) partes.push('Actualizó las notas.');
                if (datos.fechaEntregaEstimada !== (ordenActual.fechaEntregaEstimada || null)) partes.push('Actualizó la fecha estimada de entrega.');
                if (datos.idsLineasEliminar.length) partes.push(`Quitó ${datos.idsLineasEliminar.length} insumo${datos.idsLineasEliminar.length === 1 ? '' : 's'}.`);
                if (datos.lineasNuevas.length) partes.push(`Agregó ${datos.lineasNuevas.length} insumo${datos.lineasNuevas.length === 1 ? '' : 's'}.`);

                await registrarMovimientoOrden({
                    idOrdenCompra: ordenActual.idOrdenCompra,
                    accion: 'edicion',
                    resumen: partes.length ? partes.join(' ') : 'Guardó cambios sin modificar nada.',
                    usuario: req.usuario,
                    empleado: req.empleadoVerificado,
                    transaction
                });
            });
        } catch (e) {
            if (e.message === 'CONFLICTO_CONCURRENCIA') {
                return res.status(409).json({ success: false, mensaje: 'La orden cambió mientras tanto en otra pestaña — recarga antes de guardar.' });
            }
            throw e;
        }

        return res.json({ success: true, mensaje: 'Cambios guardados.', estado: datos.estado, ...totales });
    } catch (e) {
        console.error('ordenesCompraController(guardarEdicion):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar. Intenta de nuevo.' });
    }
};

// POST /admin/insumos/compra/:idOrdenCompra/convertir — "Convertir a orden de compra": pasa
// una cotización (tipo='cotizacion') a orden de compra formal. Es una acción propia, no un
// campo más de "Guardar cambios" — tiene su propio botón y su propio modal de confirmación
// con código de empleado (mismo candado que el resto de la edición, routes/adminRoutes.js),
// porque convertir una cotización compromete con el proveedor igual que crearla de cero.
//
// Solo toca `tipo`. El estado NO cambia acá — sigue siendo un control aparte en la pantalla,
// para no mezclar dos decisiones en un solo clic. `idGrupoCotizacion` tampoco se limpia: si
// esta fila nació de una cotización a varios proveedores, esa historia sigue siendo real
// después de convertirla (muestra a quién más se le cotizó, aunque se haya terminado
// comprando acá) — nunca se borra, igual criterio que el resto del proyecto.
//
// Mismo candado que agregar/quitar insumos (permiteEditarLineasOrden): no tiene sentido
// convertir una cotización que ya llegó a un estado terminal.
const convertirACompra = async (req, res) => {
    try {
        const orden = await OrdenesCompra.findOne({
            where: { idOrdenCompra: req.params.idOrdenCompra },
            attributes: ['idOrdenCompra', 'tipo', 'estado']
        });
        if (!orden) return res.status(404).json({ success: false, mensaje: 'Esa orden no existe.' });

        if (orden.tipo !== 'cotizacion') {
            return res.status(400).json({ success: false, mensaje: 'Esta orden ya es una orden de compra.' });
        }
        if (!permiteEditarLineasOrden(orden)) {
            return res.status(400).json({ success: false, mensaje: 'Esta cotización ya llegó a un estado final — no se puede convertir.' });
        }

        try {
            await db.transaction(async (transaction) => {
                // Condicional al tipo/estado leídos recién (CLAUDE.md §9): si otra pestaña ya
                // la convirtió o la movió a un estado final mientras tanto, no la pisa.
                const [filas] = await OrdenesCompra.update(
                    { tipo: 'orden_compra' },
                    { where: { idOrdenCompra: orden.idOrdenCompra, tipo: 'cotizacion', estado: orden.estado }, transaction }
                );
                if (!filas) throw new Error('CONFLICTO_CONCURRENCIA');

                await registrarMovimientoOrden({
                    idOrdenCompra: orden.idOrdenCompra,
                    accion: 'conversion',
                    resumen: 'Convirtió la cotización a orden de compra.',
                    usuario: req.usuario,
                    empleado: req.empleadoVerificado,
                    transaction
                });
            });
        } catch (e) {
            if (e.message === 'CONFLICTO_CONCURRENCIA') {
                return res.status(409).json({ success: false, mensaje: 'La orden cambió mientras tanto en otra pestaña — recarga antes de convertirla.' });
            }
            throw e;
        }

        return res.json({ success: true, mensaje: 'Convertida a orden de compra.', tipo: 'orden_compra' });
    } catch (e) {
        console.error('ordenesCompraController(convertir):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo convertir. Intenta de nuevo.' });
    }
};

// POST /admin/insumos/compra/:idOrdenCompra/recibir — "Recibir orden": el operador confirma
// qué y cuánto llegó de cada insumo, línea por línea — puede ser menos, igual o más que lo
// pedido (entrega parcial, completa o con excedente), nunca se asume que llegó completo.
// Deja estado='recibida' y una fila en el historial con el detalle de cada línea. Mismo
// candado que el resto de la edición (verificarCodigoEmpleadoAdmin + verificarPermisoEmpleado,
// routes/adminRoutes.js): confirmar una recepción compromete el inventario tanto como
// crear la orden.
//
// Disponible para cualquier estado salvo 'cancelada' (helpers/ordenesCompra.js,
// permiteRecibirOrden) — incluso para una orden YA 'recibida', para poder corregir una
// cantidad mal anotada sin anular y rehacer toda la orden.
const recibirOrden = async (req, res) => {
    try {
        const ordenActual = await OrdenesCompra.findOne({
            where: { idOrdenCompra: req.params.idOrdenCompra },
            include: [{ model: DetallesOrdenCompra, as: 'detalles' }]
        });
        if (!ordenActual) return res.status(404).json({ success: false, mensaje: 'Esa orden no existe.' });
        if (!permiteRecibirOrden(ordenActual)) {
            return res.status(400).json({ success: false, mensaje: 'No se puede recibir una orden cancelada.' });
        }

        const idsLineasActuales = ordenActual.detalles.map(d => d.idDetalleOrdenCompra);
        const { errores, datos } = validarRecepcionOrden(req.body, idsLineasActuales);
        if (errores) return res.status(400).json({ success: false, errores, mensaje: 'Revisa las cantidades recibidas.' });

        const estadoAnterior = ordenActual.estado;
        try {
            await db.transaction(async (transaction) => {
                const partes = [];
                for (const l of datos.lineas) {
                    await DetallesOrdenCompra.update(
                        { cantidadRecibida: l.cantidadRecibida },
                        { where: { idDetalleOrdenCompra: l.idDetalleOrdenCompra, idOrdenCompra: ordenActual.idOrdenCompra }, transaction }
                    );

                    const linea = ordenActual.detalles.find(d => d.idDetalleOrdenCompra === l.idDetalleOrdenCompra);
                    const unidad = UNIDAD_ETIQUETA_CORTA[linea.unidadCompra] || '';
                    const pedida = Number(linea.cantidad);
                    const diff = l.cantidadRecibida - pedida;
                    const sufijo = diff === 0 ? 'completo' : diff > 0 ? `+${diff} ${unidad}` : `faltan ${Math.abs(diff)} ${unidad}`;
                    partes.push(`${linea.nombreMaterial}: ${l.cantidadRecibida}/${pedida} ${unidad} (${sufijo})`);
                }

                // Condicional al estado leído al abrir la pantalla (CLAUDE.md §9): si otra
                // pestaña ya la cambió mientras tanto, esta escritura no la pisa en silencio.
                const [filas] = await OrdenesCompra.update(
                    { estado: 'recibida' },
                    { where: { idOrdenCompra: ordenActual.idOrdenCompra, estado: estadoAnterior }, transaction }
                );
                if (!filas) throw new Error('CONFLICTO_CONCURRENCIA');

                await registrarMovimientoOrden({
                    idOrdenCompra: ordenActual.idOrdenCompra,
                    accion: 'recepcion',
                    resumen: `Recibió el pedido — ${partes.join('; ')}.`,
                    usuario: req.usuario,
                    empleado: req.empleadoVerificado,
                    transaction
                });
            });
        } catch (e) {
            if (e.message === 'CONFLICTO_CONCURRENCIA') {
                return res.status(409).json({ success: false, mensaje: 'La orden cambió mientras tanto en otra pestaña — recarga antes de confirmar la recepción.' });
            }
            throw e;
        }

        return res.json({ success: true, mensaje: 'Recepción registrada.', estado: 'recibida' });
    } catch (e) {
        console.error('ordenesCompraController(recibir):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo registrar la recepción. Intenta de nuevo.' });
    }
};

// GET /admin/insumos/compra/:idOrdenCompra/pdf — comprobante en PDF de la orden/cotización.
// Mismo patrón A4 que generarInformeCreditoPDF (adminControllers.js): streaming directo con
// doc.pipe(res), nunca acumulado completo en memoria (CLAUDE.md §11). Es solo lectura — no
// pide código de empleado, igual que cualquier otro export del panel.
const pdfOrdenCompra = async (req, res) => {
    try {
        const orden = await cargarOrdenParaDetalle(req.params.idOrdenCompra);
        if (!orden) return res.status(404).send('Esa orden no existe.');

        const { mapaMunicipios, mapaDepartamentos } = await resolverUbicacionesProveedores([orden.proveedor]);
        const proveedor = presentarProveedorPicker(orden.proveedor, mapaMunicipios, mapaDepartamentos);

        const W = 595.28, MARGIN = 40, CW = W - MARGIN * 2;
        const doc = new PDFDocument({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${orden.numeroOrden}.pdf"`);
        doc.pipe(res);

        const pesos = (n) => `$${money(n)}`;
        const etiquetaTipo = TIPOS_ORDEN.find(t => t.valor === orden.tipo)?.etiqueta || orden.tipo;
        const fechaCO = (f) => f ? new Date(f).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) : '—';

        try { doc.image(LOGO_PATH_ORDENES, MARGIN, MARGIN, { width: 48, height: 48 }); } catch { /* sin logo no se rompe el PDF */ }
        doc.font('Helvetica-Bold').fontSize(16).text(etiquetaTipo.toUpperCase(), MARGIN + 60, MARGIN + 4);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#E24C95').text(orden.numeroOrden, MARGIN + 60, MARGIN + 24);
        doc.font('Helvetica').fontSize(9).fillColor('#64748b')
           .text(`Estado: ${etiquetaEstado(orden.estado)} · Generado el ${new Date().toLocaleDateString('es-CO')}`, MARGIN + 60, MARGIN + 40);
        doc.fillColor('#000');
        doc.y = MARGIN + 68;
        doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CW, doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
        doc.moveDown(1);

        // Proveedor y fechas, dos columnas a la misma altura.
        const colY = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).text('Proveedor', MARGIN, colY);
        doc.font('Helvetica').fontSize(9).fillColor('#334155')
           .text(proveedor.razonSocial, MARGIN, colY + 14, { width: CW * 0.55 })
           .text(`${proveedor.tipoDocumento || ''} ${proveedor.documento || ''}`.trim(), MARGIN, doc.y, { width: CW * 0.55 })
           .text([proveedor.ciudad, proveedor.departamento].filter(Boolean).join(', ') || '—', MARGIN, doc.y, { width: CW * 0.55 })
           .text(proveedor.telefono || '—', MARGIN, doc.y, { width: CW * 0.55 })
           .text(proveedor.correo || '—', MARGIN, doc.y, { width: CW * 0.55 });
        doc.fillColor('#000');

        const colX2 = MARGIN + CW * 0.6;
        doc.font('Helvetica-Bold').fontSize(10).text('Fechas', colX2, colY);
        doc.font('Helvetica').fontSize(9).fillColor('#334155')
           .text(`Orden: ${fechaCO(orden.fechaOrden)}`, colX2, colY + 14, { width: CW * 0.4 })
           .text(`Entrega estimada: ${fechaCO(orden.fechaEntregaEstimada)}`, colX2, doc.y, { width: CW * 0.4 });
        doc.fillColor('#000');

        doc.y = Math.max(doc.y, colY + 95);
        doc.moveDown(0.5);

        doc.font('Helvetica-Bold').fontSize(10).text('Insumos', MARGIN, doc.y);
        doc.moveDown(0.3);

        const c1 = CW * 0.32, c2 = CW * 0.18, c3 = CW * 0.17, c4 = CW * 0.17, c5 = CW * 0.16;
        const anchos = [c1, c2, c3, c4, c5];
        const filaTabla = (y, cols, bold = false) => {
            doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
            let x = MARGIN;
            cols.forEach((txt, i) => {
                doc.text(String(txt), x, y, { width: anchos[i], align: i === 0 ? 'left' : 'right' });
                x += anchos[i];
            });
        };

        let y = doc.y;
        filaTabla(y, ['Insumo', 'Color', 'Cantidad', 'Valor unitario', 'Valor total'], true);
        y += 14;
        doc.moveTo(MARGIN, y - 2).lineTo(MARGIN + CW, y - 2).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

        orden.detalles.forEach(d => {
            if (y > 740) { doc.addPage(); y = MARGIN; }
            const cantidadTxt = `${Number(d.cantidad).toLocaleString('es-CO')} ${d.unidadCompra || ''}`.trim();
            filaTabla(y, [d.nombreMaterial, d.color?.valor || '—', cantidadTxt, pesos(d.valorUnitario), pesos(d.valorTotal)]);
            y += 16;
        });
        doc.y = y + 8;

        doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CW, doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
        doc.moveDown(0.6);

        const totalLabelX = MARGIN + CW - 220;
        const filaTotal = (etiqueta, valor, bold = false) => {
            const yFila = doc.y;
            doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9);
            doc.text(etiqueta, totalLabelX, yFila, { width: 110, align: 'left' });
            doc.text(valor, totalLabelX + 110, yFila, { width: 110, align: 'right' });
            doc.y = yFila + (bold ? 16 : 13);
        };
        filaTotal('Subtotal', pesos(orden.subtotal));
        filaTotal(
            Number(orden.porcentajeIva) > 0 ? `IVA (${Number(orden.porcentajeIva)}%)` : 'IVA',
            Number(orden.porcentajeIva) > 0 ? pesos(orden.valorIva) : 'Incluido'
        );
        filaTotal('Total', pesos(orden.total), true);

        if (orden.notas) {
            doc.moveDown(1.2);
            doc.font('Helvetica-Bold').fontSize(9).text('Notas', MARGIN, doc.y);
            doc.font('Helvetica').fontSize(9).fillColor('#334155').text(orden.notas, MARGIN, doc.y, { width: CW });
            doc.fillColor('#000');
        }

        // El código de empleado NUNCA se imprime en ningún comprobante — es una credencial
        // (mismo criterio que el historial de precios del producto, CLAUDE.md §6): solo el
        // nombre identifica a quien autorizó, igual que el resto de la pantalla/historial.
        if (orden.empleadoAutorizaNombre) {
            doc.moveDown(1.2);
            doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
               .text(`Autorizada por ${orden.empleadoAutorizaNombre}`, MARGIN, doc.y);
            doc.fillColor('#000');
        }

        doc.end();
    } catch (e) {
        console.error('ordenesCompraController(pdf):', e);
        if (!res.headersSent) return res.status(500).send('No se pudo generar el PDF.');
        res.end();
    }
};

export {
    homeOrdenCompra, buscarProveedoresOrden, verProveedorOrden, guardarBorradorOrden, crearOrdenCompra, crearColorSimple,
    homeHistorialCompras, historialComprasJson, verOrdenCompra, guardarEdicionOrden, convertirACompra, recibirOrden, pdfOrdenCompra
};
