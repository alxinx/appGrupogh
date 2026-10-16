import { Op } from 'sequelize';
import { Atributos, Material, Provedores, OrdenesCompraHistorial } from '../models/index.js';
import { round2 } from './formatMoney.js';

// Orden de compra de insumos (admin/insumos/compra). Una sola fuente para la validación
// de cabecera y líneas, y para el cálculo de totales — el formulario del navegador valida
// lo mismo para avisar antes (CLAUDE.md §5.3), pero esto es la garantía real.

export const TIPOS_ORDEN = [
    { valor: 'orden_compra', etiqueta: 'Orden de compra' },
    { valor: 'cotizacion',   etiqueta: 'Cotización' }
];

export const IVA_PORCENTAJE_DEFECTO = 19.00;

// Mismo vocabulario que el ENUM de ORDENES_COMPRA.estado (models/OrdenesCompra.js) — una
// sola lista para el filtro del historial (admin/insumos/compra/historial) y cualquier
// otro lugar que necesite mostrar las opciones, en vez de repetir los seis valores sueltos.
export const ESTADOS_ORDEN = [
    { valor: 'borrador',    etiqueta: 'Borrador' },
    { valor: 'enviada',     etiqueta: 'Enviada' },
    { valor: 'confirmada',  etiqueta: 'Confirmada' },
    { valor: 'en_transito', etiqueta: 'En tránsito' },
    { valor: 'recibida',    etiqueta: 'Recibida' },
    { valor: 'cancelada',   etiqueta: 'Cancelada' }
];

// Colores "simples": ATRIBUTOS de tipo COLOR sin un segundo código — un combinado
// (ej. "Blanco + Negro") siempre tiene codigo2 relleno (ver helpers/insumos.js para el
// mismo criterio de "qué es relleno vs. qué es real" en este módulo). Es el único filtro
// de colores simples que existe hoy en el proyecto: el selector de color de un producto
// (views/administrador/inventarios/forms/product.pug) muestra el catálogo completo, sin
// filtrar combinados — acá sí hace falta, porque una orden de compra pide un color de
// verdad, no una combinación que en la práctica compran dos insumos distintos.
export const coloresSimplesDisponibles = () =>
    Atributos.findAll({
        where: { tipo: 'COLOR', codigo2: { [Op.is]: null } },
        attributes: ['idAtributo', 'valor', 'codigo1'],
        order: [['valor', 'ASC']],
        raw: true
    });

// Catálogo de materiales activos para armar una línea de orden — igual criterio que el
// catálogo de Insumos (es chico, se trae completo y se filtra en el navegador; ver
// produccionController.js homeInsumos).
export const materialesDisponibles = () =>
    Material.findAll({
        where: { activo: true },
        attributes: ['idMaterial', 'codigoMaterial', 'nombre', 'tipo', 'unidadCompra'],
        order: [['nombre', 'ASC']],
        raw: true
    });

// Cantidad y valor unitario llegan del navegador con el mismo formato de miles que un
// precio ("1.500" → 1500; ver window.initMoneyInput en src/js/helpers.js, que es el que
// los formatea mientras se escribe) — los dos se parsean igual, de ahí un solo helper. No
// es montoPositivo/montoNoNegativo de helpers/helpers.js porque ésos viven en el dominio de
// pesos colombianos; acá cantidad también pasa por el mismo parseo aunque no sea dinero.
export const enteroPositivo = (valorCrudo) => {
    const texto = String(valorCrudo ?? '').trim();
    if (texto.startsWith('-')) return null;
    const limpio = texto.replace(/[^0-9]/g, '');
    const valor = parseInt(limpio, 10);
    return Number.isFinite(valor) && valor > 0 ? valor : null;
};

// Como `enteroPositivo`, pero admite 0 — al recibir una orden (ver más abajo,
// validarRecepcionOrden), "no llegó nada de este insumo" es una cantidad recibida real y
// válida, a diferencia de la cantidad PEDIDA, que nunca puede ser 0.
export const enteroNoNegativo = (valorCrudo) => {
    const texto = String(valorCrudo ?? '').trim();
    if (texto.startsWith('-')) return null;
    const limpio = texto.replace(/[^0-9]/g, '');
    if (!limpio) return null;
    const valor = parseInt(limpio, 10);
    return Number.isFinite(valor) && valor >= 0 ? valor : null;
};

// Forma corta de la unidad para un texto en línea ("950 kg"), aparte de UNIDADES_COMPRA de
// helpers/insumos.js (que trae la forma larga, "Kilogramo (kg)", para un <select>). Mismo
// mapa que ya usan ordenCompra.js/ordenCompraDetalle.js en el navegador — acá es la única
// copia del lado del servidor (el resumen de una recepción, helpers/ordenesCompra.js).
export const UNIDAD_ETIQUETA_CORTA = { kg: 'kg', metro: 'm', rollo: 'rollos', unidad: 'uds' };

