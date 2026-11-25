import Decimal from 'decimal.js';
import { Op } from 'sequelize';
import {
    OrdenProduccion, OrdenProduccionCantidad, OrdenProduccionInsumo, OrdenProduccionInsumoColor,
    Material, Atributos
} from '../models/index.js';
import { TALLAS_CORTE } from './catalogos.js';
import { dec, a4, cantidadValida, UNIDAD_CONSUMO_CORTA } from './unidadesInsumo.js';
import { disponiblePorMaterialYColor, materialesConColor } from './inventarioInsumos.js';
import { fechaHoyBogota } from './fechas.js';

// Orden de producción (CLAUDE.md §6.2, wiki "Proceso de confección"). Una sola copia de las
// reglas: la usan el controlador (crear, editar, confirmar, revisar) y los tests.
//
// Decidido con el dueño el 2026-11-21:
//   - La orden SOLO AVISA si alcanza el material: no reserva nada del inventario.
//   - Un insumo cuyo material tiene colores se elige por color de prenda; uno sin colores
//     se cuenta junto.
//   - La tela no se revisa acá: la da el trazo, en la orden de corte.

export const ESTADOS_ORDEN = ['borrador', 'en_curso', 'cerrada', 'cancelada'];
export const ETIQUETA_ESTADO_ORDEN = {
    borrador: 'Borrador',
    en_curso: 'En curso',
    cerrada: 'Cerrada',
    cancelada: 'Cancelada'
};

// Topes del formulario. Lo que pasa de acá es un error de captura, no una producción real.
export const LIMITES_ORDEN = { cantidadMaxCelda: 100000, insumosMax: 60, notasMax: 2000, motivoMax: 500 };

// ── Tallas ───────────────────────────────────────────────────────────────────────────────
// Las tallas de una orden son las del DXF de su ficha (helpers/dxf.js normalizarTallas las
// guarda como "Talla S", "Talla Única"). Se pasan al código del catálogo de tallas
// (src/json/tallasCorte.json) y se ordenan como ese catálogo; una talla que el catálogo no
// conoce va al final con su propio texto.
const ORDEN_TALLA = new Map(TALLAS_CORTE.map((t, i) => [t.codigo, i]));
const ETIQUETA_TALLA = new Map(TALLAS_CORTE.map(t => [t.codigo, t.etiqueta]));

export const codigoTalla = (texto) => {
    const limpio = String(texto ?? '').replace(/^\s*talla\s*/i, '').trim().toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
    return limpio === 'UNICA' || limpio === '' ? 'UNICA' : limpio;
};

export const etiquetaTalla = (codigo) => ETIQUETA_TALLA.get(codigo) ?? codigo;

/** Tallas de una ficha a partir de FICHAS_CONFECCION_DXF.talla: [{ codigo, etiqueta }]. */
export const tallasDeFicha = (tallasDxf) => {
    const lista = Array.isArray(tallasDxf) && tallasDxf.length ? tallasDxf : ['Talla Única'];
    const codigos = [...new Set(lista.map(codigoTalla))];
    codigos.sort((a, b) => (ORDEN_TALLA.get(a) ?? 999) - (ORDEN_TALLA.get(b) ?? 999));
    return codigos.map(codigo => ({ codigo, etiqueta: etiquetaTalla(codigo) }));
};

// ── Cálculo de lo que necesita una orden (puro: sin base de datos) ───────────────────────
// Clave de una necesidad: material + color del insumo ('' = sin color, se cuenta junto).
export const claveNecesidad = (idMaterial, idAtributoColor) => `${idMaterial}|${idAtributoColor ?? ''}`;

/**
 * Cuánto de cada insumo necesitan estas órdenes, en la unidad de consumo.
 *   sin colores: cantidad por prenda × total de prendas de la orden
 *   con colores: por cada color de prenda, cantidad por prenda × prendas de ese color, sumado
 *                al color de insumo que se eligió para él
 *
 * @param ordenes [{ cantidades: [{ idAtributoColor, cantidad }],
 *                   insumos: [{ idMaterial, cantidadPorPrenda, colores: [{ idAtributoColorPrenda, idAtributoColorInsumo }] }] }]
 * @returns Map clave → { idMaterial, idAtributoColor, necesario: Decimal }
 */
