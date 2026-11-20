import { Op } from 'sequelize';
import { toPascal } from './clientes.js';
import { UNIDADES_CONSUMO, unidadConsumoSugerida, cantidadValida } from './unidadesInsumo.js';
import { QueryTypes } from 'sequelize';
import db from '../config/bd.js';
import { DetallesOrdenCompra, OrdenesCompra, Provedores } from '../models/index.js';
import { inicialesProveedor, resolverUbicacionesProveedores } from './proveedores.js';

// Catálogo de Insumos y Materias Primas (admin/insumos). Una sola fuente para las opciones
// del formulario, los límites y la validación del alta: la vista recibe estas listas por
// locals y el navegador copia los límites desde los atributos del formulario, así que no
// hay una segunda lista escrita a mano en pug ni en JS (CLAUDE.md §2).
//
// Los valores de `tipo` y `unidadCompra` son los del ENUM de la tabla MATERIAL.

// `etiquetaNombre` es el rótulo del campo Nombre cuando se elige el tipo ("Nombre Insumo").
export const TIPOS_INSUMO = [
    { valor: 'materia_prima', etiqueta: 'Materia prima', etiquetaNombre: 'Materia Prima', detalle: 'Telas e hilos que se transforman en producto', icono: '/img/avatars/telita.webp' },
    { valor: 'insumo',        etiqueta: 'Insumo',        etiquetaNombre: 'Insumo',        detalle: 'Avíos y empaques que se consumen en el proceso', icono: '/img/avatars/insumos.webp' }
];

export const UNIDADES_COMPRA = [
    { valor: 'kg',     etiqueta: 'Kilogramo (kg)' },
    { valor: 'metro',  etiqueta: 'Metro' },
    { valor: 'rollo',  etiqueta: 'Rollo' },
    { valor: 'unidad', etiqueta: 'Unidad' },
    { valor: 'bolsa',  etiqueta: 'Bolsa' },
    { valor: 'caja',   etiqueta: 'Caja' }
];

// codigoMaterial es VARCHAR(20): acepta un número simple ("1") o un código compuesto
// familia.material ("1.23"). El separador canónico es el punto — un guión en la entrada
// se normaliza a punto en codigoDxfValido.
export const LIMITES_INSUMO = { nombreMax: 100 };

// Carpeta en el bucket público (`grupo-gh`, config/r2.js) donde vive la foto de un material.
// Sin espacios ni mayúsculas, a diferencia de como se nombró de palabra: el resto de
// carpetas del proyecto (`productos/`, `documentacion/`, `provedores/`...) tampoco llevan
// espacio, y `urlDocumento`/`${R2_PUBLIC_URL}/${key}` no codifican la URL — un espacio
// literal ahí queda a merced de que cada consumidor lo encodee bien.
export const CARPETA_IMAGENES_INSUMOS = 'materiales-e-insumos';

// MATERIAL.imagen guarda solo el nombre de archivo (igual que IMAGENES.nombreImagen para
// productos): la carpeta es fija para todo el catálogo, así que no hace falta repetirla en
// cada fila. La URL se arma una sola vez, acá, en vez de en cada vista/controlador.
export const urlImagenMaterial = (nombreArchivo) =>
    nombreArchivo ? `${process.env.R2_PUBLIC_URL}/${CARPETA_IMAGENES_INSUMOS}/${nombreArchivo}` : null;

const ETIQUETA_TIPO = Object.fromEntries(TIPOS_INSUMO.map(t => [t.valor, t.etiqueta]));
const ICONO_TIPO = Object.fromEntries(TIPOS_INSUMO.map(t => [t.valor, t.icono]));
const ETIQUETA_UNIDAD = Object.fromEntries(UNIDADES_COMPRA.map(u => [u.valor, u.etiqueta]));

// PENDIENTE: todavía no hay stock real de materiales (eso llega con el módulo de
// Producción que consume estos insumos). Mientras tanto la columna "Cantidad" del
// catálogo, y todo el perfil de un material (helpers de más abajo), muestran números de
// relleno — determinísticos por `idMaterial`, nunca `Math.random()`, para que no cambien
// en cada recarga y parezcan un bug. Un solo hash para todos: `hashIdMaterial` abajo.
const hashIdMaterial = (idMaterial) => {
    let hash = 0;
    for (const c of String(idMaterial)) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    return hash;
};


