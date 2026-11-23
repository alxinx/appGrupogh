import { Op } from 'sequelize';
import { InsumoRollo, InsumoRolloEstado, Material, Atributos } from '../models/index.js';
import { crearConCodigo } from './secuencias.js';
import { errorPublico } from './helpers.js';
import { dec, a4 } from './unidadesInsumo.js';
import { columnasActor, registrarSalidaAjuste } from './inventarioInsumos.js';

// Rollos de tela (decidido con el dueño el 2026-11-21). Toda tela que entra queda "sin
// tender"; el operador elige los rollos que tiende y desde ahí reposan las horas del
// material (48 por defecto) antes de poder cortarse. Adelantar ese reposo o deshacer un
// tendido se hace a mano, con motivo y código de empleado, y queda en la bitácora.
//
// Qué se lleva por rollo: toda TELA, es decir materia prima que se gasta en cm. Comprada
// por rollo, nace un rollo por cada uno con su metraje; comprada por metro o kilo, una sola
// pieza con lo que llegó (también hay que tenderla).
//
// Todo lo que mueve un rollo pasa por acá, dentro de la transacción del llamador, para que
// la suma de los rollos vivos de una capa no se separe de lo que la capa tiene.

export const REPOSO_HORAS_DEFECTO = 48;
export const REPOSO_HORAS_MAX = 720;   // 30 días: más que eso es un error de captura
export const METRAJE_ROLLO_MAX_M = 5000;
export const ROLLOS_POR_LINEA_MAX = 200;

/** ¿Este material se lleva por rollo? Telas: materia prima que se gasta en cm. */
export const esTelaPorRollo = (material) => material?.tipo === 'materia_prima' && material?.unidadConsumo === 'cm';

/**
 * El estado que se muestra. El guardado es sin_tender / tendido / en_corte / agotado;
 * "tendido" se ve como "en reposo" hasta `listoDesde` y como "listo" desde ahí.
 */
export const estadoVisible = (rollo, ahora = new Date()) => {
    if (rollo.estado !== 'tendido') return rollo.estado;
    return rollo.listoDesde && new Date(rollo.listoDesde) <= ahora ? 'listo' : 'en_reposo';
};

export const ETIQUETA_ESTADO_ROLLO = {
    sin_tender: 'Sin tender',
    en_reposo: 'En reposo',
    listo: 'Listo para cortar',
    en_corte: 'En corte',
    agotado: 'Agotado'
};

const sumarHoras = (fecha, horas) => new Date(fecha.getTime() + horas * 3600 * 1000);

const constancia = (rollo, { accion, desde, hacia, cantidadCm = null, motivo = null }, actor, transaction) =>
    InsumoRolloEstado.create({
        idRollo: rollo.idRollo, accion, estadoAnterior: desde, estadoNuevo: hacia,
        cantidadCm: cantidadCm === null ? null : a4(cantidadCm), motivo, ...columnasActor(actor)
    }, { transaction });

// ── Entrada ──────────────────────────────────────────────────────────────────────────────

/**
 * Crea los rollos de una capa recién entrada. `metrajesCm` es la lista de lo que mide cada
 * uno (en cm); su suma tiene que ser la cantidad de la capa. Nacen sin tender.
 */
export async function crearRollos({ capa, metrajesCm, actor, transaction }) {
    if (!transaction) throw new Error('crearRollos: va dentro de una transacción');
    const total = metrajesCm.reduce((s, m) => s.plus(dec(m)), dec(0));
    if (!total.eq(dec(capa.cantidadInicial))) throw new Error('crearRollos: los rollos no suman lo que entró a la capa');
    const creados = [];
    for (const m of metrajesCm) {
        // Uno por uno: cada rollo toma su número de SECUENCIAS. Acotado por ROLLOS_POR_LINEA_MAX.
        const rollo = await crearConCodigo(InsumoRollo, 'codigoRollo', 'R-', 'rollo_tela', {
            idCapa: capa.idCapa, idMaterial: capa.idMaterial, idAtributoColor: capa.idAtributoColor ?? null,
            metrajeInicialCm: a4(m), metrajeActualCm: a4(m), estado: 'sin_tender'
        }, transaction);
        await constancia(rollo, { accion: 'recibido', desde: null, hacia: 'sin_tender', cantidadCm: m }, actor, transaction);
        creados.push(rollo);
    }
    return creados;
}

/**
 * Lee los metrajes de los rollos que llegan (en METROS, como los trae la etiqueta del rollo)
 * y los devuelve en cm. null si alguno no sirve.
 */
