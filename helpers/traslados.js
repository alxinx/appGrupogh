import { Op } from 'sequelize';
import {
    Stock, Traslados, DetalleTraslados, Pack, DetallesPack, InsidenciaTraslado,
    PuntosDeVenta, Productos, Empleados, Usuarios
} from '../models/index.js';
import { siguienteNumero } from './secuencias.js';

// Orígenes que no son una tienda: los packs que salen de la dosificación. No llevan STOCKS
// —su inventario es el pack EMPACADO— y lo que se devuelve ahí lo recibe la administración.
export const ORIGENES_PRODUCCION = ['PRODUCCION', 'BODEGA-VIRTUAL'];
export const esOrigenProduccion = (idOrigen) => ORIGENES_PRODUCCION.includes(idOrigen);

const valorDePack = async (idPack, transaction) => {
    const detalles = await DetallesPack.findAll({ where: { idPack }, transaction });
    return detalles.reduce((s, d) => s + (parseFloat(d.valorUnidad || 0) * d.cantidad), 0);
};

// Pone mercancía en el inventario de un punto de venta: un pack entra CERRADO; unidades
// sueltas, SUELTO, con el valor de la última fila conocida del producto.
export async function crearStockRow(idPuntoVenta, { idPack, idProducto }, cantidad, transaction) {
    if (idPack) {
        await Stock.create({
            idPuntoVenta,
            idPack,
            idProducto:        null,
            cantidadExistente: cantidad,
            cantidadOriginal:  cantidad,
            valorUnidad:       await valorDePack(idPack, transaction),
            estadoInterno:     'CERRADO'
        }, { transaction });
    } else if (idProducto) {
        const ref = await Stock.findOne({
            where: { idProducto },
            order: [['createdAt', 'DESC']],
            transaction
        });
        await Stock.create({
            idPuntoVenta,
            idPack:            null,
            idProducto,
            cantidadExistente: cantidad,
            cantidadOriginal:  cantidad,
            valorUnidad:       ref?.valorUnidad || 0,
            estadoInterno:     'SUELTO'
        }, { transaction });
    }
}

// idEmpleado de lo que escribe el job de traslados expirados. En la base
// INSIDENCIAS_TRASLADOS.idEmpleado es NOT NULL (el modelo dice lo contrario), así que con
// null el job moría en su primera fila. Mismo recurso que 'PRODUCCION' en TRASLADOS.idOrigen.
export const ACTOR_JOB_EXPIRADOS = 'SISTEMA-JOB-EXPIRADOS';

// Segundos que un traslado puede seguir EN_TRANSITO antes de que el job lo devuelva. El mismo
// valor pinta el semáforo de la tienda: el job leía otra variable (24h) y el semáforo esta
// (72h), así que la devolución llegaba antes de que el aviso pasara a rojo.
export const segundosMaximosEnTransito = () => parseInt(process.env.MAX_TRANSFER_TIME) || 259200;

// Desde dosificación solo sale lo recién empacado. En tienda un pack recibido sigue en
// TRASLADADO —aceptar nunca le cambia el estado—, así que ahí lo que prueba que el pack está
// en esa tienda es su fila de STOCKS CERRADO, no el estado.
export const ESTADOS_PACK_TRASLADABLE_DOSIFICACION = ['EMPACADO'];
export const ESTADOS_PACK_TRASLADABLE_TIENDA = ['EMPACADO', 'TRASLADADO'];

export class TrasladoRechazadoError extends Error {
    // auditoria: filas { idTraslado, idDetalleTraslado, cantidadOriginal } donde queda el rechazo.
    // idsPack: packs cuyo último traslado recibe la fila, porque el intento no llegó a crear uno.
    constructor(mensaje, { status = 400, auditoria = [], idsPack = [] } = {}) {
        super(mensaje);
        this.name = 'TrasladoRechazadoError';
        this.status = status;
        this.auditoria = auditoria;
        this.idsPack = idsPack;
    }
}

export class TrasladoEstadoInvalidoError extends TrasladoRechazadoError {
    constructor(mensaje, opciones = {}) {
        super(mensaje, { ...opciones, status: 409 });
        this.name = 'TrasladoEstadoInvalidoError';
    }
}