// Lo que la vista necesita de una fila: nada del modelo que no se pinte.
// `padreNombre` es opcional: se pasa desde el controlador cuando se tiene la lista completa
// y se puede resolver el padre de las variantes sin un query adicional.
export const presentarMaterial = (m, padreNombre = null) => ({
    idMaterial:     m.idMaterial,
    codigoMaterial: m.codigoMaterial,
    nombre:         m.nombre,
    tipo:           m.tipo,
    tipoEtiqueta:   ETIQUETA_TIPO[m.tipo] ?? m.tipo,
    unidadCompra:   m.unidadCompra,
    unidadEtiqueta: ETIQUETA_UNIDAD[m.unidadCompra] ?? '—',
    unidadConsumo:  m.unidadConsumo,
    anchoUtilCm:    m.anchoUtilCm ?? null,
    gramajeGm2:     m.gramajeGm2 ?? null,
    activo:         Boolean(m.activo),
    icono:          ICONO_TIPO[m.tipo] ?? ICONO_TIPO.insumo,
    imagenUrl:      urlImagenMaterial(m.imagen),
    esVariante:     m.codigoMaterial.includes('.'),
    padreNombre
});

// ── Perfil de un material (admin/insumos/:id) — lo que TODAVÍA es relleno ────────────────
// Existencias, costo, historial de compras, proveedores y resumen de compras ya son reales
// (helpers/inventarioInsumos.js y las funciones de abajo). Solo quedan de relleno la
// descripción, la composición, los procesos involucrados, el tiempo de entrega y el dato
// útil: MATERIAL no tiene esos campos. Determinístico por idMaterial (`hashIdMaterial`),
// nunca azar, para que la pantalla no "cambie sola" al recargar.
// Forma corta de cada presentación para un texto en línea ("950 kg", "3 bolsas").
export const UNIDAD_COMPRA_CORTA = { kg: 'kg', metro: 'm', rollo: 'rollos', unidad: 'uds', bolsa: 'bolsas', caja: 'cajas' };

const DESCRIPCIONES_FICTICIAS = {
    materia_prima: 'Material base que se transforma en la prenda. Confirma composición y cuidados exactos en la ficha técnica del proveedor.',
    insumo:        'Avío o empaque que se consume durante la confección. Confirma especificaciones exactas en la ficha técnica del proveedor.'
};

const COMPOSICION_POOL = ['Algodón', 'Poliéster', 'Elastano', 'Lycra', 'Viscosa', 'Nylon', 'Poliamida'];