export function necesidadesDeOrdenes(ordenes) {
    const res = new Map();
    const sumar = (idMaterial, idAtributoColor, cantidad) => {
        const clave = claveNecesidad(idMaterial, idAtributoColor);
        if (!res.has(clave)) res.set(clave, { idMaterial, idAtributoColor: idAtributoColor ?? null, necesario: dec(0) });
        res.get(clave).necesario = res.get(clave).necesario.plus(cantidad);
    };
    for (const orden of ordenes) {
        const prendasPorColor = new Map();
        let totalPrendas = 0;
        for (const c of orden.cantidades || []) {
            const n = Number(c.cantidad) || 0;
            prendasPorColor.set(Number(c.idAtributoColor), (prendasPorColor.get(Number(c.idAtributoColor)) || 0) + n);
            totalPrendas += n;
        }
        for (const ins of orden.insumos || []) {
            const porPrenda = dec(ins.cantidadPorPrenda);
            const colores = ins.colores || [];
            if (!colores.length) {
                sumar(ins.idMaterial, null, porPrenda.times(totalPrendas));
                continue;
            }
            for (const c of colores) {
                const prendas = prendasPorColor.get(Number(c.idAtributoColorPrenda)) || 0;
                if (prendas) sumar(ins.idMaterial, Number(c.idAtributoColorInsumo), porPrenda.times(prendas));
            }
        }
    }
    return res;
}

/**
 * Compara lo que necesita una orden con lo disponible, descontando lo que ya piden las otras
 * órdenes EN CURSO (la orden no reserva: dos órdenes ven el mismo disponible, así que el
 * aviso tiene que contar lo comprometido). Puro: recibe los mapas ya cargados.
 *
 *   sin color:  disponible = todo el material, de cualquier color; comprometido = lo que
 *               piden las otras de ese material, de cualquier color
 *   con color:  disponible y comprometido de ese color
 */
export function compararConDisponible({ necesidades, disponibles, comprometidas }) {
    const comprometidoMaterial = new Map();
    for (const n of comprometidas.values()) {
        comprometidoMaterial.set(n.idMaterial, (comprometidoMaterial.get(n.idMaterial) || dec(0)).plus(n.necesario));
    }
    const lineas = [];
    for (const n of necesidades.values()) {
        const disp = disponibles.get(n.idMaterial);
        const disponible = n.idAtributoColor === null
            ? (disp?.total ?? dec(0))
            : (disp?.porColor.get(n.idAtributoColor) ?? dec(0));
        const comprometido = n.idAtributoColor === null
            ? (comprometidoMaterial.get(n.idMaterial) ?? dec(0))
            : (comprometidas.get(claveNecesidad(n.idMaterial, n.idAtributoColor))?.necesario ?? dec(0));
        const libre = Decimal.max(0, disponible.minus(comprometido));
        const faltante = n.necesario.gt(libre) ? n.necesario.minus(libre) : dec(0);
        lineas.push({
            idMaterial: n.idMaterial,
            idAtributoColor: n.idAtributoColor,
            necesario: a4(n.necesario),
            disponible: a4(disponible),
            comprometido: a4(comprometido),
            faltante: a4(faltante),
            estado: faltante.gt(0) ? (disponible.gt(0) ? 'falta' : 'sin_existencia') : 'alcanza'
        });
    }
    return lineas;
}

// ── Revisión de material (con base de datos) ─────────────────────────────────────────────

/** Las órdenes en curso (salvo `excluir`) que usan alguno de estos materiales, ya en la forma de necesidadesDeOrdenes. */
async function ordenesEnCursoQueUsan(idsMaterial, excluir) {
    if (!idsMaterial.length) return [];
    const where = { estado: 'en_curso' };
    if (excluir) where.idOrdenProduccion = { [Op.ne]: excluir };
    const ordenes = await OrdenProduccion.findAll({
        where,
        attributes: ['idOrdenProduccion'],
        include: [
            { model: OrdenProduccionCantidad, as: 'cantidades', attributes: ['idAtributoColor', 'cantidad'] },
            {
                model: OrdenProduccionInsumo, as: 'insumos', attributes: ['idDetalle', 'idMaterial', 'cantidadPorPrenda'],
                where: { idMaterial: { [Op.in]: idsMaterial } },
                include: [{ model: OrdenProduccionInsumoColor, as: 'colores', attributes: ['idAtributoColorPrenda', 'idAtributoColorInsumo'] }]
            }
        ]
    });
    return ordenes.map(o => o.get({ plain: true }));
}

/**
 * Revisa si alcanza el material de una orden (guardada o el borrador del formulario).
 * Consultas fijas, sin importar cuántos insumos tenga (CLAUDE.md §7).
 *
 * @param orden { idOrdenProduccion?, cantidades, insumos } en la forma de necesidadesDeOrdenes
 * @returns { lineas: [...], conFaltante: number }
 */