// Los ids van ordenados: dos transacciones que bloquean los mismos registros en distinto
// orden pueden quedar esperándose la una a la otra.
const bloquearYValidar = async (modelo, clave, ids, estadosPermitidos, transaction) => {
    if (!transaction) throw new Error(`Bloquear ${modelo.name} requiere una transacción.`);
    const unicos = [...new Set(ids.map(String))].sort();
    const filas = await modelo.findAll({
        where: { [clave]: unicos },
        order: [[clave, 'ASC']],
        lock: transaction.LOCK.UPDATE,
        transaction
    });
    const encontrados = new Set(filas.map(f => f[clave]));
    return {
        filas,
        faltantes: unicos.filter(id => !encontrados.has(id)),
        invalidas: filas.filter(f => !estadosPermitidos.includes(f.estado))
    };
};

// Un rechazo del traslado completo deja UNA fila, en el primer detalle: una por detalle
// llenaría el comprobante de líneas repetidas por cada doble clic.
export const filaDeTraslado = (traslado, detalle) => detalle
    ? [{ idTraslado: traslado.idTraslado, idDetalleTraslado: detalle.idDetalleTraslado, cantidadOriginal: detalle.cantidad }]
    : [];

// La fila del traslado es el mutex de todo lo que le cambia el estado (aceptar, resolver, el
// job). Los detalles no se bloquean: DETALLE_TRASLADOS no tiene índice en idTraslado y un
// FOR UPDATE ahí trabaría la tabla entera; nadie los modifica sin tener antes esta fila.
// Tiene que ser la primera lectura de la transacción para que los detalles salgan frescos.
export async function bloquearYValidarTraslado(idTraslado, estadosPermitidos, transaction) {
    const { filas: [traslado], faltantes } =
        await bloquearYValidar(Traslados, 'idTraslado', [idTraslado], estadosPermitidos, transaction);
    if (faltantes.length) throw new TrasladoRechazadoError('Traslado no encontrado.', { status: 404 });

    const detalles = await DetalleTraslados.findAll({
        where: { idTraslado: traslado.idTraslado },
        order: [['idDetalleTraslado', 'ASC']],
        transaction
    });

    if (!estadosPermitidos.includes(traslado.estado)) {
        throw new TrasladoEstadoInvalidoError(
            `El traslado ${traslado.codigoTraslado} no admite esta acción: está ${traslado.estado}.`,
            { auditoria: filaDeTraslado(traslado, detalles[0]) }
        );
    }
    return { traslado, detalles };
}

export async function bloquearYValidarPacks(idsPack, estadosPermitidos, transaction) {
    const { filas, faltantes, invalidas } =
        await bloquearYValidar(Pack, 'idPack', idsPack, estadosPermitidos, transaction);
    if (faltantes.length) {
        throw new TrasladoRechazadoError(`${faltantes.length} de los paquetes enviados no existen.`);
    }
    if (invalidas.length) {
        throw new TrasladoEstadoInvalidoError(
            `No se puede trasladar: ${invalidas.map(p => `${p.codigoEtiqueta} está ${p.estado}`).join(', ')}.`,
            { idsPack: invalidas.map(p => p.idPack) }
        );
    }
    return filas;
}

// Del navegador solo se toma el id del detalle: cantidades, pack y producto salen de la base.
export function detallesDelBody(traslado, detalles, items) {
    const porId = new Map(detalles.map(d => [d.idDetalleTraslado, d]));
    const usados = new Set();
    return items.map((item) => {
        const id = Number(item?.idDetalleTraslado);
        const detalle = porId.get(id);
        if (!detalle || usados.has(id)) {
            throw new TrasladoRechazadoError(
                detalle
                    ? `El ítem #${id} viene repetido.`
                    : `El ítem #${item?.idDetalleTraslado} no pertenece al traslado ${traslado.codigoTraslado}.`,
                { auditoria: filaDeTraslado(traslado, detalle || detalles[0]) }
            );
        }
        usados.add(id);
        return { item, detalle };
    });
}

const EVENTOS_RUTINARIOS = ['ENVIADO', 'RECIBIDO', 'DEVUELTO AL ORIGEN', 'DEVUELTO'];

