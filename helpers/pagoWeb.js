import { Entidades, PagosPedidoWeb } from '../models/index.js';

// El dinero de un pedido web nunca entra a la caja de la tienda: lo cobra Wompi y después se
// liquida a la cuenta bancaria del negocio. Por eso todos estos pagos se registran contra una
// entidad dedicada "Wompi" en vez de contra Nequi/Visa/Bancolombia — así el cuadre diario de la
// tienda no se infla con plata que nunca recibió, y el total se concilia contra el extracto de
// Wompi. El instrumento real que usó el cliente queda visible igual, en el pedido y en el PDF.
const NOMBRE_ENTIDAD_WOMPI = 'Wompi';

// payment_method_type de Wompi → texto legible. Es solo para mostrar; la entidad contable
// siempre es Wompi.
const ETIQUETA_METODO_WOMPI = {
    CARD: 'Tarjeta', NEQUI: 'Nequi', PSE: 'PSE',
    BANCOLOMBIA_TRANSFER: 'Transferencia Bancolombia',
    BANCOLOMBIA_COLLECT: 'Corresponsal Bancolombia',
    BANCOLOMBIA_QR: 'QR Bancolombia',
    DAVIPLATA: 'Daviplata', GOOGLE_PAY: 'Google Pay', SU_PLUS: 'Su+ Pay'
};

// Cache del id de la entidad: es una fila fija que no cambia en caliente.
let idEntidadWompi = null;
async function getIdEntidadWompi() {
    if (idEntidadWompi) return idEntidadWompi;
    const entidad = await Entidades.findOne({ where: { nombreEntidad: NOMBRE_ENTIDAD_WOMPI } });
    if (!entidad) {
        throw new Error(`Falta la entidad "${NOMBRE_ENTIDAD_WOMPI}" en ENTIDADES — se necesita para facturar pedidos web.`);
    }
    idEntidadWompi = entidad.idEntidad;
    return idEntidadWompi;
}

/**
 * Datos del pago ya confirmado por la pasarela para un pedido web.
 * Devuelve null si el pedido no se pagó por pasarela (contraentrega).
 *
 * El valor sale de PAGOS_PEDIDO_WEB, no de lo que mande el cliente: es lo que Wompi confirmó.
 *
 * @param {object} pedido  Instancia de PedidosWeb (puede traer `pagos` precargados)
 */
export async function resolverPagoWebParaFactura(pedido) {
    if (!pedido || pedido.metodoPago === 'contraentrega') return null;

    const pagos = pedido.pagos ?? await PagosPedidoWeb.findAll({ where: { idPedido: pedido.idPedido } });
    const aprobado = pagos.find(p => p.estado === 'APPROVED');
    if (!aprobado) return null;

    return {
        idEntidad:     await getIdEntidadWompi(),
        nombreEntidad: NOMBRE_ENTIDAD_WOMPI,
        valor:         parseFloat(aprobado.monto) || 0,
        metodoWompi:   aprobado.metodoPago || null,
        etiqueta:      ETIQUETA_METODO_WOMPI[aprobado.metodoPago] || aprobado.metodoPago || 'Pago en línea',
        idTransaccion: aprobado.idTransaccionWompi || null,
        referencia:    aprobado.referenciaWompi || null
    };
}

export { ETIQUETA_METODO_WOMPI, NOMBRE_ENTIDAD_WOMPI };
