import { SendEmailCommand } from "@aws-sdk/client-ses";
import dotenv from "dotenv";
import sesClient from "../config/ses.js";
import { COLORES_CORREO as C, LOGO_URL, SOPORTE_WHATSAPP } from "../config/marca.js";
import { plantillaSimple } from "./plantillaCorreo.js";
import { money } from "./formatMoney.js";
dotenv.config();

// Un remitente por caso de uso — nunca uno genérico para todo. Los tres son direcciones
// del dominio verificado en SES (notificaciones.grupogh.co); al ser una identidad de
// dominio, no hace falta verificar cada dirección por separado.
export const REMITENTE_EMPLEADOS = "empleados@notificaciones.grupogh.co";
export const REMITENTE_COMPRAS   = "compras@notificaciones.grupogh.co";
export const REMITENTE_ALERTAS   = "alertas@notificaciones.grupogh.co";

// Único punto de salida de correo del proyecto: arma el comando, manda y atrapa
// cualquier error ahí mismo. Ningún llamador necesita acordarse de envolverlo en
// try/catch — un correo que no sale nunca debe tumbar el flujo que lo disparó (crear
// una orden, dar de alta un empleado, cancelar un pedido).
//
// Lo usan también helpers/mailNewEmployer.js, helpers/mailPedidoCancelado.js y
// helpers/notificarQrPago.js, que antes abrían cada uno su propio transporte SMTP con
// nodemailer. Cada helper arma su HTML y delega el envío acá: un solo lugar donde mirar
// cuando el correo deja de salir, y uno solo donde tocar si cambia el proveedor.
//
// `texto` es opcional: la alternativa en texto plano para los clientes que no
// rendericen HTML (y un punto menos de spam score).
export async function enviarCorreoSes({ remitente, destinatario, asunto, html, texto, contexto }) {
    if (!destinatario) {
        console.warn(`[ses:${contexto}] sin destinatario; no se envía nada.`);
        return false;
    }

    const cuerpo = { Html: { Data: html, Charset: "UTF-8" } };
    if (texto) cuerpo.Text = { Data: texto, Charset: "UTF-8" };

    const comando = new SendEmailCommand({
        Source: remitente,
        Destination: { ToAddresses: [destinatario] },
        Message: {
            Subject: { Data: asunto, Charset: "UTF-8" },
            Body: cuerpo
        }
    });

    try {
        await sesClient.send(comando);
        return true;
    } catch (e) {
        console.error(`[ses:${contexto}] no se pudo enviar a ${destinatario}: ${e.message}`);
        return false;
    }
}

// Aviso a un empleado (turno, novedad de nómina, cambio de asignación, etc.).
// Devuelve true/false — nunca lanza.
export async function sendEmployeeNotification({ to, nombreEmpleado, asunto, mensajeHtml }) {
    const asuntoFinal = asunto || `Aviso para ${nombreEmpleado}`;
    const html = plantillaSimple({
        titulo: asuntoFinal,
        saludo: `Hola, ${nombreEmpleado},`,
        cuerpoHtml: mensajeHtml
    });
    return enviarCorreoSes({ remitente: REMITENTE_EMPLEADOS, destinatario: to, asunto: asuntoFinal, html, contexto: 'empleado' });
}

// Cambio de estado de un pedido/compra (confirmado, en camino, entregado, cancelado...).
// Devuelve true/false — nunca lanza: que falle este aviso no debe romper la creación
// ni el cambio de estado del pedido que lo dispara.
export async function sendPurchaseStatusUpdate({ to, nombreCliente, numeroPedido, estado, mensajeHtml }) {
    const asunto = `Tu pedido ${numeroPedido}: ${estado}`;
    const html = plantillaSimple({
        titulo: asunto,
        saludo: `Hola, ${nombreCliente},`,
        cuerpoHtml: mensajeHtml || `<p>El estado de tu pedido <strong>${numeroPedido}</strong> cambió a <strong>${estado}</strong>.</p>`
    });
    return enviarCorreoSes({ remitente: REMITENTE_COMPRAS, destinatario: to, asunto, html, contexto: 'pedido' });
}

