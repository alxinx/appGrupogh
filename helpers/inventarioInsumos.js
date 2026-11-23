import Decimal from 'decimal.js';
import { QueryTypes } from 'sequelize';
import db from '../config/bd.js';
import { InsumoCapa, InsumoMovimiento, MaterialPresentacion } from '../models/index.js';
import { errorPublico } from './helpers.js';
import { dec, a4 } from './unidadesInsumo.js';

// Inventario de insumos (PLAN_COSTEO_PRODUCCION.md §3). TODO movimiento pasa por acá: ningún
// controlador escribe INSUMOS_CAPAS ni INSUMOS_MOVIMIENTOS directo.
//
// - Cada entrada es una capa con su costo; se gasta de la más vieja a la más nueva (FIFO).
// - Toda función corre dentro de la transacción del llamador (`transaction` obligatoria)
//   y bloquea las capas que toca (FOR UPDATE) + update condicionado con revisión de filas
//   afectadas (CLAUDE.md §9): dos salidas simultáneas no pueden gastar la misma cantidad.
// - Además, INSUMOS_CAPAS tiene un CHECK en la base: ninguna cantidad negativa y la suma
//   de los estados siempre igual a la inicial. Un error de lógica acá falla la transacción
//   en vez de descuadrar el inventario.
// - Todas las cantidades van en la UNIDAD DE CONSUMO del material.

// ── Actor ────────────────────────────────────────────────────────────────────────────────
// Quién movió el inventario. Genérico a propósito: hoy siempre es el panel; el portal del
// confeccionista (PLAN_COSTEO_PRODUCCION.md §7) armará el suyo con origen 'portal'.

/** Actor de una petición del panel (usuario de la sesión + empleado verificado, si lo hay). */
export const actorDelPanel = (req) => ({
    origen: 'panel',
    idUsuario: req.usuario?.idUsuario ?? null,
    nombreUsuario: req.usuario ? `${req.usuario.nombreUsuario} ${req.usuario.apellidoUsuario || ''}`.trim() : null,
    empleado: req.empleadoVerificado ?? null
});

export const columnasActor = (actor = {}) => ({
    origen: actor.origen || 'panel',
    idUsuario: actor.idUsuario ?? null,
    nombreUsuario: actor.nombreUsuario ?? null,
    idEmpleado: actor.empleado?.idEmpleado ?? null,
    nombreEmpleado: actor.empleado?.nombre ?? null,
    codigoEmpleado: actor.empleado?.codigoEmpleado ?? null
});

const exigirTransaccion = (transaction) => {
    if (!transaction) throw new Error('inventarioInsumos: toda operación va dentro de una transacción');
};

// ── Entradas ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea una capa nueva: una recepción de compra (`origen: 'compra'`) o un ajuste de entrada
 * por conteo físico (`origen: 'ajuste'`, con motivo). Devuelve la capa.
 */
export async function registrarEntrada({
    idMaterial, idAtributoColor = null, cantidad, costoUnitario, ivaUnitario = 0,
    origen = 'compra', idDetalleOrdenCompra = null, motivo = null, actor, transaction
}) {
    exigirTransaccion(transaction);
    if (!dec(cantidad).gt(0)) throw errorPublico('La cantidad que entra al inventario debe ser mayor a 0.');
    if (dec(costoUnitario).lt(0)) throw errorPublico('El costo no puede ser negativo.');

    const capa = await InsumoCapa.create({
        idMaterial,
        idAtributoColor,
        origen,
        idDetalleOrdenCompra,
        fechaEntrada: new Date(),
        cantidadInicial: a4(cantidad),
        cantidadDisponible: a4(cantidad),
        costoUnitario: a4(costoUnitario),
        ivaUnitario: a4(ivaUnitario)
    }, { transaction });

    await InsumoMovimiento.create({
        idCapa: capa.idCapa,
        idMaterial,
        tipo: origen === 'compra' ? 'entrada' : 'ajuste_entrada',
        cantidad: a4(cantidad),
        costoUnitario: a4(costoUnitario),
        idDetalleOrdenCompra,
        motivo,
        ...columnasActor(actor)
    }, { transaction });

    return capa;
}