export const metrajesDesdeMetros = (lista) => {
    if (!Array.isArray(lista) || !lista.length || lista.length > ROLLOS_POR_LINEA_MAX) return null;
    const cm = [];
    for (const crudo of lista) {
        const texto = String(crudo ?? '').trim();
        if (!/^\d{1,6}(\.\d{1,2})?$/.test(texto)) return null;
        const m = dec(texto);
        if (!m.gt(0) || m.gt(METRAJE_ROLLO_MAX_M)) return null;
        cm.push(m.times(100));
    }
    return cm;
};

// ── Estado ───────────────────────────────────────────────────────────────────────────────

const bloquear = (where, transaction) => InsumoRollo.findAll({
    where, lock: transaction.LOCK.UPDATE, transaction,
    include: [{ model: Material, as: 'material', attributes: ['idMaterial', 'reposoHoras'] }]
});

/** Tiende estos rollos de un material: sin tender → en reposo por las horas del material. */
export async function tenderRollos({ idMaterial, idsRollo, actor, transaction, ahora = new Date() }) {
    const ids = [...new Set((idsRollo || []).map(String))];
    if (!ids.length) throw errorPublico('Elige al menos un rollo para tender.');
    const rollos = await bloquear({ idRollo: ids, idMaterial }, transaction);
    if (rollos.length !== ids.length) throw errorPublico('Alguno de los rollos no es de esta tela.', 404);
    const noSinTender = rollos.filter(r => r.estado !== 'sin_tender');
    if (noSinTender.length) throw errorPublico(`${noSinTender.map(r => r.codigoRollo).join(', ')} ya no está sin tender: recarga la página.`, 409);

    for (const r of rollos) {
        const listoDesde = sumarHoras(ahora, r.material?.reposoHoras ?? REPOSO_HORAS_DEFECTO);
        const [filas] = await InsumoRollo.update(
            { estado: 'tendido', tendidoEn: ahora, listoDesde },
            { where: { idRollo: r.idRollo, estado: 'sin_tender' }, transaction });
        if (!filas) throw errorPublico('Un rollo cambió mientras tanto. Intenta de nuevo.', 409);
        await constancia(r, { accion: 'tendido', desde: 'sin_tender', hacia: 'tendido' }, actor, transaction);
    }
    return rollos.length;
}

/** Adelanta el reposo: el rollo queda listo para cortar ya. Motivo obligatorio. */
export async function adelantarReposo({ idRollo, motivo, actor, transaction, ahora = new Date() }) {
    const [rollo] = await bloquear({ idRollo }, transaction);
    if (!rollo) throw errorPublico('Ese rollo no existe.', 404);
    if (estadoVisible(rollo, ahora) !== 'en_reposo') throw errorPublico(`${rollo.codigoRollo} no está en reposo: recarga la página.`, 409);
    await rollo.update({ listoDesde: ahora }, { transaction });
    await constancia(rollo, { accion: 'listo_adelantado', desde: 'tendido', hacia: 'tendido', motivo }, actor, transaction);
    return rollo;
}

/** Deshace un tendido (en reposo o listo, todavía sin cortar): vuelve a sin tender. Motivo obligatorio. */
export async function deshacerTendido({ idRollo, motivo, actor, transaction }) {
    const [rollo] = await bloquear({ idRollo }, transaction);
    if (!rollo) throw errorPublico('Ese rollo no existe.', 404);
    if (rollo.estado !== 'tendido') throw errorPublico(`${rollo.codigoRollo} no está tendido: recarga la página.`, 409);
    await rollo.update({ estado: 'sin_tender', tendidoEn: null, listoDesde: null }, { transaction });
    await constancia(rollo, { accion: 'tendido_deshecho', desde: 'tendido', hacia: 'sin_tender', motivo }, actor, transaction);
    return rollo;
}

// ── Salida por ajuste ────────────────────────────────────────────────────────────────────

/**
 * Salida por conteo físico de un rollo puntual: baja su metraje y sale de SU capa (no FIFO).
 * Un rollo que queda en 0 pasa a agotado.
 */