// Un envío de 100 packs deja 100 incidencias iguales salvo el código ("ENVIADO: pack X").
// Separa lo que exige atención (un rechazo, un faltante, un intento bloqueado) de lo rutinario,
// y junta lo rutinario de packs de un mismo evento en un solo bloque. Empleado y evento bastan
// como clave: cada evento ocurre una sola vez por traslado. La usan la tirilla y el detalle
// del traslado en la tienda, para que los dos cuenten la misma historia.
//
// Espera las incidencias con `detalle.pack` / `detalle.producto` incluidos y en orden de id.
export function agruparInsidencias(insidencias) {
    const bloques = [];
    const grupos = new Map();
    for (const ins of insidencias) {
        const razon = ins.razonInsidencia || '';
        const evento = razon.split(':')[0].trim();
        const rutinaria = EVENTOS_RUTINARIOS.includes(evento) && ins.cantidadOriginal === ins.cantidadAceptada;
        const tipo = razon.startsWith('RECHAZADO') ? 'intento' : (rutinaria ? 'movimiento' : 'incidencia');

        if (tipo !== 'movimiento' || !ins.detalle?.pack) {
            bloques.push({ ins, tipo, evento: tipo === 'movimiento' ? evento : null, codigos: [], original: ins.cantidadOriginal, aceptada: ins.cantidadAceptada });
            continue;
        }
        const clave = `${evento}|${ins.idEmpleado}`;
        if (!grupos.has(clave)) {
            const grupo = { ins, tipo, evento, codigos: [], original: 0, aceptada: 0 };
            grupos.set(clave, grupo);
            bloques.push(grupo);
        }
        const grupo = grupos.get(clave);
        grupo.codigos.push(ins.detalle.pack.codigoEtiqueta);
        grupo.original += ins.cantidadOriginal;
        grupo.aceptada += ins.cantidadAceptada;
    }
    return bloques;
}

/**
 * El origen recibe de vuelta todo lo que el destino rechazó, y el traslado se cierra.
 *
 * Lo rechazado solo puede volver al origen: el destino nunca se queda con algo que rechazó,
 * y si hay que mandarlo otra vez es un traslado nuevo. Por eso no hay nada que elegir por
 * ítem. La comparten la tienda (devoluciones entre tiendas) y el admin (las de producción);
 * cada una dice quién puede recibir con `validarReceptor`, que devuelve el motivo del
 * rechazo o null.
 */
export async function recibirDevolucionTraslado(idTraslado, { empleado, validarReceptor }, transaction) {
    const { traslado, detalles } = await bloquearYValidarTraslado(idTraslado, ['EN_CONTROVERSIA'], transaction);

    const motivo = validarReceptor(traslado);
    if (motivo) {
        throw new TrasladoRechazadoError(motivo, { status: 403, auditoria: filaDeTraslado(traslado, detalles[0]) });
    }

    const desdeProduccion = esOrigenProduccion(traslado.idOrigen);
    for (const detalle of detalles.filter(d => d.estado === 'CONTROVERSIA')) {
        const cantidad = detalle.cantidadControversia ?? detalle.cantidad;
        if (cantidad <= 0) continue;

        if (desdeProduccion) {
            if (detalle.idPack) {
                await Pack.update({ estado: 'EMPACADO' }, { where: { idPack: detalle.idPack }, transaction });
            }
        } else {
            await crearStockRow(traslado.idOrigen, { idPack: detalle.idPack, idProducto: detalle.idProducto }, cantidad, transaction);
        }

        await InsidenciaTraslado.create({
            idTraslado:        traslado.idTraslado,
            idDetalleTraslado: detalle.idDetalleTraslado,
            idEmpleado:        empleado.idEmpleado,
            razonInsidencia:   `DEVUELTO AL ORIGEN: recibido por ${empleado.nombre}`,
            cantidadOriginal:  cantidad,
            cantidadAceptada:  cantidad,
            resuelta:          'si'
        }, { transaction });
    }

    // Por id y no por idTraslado: INSIDENCIAS_TRASLADOS no tiene índice en idTraslado, y un
    // UPDATE por esa columna bloquearía la tabla entera hasta el commit.
    const abiertas = await InsidenciaTraslado.findAll({
        where: { idTraslado: traslado.idTraslado, resuelta: 'no' },
        attributes: ['idInsidencia'],
        transaction
    });
    if (abiertas.length) {
        await InsidenciaTraslado.update(
            { resuelta: 'si' },
            { where: { idInsidencia: abiertas.map(i => i.idInsidencia) }, transaction }
        );
    }

    await traslado.update({ estado: 'RECIBIDO' }, { transaction });
    return traslado;
}