// ── Movimientos FIFO ─────────────────────────────────────────────────────────────────────

// Columnas de estado de una capa. `null` como destino = la cantidad no pasa a otro estado
// de la capa (no se usa hoy: toda salida cae en consumida o baja, para que la capa cuadre).
const ESTADOS = new Set(['cantidadDisponible', 'cantidadReservada', 'cantidadEnProceso', 'cantidadConsumida', 'cantidadBaja']);

/**
 * Pasa `cantidad` de un estado a otro en las capas de un material, de la más vieja a la más
 * nueva. Escribe un movimiento por capa tocada y devuelve [{ idCapa, cantidad, costoUnitario }].
 *
 * `idAtributoColor`: undefined = cualquier color; null = solo sin color; número = ese color.
 * Lanza 409 si no alcanza (no mueve nada: la transacción del llamador se revierte).
 *
 * Es la pieza que reusa la orden de producción (entrega 2): reservar = disponible→reservada,
 * entregar al taller = reservada→enProceso, consumir = enProceso→consumida, etc.
 */
export async function moverFIFO({ idMaterial, idAtributoColor, idCapa = null, cantidad, desde, hacia, tipo, motivo = null, actor, transaction }) {
    exigirTransaccion(transaction);
    if (!ESTADOS.has(desde) || !ESTADOS.has(hacia) || desde === hacia) throw new Error(`moverFIFO: estados inválidos ${desde} → ${hacia}`);
    const pedida = dec(cantidad);
    if (!pedida.gt(0)) throw errorPublico('La cantidad debe ser mayor a 0.');

    const where = { idMaterial };
    if (idAtributoColor !== undefined) where.idAtributoColor = idAtributoColor;
    // Una capa puntual: la tela sale del rollo que se eligió, no de la capa más vieja
    // (helpers/rollosTela.js). Mismos candados y mismo registro que el FIFO.
    if (idCapa) where.idCapa = idCapa;
    const capas = await InsumoCapa.findAll({
        where,
        order: [['fechaEntrada', 'ASC'], [db.literal('secuencia'), 'ASC']],   // FIFO, orden total
        lock: transaction.LOCK.UPDATE,
        transaction
    });

    const conSaldo = capas.filter(c => dec(c[desde]).gt(0));
    const hay = conSaldo.reduce((s, c) => s.plus(dec(c[desde])), dec(0));
    if (hay.lt(pedida)) {
        throw errorPublico(`No alcanza: se necesitan ${a4(pedida).replace(/\.?0+$/, '')} y hay ${a4(hay).replace(/\.?0+$/, '')}.`, 409);
    }

    const tomadas = [];
    let falta = pedida;
    for (const capa of conSaldo) {
        if (falta.lte(0)) break;
        const toma = Decimal.min(falta, dec(capa[desde]));
        // Condicionado: si otra transacción la movió entre la lectura y acá, no se pisa.
        const [, filas] = await db.query(
            `UPDATE INSUMOS_CAPAS SET ${desde} = ${desde} - :t, ${hacia} = ${hacia} + :t, updatedAt = NOW()
             WHERE idCapa = :id AND ${desde} >= :t`,
            { replacements: { t: a4(toma), id: capa.idCapa }, transaction });
        if (!filas) throw errorPublico('El inventario cambió mientras tanto. Intenta de nuevo.', 409);

        await InsumoMovimiento.create({
            idCapa: capa.idCapa, idMaterial, tipo,
            cantidad: a4(toma), costoUnitario: capa.costoUnitario, motivo,
            ...columnasActor(actor)
        }, { transaction });

        tomadas.push({ idCapa: capa.idCapa, cantidad: a4(toma), costoUnitario: capa.costoUnitario });
        falta = falta.minus(toma);
    }
    return tomadas;
}


/**
 * Salida por conteo físico (pérdida, daño, error de carga): disponible → baja, FIFO. Con
 * `idCapa`, solo de esa capa (la salida de un rollo de tela, helpers/rollosTela.js).
 */
