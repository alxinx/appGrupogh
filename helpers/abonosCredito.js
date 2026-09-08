import { Op, fn, col } from 'sequelize';
import { AbonoClienteCreditos, FacturaClientes, Entidades, DetallesFactura, DetallesPagosFactura, Clientes, CreditoDisponibleCliente, CajasYBancos, MovimientosCajasBancos } from '../models/index.js';
import { round2 } from './formatMoney.js';
import db from '../config/bd.js';

// Todos los métodos de pago posibles de una factura (venta de mostrador o pedido web) —
// antes vivía como METODOS_PAGO repetido en adminControllers.js y como un objeto literal
// calcado (mismas 6 claves, a mano) en el broadcast SSE de storeControllers.js
// `procesarFactura`. Incluye 'Credito En Tienda' — a diferencia de METODOS_ABONO, acá sí
// aplica: es exactamente lo que puede llegar en un pago de factura.
export const METODOS_PAGO = ['Efectivo', 'Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito', 'Credito En Tienda'];

// Mismo set de métodos en las tres formas de abonar del proyecto (una factura puntual,
// abono global de admin, abono global de tienda) — antes vivía como METODOS_VALIDOS
// repetido (¡dos veces en el mismo archivo!) en adminControllers.js y como
// METODOS_ABONO_STORE en storeControllers.js. 'Credito En Tienda' queda afuera: es la
// tienda misma financiando, no un cobro; no aplica a pagar una deuda ya existente.
export const METODOS_ABONO = ['Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito', 'Efectivo'];
// Subconjunto que necesita un banco/tarjeta/financiera específico — lo usa hoy solo el
// abono de tienda (admin, por ahora, solo pide entidad para 'Entidad Crediticia').
export const METODOS_ABONO_CON_ENTIDAD = ['Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito'];

// Un abono paga una factura de crédito que puede ser de cualquier fecha anterior — nunca se
// puede encontrar buscando solo por FACTURA_CLIENTES.createdAt en un rango. Cuatro lugares
// necesitaban exactamente esta misma consulta (el cuadre de caja de tienda y tres tableros
// de admin) y cada uno la repetía a su manera; algunos ni siquiera la tenían, así que un
// abono en efectivo desaparecía del "Métodos de pago" del dashboard aunque sí entró esa
// plata. Un solo lugar que arme la consulta evita que un quinto lector la repita mal, o que
// una corrección futura (ej. un método de pago nuevo) quede aplicada en unos sitios y en
// otros no.
//
// idPuntoDeVenta null = todas las tiendas (dashboard global). hasta null = sin tope
// superior (desde `desde` hasta ahora). metodoPago acota a un solo método (el detalle de
// una tarjeta de "Métodos de pago").
export const buscarAbonosPeriodo = ({ idPuntoDeVenta = null, metodoPago = null, desde, hasta = null, transaction = undefined }) => {
    const whereAbono = { createdAt: hasta ? { [Op.between]: [desde, hasta] } : { [Op.gte]: desde } };
    if (metodoPago) whereAbono.metodoPago = metodoPago;

    return AbonoClienteCreditos.findAll({
        where: whereAbono,
        attributes: ['idAbonoClienteCredito', 'idFacturaCliente', 'idCliente', 'valorAbono', 'metodoPago', 'nroReferencia', 'loteAbonoGlobal', 'createdAt'],
        include: [
            {
                model: FacturaClientes, as: 'factura',
                attributes: ['prefijo', 'numeroFactura', 'idPuntoDeVenta'],
                where: idPuntoDeVenta ? { idPuntoDeVenta } : undefined,
                required: true
            },
            { model: Entidades, as: 'entidad', attributes: ['nombreEntidad'], required: false }
        ],
        order: [['createdAt', 'ASC']],
        transaction
    });
};

// Suma valorAbono agrupado por metodoPago — para los tableros que solo necesitan el total
// recibido por método, no el detalle de cada abono.
export const sumarAbonosPorMetodo = (abonos) => {
    const totales = {};
    for (const a of abonos) {
        totales[a.metodoPago] = (totales[a.metodoPago] || 0) + parseFloat(a.valorAbono);
    }
    return totales;
};