// Mismos colores por proveedor en la leyenda (server, inline style) y en la dona
// (src/js/insumoPerfil.js, Chart.js): una sola paleta para que no haga falta mantenerla
// sincronizada en dos archivos. Igual a la de src/js/adminProductoView.js.
export const PALETTE_RESUMEN_COMPRAS = ['#EC5FA3', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444'];

const PROCESOS_POOL = [
    { nombre: 'Corte',      icono: 'fi-rr-scissors' },
    { nombre: 'Confección', icono: 'fi-rr-shirt' },
    { nombre: 'Lavandería', icono: 'fi-rr-washer' },
    { nombre: 'Estampado',  icono: 'fi-rr-spray-can' },
    { nombre: 'Acabados',   icono: 'fi-rr-sparkles' },
    { nombre: 'Empaque',    icono: 'fi-rr-box' }
];

// Elige `n` elementos de `pool` sin repetir, en un orden que varía con `hash` — mismo
// mecanismo que el resto de este módulo: determinístico, nunca Math.random().
const elegirSinRepetir = (pool, hash, n) => {
    const disponibles = [...pool];
    const elegidos = [];
    let h = hash;
    for (let i = 0; i < n && disponibles.length; i++) {
        h = (h * 31 + 7) >>> 0;
        elegidos.push(disponibles.splice(h % disponibles.length, 1)[0]);
    }
    return elegidos;
};

// "02 oct 2026", sin el "de" que mete Intl por defecto en es-CO — mismo formato corto que
// ya usan las tirillas y el resto del panel.
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = (f) => `${String(f.getDate()).padStart(2, '0')} ${MESES_CORTOS[f.getMonth()]} ${f.getFullYear()}`;

export const datosFicticiosInsumo = (material) => {
    const hash = hashIdMaterial(material.idMaterial);
    return {
        tiempoEntregaDias: 2 + (hash % 8),
        descripcion:  DESCRIPCIONES_FICTICIAS[material.tipo] ?? DESCRIPCIONES_FICTICIAS.insumo,
        composicion:  elegirSinRepetir(COMPOSICION_POOL, hash, 2 + (hash % 2)),
        procesos:     elegirSinRepetir(PROCESOS_POOL, hash >>> 3, 2 + (hash % 3)),
        datoUtil: material.tipo === 'materia_prima'
            ? 'Verifica el lote antes de cortar: dos rollos del mismo color pueden variar levemente de tono.'
            : 'Guarda este insumo en un lugar seco — la humedad puede afectar el empaque o el adhesivo.'
    };
};

// ── Historial de compras REAL de un material (admin/insumos/:id) ─────────────────────
// Solo cuenta como "comprada" una línea cuya orden llegó al menos a 'confirmada' — antes de
// eso (borrador/enviada) todavía puede cambiar o no concretarse nunca, y 'cancelada' nunca
// se concretó aunque haya pasado por 'confirmada'. Mismo principio que FacturaClientes.estado
// (CLAUDE.md §6): nada se da por comprado hasta el estado que lo confirma de verdad.
const ESTADOS_COMPRA_CONFIRMADA = ['confirmada', 'en_transito', 'recibida'];
const LIMITE_HISTORIAL_COMPRAS_INSUMO = 10;

// Mismo rótulo y color que la columna Estado del historial de compras
// (src/js/historialCompras.js, ESTADO) — acá solo pueden salir estos tres valores, nunca
// borrador/enviada/cancelada (ya los filtra la consulta de abajo), pero se define el mapa
// completo para no tener dos copias parciales del mismo mapeo en el proyecto.
const ESTADO_ORDEN_BADGE = {
    borrador:    ['Borrador',    'bg-slate-100 text-slate-500'],
    enviada:     ['Enviada',     'bg-blue-100 text-blue-600'],
    confirmada:  ['Confirmada',  'bg-indigo-100 text-indigo-600'],
    en_transito: ['En tránsito', 'bg-amber-100 text-amber-600'],
    recibida:    ['Recibida',    'bg-emerald-100 text-emerald-600'],
    cancelada:   ['Cancelada',   'bg-rose-100 text-rose-600']
};

export const historialComprasInsumo = async (idMaterial) => {
    const lineas = await DetallesOrdenCompra.findAll({
        where: { idMaterial },
        include: [{
            model: OrdenesCompra, as: 'orden',
            where: { estado: { [Op.in]: ESTADOS_COMPRA_CONFIRMADA } },
            attributes: ['idOrdenCompra', 'numeroOrden', 'fechaOrden', 'estado'],
            include: [{ model: Provedores, as: 'proveedor', attributes: ['razonSocial'] }]
        }],
        order: [[{ model: OrdenesCompra, as: 'orden' }, 'fechaOrden', 'DESC'], ['idDetalleOrdenCompra', 'DESC']],
        limit: LIMITE_HISTORIAL_COMPRAS_INSUMO
    });

    return lineas.map(l => {
        const [estadoEtiqueta, estadoClase] = ESTADO_ORDEN_BADGE[l.orden.estado] || [l.orden.estado, 'bg-slate-100 text-slate-500'];
        return {
            idOrdenCompra: l.orden.idOrdenCompra,
            numeroOrden:   l.orden.numeroOrden,
            proveedor:     l.orden.proveedor?.razonSocial || '—',
            fecha:         fechaCorta(new Date(`${l.orden.fechaOrden}T00:00:00`)),
            cantidad:      Number(l.cantidad),
            unidad:        UNIDAD_COMPRA_CORTA[l.unidadCompra] || 'uds',
            precioUnit:    Number(l.valorUnitario),
            total:         Number(l.valorTotal),
            estadoEtiqueta,
            estadoClase
        };
    });
};

// ── Proveedores a los que se les ha comprado un material (admin/insumos/:id) ───────────
// Real, a partir de las órdenes de compra: mismo criterio que historialComprasInsumo (solo
// cuenta una orden confirmada, en tránsito o recibida) y además solo ÓRDENES DE COMPRA — una
// cotización confirmada no es una compra. Una sola consulta agregada para todos (CLAUDE.md §7).
//
// Precio promedio = Σ valor / Σ cantidad (ponderado por cantidad), en la presentación de la
// ÚLTIMA compra a ese proveedor: promediar "por bolsa" con "por kg" no significa nada. Las
// compras en otra presentación se cuentan en `otrasPresentaciones`.
//
// `calificacion` queda en null a propósito: es el punto donde se conectará la calificación
// de proveedores cuando exista. La vista ya muestra "Sin calificar" cuando es null.
export const proveedoresDelInsumo = async (idMaterial) => {
    const filas = await db.query(`
        SELECT o.idProveedor, d.unidadCompra,
               SUM(d.valorTotal) valor, SUM(d.cantidad) cantidad,
               COUNT(DISTINCT o.idOrdenCompra) compras, MAX(o.fechaOrden) ultimaFecha
        FROM DETALLES_ORDEN_COMPRA d
        JOIN ORDENES_COMPRA o ON o.idOrdenCompra = d.idOrdenCompra
        WHERE d.idMaterial = :idMaterial AND o.tipo = 'orden_compra' AND o.estado IN (:estados)
        GROUP BY o.idProveedor, d.unidadCompra`,
        { replacements: { idMaterial, estados: ESTADOS_COMPRA_CONFIRMADA }, type: QueryTypes.SELECT });
    if (!filas.length) return [];

    const porProveedor = new Map();
    for (const f of filas) (porProveedor.get(f.idProveedor) || porProveedor.set(f.idProveedor, []).get(f.idProveedor)).push(f);

    const proveedores = await Provedores.findAll({
        where: { idProveedor: [...porProveedor.keys()] },
        attributes: ['idProveedor', 'razonSocial', 'ciudad', 'departamento'], paranoid: false, raw: true
    });
    const { mapaMunicipios, mapaDepartamentos } = await resolverUbicacionesProveedores(proveedores);
    const fechaTxt = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10));

    return proveedores.map(p => {
        const grupos = porProveedor.get(p.idProveedor);
        // La presentación de la compra más reciente manda el precio que se muestra.
        const principal = grupos.reduce((a, b) => (fechaTxt(b.ultimaFecha) > fechaTxt(a.ultimaFecha) ? b : a));
        const ultimaFecha = grupos.reduce((max, g) => (fechaTxt(g.ultimaFecha) > max ? fechaTxt(g.ultimaFecha) : max), '');
        return {
            idProveedor:  p.idProveedor,
            nombre:       p.razonSocial,
            iniciales:    inicialesProveedor(p.razonSocial),
            ciudad:       [mapaMunicipios.get(p.ciudad), mapaDepartamentos.get(p.departamento)].filter(Boolean).join(', ') || 'Sin ciudad registrada',
            ultimaFechaOrden: ultimaFecha,
            ultimaCompra: fechaCorta(new Date(`${ultimaFecha}T00:00:00`)),
            compras:      grupos.reduce((n, g) => n + Number(g.compras), 0),
            // En pesos, todas las presentaciones juntas (antes de IVA, como el valor de la línea).
            totalComprado: Math.round(grupos.reduce((t, g) => t + Number(g.valor), 0)),
            precioPromedio: Number(principal.cantidad) > 0 ? Math.round(Number(principal.valor) / Number(principal.cantidad)) : null,
            unidadPrecio: UNIDAD_COMPRA_SINGULAR[principal.unidadCompra] || 'ud',
            otrasPresentaciones: grupos.length - 1,
            calificacion: null
        };
    }).sort((a, b) => b.ultimaFechaOrden.localeCompare(a.ultimaFechaOrden));
};