export async function salidaDeRollo({ idMaterial, idRollo, cantidad, motivo, actor, transaction }) {
    const [rollo] = await bloquear({ idRollo, idMaterial }, transaction);
    if (!rollo) throw errorPublico('Ese rollo no es de esta tela.', 404);
    if (!['sin_tender', 'tendido'].includes(rollo.estado)) throw errorPublico(`${rollo.codigoRollo} no está en bodega.`, 409);
    const sale = dec(cantidad);
    if (sale.gt(dec(rollo.metrajeActualCm))) {
        throw errorPublico(`${rollo.codigoRollo} tiene ${a4(rollo.metrajeActualCm).replace(/\.?0+$/, '')} cm: no pueden salir más.`, 409);
    }
    await registrarSalidaAjuste({ idMaterial, idCapa: rollo.idCapa, cantidad: sale, motivo: `${rollo.codigoRollo}: ${motivo}`, actor, transaction });
    const antes = rollo.estado;
    const queda = dec(rollo.metrajeActualCm).minus(sale);
    const hacia = queda.gt(0) ? antes : 'agotado';
    await rollo.update({ metrajeActualCm: a4(queda), estado: hacia }, { transaction });
    await constancia(rollo, { accion: 'ajuste_salida', desde: antes, hacia, cantidadCm: sale, motivo }, actor, transaction);
    return rollo;
}

// ── Lectura ──────────────────────────────────────────────────────────────────────────────

/** Los rollos en bodega de un material (sin agotados), para el perfil y el ajuste. */
export async function rollosEnBodega(idMaterial, ahora = new Date()) {
    const rollos = await InsumoRollo.findAll({
        where: { idMaterial, estado: { [Op.ne]: 'agotado' } },
        include: [{ model: Atributos, as: 'color', attributes: ['idAtributo', 'valor', 'codigo1'] }],
        order: [['createdAt', 'ASC'], ['codigoRollo', 'ASC']]
    });
    return rollos.map(r => ({
        idRollo: r.idRollo,
        codigo: r.codigoRollo,
        color: r.color?.valor ?? null,
        colorHex: r.color?.codigo1 ?? null,
        idAtributoColor: r.idAtributoColor,
        metrajeCm: a4(r.metrajeActualCm),
        metrajeInicialCm: a4(r.metrajeInicialCm),
        estado: estadoVisible(r, ahora),
        tendidoEn: r.tendidoEn,
        listoDesde: r.listoDesde,
        entro: r.createdAt
    }));
}

// ── Etiquetas ────────────────────────────────────────────────────────────────────────────

export const ETIQUETAS_POR_PDF_MAX = 300;

/**
 * Lo que va en la etiqueta de cada rollo, en el orden en que llegaron los ids (el de la
 * recepción o el de la lista): código, tela, color, metros de la etiqueta del proveedor,
 * fecha de entrada y orden de compra. Una sola consulta (CLAUDE.md §7).
 */
export async function datosEtiquetasRollos(ids) {
    const unicos = [...new Set(ids.map(String))].slice(0, ETIQUETAS_POR_PDF_MAX);
    if (!unicos.length) return [];
    const filas = await InsumoRollo.sequelize.query(`
        SELECT r.idRollo, r.codigoRollo, r.metrajeInicialCm, r.createdAt,
               m.nombre material, a.valor color, o.numeroOrden
        FROM INSUMOS_ROLLOS r
        JOIN MATERIAL m ON m.idMaterial = r.idMaterial
        LEFT JOIN ATRIBUTOS a ON a.idAtributo = r.idAtributoColor
        JOIN INSUMOS_CAPAS c ON c.idCapa = r.idCapa
        LEFT JOIN DETALLES_ORDEN_COMPRA d ON d.idDetalleOrdenCompra = c.idDetalleOrdenCompra
        LEFT JOIN ORDENES_COMPRA o ON o.idOrdenCompra = d.idOrdenCompra
        WHERE r.idRollo IN (:ids)`,
        { replacements: { ids: unicos }, type: InsumoRollo.sequelize.QueryTypes.SELECT });
    const porId = new Map(filas.map(f => [f.idRollo, f]));
    return unicos.map(id => porId.get(id)).filter(Boolean);
}

/** Las líneas de texto de la etiqueta de un rollo (helpers/etiquetaCodigo.js). */
export const lineasEtiquetaRollo = (f) => {
    const metros = (Number(f.metrajeInicialCm) / 100).toLocaleString('es-CO', { maximumFractionDigits: 2 });
    const fecha = new Date(f.createdAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric' });
    return [
        { texto: f.color ? `${f.codigoRollo} · ${f.color}` : f.codigoRollo, tamano: 8.5, negrita: true, alto: 10, recortar: true },
        { texto: `${f.material} · ${metros} m`, tamano: 7, alto: 9, recortar: true },
        { texto: f.numeroOrden ? `${fecha} · ${f.numeroOrden}` : fecha, tamano: 6.5, alto: 8, recortar: true }
    ];
};