// Trae y BLOQUEA (SELECT ... FOR UPDATE) las facturas de crédito de un cliente —
// opcionalmente acotadas a un punto de venta, o a una sola factura puntual— para abonarles
// dentro de una transacción. El lock es lo que le faltaba a esta simulación: dos abonos
// casi simultáneos sobre el mismo cliente leían el mismo saldo viejo, cada uno armaba su
// propio reparto FIFO sobre esa foto vieja y las dos transacciones terminaban peleándose
// por las mismas filas — MySQL detecta el interbloqueo y mata una con un 500 genérico
// (comprobado en una simulación real: dos abonos de $120.000 en paralelo, uno terminaba en
// "Error al registrar el abono" en vez de un rechazo claro). Acá el segundo simplemente
// ESPERA a que el primero confirme (mismo patrón que el lock de CajaTienda en
// storeControllers.js `crearTrasladoEfectivo`) y recién ahí lee el saldo real, ya con lo
// que aplicó el primero.
//
// Devuelve las facturas en orden FIFO (más antigua primero) con su deudaActual calculada
// DENTRO de esta misma transacción — nunca la de antes de tomar el lock. No filtra por
// deudaActual > 0: cuando `idFacturaCliente` viene puntual (abonarFactura), el llamador
// necesita ver una factura ya en $0 para poder decir "esta factura ya está pagada" en vez
// de "no encontrada".
export const bloquearFacturasCreditoCliente = async ({ idCliente, idPuntoDeVenta = null, idFacturaCliente = null, transaction }) => {
    const where = { idCliente, credito: true };
    if (idFacturaCliente) where.idFacturaCliente = idFacturaCliente;
    else where.estado = 'pendiente';
    if (idPuntoDeVenta) where.idPuntoDeVenta = idPuntoDeVenta;

    const facturas = await FacturaClientes.findAll({
        where,
        attributes: ['idFacturaCliente', 'prefijo', 'numeroFactura', 'total', 'estado'],
        order: [['fechaEmision', 'ASC']],
        lock: transaction.LOCK.UPDATE,
        transaction
    });
    if (!facturas.length) return [];

    // Una vez tomado el lock, el saldo real: la fila más reciente por factura en el ledger
    // append-only, leída dentro de la misma transacción (nunca la de antes del lock).
    const ids = facturas.map(f => f.idFacturaCliente);
    const ultimos = await AbonoClienteCreditos.findAll({
        where: { idFacturaCliente: ids },
        attributes: ['idFacturaCliente', 'valorPorPagar', 'createdAt'],
        order: [['createdAt', 'DESC']],
        transaction
    });
    const ultimoPorFactura = new Map();
    for (const u of ultimos) {
        if (!ultimoPorFactura.has(u.idFacturaCliente)) ultimoPorFactura.set(u.idFacturaCliente, parseFloat(u.valorPorPagar));
    }

    // Mismo criterio que `facturasCreditoCliente`: sin abonos, la deuda de arranque es lo
    // financiado. Sin esto un abono exigía el total y el cliente terminaba pagando dos
    // veces lo que ya había entregado en efectivo al comprar.
    const financiado = await financiadoPorFactura(ids, transaction);

    return facturas.map(f => {
        const total = parseFloat(f.total);
        const aCredito = financiado.has(f.idFacturaCliente) ? financiado.get(f.idFacturaCliente) : total;
        const deudaActual = ultimoPorFactura.has(f.idFacturaCliente) ? ultimoPorFactura.get(f.idFacturaCliente) : aCredito;
        return {
            idFacturaCliente: f.idFacturaCliente, idCliente,
            nroFactura: `${f.prefijo || ''}${f.numeroFactura}`,
            valorOriginal: total, deudaActual, estadoFactura: f.estado
        };
    });
};