/**
 * Resumen de compras de un material (la dona del perfil) a partir de proveedoresDelInsumo:
 * cuánto se le ha comprado a cada uno y qué parte del total es.
 *
 * "Mejor precio promedio" solo compara proveedores en la MISMA presentación (no se compara
 * $/bolsa con $/kg); se toma la presentación con más proveedores, y si en ninguna hay al menos
 * dos, no hay a quién comparar y queda en null (la vista no muestra la línea).
 */
export const resumenComprasInsumo = (proveedores) => {
    const totalComprado = proveedores.reduce((t, p) => t + p.totalComprado, 0);
    const resumenCompras = [...proveedores]
        .sort((a, b) => b.totalComprado - a.totalComprado)
        .map((p, i) => ({
            nombre: p.nombre,
            total: p.totalComprado,
            pct: totalComprado ? Math.round((p.totalComprado / totalComprado) * 100) : 0,
            color: PALETTE_RESUMEN_COMPRAS[i % PALETTE_RESUMEN_COMPRAS.length]
        }));

    const porPresentacion = new Map();
    for (const p of proveedores) {
        if (p.precioPromedio === null) continue;
        (porPresentacion.get(p.unidadPrecio) || porPresentacion.set(p.unidadPrecio, []).get(p.unidadPrecio)).push(p);
    }
    const comparables = [...porPresentacion.values()].sort((a, b) => b.length - a.length)[0] || [];
    const mejor = comparables.length >= 2 ? comparables.reduce((a, b) => (b.precioPromedio < a.precioPromedio ? b : a)) : null;

    return {
        resumenCompras,
        totalComprado,
        mejorProveedor: mejor ? { nombre: mejor.nombre, precioPromedio: mejor.precioPromedio, unidad: mejor.unidadPrecio } : null
    };
};