// Valida una línea de la orden contra el catálogo real — nunca confía en nombre/código que
// mande el navegador (whitelist, CLAUDE.md §12): nombreMaterial/codigoMaterialDxf se
// recalculan acá a partir del material real, no se toman del body.
export const validarLineaOrden = async (linea = {}) => {
    const errores = {};

    const idMaterial = String(linea.idMaterial ?? '').trim();
    let material = null;
    if (!idMaterial) {
        errores.idMaterial = 'Elige un insumo.';
    } else {
        material = await Material.findOne({ where: { idMaterial, activo: true } });
        if (!material) errores.idMaterial = 'Ese insumo no existe o está suspendido.';
    }

    const cantidad = enteroPositivo(linea.cantidad);
    if (cantidad === null) errores.cantidad = 'La cantidad debe ser un número mayor a 0.';

    const valorUnitario = enteroPositivo(linea.valorUnitario);
    if (valorUnitario === null) errores.valorUnitario = 'El valor unitario debe ser mayor a 0.';

    let idAtributoColor = null;
    const colorTxt = String(linea.idAtributoColor ?? '').trim();
    if (colorTxt) {
        const color = await Atributos.findOne({ where: { idAtributo: colorTxt, tipo: 'COLOR', codigo2: { [Op.is]: null } } });
        if (!color) errores.idAtributoColor = 'Elige un color simple del catálogo (no uno combinado).';
        else idAtributoColor = color.idAtributo;
    }

    // Lo demás ("Composición", "Ancho"...) es texto libre del usuario: se acepta como un
    // objeto plano de string→string, sin validar su contenido (no hay catálogo detrás).
    let caracteristicas = null;
    if (linea.caracteristicas && typeof linea.caracteristicas === 'object' && !Array.isArray(linea.caracteristicas)) {
        const limpio = Object.entries(linea.caracteristicas)
            .map(([k, v]) => [String(k).trim().slice(0, 40), String(v ?? '').trim().slice(0, 200)])
            .filter(([k, v]) => k && v);
        if (limpio.length) caracteristicas = Object.fromEntries(limpio);
    }

    if (Object.keys(errores).length) return { errores };

    const valorTotal = round2(cantidad * valorUnitario);
    return {
        datos: {
            idMaterial: material.idMaterial,
            nombreMaterial: material.nombre,
            codigoMaterialDxf: material.codigoMaterial,
            cantidad,
            unidadCompra: material.unidadCompra,
            valorUnitario,
            valorTotal,
            idAtributoColor,
            caracteristicas
        }
    };
};

// Suma las líneas ya validadas (ver validarLineaOrden) en los totales de la cabecera.
// round2 en cada paso, nunca al final sobre una suma ya arrastrando error de punto
// flotante — mismo patrón que storeControllers.js (_round2 por línea).
export const calcularTotalesOrden = (lineasValidas, porcentajeIva = IVA_PORCENTAJE_DEFECTO) => {
    const subtotal = round2(lineasValidas.reduce((acc, l) => acc + l.valorTotal, 0));
    const valorIva = round2(subtotal * (Number(porcentajeIva) / 100));
    const total = round2(subtotal + valorIva);
    return { subtotal, valorIva, total };
};