export async function revisarMaterial(orden) {
    const necesidades = necesidadesDeOrdenes([orden]);
    const ids = [...new Set([...necesidades.values()].map(n => n.idMaterial))];
    if (!ids.length) return { lineas: [], conFaltante: 0 };

    const [disponibles, otras, materiales] = await Promise.all([
        disponiblePorMaterialYColor(ids),
        ordenesEnCursoQueUsan(ids, orden.idOrdenProduccion),
        Material.findAll({ where: { idMaterial: ids }, attributes: ['idMaterial', 'nombre', 'unidadConsumo'], raw: true })
    ]);
    const lineas = compararConDisponible({ necesidades, disponibles, comprometidas: necesidadesDeOrdenes(otras) });

    const idsColor = [...new Set(lineas.map(l => l.idAtributoColor).filter(Boolean))];
    const colores = idsColor.length
        ? await Atributos.findAll({ where: { idAtributo: idsColor }, attributes: ['idAtributo', 'valor', 'codigo1'], raw: true })
        : [];
    const material = new Map(materiales.map(m => [m.idMaterial, m]));
    const color = new Map(colores.map(c => [c.idAtributo, c]));

    for (const l of lineas) {
        const m = material.get(l.idMaterial);
        l.nombre = m?.nombre ?? '—';
        l.unidad = UNIDAD_CONSUMO_CORTA[m?.unidadConsumo] ?? '';
        l.colorNombre = l.idAtributoColor ? (color.get(l.idAtributoColor)?.valor ?? '—') : null;
        l.colorHex = l.idAtributoColor ? (color.get(l.idAtributoColor)?.codigo1 ?? null) : null;
    }
    lineas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || String(a.colorNombre ?? '').localeCompare(String(b.colorNombre ?? ''), 'es'));
    return { lineas, conFaltante: lineas.filter(l => l.estado !== 'alcanza').length };
}

// ── Validación del formulario ────────────────────────────────────────────────────────────

const entero = (v) => {
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
};

/**
 * Valida lo que manda el formulario de la orden (crear o editar un borrador). Nunca toma el
 * body tal cual (CLAUDE.md §12): arma los datos campo por campo.
 *
 * @param body   { fechaRequerida, notas, cantidades: [{ idAtributoColor, talla, cantidad }],
 *                 insumos: [{ idMaterial, cantidadPorPrenda, colores: [{ idAtributoColorPrenda, idAtributoColorInsumo }] }] }
 * @param tallas las de la ficha (tallasDeFicha)
 * @returns { datos } o { errores: { campo: mensaje } }
 */