const nombreDe = (e) => (e ? `${e.PrimerNombre || ''} ${e.PrimerApellido || ''}`.trim() : null);

// Incluye de las incidencias el `empleado` y el `detalle` con su pack o producto.
export const INCLUDE_INSIDENCIA = [
    { model: Empleados, as: 'empleado', attributes: ['PrimerNombre', 'PrimerApellido'] },
    {
        model: DetalleTraslados, as: 'detalle',
        include: [
            { model: Pack, as: 'pack', attributes: ['codigoEtiqueta'] },
            { model: Productos, as: 'producto', attributes: ['nombreProducto', 'sku'] }
        ]
    }
];

// Lo que pinta src/js/historialTraslado.js, a partir de incidencias cargadas con
// INCLUDE_INSIDENCIA. Lo usan el detalle de un traslado y el historial de un pack.
export const vistaHistorial = (insidencias) => {
    const ordenadas = [...insidencias].sort((a, b) => a.idInsidencia - b.idInsidencia);
    return agruparInsidencias(ordenadas).map(({ ins, tipo, evento, codigos, original, aceptada }) => ({
        tipo,
        evento,
        razon:    ins.razonInsidencia,
        fecha:    ins.fechaInsidencia,
        empleado: ins.idEmpleado === ACTOR_JOB_EXPIRADOS ? 'Sistema (traslado vencido)' : nombreDe(ins.empleado),
        etiqueta: ins.detalle?.pack?.codigoEtiqueta || ins.detalle?.producto?.nombreProducto || null,
        codigos,
        original,
        aceptada,
        resuelta: ins.resuelta === 'si'
    }));
};

/**
 * Un traslado con sus ítems y su historial agrupado, listo para el detalle de la tienda y
 * del admin. `idPuntoDeVenta` acota a los traslados de esa tienda; sin él, el admin ve todos.
 * Devuelve null si no existe o no le pertenece.
 */
export async function cargarDetalleTraslado(idTraslado, { idPuntoDeVenta = null } = {}) {
    const where = { idTraslado };
    if (idPuntoDeVenta) where[Op.or] = [{ idOrigen: idPuntoDeVenta }, { idDestino: idPuntoDeVenta }];

    const traslado = await Traslados.findOne({
        where,
        include: [
            { model: PuntosDeVenta, as: 'origen',  attributes: ['nombreComercial'], required: false },
            { model: PuntosDeVenta, as: 'destino', attributes: ['nombreComercial'], required: false },
            {
                model: DetalleTraslados, as: 'items',
                include: [
                    {
                        model: Pack, as: 'pack',
                        attributes: ['codigoEtiqueta', 'estado'],
                        include: [{
                            model: DetallesPack,
                            include: [{ model: Productos, as: 'producto', attributes: ['nombreProducto', 'sku'] }]
                        }]
                    },
                    { model: Productos, as: 'producto', attributes: ['nombreProducto', 'sku'] }
                ]
            },
            { model: InsidenciaTraslado, as: 'insidencias', include: INCLUDE_INSIDENCIA }
        ]
    });
    if (!traslado) return null;

    // idUsuarioDespacha guarda un empleado en los flujos de tienda y dosificación, y un
    // usuario del panel en el traslado desde el admin: se busca en las dos tablas.
    const ids = [traslado.idUsuarioDespacha, traslado.idUsuarioRecibe].filter(Boolean);
    const [empleados, usuarios] = ids.length ? await Promise.all([
        Empleados.findAll({ where: { idEmpleado: ids }, attributes: ['idEmpleado', 'PrimerNombre', 'PrimerApellido'], raw: true }),
        Usuarios.findAll({ where: { idUsuario: ids }, attributes: ['idUsuario', 'nombreUsuario'], raw: true })
    ]) : [[], []];
    const persona = (id) => nombreDe(empleados.find(e => e.idEmpleado === id))
        || usuarios.find(u => u.idUsuario === id)?.nombreUsuario
        || null;

    return {
        traslado,
        historial: vistaHistorial(traslado.insidencias),
        personas: { despacha: persona(traslado.idUsuarioDespacha), recibe: persona(traslado.idUsuarioRecibe) }
    };
}