// Cabecera de la orden: proveedor(es), tipo, fechas, notas. El estado y los totales los
// decide el controlador (dependen de si es "guardar borrador" o "crear orden", y de las
// líneas). Async porque valida los proveedores contra la base — nunca confía en qué dice
// el navegador que existe (CLAUDE.md §12).
export const validarCabeceraOrden = async (body = {}) => {
    const errores = {};

    const tipo = String(body.tipo ?? 'orden_compra');
    if (!TIPOS_ORDEN.some(t => t.valor === tipo)) errores.tipo = 'Elige cotización u orden de compra.';

    // Una orden de compra es siempre de UN proveedor; una cotización puede pedirse a
    // varios a la vez (cada uno termina en su propia fila, ver insertarOrden en
    // ordenesCompraController.js) — pero también puede ser a uno solo, eso es válido.
    const idsProveedor = [...new Set(
        (Array.isArray(body.idProveedores) ? body.idProveedores : [])
            .map(id => String(id ?? '').trim())
            .filter(Boolean)
    )];
    if (!idsProveedor.length) {
        errores.idProveedores = 'Selecciona al menos un proveedor registrado.';
    } else if (tipo === 'orden_compra' && idsProveedor.length > 1) {
        errores.idProveedores = 'Una orden de compra es para un solo proveedor — usa "Cotización" para pedir a varios a la vez.';
    } else {
        // Una sola consulta con Op.in para los N proveedores, no un findOne por cada uno
        // dentro de un map (CLAUDE.md §7).
        const encontrados = await Provedores.count({ where: { idProveedor: { [Op.in]: idsProveedor } } });
        if (encontrados !== idsProveedor.length) errores.idProveedores = 'Uno o más proveedores elegidos ya no existen.';
    }

    const fechaOrdenTxt = String(body.fechaOrden ?? '').trim();
    const fechaOrden = fechaOrdenTxt && !Number.isNaN(Date.parse(fechaOrdenTxt)) ? fechaOrdenTxt : null;
    if (!fechaOrden) errores.fechaOrden = 'Escribe la fecha de la orden.';

    let fechaEntregaEstimada = null;
    const fechaEntregaTxt = String(body.fechaEntregaEstimada ?? '').trim();
    if (fechaEntregaTxt) {
        if (Number.isNaN(Date.parse(fechaEntregaTxt))) {
            errores.fechaEntregaEstimada = 'La fecha estimada de entrega no es válida.';
        } else if (fechaOrden && fechaEntregaTxt < fechaOrden) {
            errores.fechaEntregaEstimada = 'La entrega no puede ser antes de la fecha de la orden.';
        } else {
            fechaEntregaEstimada = fechaEntregaTxt;
        }
    }

    const notas = String(body.notas ?? '').trim().slice(0, 1000) || null;

    // Solo un booleano, nunca un porcentaje que mande el navegador (whitelist, CLAUDE.md
    // §12): si el proveedor ya cotizó los valores con IVA incluido, el controlador decide
    // el porcentaje real (0) — acá no se confía en ningún número que llegue del cliente.
    const ivaIncluido = Boolean(body.ivaIncluido);

    if (Object.keys(errores).length) return { errores };
    return { datos: { idProveedores: idsProveedor, tipo, fechaOrden, fechaEntregaEstimada, notas, ivaIncluido } };
};

// Edición de una orden YA creada (admin/insumos/compra/:idOrdenCompra). Estado, notas y
// fecha de entrega estimada se pueden cambiar sin importar el tipo ni el estado actual —
// cualquier transición es válida, el operador decide. Los insumos (agregar, quitar, o
// "editar" una línea — que por dentro es quitar la vieja y agregar la corregida, ver
// src/js/ordenCompraDetalle.js) SOLO se tocan en una cotización que no llegó todavía a un
// estado terminal: una orden de compra formal que hay que corregir se anula
// (estado='cancelada') y se hace otra, no se reescribe — regla del operador, igual
// principio que "un pedido web es inmodificable desde el POS" (CLAUDE.md §5.11): lo que ya
// se comprometió con un proveedor no se edita por detrás.
export const permiteEditarLineasOrden = (orden) =>
    orden.tipo === 'cotizacion' && !['recibida', 'cancelada'].includes(orden.estado);