export const registrarSalidaAjuste = ({ idMaterial, idAtributoColor, idCapa = null, cantidad, motivo, actor, transaction }) =>
    moverFIFO({ idMaterial, idAtributoColor, idCapa, cantidad, desde: 'cantidadDisponible', hacia: 'cantidadBaja', tipo: 'ajuste_salida', motivo, actor, transaction });

// ── Presentaciones recordadas ───────────────────────────────────────────────────────────

/** Guarda el contenido confirmado como sugerencia para la próxima recepción. */
export const recordarPresentacion = ({ idMaterial, presentacion, contenido, transaction }) =>
    db.query(
        `INSERT INTO MATERIAL_PRESENTACIONES (idMaterial, presentacion, contenidoSugerido, createdAt, updatedAt)
         VALUES (:idMaterial, :presentacion, :contenido, NOW(), NOW())
         ON DUPLICATE KEY UPDATE contenidoSugerido = VALUES(contenidoSugerido), updatedAt = NOW()`,
        { replacements: { idMaterial, presentacion, contenido: a4(contenido) }, transaction });

/** { [idMaterial]: { [presentacion]: contenido } } para precargar la recepción. */
export async function presentacionesRecordadas(idsMaterial) {
    if (!idsMaterial.length) return {};
    const filas = await MaterialPresentacion.findAll({ where: { idMaterial: idsMaterial }, raw: true });
    const r = {};
    for (const f of filas) (r[f.idMaterial] ||= {})[f.presentacion] = f.contenidoSugerido;
    return r;
}

// ── Lecturas ─────────────────────────────────────────────────────────────────────────────

/**
 * Existencias y costo de varios materiales en UNA consulta (sin N+1, CLAUDE.md §7).
 * Devuelve Map idMaterial → { disponible, reservada, enProceso, costoPonderado, ultimoCosto }
 * (strings con 4 decimales; costoPonderado/ultimoCosto null si no hay).
 *
 * costoPonderado = Σ(disponible × costo) / Σ(disponible) de las capas con disponible > 0
 * (PLAN_COSTEO_PRODUCCION.md D1): lo que está en manos de un taller NO entra.
 */
export async function existenciasDeMateriales(idsMaterial, { transaction } = {}) {
    const res = new Map();
    if (!idsMaterial.length) return res;
    const filas = await db.query(`
        SELECT c.idMaterial,
               SUM(c.cantidadDisponible) disponible,
               SUM(c.cantidadReservada)  reservada,
               SUM(c.cantidadEnProceso)  enProceso,
               SUM(c.cantidadDisponible * c.costoUnitario) valorDisponible,
               (SELECT u.costoUnitario FROM INSUMOS_CAPAS u
                 WHERE u.idMaterial = c.idMaterial AND u.origen = 'compra'
                 ORDER BY u.fechaEntrada DESC, u.secuencia DESC LIMIT 1) ultimoCosto
        FROM INSUMOS_CAPAS c
        WHERE c.idMaterial IN (:ids)
        GROUP BY c.idMaterial`,
        { replacements: { ids: idsMaterial }, type: QueryTypes.SELECT, transaction });
    for (const f of filas) {
        const disponible = dec(f.disponible);
        res.set(f.idMaterial, {
            disponible: a4(disponible),
            reservada: a4(f.reservada),
            enProceso: a4(f.enProceso),
            costoPonderado: disponible.gt(0) ? a4(dec(f.valorDisponible).div(disponible)) : null,
            ultimoCosto: f.ultimoCosto === null ? null : a4(f.ultimoCosto)
        });
    }
    return res;
}

/** Las capas con algo todavía (no agotadas) de un material, en orden FIFO, con su origen. */
export const capasVivas = (idMaterial) => db.query(`
    SELECT c.idCapa, c.origen, c.fechaEntrada, c.idAtributoColor, a.valor colorNombre,
           c.cantidadInicial, c.cantidadDisponible, c.cantidadReservada, c.cantidadEnProceso,
           c.costoUnitario, c.ivaUnitario, o.numeroOrden, o.idOrdenCompra
    FROM INSUMOS_CAPAS c
    LEFT JOIN ATRIBUTOS a ON a.idAtributo = c.idAtributoColor
    LEFT JOIN DETALLES_ORDEN_COMPRA d ON d.idDetalleOrdenCompra = c.idDetalleOrdenCompra
    LEFT JOIN ORDENES_COMPRA o ON o.idOrdenCompra = d.idOrdenCompra
    WHERE c.idMaterial = :idMaterial
      AND (c.cantidadDisponible > 0 OR c.cantidadReservada > 0 OR c.cantidadEnProceso > 0)
    ORDER BY c.fechaEntrada ASC, c.secuencia ASC`,
    { replacements: { idMaterial }, type: QueryTypes.SELECT });