// Reparte `lineas` (cada una { valor, metodoPago, idEntidad, nroReferencia }) sobre
// `facturas` (en el orden en que deben pagarse — típicamente FIFO por fechaEmision; cada
// una necesita { idFacturaCliente, idCliente, valorOriginal, deudaActual }). `facturas` se
// MUTA: al terminar, `deudaActual` de cada una queda en su saldo real después de aplicar
// todo — el llamador la usa para construir su propia respuesta sin volver a consultar.
//
// Crea una fila de ABONO_CLIENTE_CREDITOS por cada (línea × factura) que efectivamente se
// toca —una factura puede recibir trozos de más de una línea si una transferencia sola no
// alcanza a cubrirla— y marca 'liquidada' la que llega a saldo 0 (el `update` condicionado
// a estado='pendiente' evita que dos cierres concurrentes la liquiden dos veces).
//
// Es el mismo bucle detrás de las tres formas de abonar que hay hoy: una factura puntual
// (admin `abonarFactura`: una línea, una factura), un abono global de una sola línea
// (admin `abonoGlobalCliente`) y un abono global de varias líneas (tienda
// `abonoGlobalClienteStore`) — las tres son casos particulares de "repartir N líneas de
// pago sobre M facturas en orden". Antes de esto, esa lógica estaba escrita tres veces con
// pequeñas diferencias que una corrección futura (ej. un bug en el redondeo) podía terminar
// arreglando en un solo lugar.
// El método de pago dejó de preguntarse en el panel: ahora se elige la cuenta que recibe
// la plata y el método sale de su tipo. ABONO_CLIENTE_CREDITOS.metodoPago es NOT NULL y
// lo leen los tableros y el cuadre de caja (`sumarAbonosPorMetodo`), así que se sigue
// guardando — pero ya no puede contradecir a la cuenta: un abono a una caja es efectivo,
// y uno a un banco no lo es.
export const METODO_POR_TIPO_CUENTA = {
    caja:      'Efectivo',
    banco:     'Banco',
    billetera: 'Billetera Virtual'
};

/**
 * Ingreso en el libro de la cuenta que recibió el abono.
 *
 * Va en la MISMA transacción que los abonos (CLAUDE.md §9): o entra la plata a la cuenta
 * y queda registrado el abono, o no pasa ninguna de las dos cosas. Antes esto no existía
 * y el saldo de cajas y bancos nunca veía la plata de un abono a crédito.
 *
 * Un movimiento por línea de pago, no por factura: si un abono global de $500.000 se
 * reparte entre cuatro facturas, a la caja entraron $500.000 una sola vez.
 */
const registrarIngresoDeAbono = async ({ linea, empleado, transaction }) => {
    const cuenta = await CajasYBancos.findByPk(linea.idCajaBanco, {
        attributes: ['idCajaBanco', 'estado'],
        transaction,
        lock: transaction.LOCK.SHARE
    });
    if (!cuenta) throw Object.assign(new Error('La cuenta que recibe el abono no existe.'), { publico: true });
    if (!cuenta.estado) throw Object.assign(new Error('La cuenta que recibe el abono está inactiva.'), { publico: true });

    // MOVIMIENTOS_CAJAS_BANCOS.idEmpleado es NOT NULL: sin ficha de empleado el
    // movimiento no puede quedar a nombre de nadie, y el libro es append-only.
    if (!empleado?.idEmpleado) {
        throw Object.assign(
            new Error('El abono no puede registrarse en la cuenta sin un empleado verificado.'),
            { publico: true }
        );
    }

    return MovimientosCajasBancos.create({
        idCajaBanco: linea.idCajaBanco,
        idEmpleado:  empleado.idEmpleado,
        fecha:       linea.fecha || new Date(),
        tipo:        'ingreso',
        valor:       linea.valor,
        referencia:  linea.nroReferencia ?? null,
        descripcion: linea.descripcion || null
    }, { transaction });
};