export const validarEdicionOrden = async (body = {}, ordenActual) => {
    const errores = {};

    const estado = String(body.estado ?? '');
    if (!ESTADOS_ORDEN.some(e => e.valor === estado)) errores.estado = 'Elige un estado válido.';

    const notas = String(body.notas ?? '').trim().slice(0, 1000) || null;

    let fechaEntregaEstimada = null;
    const fechaEntregaTxt = String(body.fechaEntregaEstimada ?? '').trim();
    if (fechaEntregaTxt) {
        if (Number.isNaN(Date.parse(fechaEntregaTxt))) {
            errores.fechaEntregaEstimada = 'La fecha estimada de entrega no es válida.';
        } else if (fechaEntregaTxt < ordenActual.fechaOrden) {
            errores.fechaEntregaEstimada = 'La entrega no puede ser antes de la fecha de la orden.';
        } else {
            fechaEntregaEstimada = fechaEntregaTxt;
        }
    }

    const permiteLineas = permiteEditarLineasOrden(ordenActual);

    const lineasNuevas = [];
    let idsLineasEliminar = [];
    if (permiteLineas) {
        const nuevasBody = Array.isArray(body.lineasNuevas) ? body.lineasNuevas : [];
        const erroresLineas = [];
        for (let i = 0; i < nuevasBody.length; i++) {
            const { errores: errLinea, datos } = await validarLineaOrden(nuevasBody[i]);
            if (errLinea) erroresLineas.push({ indice: i, errores: errLinea });
            else lineasNuevas.push(datos);
        }
        if (erroresLineas.length) errores.lineasNuevas = erroresLineas;

        // Whitelist contra las líneas reales de ESTA orden (CLAUDE.md §12) — un id que no
        // está entre las que ya tiene la orden se ignora en silencio, nunca borra la línea
        // de otra orden.
        idsLineasEliminar = (Array.isArray(body.idsLineasEliminar) ? body.idsLineasEliminar : [])
            .map(id => parseInt(id, 10))
            .filter(id => Number.isInteger(id) && ordenActual.idsLineasActuales.includes(id));
    }

    if (Object.keys(errores).length) return { errores };
    return { datos: { estado, notas, fechaEntregaEstimada, lineasNuevas, idsLineasEliminar, permiteLineas } };
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Alta de un color SIMPLE nuevo en ATRIBUTOS, desde la caja de colores de "Agregar insumo"
// (admin/insumos/compra) — si el que se necesita no está en el catálogo. Siempre
// codigo2=null: esta caja solo maneja colores simples (ver coloresSimplesDisponibles), un
// combinado no se da de alta acá.
export const validarColorNuevo = async (body = {}) => {
    const errores = {};

    const valor = String(body.valor ?? '').trim();
    if (!valor) errores.valor = 'Escribe el nombre del color.';
    else if (valor.length > 100) errores.valor = 'El nombre no puede pasar de 100 caracteres.';

    const codigo1 = String(body.codigo1 ?? '').trim();
    if (!HEX_COLOR.test(codigo1)) errores.codigo1 = 'Elige un color válido.';

    if (Object.keys(errores).length) return { errores };

    // Nombre repetido entre los colores (simples o combinados, da igual): uno nuevo con el
    // mismo nombre que ya existe confundiría el catálogo, aunque el combinado no se use acá.
    const existente = await Atributos.findOne({
        where: { tipo: 'COLOR', valor: { [Op.like]: valor } },
        attributes: ['idAtributo']
    });
    if (existente) return { errores: { valor: `Ya existe un color "${valor}" en el catálogo.` } };

    return { datos: { tipo: 'COLOR', valor, codigo1, codigo2: null } };
};

// ── Recibir una orden (admin/insumos/compra/:idOrdenCompra, "Recibir orden") ────────────
// Lo que de verdad llegó puede diferir de lo pedido (entrega parcial, completa o con
// excedente) — por eso cada línea trae su propia cantidadRecibida editable, nunca se asume
// que llegó exactamente lo pedido. Disponible para cualquier tipo/estado salvo 'cancelada'
// (no tiene sentido recibir algo que se anuló) — y también para una orden que YA está
// 'recibida', para poder corregir una cantidad mal anotada sin tener que anular y rehacer
// toda la orden.
export const permiteRecibirOrden = (orden) => orden.estado !== 'cancelada';

// Whitelist contra las líneas reales de la orden (CLAUDE.md §12) — un idDetalleOrdenCompra
// que no es de esta orden se ignora en silencio, nunca toca la línea de otra.
export const validarRecepcionOrden = (body = {}, idsLineasActuales = []) => {
    const idsValidos = new Set(idsLineasActuales);
    const cuerpoLineas = Array.isArray(body.lineas) ? body.lineas : [];

    const lineas = [];
    const errores = [];
    for (const l of cuerpoLineas) {
        const idDetalleOrdenCompra = parseInt(l?.idDetalleOrdenCompra, 10);
        if (!idsValidos.has(idDetalleOrdenCompra)) continue;

        const cantidadRecibida = enteroNoNegativo(l?.cantidadRecibida);
        if (cantidadRecibida === null) {
            errores.push({ idDetalleOrdenCompra, mensaje: 'La cantidad recibida debe ser un número mayor o igual a 0.' });
            continue;
        }
        lineas.push({ idDetalleOrdenCompra, cantidadRecibida });
    }

    if (!lineas.length) errores.push({ mensaje: 'No hay insumos válidos para registrar.' });
    if (errores.length) return { errores };
    return { datos: { lineas } };
};

// ── Bitácora de movimientos (ORDENES_COMPRA_HISTORIAL) ──────────────────────────────────
// Una sola función para escribir la fila, llamada desde las cuatro acciones que mutan una
// orden (crear, guardar cambios, convertir, recibir) — así el "quién/cuándo" se arma una
// sola vez, igual criterio que PRODUCTOS_CAMBIOS_PRECIO o PEDIDOS_WEB_HISTORIAL_ESTADO
// (CLAUDE.md §6/§5.11): nombre del usuario y del empleado CONGELADOS al momento del
// movimiento, no se vuelven a leer de USUARIOS/EMPLEADOS cada vez que se muestra la fila.
export const registrarMovimientoOrden = ({ idOrdenCompra, accion, resumen, usuario, empleado, transaction }) =>
    OrdenesCompraHistorial.create({
        idOrdenCompra,
        accion,
        resumen,
        idUsuario: usuario.idUsuario,
        usuarioNombre: `${usuario.nombreUsuario} ${usuario.apellidoUsuario || ''}`.trim(),
        idEmpleado: empleado?.idEmpleado ?? null,
        empleadoNombre: empleado?.nombre ?? null,
        empleadoCodigo: empleado?.codigoEmpleado ?? null
    }, { transaction });