// "por kg", "por bolsa": el precio promedio es de UNA presentación.
const UNIDAD_COMPRA_SINGULAR = { kg: 'kg', metro: 'm', rollo: 'rollo', unidad: 'ud', bolsa: 'bolsa', caja: 'caja' };

// Devuelve el código normalizado (punto como separador canónico) o null si el formato no
// es válido. Acepta un número simple ("1") o un código compuesto ("1.23" / "1-23" — el
// guión se normaliza a punto). Lo usan la validación del alta y la consulta de duplicados.
export const codigoDxfValido = (texto) => {
    const t = String(texto ?? '').trim();
    const compuesto = t.match(/^(\d{1,10})[.\-](\d{1,10})$/);
    if (compuesto) return `${compuesto[1]}.${compuesto[2]}`;
    if (/^\d{1,10}$/.test(t)) return t;
    return null;
};

// Validación del alta. Devuelve `{ errores }` con un mensaje por campo, o `{ datos }` con
// solo los campos permitidos (whitelist: nada del body llega al modelo tal cual, §12).
export const validarInsumo = (body = {}) => {
    const errores = {};
    const { nombreMax } = LIMITES_INSUMO;

    const codigoTxt = String(body.codigoMaterial ?? '').trim();
    const codigoMaterial = codigoDxfValido(codigoTxt);
    if (!codigoTxt) {
        errores.codigoMaterial = 'Escribe el código del material, el número que trae el DXF.';
    } else if (codigoMaterial === null) {
        errores.codigoMaterial = 'El código debe ser un número (ej: 1) o un código compuesto (ej: 1.23).';
    }

    const nombre = String(body.nombre ?? '').trim();
    if (!nombre) errores.nombre = 'Escribe el nombre del material.';
    else if (nombre.length > nombreMax) errores.nombre = `El nombre no puede pasar de ${nombreMax} caracteres.`;

    const tipo = String(body.tipo ?? '');
    if (!TIPOS_INSUMO.some(t => t.valor === tipo)) errores.tipo = 'Elige si es materia prima o insumo.';

    const unidadTxt = String(body.unidadCompra ?? '').trim();
    const unidadCompra = unidadTxt || null;
    if (unidadCompra && !UNIDADES_COMPRA.some(u => u.valor === unidadCompra)) {
        errores.unidadCompra = 'Elige una unidad de compra de la lista.';
    }

    // En qué se gasta (cm, g, unidad): lo que mide la ficha, el inventario y el costo. Si no
    // llega se deduce de cómo se compra (metro → cm, kg → g).
    const consumoTxt = String(body.unidadConsumo ?? '').trim();
    const unidadConsumo = consumoTxt || unidadConsumoSugerida(unidadCompra);
    if (!UNIDADES_CONSUMO.some(u => u.valor === unidadConsumo)) errores.unidadConsumo = 'Elige en qué se gasta este material.';

    // Ancho útil y gramaje: solo para telas (materia prima), opcionales.
    const medidaTela = (campo, etiqueta) => {
        const txt = String(body[campo] ?? '').trim();
        if (tipo !== 'materia_prima' || !txt) return null;
        const v = cantidadValida(txt);
        if (!v || v.gt(999999)) { errores[campo] = `${etiqueta} debe ser un número mayor a 0.`; return null; }
        return v.toDecimalPlaces(2).toFixed(2);
    };
    const anchoUtilCm = medidaTela('anchoUtilCm', 'El ancho útil');
    const gramajeGm2 = medidaTela('gramajeGm2', 'El gramaje');

    if (Object.keys(errores).length) return { errores };
    // El nombre se guarda en formato de título (POLILICRA -> Polilicra) con el mismo helper que
    // usan clientes y proveedores, para que el catálogo no mezcle mayúsculas.
    return { datos: { codigoMaterial, nombre: toPascal(nombre), tipo, unidadCompra, unidadConsumo, anchoUtilCm, gramajeGm2 } };
};