// Aviso de "producto disponible de nuevo" a UN destinatario. Para avisar a varios a la
// vez (todos los que pidieron el mismo producto) no se llama esto en un loop: se usa
// encolarNotificacionesProducto() de helpers/colaEmailProducto.js, que reparte estos
// mismos envíos respetando el rate limit de SES.
//
// urlBaja es opcional pero se espera siempre que este correo salga por una lista (varios
// destinatarios): es la única de las tres notificaciones que no es 1-a-1 transaccional,
// así que es la que necesita forma de bajarse.
export async function sendProductAvailableNotification({ to, nombreProducto, urlProducto, urlBaja }) {
    const asunto = `¡${nombreProducto} ya está disponible!`;
    const html = plantillaSimple({
        titulo: asunto,
        saludo: '¡Buenas noticias!',
        cuerpoHtml: `
            <p><strong>${nombreProducto}</strong> volvió a tener stock.</p>
            ${urlProducto ? `<p style="text-align:center; margin-top:24px;">
                <a href="${urlProducto}" style="background-color:#FF5EAA; color:#ffffff; padding:12px 24px; text-decoration:none; border-radius:8px; font-weight:bold; display:inline-block;">Verlo ahora</a>
            </p>` : ''}
        `,
        pieBaja: urlBaja
    });
    return enviarCorreoSes({ remitente: REMITENTE_COMPRAS, destinatario: to, asunto, html, contexto: 'producto-disponible' });
}

// ─── Confirmación de pedido web ─────────────────────────────────────────────
//
// A diferencia de plantillaSimple() (la que usan las otras tres notificaciones), esta va con
// tabla + estilos inline de punta a punta: es la que de verdad tiene que abrirse bien en
// Outlook/Gmail/Apple Mail, no solo en un navegador. flex/grid y <style> no sobreviven a
// Outlook de escritorio.

const NOMBRE_METODO_PAGO = {
    contraentrega: 'Pago contraentrega',
    tarjeta: 'Tarjeta de crédito/débito',
    pse: 'PSE — Pagos Seguros en Línea',
    nequi: 'Nequi'
};

const PALETA_SWATCH = [
    { bg: '#f6c9de', fg: '#ad3d76' },
    { bg: '#d8d3f0', fg: '#5b4fa3' },
    { bg: '#c9e8dc', fg: '#1f7a58' }
];

