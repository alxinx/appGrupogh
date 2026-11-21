import { SOPORTE_EMAIL, WHATSAPP_URL } from '../config/marca.js';
import { money } from './formatMoney.js';
import {
<<<<<<< HEAD
    COLORES_CORREO, WEB_STORE_URL, LOGO_WEBP_URL, BOX_URL,
    SOPORTE_EMAIL, WHATSAPP_URL, REDES
} from '../config/marca.js';
import { moneyCOP } from './formatMoney.js';
import { fmtFechaCorta, fmtHora, icono as iconoCompartido } from './plantillaCorreo.js';
=======
    plantillaMarca, ICONO_CORREO, filaCorreo, tarjetaCorreo, datosCorreo, avisoCorreo,
    tablaProductosCorreo, fmtFechaCorta, fmtHora
} from './plantillaCorreo.js';
>>>>>>> PRODUCCION
import { enviarCorreoSes, REMITENTE_COMPRAS } from './emailSes.js';
import { escaparHtml } from '../src/js/escaparHtml.js';

// Pedido web cancelado. Diseño de marca (plantillaMarca, el de la confirmación de pedido):
// misma tabla de productos que la confirmación, así las dos mitades de la vida de un
// pedido se ven como un mismo documento. Antes tenía su propio layout (hero con caja,
// franja de confianza, redes) — se reemplazó por la regla de un solo diseño (2026-11-20).

<<<<<<< HEAD
// Iconos de línea compartidos con helpers/mailBienvenidaProveedor.js — ver
// helpers/plantillaCorreo.js. El color por defecto de este correo es el rosa de marca.
function icono(nombre, opts = {}) {
    return iconoCompartido(nombre, { color: COLOR_PRIMARY, ...opts });
}
=======
const fechaHora = (f) => `${fmtFechaCorta(f)} · ${fmtHora(f)}`;
>>>>>>> PRODUCCION

const botonContacto = (href, texto) =>
    `<a href="${href}" style="display:inline-block;margin:4px;border:1px solid #E24C95;color:#E24C95;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;font-weight:700;text-decoration:none;padding:9px 16px;border-radius:10px;">${texto}</a>`;

export function construirHtmlPedidoCancelado(datos) {
    const { nombreCliente, numeroPedido, fechaPedido, fechaCancelacion, total, razones, items = [] } = datos;
    const listaRazones = (Array.isArray(razones) ? razones : [razones]).filter(Boolean);
    const totalPedido = total ?? items.reduce((s, it) => s + Number(it.subTotal || 0), 0);

    const filasHtml = [
        filaCorreo(tarjetaCorreo({
            titulo: `Pedido #${escaparHtml(numeroPedido)}`,
            html: datosCorreo([
                ['Fecha del pedido', fechaHora(fechaPedido)],
                ['Fecha de cancelación', fechaHora(fechaCancelacion)],
                ['Valor del pedido', `<span style="color:#E24C95;">$${money(totalPedido)}</span>`]
            ])
        })),
        filaCorreo(avisoCorreo('Razones de la cancelación', `
            <ul style="margin:0;padding-left:18px;">${listaRazones.map(r => `<li>${escaparHtml(r)}</li>`).join('')}</ul>
            <p style="margin:8px 0 0;">Si tienes alguna duda o crees que es un error, contáctanos y con gusto te ayudamos.</p>`)),
        filaCorreo(tablaProductosCorreo('Productos que pediste', items.map(it => ({
            nombreProducto: escaparHtml(it.nombre),
            referencia: it.referencia && it.referencia !== '—' ? escaparHtml(it.referencia) : null,
            imagen: it.imagen,
            cantidad: Number(it.cantidad),
            valorUnidad: it.valorUnidad,
            subTotal: it.subTotal
        })))),
        filaCorreo(`<div style="text-align:center;">
            <p style="margin:0 0 8px;font-size:13.5px;font-weight:700;color:#241f38;">¿Necesitas ayuda?</p>
            ${WHATSAPP_URL ? botonContacto(WHATSAPP_URL, 'Escribir por WhatsApp') : ''}
            ${botonContacto(`mailto:${SOPORTE_EMAIL}`, SOPORTE_EMAIL)}
        </div>`)
    ].join('');

    return plantillaMarca({
        icono: { simbolo: '&#10005;', ...ICONO_CORREO.peligro },
        titulo: 'Tu pedido fue cancelado',
        saludo: nombreCliente ? `Hola ${escaparHtml(nombreCliente)} &#128075;` : null,
        intro: 'Sentimos que tu pedido no haya podido completarse. Aquí te compartimos los detalles.',
        filasHtml,
        despedida: 'Gracias por confiar en nosotros &#128156;'
    });
}

// Sale por SES con el mismo remitente de compras que la confirmación de pedido
// (helpers/emailSes.js): las dos mitades de la vida de un pedido le llegan al cliente
// desde la misma dirección. Devuelve true/false y nunca lanza — cuando esto corre, la
// cancelación ya está escrita en base de datos.
const mailPedidoCancelado = async (datos) => {
    const listaRazones = Array.isArray(datos.razones) ? datos.razones : [datos.razones];

    return enviarCorreoSes({
        remitente: REMITENTE_COMPRAS,
        destinatario: datos.emailCliente,
        asunto: `Tu pedido ${datos.numeroPedido} fue cancelado`,
        texto: `Hola ${datos.nombreCliente}, tu pedido ${datos.numeroPedido} fue cancelado. Motivo: ${listaRazones.join(' / ')}`,
        html: construirHtmlPedidoCancelado(datos),
        contexto: 'pedido-cancelado'
    });
};

export { mailPedidoCancelado };