export const aplicarAbonoFIFO = async ({ lineas, facturas, loteAbonoGlobal = null, empleado, idUsuario, transaction }) => {
    const aplicadoPorFactura = new Map();
    const abonosCreados = [];
    // Los movimientos que este abono asentó en el libro de la cuenta, para que el
    // llamador pueda ofrecer su comprobante — uno por línea de pago.
    const movimientosCreados = [];
    let idxFactura = 0;

    for (const linea of lineas) {
        // El ingreso a la cuenta se registra una sola vez por línea de pago, antes de
        // repartirla entre facturas. `idCajaBanco` es opcional: el abono de tienda
        // todavía no elige cuenta y sigue funcionando como antes (ver storeControllers).
        if (linea.idCajaBanco) {
            movimientosCreados.push(await registrarIngresoDeAbono({ linea, empleado, transaction }));
        }

        let restanteLinea = linea.valor;
        while (restanteLinea > 0 && idxFactura < facturas.length) {
            const f = facturas[idxFactura];
            if (f.deudaActual <= 0) { idxFactura++; continue; }

            const aplicar = round2(Math.min(restanteLinea, f.deudaActual));
            f.deudaActual = round2(f.deudaActual - aplicar);
            restanteLinea = round2(restanteLinea - aplicar);

            const abono = await AbonoClienteCreditos.create({
                idFacturaCliente: f.idFacturaCliente, idCliente: f.idCliente,
                totalFactura: f.valorOriginal,
                valorAbono: aplicar, valorPorPagar: f.deudaActual,
                metodoPago: linea.metodoPago, idEntidad: linea.idEntidad ?? null,
                idCajaBanco: linea.idCajaBanco ?? null,
                nroReferencia: linea.nroReferencia ?? null, loteAbonoGlobal,
                idEmpleado:     empleado?.idEmpleado || null,
                nombreEmpleado: empleado?.nombre || null,
                codigoEmpleado: empleado?.codigoEmpleado || null,
                idUsuario:      idUsuario || null
            }, { transaction });
            abonosCreados.push(abono);

            if (f.deudaActual <= 0) {
                await FacturaClientes.update(
                    { estado: 'liquidada' },
                    { where: { idFacturaCliente: f.idFacturaCliente, estado: 'pendiente' }, transaction }
                );
                idxFactura++;
            }

            aplicadoPorFactura.set(
                f.idFacturaCliente,
                round2((aplicadoPorFactura.get(f.idFacturaCliente) || 0) + aplicar)
            );
        }
    }

    const resumen = [...aplicadoPorFactura.entries()].map(([idFacturaCliente, aplicado]) => {
        const f = facturas.find(x => x.idFacturaCliente === idFacturaCliente);
        return { idFacturaCliente, nroFactura: f?.nroFactura, aplicado, saldoRestante: f?.deudaActual ?? 0 };
    });

    return { resumen, abonosCreados, movimientosCreados };
};

// Ventas y desglose de pagos (por nombre completo de método, ver METODOS_PAGO) de un rango
// —opcionalmente acotado a un punto de venta—, incluyendo los abonos a crédito recibidos
// en ese rango. Antes era `_getVentasPeriodo` en adminControllers.js (una copia, solo por
// tienda) y otra copia más, sin abonos, en el broadcast SSE que storeControllers.js
// `procesarFactura` dispara después de cada venta — ese último ni siquiera tenía la
// corrección de abonos: cada venta nueva volvía a pisar el dashboard en vivo del admin
// con un número que no los contaba.
export const ventasYPagosPeriodo = async ({ idPuntoDeVenta = null, desde, hasta = null }) => {
    const whereFactura = { createdAt: hasta ? { [Op.between]: [desde, hasta] } : { [Op.gte]: desde } };
    if (idPuntoDeVenta) whereFactura.idPuntoDeVenta = idPuntoDeVenta;
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

    const totalesAbono = sumarAbonosPorMetodo(await buscarAbonosPeriodo({ idPuntoDeVenta, desde, hasta }));
    for (const [metodo, total] of Object.entries(totalesAbono)) {
        if (Object.prototype.hasOwnProperty.call(pagos, metodo)) pagos[metodo] += total;
    }

    return { ventas, pagos, totalFacturas: facturas.length };
};

// Los 5 "casilleros" abreviados que arma el widget "Métodos de pago" del dashboard de
// admin (junta Banco + Billetera Virtual bajo "transBill") — antes era el mismo switch
// if/else escrito a mano en tres sitios: `getTiendasStatsHoy` (dos veces, una para ventas y
// otra para abonos) y el broadcast global de `procesarFactura`.
export const bucketPagosVacio = () => ({ efectivo: 0, transBill: 0, tCredito: 0, creditos: 0, creditoTienda: 0 });