/** Disponible por color de un material (para elegir de cuál sale un ajuste). */
export const disponiblePorColor = (idMaterial) => db.query(`
    SELECT c.idAtributoColor, a.valor colorNombre, SUM(c.cantidadDisponible) disponible
    FROM INSUMOS_CAPAS c
    LEFT JOIN ATRIBUTOS a ON a.idAtributo = c.idAtributoColor
    WHERE c.idMaterial = :idMaterial
    GROUP BY c.idAtributoColor, a.valor
    HAVING SUM(c.cantidadDisponible) > 0
    ORDER BY a.valor`,
    { replacements: { idMaterial }, type: QueryTypes.SELECT });

/**
 * Disponible de varios materiales, por color, en UNA consulta (para revisar el material de
 * una orden de producción sin una consulta por insumo, CLAUDE.md §7).
 * Devuelve un Map idMaterial → { total: Decimal, porColor: Map(idAtributoColor|null → Decimal) }.
 */
export async function disponiblePorMaterialYColor(idsMaterial, { transaction } = {}) {
    const res = new Map();
    if (!idsMaterial.length) return res;
    const filas = await db.query(`
        SELECT idMaterial, idAtributoColor, SUM(cantidadDisponible) disponible
        FROM INSUMOS_CAPAS
        WHERE idMaterial IN (:ids)
        GROUP BY idMaterial, idAtributoColor`,
        { replacements: { ids: idsMaterial }, type: QueryTypes.SELECT, transaction });
    for (const f of filas) {
        if (!res.has(f.idMaterial)) res.set(f.idMaterial, { total: dec(0), porColor: new Map() });
        const m = res.get(f.idMaterial);
        m.total = m.total.plus(dec(f.disponible));
        m.porColor.set(f.idAtributoColor ?? null, dec(f.disponible));
    }
    return res;
}

/**
 * De estos materiales, cuáles manejan colores: los que tienen alguna compra o capa de
 * inventario con color. MATERIAL no tiene una marca propia de "lleva color": el color vive
 * en la línea de compra y en la capa (models/DetallesOrdenCompra.js), así que se deduce de ahí.
 */
export async function materialesConColor(idsMaterial, { transaction } = {}) {
    if (!idsMaterial.length) return new Set();
    const filas = await db.query(`
        SELECT DISTINCT idMaterial FROM INSUMOS_CAPAS
         WHERE idMaterial IN (:ids) AND idAtributoColor IS NOT NULL
        UNION
        SELECT DISTINCT idMaterial FROM DETALLES_ORDEN_COMPRA
         WHERE idMaterial IN (:ids) AND idAtributoColor IS NOT NULL`,
        { replacements: { ids: idsMaterial }, type: QueryTypes.SELECT, transaction });
    return new Set(filas.map(f => f.idMaterial));
}

/** Libro de un material, más reciente primero, de a `limite` con cursor por idMovimiento. */
export const movimientosDeMaterial = (idMaterial, { limite = 20, antesDe = null } = {}) => db.query(`
    SELECT m.idMovimiento, m.tipo, m.cantidad, m.costoUnitario, m.motivo, m.origen, m.createdAt,
           m.nombreUsuario, m.nombreEmpleado, o.numeroOrden, o.idOrdenCompra
    FROM INSUMOS_MOVIMIENTOS m
    LEFT JOIN DETALLES_ORDEN_COMPRA d ON d.idDetalleOrdenCompra = m.idDetalleOrdenCompra
    LEFT JOIN ORDENES_COMPRA o ON o.idOrdenCompra = d.idOrdenCompra
    WHERE m.idMaterial = :idMaterial ${antesDe ? 'AND m.idMovimiento < :antesDe' : ''}
    ORDER BY m.idMovimiento DESC
    LIMIT :limite`,
    { replacements: { idMaterial, antesDe, limite }, type: QueryTypes.SELECT });