export async function validarOrdenBody(body = {}, { tallas }) {
    const errores = {};

    const fechaRequerida = String(body.fechaRequerida ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRequerida) || Number.isNaN(Date.parse(fechaRequerida))) {
        errores.fechaRequerida = 'Elige para qué fecha se necesita la producción.';
    } else if (fechaRequerida < fechaHoyBogota()) {
        errores.fechaRequerida = 'La fecha requerida no puede ser anterior a hoy.';
    }

    const notas = String(body.notas ?? '').trim();
    if (notas.length > LIMITES_ORDEN.notasMax) errores.notas = `Las notas no pueden pasar de ${LIMITES_ORDEN.notasMax} caracteres.`;

    // Cantidades: una celda por color y talla, solo las que tienen algo.
    const codigosTalla = new Set(tallas.map(t => t.codigo));
    const celdas = new Map();
    let celdaInvalida = false;
    for (const c of Array.isArray(body.cantidades) ? body.cantidades : []) {
        const idAtributoColor = entero(c?.idAtributoColor);
        const talla = String(c?.talla ?? '');
        const cantidad = entero(c?.cantidad);
        if (cantidad === 0) continue;
        if (!idAtributoColor || !codigosTalla.has(talla) || !cantidad || cantidad < 0 || cantidad > LIMITES_ORDEN.cantidadMaxCelda) {
            celdaInvalida = true;
            continue;
        }
        const clave = `${idAtributoColor}|${talla}`;
        celdas.set(clave, { idAtributoColor, talla, cantidad: (celdas.get(clave)?.cantidad || 0) + cantidad });
    }
    const cantidades = [...celdas.values()];
    const idsColorPrenda = [...new Set(cantidades.map(c => c.idAtributoColor))];
    if (celdaInvalida) errores.cantidades = `Cada cantidad tiene que ser un número entero entre 1 y ${LIMITES_ORDEN.cantidadMaxCelda.toLocaleString('es-CO')}.`;
    else if (!cantidades.length) errores.cantidades = 'Escribe cuántas prendas se hacen, al menos en un color y una talla.';

    // Insumos: la receta efectiva de esta producción.
    const insumosBody = Array.isArray(body.insumos) ? body.insumos : [];
    if (insumosBody.length > LIMITES_ORDEN.insumosMax) errores.insumos = `Una orden no puede llevar más de ${LIMITES_ORDEN.insumosMax} insumos.`;
    const insumos = [];
    const vistos = new Set();
    for (const fila of insumosBody.slice(0, LIMITES_ORDEN.insumosMax)) {
        const idMaterial = String(fila?.idMaterial ?? '').trim();
        const cantidad = cantidadValida(fila?.cantidadPorPrenda);
        if (!idMaterial || !cantidad) { errores.insumos = 'Cada insumo necesita una cantidad por prenda mayor a 0.'; break; }
        if (vistos.has(idMaterial)) { errores.insumos = 'Hay un insumo repetido: déjalo en una sola línea.'; break; }
        vistos.add(idMaterial);
        insumos.push({
            idMaterial,
            cantidadPorPrenda: a4(cantidad),
            colores: (Array.isArray(fila?.colores) ? fila.colores : []).map(c => ({
                idAtributoColorPrenda: entero(c?.idAtributoColorPrenda),
                idAtributoColorInsumo: entero(c?.idAtributoColorInsumo)
            }))
        });
    }

    if (Object.keys(errores).length) return { errores };

    // Contra la base: colores que existen, materiales activos, y colores del insumo completos
    // para los materiales que los manejan.
    const idsMaterial = insumos.map(i => i.idMaterial);
    const idsColorInsumo = [...new Set(insumos.flatMap(i => i.colores.map(c => c.idAtributoColorInsumo)).filter(Boolean))];
    const [coloresPrenda, coloresInsumo, materiales, conColor] = await Promise.all([
        Atributos.findAll({ where: { idAtributo: idsColorPrenda, tipo: 'COLOR' }, attributes: ['idAtributo'], raw: true }),
        idsColorInsumo.length
            ? Atributos.findAll({ where: { idAtributo: idsColorInsumo, tipo: 'COLOR', codigo2: { [Op.is]: null } }, attributes: ['idAtributo'], raw: true })
            : [],
        idsMaterial.length
            ? Material.findAll({ where: { idMaterial: idsMaterial, activo: true }, attributes: ['idMaterial', 'nombre'], raw: true })
            : [],
        materialesConColor(idsMaterial)
    ]);
    if (coloresPrenda.length !== idsColorPrenda.length) return { errores: { cantidades: 'Alguno de los colores elegidos no existe.' } };
    if (materiales.length !== idsMaterial.length) return { errores: { insumos: 'Alguno de los insumos elegidos no existe o ya no está activo.' } };

    const colorInsumoValido = new Set(coloresInsumo.map(c => c.idAtributo));
    const nombre = new Map(materiales.map(m => [m.idMaterial, m.nombre]));
    for (const ins of insumos) {
        ins.nombreMaterial = nombre.get(ins.idMaterial);
        if (!conColor.has(ins.idMaterial)) { ins.colores = []; continue; }
        // Un color de insumo por cada color de prenda de la orden, ni más ni menos.
        const porPrenda = new Map();
        for (const c of ins.colores) {
            if (idsColorPrenda.includes(c.idAtributoColorPrenda) && colorInsumoValido.has(c.idAtributoColorInsumo)) {
                porPrenda.set(c.idAtributoColorPrenda, c.idAtributoColorInsumo);
            }
        }
        if (porPrenda.size !== idsColorPrenda.length) {
            return { errores: { insumos: `"${ins.nombreMaterial}" maneja colores: elige de qué color va en cada color de la prenda.` } };
        }
        ins.colores = [...porPrenda].map(([idAtributoColorPrenda, idAtributoColorInsumo]) => ({ idAtributoColorPrenda, idAtributoColorInsumo }));
    }

    return { datos: { fechaRequerida, notas: notas || null, cantidades, insumos } };
}

/** Escribe cantidades e insumos (con sus colores) de una orden. Reemplaza lo que hubiera: solo en borrador. */
export async function escribirDetalleOrden(idOrdenProduccion, { cantidades, insumos }, transaction) {
    await OrdenProduccionCantidad.destroy({ where: { idOrdenProduccion }, transaction });
    await OrdenProduccionInsumo.destroy({ where: { idOrdenProduccion }, transaction });   // sus colores caen en CASCADE
    await OrdenProduccionCantidad.bulkCreate(cantidades.map(c => ({ idOrdenProduccion, ...c })), { transaction });
    for (const [i, ins] of insumos.entries()) {
        // Uno por uno: cada línea necesita su idDetalle para colgarle los colores.
        // Acotado por LIMITES_ORDEN.insumosMax.
        const fila = await OrdenProduccionInsumo.create({
            idOrdenProduccion, idMaterial: ins.idMaterial, nombreMaterial: ins.nombreMaterial,
            cantidadPorPrenda: ins.cantidadPorPrenda, orden: i + 1
        }, { transaction });
        if (ins.colores.length) {
            await OrdenProduccionInsumoColor.bulkCreate(ins.colores.map(c => ({ idInsumoOrden: fila.idDetalle, ...c })), { transaction });
        }
    }
}

/** Total de prendas de una lista de cantidades. */
export const totalPrendas = (cantidades) => (cantidades || []).reduce((s, c) => s + (Number(c.cantidad) || 0), 0);