export const acumularEnBucketPagos = (bucket, metodoPago, valor) => {
    const v = Math.round(valor);
    if (metodoPago === 'Efectivo') bucket.efectivo += v;
    else if (metodoPago === 'Banco' || metodoPago === 'Billetera Virtual') bucket.transBill += v;
    else if (metodoPago === 'Tarjeta Credito') bucket.tCredito += v;
    else if (metodoPago === 'Entidad Crediticia') bucket.creditos += v;
    else if (metodoPago === 'Credito En Tienda') bucket.creditoTienda += v;
    return bucket;
};

// Atajo: el bucket abreviado directo a partir del objeto `pagos` (nombres completos) que
// devuelve `ventasYPagosPeriodo` — evita que cada llamador repita el propio for/if.
export const pagosATransBucket = (pagos) => {
    const bucket = bucketPagosVacio();
    for (const [metodo, valor] of Object.entries(pagos)) acumularEnBucketPagos(bucket, metodo, valor);
    return bucket;
};

// Todas las facturas de crédito (credito=true) de un cliente en CUALQUIER tienda, con su
// deudaActual ya calculada desde el ledger (la fila más reciente por factura en
// ABONO_CLIENTE_CREDITOS da el saldo — mismo criterio que CUENTAS_POR_PAGAR del lado
// proveedores). Antes vivía como `_facturasCreditoCliente` en adminControllers.js, y
// storeControllers.js `misClienteDetallePage` tenía su propia copia (recortada, solo para
// sumar "consumido") de la misma consulta.
/**
 * Cuánto se FINANCIÓ realmente en una factura a crédito.
 *
 * No es su total: una venta a crédito puede venir parcialmente pagada en el mismo
 * momento —el cliente abona algo en efectivo y financia el resto—, y lo que queda
 * debiendo es solo la línea de pago 'Credito En Tienda'.
 *
 * Tomar el total como deuda inicial inflaba la deuda del cliente por el monto que ya
 * había entregado: la factura 67 (total 496.200, de los cuales pagó 100.000 en efectivo)
 * aparecía debiendo los 496.200 completos. Y como el cupo disponible se calcula restando
 * los saldos abiertos, también le comía cupo que sí tenía.
 *
 * Devuelve un Map idFacturaCliente → monto financiado. Sin línea de crédito cae en el
 * total, que es el caso de las facturas 100% a crédito.
 */
export const financiadoPorFactura = async (ids, transaction = undefined) => {
    const mapa = new Map();
    if (!ids?.length) return mapa;

    const filas = await DetallesPagosFactura.findAll({
        attributes: ['idFacturaCliente', [fn('SUM', col('valor')), 'financiado']],
        where: { idFacturaCliente: { [Op.in]: ids }, metodoPago: 'Credito En Tienda' },
        group: ['idFacturaCliente'],
        raw: true,
        transaction
    });
    filas.forEach(f => mapa.set(f.idFacturaCliente, parseFloat(f.financiado) || 0));
    return mapa;
};