export const registrarEnvio = (transaction, { traslado, detalle, idEmpleado, descripcion }) =>
    InsidenciaTraslado.create({
        idTraslado:        traslado.idTraslado,
        idDetalleTraslado: detalle.idDetalleTraslado,
        idEmpleado,
        razonInsidencia:   `ENVIADO: ${descripcion}`,
        cantidadOriginal:  detalle.cantidad,
        cantidadAceptada:  detalle.cantidad,
        resuelta:          'si'
    }, { transaction });

// Se llama DESPUÉS del rollback y fuera de esa transacción: escrita adentro, el rollback que
// deshace el intento se llevaría también la prueba de que existió. Nunca lanza, para no
// convertir un rechazo en un 500.
export async function registrarRechazo(error, { idEmpleado, accion }) {
    try {
        const filas = [...error.auditoria];
        if (error.idsPack.length) {
            const ultimos = await DetalleTraslados.findAll({
                where: { idPack: error.idsPack },
                attributes: ['idDetalleTraslado', 'idTraslado', 'idPack', 'cantidad'],
                order: [['idDetalleTraslado', 'DESC']]
            });
            const vistos = new Set();
            for (const d of ultimos) {
                if (vistos.has(d.idPack)) continue;
                vistos.add(d.idPack);
                filas.push({ idTraslado: d.idTraslado, idDetalleTraslado: d.idDetalleTraslado, cantidadOriginal: d.cantidad });
            }
            const sinTraslado = error.idsPack.filter(id => !vistos.has(id));
            if (sinTraslado.length) {
                console.warn(`[traslados] Rechazo (${accion}) de packs sin traslado previo donde auditarlo: ${sinTraslado.join(', ')} — ${error.message}`);
            }
        }
        if (!filas.length) {
            console.warn(`[traslados] Rechazo (${accion}) sin detalle donde auditarlo, empleado ${idEmpleado}: ${error.message}`);
            return;
        }
        const razonInsidencia = `RECHAZADO (${accion}): ${error.message}`.slice(0, 500);
        await InsidenciaTraslado.bulkCreate(filas.map(f => ({
            ...f, idEmpleado, razonInsidencia, cantidadAceptada: 0, resuelta: 'si'
        })));
    } catch (e) {
        console.error(`[traslados] No se pudo auditar el rechazo (${accion}): ${error.message}`, e);
    }
}

// Descuenta `cantidad` de un producto en un punto de venta usando FIFO sobre los lotes de STOCK
// (los más antiguos primero) — mismo mecanismo que usa el traslado manual de empleados.
// Lanza si no hay stock suficiente. Debe llamarse dentro de una transacción.
export async function descontarStockFifo(idProducto, idPuntoVenta, cantidad, transaction) {
    const filasStock = await Stock.findAll({
        where: { idProducto, idPuntoVenta, cantidadExistente: { [Op.gt]: 0 } },
        order: [['createdAt', 'ASC']],
        lock: transaction.LOCK.UPDATE,
        transaction
    });
    let restante = parseFloat(cantidad);
    for (const fila of filasStock) {
        if (restante <= 0) break;
        const disponible = parseFloat(fila.cantidadExistente);
        if (disponible <= restante) {
            await fila.update({ cantidadExistente: 0 }, { transaction });
            restante -= disponible;
        } else {
            await fila.update({ cantidadExistente: disponible - restante }, { transaction });
            restante = 0;
        }
    }
    if (restante > 0) {
        throw new Error(`Stock insuficiente para el producto ${idProducto} en el punto de venta ${idPuntoVenta}.`);
    }
}

// Siguiente código correlativo de traslado (TR-1000, TR-1001, ...).
// Sale del contador de SECUENCIAS, no de leer el último traslado: dos traslados creados en el
// mismo segundo —la tienda facturando en el POS mientras entra un pago web— calculaban el mismo
// código y el segundo moría contra el índice único de codigoTraslado.
export async function siguienteCodigoTraslado(transaction) {
    return `TR-${await siguienteNumero('traslado', transaction)}`;
}