function inicialesProducto(nombre) {
    return (nombre || '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(p => p[0].toUpperCase())
        .join('') || '·';
}

function filaProducto(item, idx) {
    const { bg, fg } = PALETA_SWATCH[idx % PALETA_SWATCH.length];
    const meta = [item.talla ? `Talla ${item.talla}` : null, item.color ? `Color: ${item.color}` : null].filter(Boolean).join(' · ');

    // La foto real del producto cuando la hay; si no, el cuadro con las iniciales. Un
    // producto puede no tener imagen cargada todavía, y una etiqueta <img> rota se ve
    // mucho peor que el cuadro de color. El mismo criterio que en el correo de
    // cancelación (helpers/mailPedidoCancelado.js). El color de fondo se queda debajo de
    // la foto: es lo que ve el cliente mientras la imagen carga, o si bloquea imágenes.
    const miniatura = item.imagen
        ? `<td style="width:44px;"><img src="${item.imagen}" width="44" height="44" alt="${item.nombreProducto}" style="display:block;width:44px;height:44px;border-radius:10px;object-fit:cover;background:${bg};"></td>`
        : `<td style="width:44px;height:44px;border-radius:10px;background:${bg};color:${fg};text-align:center;vertical-align:middle;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;">${inicialesProducto(item.nombreProducto)}</td>`;

    return `
    <tr>
        <td style="padding:14px 0;border-bottom:1px solid #ece8f3;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                ${miniatura}
                <td style="padding-left:12px;font-family:Helvetica,Arial,sans-serif;">
                    <div style="font-weight:600;color:#241f38;font-size:13.5px;">${item.nombreProducto}</div>
                    ${meta ? `<div style="font-size:12px;color:#8a84a0;margin-top:2px;">${meta}</div>` : ''}
                </td>
            </tr></table>
        </td>
        <td style="padding:14px 0;border-bottom:1px solid #ece8f3;text-align:right;font-family:Helvetica,Arial,sans-serif;font-size:13.5px;">${item.cantidad}</td>
        <td style="padding:14px 0;border-bottom:1px solid #ece8f3;text-align:right;font-family:Helvetica,Arial,sans-serif;font-size:13.5px;">$${money(item.valorUnidad)}</td>
        <td style="padding:14px 0;border-bottom:1px solid #ece8f3;text-align:right;font-family:Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:700;">$${money(item.subTotal)}</td>
    </tr>`;
}

function pasoTracker({ metodoPago }) {
    // Único caso que espera algo antes de arrancar: QR, porque nadie confirmó todavía
    // que la plata entró (ver CLAUDE.md §5.10-5.11 — nada se da por pagado sin ese paso
    // manual). Para el resto (pasarela o contraentrega), el pedido ya arranca su proceso.
    if (metodoPago === 'qr') {
        return {
            paso1: { label: 'Pago pendiente', estado: 'esperando' },
            paso2: { label: 'Preparando pedido', estado: 'pendiente' },
            paso3: { label: 'Completado', estado: 'pendiente' }
        };
    }
    return {
        paso1: { label: metodoPago === 'contraentrega' ? 'Pedido confirmado' : 'Pago confirmado', estado: 'hecho' },
        paso2: { label: 'Preparando pedido', estado: 'actual' },
        paso3: { label: 'Completado', estado: 'pendiente' }
    };
}

function circuloPaso(estado, numero) {
    const estilos = {
        hecho:     { bg: C.ok,   fg: '#ffffff', contenido: '&#10003;' },
        actual:    { bg: C.lila, fg: '#ffffff', contenido: String(numero) },
        esperando: { bg: '#fbf3dd', fg: '#b08d1a', contenido: String(numero) },
        pendiente: { bg: '#ffffff', fg: '#8a84a0', contenido: String(numero) }
    }[estado];
    const borde = estado === 'pendiente' ? '2px solid #ece8f3' : `2px solid ${estilos.bg}`;
    return `<div style="width:26px;height:26px;line-height:26px;border-radius:50%;margin:0 auto 6px;background:${estilos.bg};color:${estilos.fg};border:${borde};font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;">${estilos.contenido}</div>`;
}

export async function sendOrderConfirmation({
    to, nombreCliente, numeroPedido, fecha,
    items, metodoPago, entidadQr,
    tipoEntrega, direccion, apto, ciudad, departamento, telefono,
    puntoRecogida,
    subtotal, envio, descuento, total
}) {
    const fechaTexto = new Intl.DateTimeFormat('es-CO', {
        day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(fecha instanceof Date ? fecha : new Date(fecha));

    const esQrPendiente = metodoPago === 'qr';
    const tracker = pasoTracker({ metodoPago });
    const metodoPagoTexto = esQrPendiente
        ? `Transferencia por QR — ${entidadQr?.nombreEntidad || 'entidad bancaria'}`
        : (NOMBRE_METODO_PAGO[metodoPago] || metodoPago);

    const bloqueDireccion = tipoEntrega === 'domicilio'
        ? `
            <p style="margin:0;font-weight:700;color:#241f38;font-size:13px;">${nombreCliente}</p>
            <p style="margin:2px 0;color:#4b4560;font-size:13px;">${telefono || ''}</p>
            <p style="margin:2px 0;color:#4b4560;font-size:13px;">${direccion}${apto ? `, ${apto}` : ''}</p>
            <p style="margin:2px 0;color:#4b4560;font-size:13px;">${ciudad}, ${departamento}</p>
            <p style="margin:2px 0 12px;color:#4b4560;font-size:13px;">Colombia</p>
            <div style="background:${C.primarySoft};color:${C.primary};border-radius:9px;padding:9px 10px;font-size:11.5px;font-weight:600;">Enviaremos tu pedido a esta dirección.</div>`
        : `
            <p style="margin:0;font-weight:700;color:#241f38;font-size:13px;">${puntoRecogida?.nombreComercial || 'Tu tienda'}</p>
            <p style="margin:2px 0;color:#4b4560;font-size:13px;">${puntoRecogida?.direccionPrincipal || ''}</p>
            <p style="margin:2px 0 12px;color:#4b4560;font-size:13px;">${[puntoRecogida?.ciudad, puntoRecogida?.departamento].filter(Boolean).join(', ')}</p>
            <div style="background:${C.primarySoft};color:${C.primary};border-radius:9px;padding:9px 10px;font-size:11.5px;font-weight:600;">Recoges tu pedido en esta tienda.</div>`;

    const avisoQr = esQrPendiente ? `
    <tr><td style="padding:0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff6e5;border:1px solid #f6dfab;border-radius:14px;margin-top:22px;">
            <tr>
                <td style="padding:18px;font-family:Helvetica,Arial,sans-serif;">
                    <p style="margin:0 0 6px;font-size:13.5px;font-weight:700;color:#7a4d00;">Importante: pago por transferencia (QR)</p>
                    <p style="margin:0 0 8px;font-size:12.8px;line-height:1.6;color:#8a5a00;">Recibimos tu pedido, pero todavía estamos esperando la confirmación de la transferencia. En cuanto la verifiquemos, tu pedido pasa a empaque.</p>
                    <p style="margin:0;font-size:12.8px;line-height:1.6;color:#8a5a00;">Si ya hiciste la transferencia, envíanos el comprobante a <a href="mailto:${REMITENTE_COMPRAS}" style="color:${C.primary};font-weight:700;text-decoration:none;">${REMITENTE_COMPRAS}</a>${SOPORTE_WHATSAPP ? ` o por WhatsApp al <b>${SOPORTE_WHATSAPP}</b>` : ''}.</p>
                </td>
            </tr>
        </table>
    </td></tr>` : '';

    const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#eef0f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f4;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">

    <tr><td style="background:#fbf4f9;padding:32px 32px 26px;text-align:center;">
        <img src="${LOGO_URL}" width="60" height="60" alt="Grupo GH" style="border-radius:50%;display:inline-block;">
    </td></tr>

    <tr><td style="padding:28px 40px 4px;text-align:center;font-family:Helvetica,Arial,sans-serif;">
        <div style="width:44px;height:44px;line-height:44px;border-radius:50%;background:#e7f8f1;color:${C.ok};margin:0 auto 14px;font-size:20px;">&#10003;</div>
        <h1 style="margin:0 0 6px;font-size:21px;color:#241f38;">¡Pedido confirmado!</h1>
        <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#4b4560;">Hola ${nombreCliente} &#128075;</p>
        <p style="margin:0 auto;max-width:38ch;font-size:13.5px;color:#8a84a0;line-height:1.6;">Gracias por tu compra. Recibimos tu pedido correctamente y está siendo procesado.</p>
    </td></tr>

    <tr><td style="padding:22px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ece8f3;border-radius:12px;">
            <tr>
                <td style="width:44px;padding:14px 8px 14px 16px;vertical-align:middle;">
                    <div style="width:30px;height:30px;border-radius:9px;background:${C.primarySoft};color:${C.primary};text-align:center;line-height:30px;font-family:Helvetica,Arial,sans-serif;font-size:14px;">&#128717;</div>
                </td>
                <td style="padding:14px 16px 14px 4px;font-family:Helvetica,Arial,sans-serif;">
                    <div style="font-size:14px;font-weight:700;color:${C.primary};">Pedido #${numeroPedido}</div>
                    <div style="font-size:12.5px;color:#8a84a0;">Realizado el ${fechaTexto}</div>
                </td>
            </tr>
        </table>
    </td></tr>

    <tr><td style="padding:22px 32px 0;font-family:Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 12px;font-size:13.5px;font-weight:700;color:#241f38;">Estado del pedido</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${esQrPendiente ? '#fbf3dd' : '#f7f2fc'};border-radius:14px;">
            <tr><td style="padding:18px;">
                <p style="margin:0 0 4px;font-size:14.5px;font-weight:700;color:#241f38;">${esQrPendiente ? 'Esperando confirmación de pago' : (metodoPago === 'contraentrega' ? '¡Tu pedido fue recibido!' : '¡Tu pedido se está empacando!')}</p>
                <p style="margin:0 0 16px;font-size:13px;color:#4b4560;line-height:1.55;">${esQrPendiente
                    ? 'Todavía no verificamos tu transferencia. Ni bien la confirmemos, tu pedido pasa a empaque automáticamente.'
                    : (metodoPago === 'contraentrega' ? 'Pagas al recibirlo. Ya estamos preparando tu pedido con mucho cuidado.' : 'Tu pago fue recibido y estamos preparando tu pedido con mucho cuidado.')}</p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td width="33%" style="text-align:center;">
                            ${circuloPaso(tracker.paso1.estado, 1)}
                            <div style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;font-weight:700;color:#241f38;">${tracker.paso1.label}</div>
                        </td>
                        <td width="33%" style="text-align:center;">
                            ${circuloPaso(tracker.paso2.estado, 2)}
                            <div style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;font-weight:700;color:#241f38;">${tracker.paso2.label}</div>
                        </td>
                        <td width="33%" style="text-align:center;">
                            ${circuloPaso(tracker.paso3.estado, 3)}
                            <div style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;font-weight:700;color:#241f38;">${tracker.paso3.label}</div>
                        </td>
                    </tr>
                </table>

                <p style="margin:16px 0 0;padding-top:14px;border-top:1px dashed #ece8f3;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#8a84a0;">Te notificaremos por correo cuando tu pedido avance.</p>
            </td></tr>
        </table>
    </td></tr>

    <tr><td style="padding:22px 32px 0;font-family:Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 10px;font-size:13.5px;font-weight:700;color:#241f38;">Productos pedidos</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
                <th align="left" style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#8a84a0;padding-bottom:8px;border-bottom:1px solid #ece8f3;">Producto</th>
                <th align="right" style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#8a84a0;padding-bottom:8px;border-bottom:1px solid #ece8f3;">Cant.</th>
                <th align="right" style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#8a84a0;padding-bottom:8px;border-bottom:1px solid #ece8f3;">Precio</th>
                <th align="right" style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#8a84a0;padding-bottom:8px;border-bottom:1px solid #ece8f3;">Subtotal</th>
            </tr>
            ${items.map(filaProducto).join('')}
        </table>
    </td></tr>

    <tr><td style="padding:22px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="50%" valign="top" style="padding-right:8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ece8f3;border-radius:12px;">
                    <tr><td style="padding:16px 18px;font-family:Helvetica,Arial,sans-serif;">
                        <p style="margin:0 0 12px;font-size:12.5px;font-weight:700;color:#241f38;">Resumen del pedido</p>
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr><td style="font-size:13px;color:#4b4560;padding:3px 0;">Subtotal</td><td align="right" style="font-size:13px;color:#4b4560;padding:3px 0;">$${money(subtotal)}</td></tr>
                            <tr><td style="font-size:13px;color:#4b4560;padding:3px 0;">Envío</td><td align="right" style="font-size:13px;color:#4b4560;padding:3px 0;">${envio ? `$${money(envio)}` : 'Gratis'}</td></tr>
                            ${descuento ? `<tr><td style="font-size:13px;color:${C.primary};padding:3px 0;">Descuento</td><td align="right" style="font-size:13px;color:${C.primary};padding:3px 0;">-$${money(descuento)}</td></tr>` : ''}
                            <tr><td style="font-size:15px;font-weight:800;color:#241f38;padding-top:10px;border-top:1px solid #ece8f3;">Total</td><td align="right" style="font-size:15px;font-weight:800;color:${C.primary};padding-top:10px;border-top:1px solid #ece8f3;">$${money(total)}</td></tr>
                        </table>
                        <p style="margin:12px 0 0;font-size:12px;color:#8a84a0;">Método de pago: ${metodoPagoTexto}</p>
                    </td></tr>
                </table>
            </td>
            <td width="50%" valign="top" style="padding-left:8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ece8f3;border-radius:12px;">
                    <tr><td style="padding:16px 18px;font-family:Helvetica,Arial,sans-serif;">
                        <p style="margin:0 0 12px;font-size:12.5px;font-weight:700;color:#241f38;">${tipoEntrega === 'domicilio' ? 'Dirección de entrega' : 'Punto de recogida'}</p>
                        ${bloqueDireccion}
                    </td></tr>
                </table>
            </td>
        </tr></table>
    </td></tr>

    ${avisoQr}

    <tr><td style="padding:26px 32px 30px;text-align:center;font-family:Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#241f38;">Gracias por confiar en nosotros &#128156;</p>
        <p style="margin:0;font-size:12px;color:#8a84a0;">Grupo GH · Medellín, Colombia</p>
        <p style="margin:8px 0 0;font-size:12px;color:#8a84a0;">Este es un mensaje automático — no respondas directamente a este correo.</p>
        ${process.env.FOOTER_CODEDREAM ? `<p style="margin:14px 0 0;font-size:9.5px;color:#8a84a0;opacity:.75;">${process.env.FOOTER_CODEDREAM}</p>` : ''}
    </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

    return enviarCorreoSes({ remitente: REMITENTE_COMPRAS, destinatario: to, asunto: `Pedido confirmado #${numeroPedido}`, html, contexto: 'confirmacion-pedido' });
}