export const facturasCreditoCliente = async (idCliente, transaction = undefined) => {
    const rows = await db.query(`
        SELECT fc.idFacturaCliente, fc.prefijo, fc.numeroFactura, fc.fechaEmision,
               fc.total, fc.estado,
               DATEDIFF(CURDATE(), fc.fechaEmision) AS diasTranscurridos,
               ult.valorPorPagar AS deudaUltima
        FROM FACTURA_CLIENTES fc
        LEFT JOIN (
            SELECT a1.idFacturaCliente, a1.valorPorPagar
            FROM ABONO_CLIENTE_CREDITOS a1
            INNER JOIN (
                SELECT idFacturaCliente, MAX(createdAt) AS maxFecha
                FROM ABONO_CLIENTE_CREDITOS GROUP BY idFacturaCliente
            ) a2 ON a2.idFacturaCliente = a1.idFacturaCliente AND a2.maxFecha = a1.createdAt
        ) ult ON ult.idFacturaCliente = fc.idFacturaCliente
        WHERE fc.idCliente = :idCliente AND fc.credito = 1
        ORDER BY fc.fechaEmision ASC
    `, { replacements: { idCliente }, type: db.QueryTypes.SELECT, transaction });

    // Sin abonos todavía, la deuda de arranque es lo FINANCIADO, no el total: lo que el
    // cliente pagó en el momento de la venta ya no lo debe.
    const financiado = await financiadoPorFactura(rows.map(r => r.idFacturaCliente), transaction);

    return rows.map(r => {
        const total  = parseFloat(r.total);
        const aCredito = financiado.has(r.idFacturaCliente) ? financiado.get(r.idFacturaCliente) : total;
        const deudaActual = r.deudaUltima != null ? parseFloat(r.deudaUltima) : aCredito;
        return {
            idFacturaCliente: r.idFacturaCliente,
            nroFactura: `${r.prefijo || ''}${r.numeroFactura}`,
            fechaEmision: r.fechaEmision,
            diasTranscurridos: parseInt(r.diasTranscurridos),
            valorOriginal: total,
            // Lo abonado se mide contra lo financiado, no contra el total: si no, el pago
            // hecho en la venta aparecería como un abono posterior que nunca existió.
            valorFinanciado: aCredito,
            abonado: round2(aCredito - deudaActual),
            deudaActual,
            estadoFactura: r.estado
        };
    });
};

// Cupo total, consumido y disponible REAL de un cliente para "Crédito en Tienda" — cupo
// asignado menos la suma de saldo pendiente de sus facturas de crédito abiertas, en
// CUALQUIER tienda (no la columna estática CREDITO_DISPONIBLE_CLIENTE.creditoDisponible:
// esa nunca se decrementa al vender, sigue el cupo tal como se asignó por última vez, no
// lo que ya se gastó — usarla tal cual dejaba pasar una venta a crédito por el cupo
// COMPLETO sin importar cuánto debiera ya el cliente).
//
// Con `transaction`, bloquea (FOR UPDATE) la fila de CREDITO_DISPONIBLE_CLIENTE del
// cliente: dos ventas a "Crédito en Tienda" casi simultáneas para el mismo cliente
// serializan acá —la segunda espera a que la primera confirme su factura— en vez de que
// las dos calculen el mismo disponible viejo y las dos pasen aunque juntas superen el
// cupo. Sin `transaction` (el chequeo en vivo del POS mientras el operador escribe el
// monto) es una lectura simple, sin lock — tomarlo en cada tecleo sería carísimo para un
// dato que de todos modos se revalida en serio al facturar.
//
// CRÍTICO: el `await` del lock va SOLO, antes de leer facturas — no en el mismo
// `Promise.all`. MySQL (REPEATABLE READ) fija la foto de una transacción en su primera
// lectura NO bloqueante; si `facturasCreditoCliente` saliera en paralelo con el lock, no
// esperaría a que ese lock se liberara (una lectura plana no bloquea) y tomaría su foto
// ANTES de que la venta que tenía el lock confirmara — dos ventas concurrentes seguían
// viendo el mismo "consumido" viejo aunque una ya hubiera confirmado la suya. Comprobado
// en una simulación real: dos ventas de $21.000 a crédito para una clienta con $27.000
// disponible pasaron LAS DOS antes de este fix.
export const creditoClienteResumen = async (idCliente, transaction = undefined) => {
    const credito = await CreditoDisponibleCliente.findOne({
        where: { idCliente, tipo: 'Credito' }, raw: true, transaction,
        lock: transaction ? transaction.LOCK.UPDATE : undefined
    });
    const [cliente, facturas] = await Promise.all([
        Clientes.findOne({ where: { idCliente }, attributes: ['credito'], raw: true, transaction }),
        facturasCreditoCliente(idCliente, transaction)
    ]);

    const cupoTotal = credito ? parseFloat(credito.valorCreditoCliente) : 0;
    const consumido = round2(facturas.reduce((s, f) => s + (f.deudaActual > 0 ? f.deudaActual : 0), 0));
    const disponible = Math.max(0, round2(cupoTotal - consumido));

    return { habilitado: !!cliente?.credito, tieneCupo: !!credito, cupoTotal, consumido, disponible };
};