/** ¿El material tiene o tuvo inventario? (no se le cambia la unidad de consumo si sí). */
export const tieneInventario = async (idMaterial, { transaction } = {}) =>
    (await InsumoCapa.count({ where: { idMaterial }, transaction })) > 0;

// ── Presentación para el perfil del insumo ──────────────────────────────────────────────

const ETIQUETA_MOVIMIENTO = {
    entrada: 'Entrada por compra', ajuste_entrada: 'Ajuste de entrada', ajuste_salida: 'Ajuste de salida',
    reserva: 'Reservado para taller', liberar_reserva: 'Reserva liberada', entrega_taller: 'Entregado a taller',
    devolucion: 'Devuelto por taller', consumo: 'Consumido en producción', merma: 'Merma', cobro_taller: 'Cobrado al taller'
};
// Lo que suma al disponible (verde) y lo que resta (rojo); lo demás cambia de estado sin
// entrar ni salir del inventario.
const SIGNO_MOVIMIENTO = { entrada: 1, ajuste_entrada: 1, devolucion: 1, liberar_reserva: 1, ajuste_salida: -1, reserva: -1, consumo: -1, merma: -1, cobro_taller: -1 };

const numero = (v) => Number(v).toLocaleString('es-CO', { maximumFractionDigits: 4 });
const pesos = (v) => (v === null || v === undefined ? null : `$${numero(v)}`);
const fecha = (f) => new Date(f).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric' });

/** Todo lo del inventario que pinta el perfil de un material, ya formateado. */
export async function inventarioDelMaterial(material, unidadCorta) {
    const [existencias, capas, movimientos, colores] = await Promise.all([
        existenciasDeMateriales([material.idMaterial]),
        capasVivas(material.idMaterial),
        movimientosDeMaterial(material.idMaterial),
        disponiblePorColor(material.idMaterial)
    ]);
    const e = existencias.get(material.idMaterial);
    const enTalleres = e ? dec(e.reservada).plus(dec(e.enProceso)) : dec(0);
    return {
        unidad: unidadCorta,
        tiene: Boolean(e),
        disponible: numero(e?.disponible ?? 0),
        hayDisponible: Boolean(e && dec(e.disponible).gt(0)),
        enTalleres: numero(a4(enTalleres)),
        costoPonderado: pesos(e?.costoPonderado),
        ultimoCosto: pesos(e?.ultimoCosto),
        capas: capas.map(c => ({
            fecha: fecha(c.fechaEntrada),
            origen: c.origen === 'compra' ? (c.numeroOrden || 'Compra') : 'Ajuste',
            idOrdenCompra: c.idOrdenCompra,
            color: c.colorNombre,
            inicial: numero(c.cantidadInicial),
            disponible: numero(c.cantidadDisponible),
            enTalleres: numero(a4(dec(c.cantidadReservada).plus(dec(c.cantidadEnProceso)))),
            costo: pesos(c.costoUnitario)
        })),
        movimientos: movimientos.map(m => ({
            fecha: fecha(m.createdAt),
            tipo: ETIQUETA_MOVIMIENTO[m.tipo] || m.tipo,
            signo: SIGNO_MOVIMIENTO[m.tipo] || 0,
            cantidad: numero(m.cantidad),
            costo: pesos(m.costoUnitario),
            motivo: m.motivo,
            quien: m.nombreEmpleado || m.nombreUsuario || '—',
            numeroOrden: m.numeroOrden,
            idOrdenCompra: m.idOrdenCompra
        })),
        // Para elegir de qué color sale un ajuste: solo lo que tiene disponible.
        colores: colores.map(c => ({ idAtributoColor: c.idAtributoColor, nombre: c.colorNombre || 'Sin color', disponible: numero(c.disponible) }))
    };
}
