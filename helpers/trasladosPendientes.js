import { fn, col, Op } from 'sequelize';
import {
    TrasladoEfectivo, TrasladoEfectivoHistorial,
    Empleados, PuntosDeVenta, Documentacion
} from '../models/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Qué cuenta como "traslado pendiente por aceptar".
//
// Un traslado en 'En Transito' es plata que ya salió del cajón de una tienda pero que
// todavía no está asentada en ninguna cuenta: `idMovimiento` es nulo hasta que el
// responsable de la caja o el banco destino la acepta. Mientras tanto no aparece en
// ningún saldo, y por eso hay que avisar — es el único estado en el que hay dinero del
// negocio que nadie está viendo.
//
// Los otros tres estados no esperan nada: 'Recibido' ya se asentó, 'Rechazado' se cerró,
// y 'Controversia' es una discusión abierta que se atiende desde el traslado mismo, no
// desde una campana en el listado.
//
// El criterio vive acá y no repartido por los controladores para que el número del badge
// del menú, el de las campanas del listado y el que viaja por SSE no puedan
// desincronizarse: si cambia, cambia en un solo lugar. Mismo motivo que
// helpers/pedidosWeb.js.
// ─────────────────────────────────────────────────────────────────────────────

export const wherePendienteAceptar = () => ({ estado: 'En Transito' });

/**
 * Cuántos traslados espera cada cuenta, y el total.
 *
 * Una sola consulta agrupada para todas las cuentas, nunca una por fila: el listado
 * pinta una campana por caja y con un count por cuenta el número de consultas crecería
 * con el número de cuentas.
 *
 * @returns {Promise<{ total: number, porCuenta: Record<string, number> }>}
 */
export const resumenPendientes = async () => {
    const filas = await TrasladoEfectivo.findAll({
        where: wherePendienteAceptar(),
        attributes: ['idCajaBanco', [fn('COUNT', col('idTrasladosEfectivo')), 'pendientes']],
        group: ['idCajaBanco'],
        raw: true
    });

    const porCuenta = {};
    let total = 0;
    for (const f of filas) {
        const n = parseInt(f.pendientes, 10) || 0;
        porCuenta[f.idCajaBanco] = n;
        total += n;
    }
    return { total, porCuenta };
};

/**
 * Los traslados que esta cuenta todavía no aceptó, con todo lo que necesita el modal de
 * aceptación: de dónde viene la plata, quién la despachó, cuánto, cuándo y con qué
 * comprobante.
 *
 * No salen de MOVIMIENTOS_CAJAS_BANCOS y no pueden salir de ahí: un traslado en tránsito
 * todavía no generó movimiento —`idMovimiento` es nulo hasta que se acepta—, justamente
 * porque esa plata no está en ningún saldo. Por eso van como una consulta aparte y la
 * vista los fija arriba de la lista en vez de mezclarlos con el libro.
 *
 * Tres consultas fijas, no una por traslado: el detalle del despacho y los comprobantes
 * de toda la página se piden agrupados.
 */
export const listarPendientesDeCuenta = async (idCajaBanco) => {
    const traslados = await TrasladoEfectivo.findAll({
        where: { idCajaBanco, ...wherePendienteAceptar() },
        include: [
            { model: PuntosDeVenta, as: 'tiendaOrigen',  attributes: ['nombreComercial'], required: false },
            { model: Empleados,     as: 'empleadoEnvia', attributes: ['PrimerNombre', 'PrimerApellido', 'codigoEmpleado'], required: false }
        ],
        // El más viejo primero: lo que lleva más tiempo esperando es lo que más urge.
        order: [['createdAt', 'ASC'], ['idTrasladosEfectivo', 'ASC']]
    });

    if (!traslados.length) return [];
    const ids = traslados.map(t => t.idTrasladosEfectivo);

    // La observación con la que se despachó: es el primer paso de la bitácora.
    const salidas = await TrasladoEfectivoHistorial.findAll({
        where: { idTrasladosEfectivo: { [Op.in]: ids }, tipoTransaccion: 'Salida' },
        attributes: ['idTrasladosEfectivo', 'observacion'],
        order: [['idTransaccion', 'ASC']],
        raw: true
    });
    const observacion = {};
    for (const s of salidas) {
        if (!(s.idTrasladosEfectivo in observacion)) observacion[s.idTrasladosEfectivo] = s.observacion;
    }

    // Comprobantes de todos los traslados de la página en UNA consulta.
    const docs = await Documentacion.findAll({
        where: { pertenece: 'transacciones_bancarias', idPropietario: { [Op.in]: ids } },
        attributes: ['idDocumento', 'idPropietario', 'nombreDocumento', 'formato', 'keyName'],
        order: [['idDocumento', 'ASC']],
        raw: true
    });
    const adjuntos = {};
    for (const d of docs) {
        (adjuntos[d.idPropietario] ??= []).push({
            idDocumento:     d.idDocumento,
            nombreDocumento: d.nombreDocumento,
            formato:         d.formato,
            url:             `${process.env.R2_PUBLIC_URL}/${d.keyName}`
        });
    }

    // Numérica corta, igual que las filas del libro: la columna de fecha es angosta y
    // "18 de ago de 2026" la parte en tres renglones, dejando la fila del traslado del
    // doble de alto que las de al lado. La zona horaria sí va explícita — un traslado de
    // las primeras horas del día no puede fecharse en el día anterior.
    const FMT  = { timeZone: 'America/Bogota' };
    const HORA = { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' };

    return traslados.map((t) => {
        const f = new Date(t.createdAt);
        return {
            idTraslado:   t.idTrasladosEfectivo,
            codigo:       t.codigoTraslado,
            referencia:   t.referencia || null,
            valor:        parseFloat(t.valorTraslado) || 0,
            origen:       t.tiendaOrigen?.nombreComercial || 'Punto de venta',
            envia:        t.empleadoEnvia
                ? `${t.empleadoEnvia.PrimerNombre} ${t.empleadoEnvia.PrimerApellido}`.trim()
                : '—',
            codigoEnvia:  t.empleadoEnvia?.codigoEmpleado || null,
            fecha:        f.toLocaleDateString('es-CO', FMT),
            hora:         f.toLocaleTimeString('es-CO', HORA),
            iso:          f.toISOString(),
            observacion:  observacion[t.idTrasladosEfectivo] || null,
            adjuntos:     adjuntos[t.idTrasladosEfectivo] || []
        };
    });
};

export default resumenPendientes;
