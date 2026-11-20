import { COLORES_CORREO as C, LOGO_URL } from '../config/marca.js';
import { money } from './formatMoney.js';

// La estructura de TODOS los correos de la webapp (plantillaMarca) y sus piezas, más los
// formatos de fecha. Antes convivían tres diseños: plantillaSimple() para los avisos, uno
// propio en la bienvenida de empleado y otro en la cancelación de pedido. Desde el
// 2026-11-20 todos usan el de la confirmación de pedido (regla del dueño).

// ─── Formatos ───────────────────────────────────────────────────────────────

/** "7 de septiembre de 2026, 10:30" — fecha larga, para avisos internos. */
export const fmtFechaLarga = (fecha) =>
    new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Bogota'
    }).format(fecha instanceof Date ? fecha : new Date(fecha));

/** "7 sept 2026" — fecha corta, para tablas y tarjetas. */
export const fmtFechaCorta = (fecha) => {
    if (!fecha) return '—';
    return new Date(fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** "10:30 AM" — deliberadamente no-locale, para que sea igual en cualquier cliente de correo. */
export const fmtHora = (fecha) => {
    if (!fecha) return '';
    const d = new Date(fecha);
    let horas = d.getHours();
    const minutos = String(d.getMinutes()).padStart(2, '0');
    const ampm = horas >= 12 ? 'PM' : 'AM';
    horas = horas % 12 || 12;
    return `${horas}:${minutos} ${ampm}`;
};

// ─── Piezas reutilizables ───────────────────────────────────────────────────

// ─── Diseño de marca (el de la confirmación de pedido) ──────────────────────

// Regla del dueño (2026-11-20): todo correo que sale de la webapp usa el diseño de la
// confirmación de pedido — fondo gris azulado, tarjeta blanca de 600px con radio 16, franja
// rosada con el logo en círculo, ícono redondo + título + saludo + intro centrados, bloques
// con borde #ece8f3 y el pie "mensaje automático". Esta es la ÚNICA copia de esa
// estructura: la usan todos los correos (emailSes.js, mailNewEmployer.js,
// mailPedidoCancelado.js, mailRecuperarContrasena.js, notificarQrPago.js).

/** Tonos del ícono redondo del encabezado. */
export const ICONO_CORREO = {
    ok:     { fondo: '#e7f8f1', color: C.ok },
    marca:  { fondo: C.primarySoft, color: C.primary },
    alerta: { fondo: '#fff6e5', color: '#7a4d00' },
    peligro: { fondo: C.alertaSuave, color: C.alerta }
};

/** Tarjeta con borde y título (como "Resumen del pedido"). */
export const tarjetaCorreo = ({ titulo, html }) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ece8f3;border-radius:12px;">
        <tr><td style="padding:16px 18px;font-family:Helvetica,Arial,sans-serif;">
            ${titulo ? `<p style="margin:0 0 12px;font-size:12.5px;font-weight:700;color:#241f38;">${titulo}</p>` : ''}
            ${html}
        </td></tr>
    </table>`;

/** Filas etiqueta → valor dentro de una tarjeta. `lineas` es [['Entidad', 'Bancolombia'], ...]. */
export const datosCorreo = (lineas) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${lineas.map(([etiqueta, valor]) => `
        <tr>
            <td style="font-size:13px;color:#8a84a0;padding:5px 12px 5px 0;vertical-align:top;">${etiqueta}</td>
            <td align="right" style="font-size:13px;color:#241f38;font-weight:700;padding:5px 0;">${valor}</td>
        </tr>`).join('')}
    </table>`;

/** Bloque de texto del cuerpo. */
export const parrafoCorreo = (html) => `<div style="font-size:13.5px;line-height:1.6;color:#4b4560;">${html}</div>`;

// Tabla de productos de un pedido (confirmación y cancelación). Cada item:
// { nombreProducto, cantidad, valorUnidad, subTotal, imagen?, talla?, color?, referencia? }
const PALETA_SWATCH = [
    { bg: '#f6c9de', fg: '#ad3d76' },
    { bg: '#d8d3f0', fg: '#5b4fa3' },
    { bg: '#c9e8dc', fg: '#1f7a58' }
];

const inicialesProducto = (nombre) => (nombre || '')
    .split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '·';

function filaProducto(item, idx) {
    const { bg, fg } = PALETA_SWATCH[idx % PALETA_SWATCH.length];
    const meta = [item.referencia ? `Ref. ${item.referencia}` : null, item.talla ? `Talla ${item.talla}` : null, item.color ? `Color: ${item.color}` : null].filter(Boolean).join(' · ');

    // La foto real del producto cuando la hay; si no, el cuadro con las iniciales: una
    // etiqueta <img> rota se ve mucho peor. El color de fondo queda debajo de la foto: es
    // lo que ve el cliente mientras carga, o si bloquea imágenes.
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

const TH = 'font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#8a84a0;padding-bottom:8px;border-bottom:1px solid #ece8f3;';

/** Título + tabla de productos. */
export const tablaProductosCorreo = (titulo, items) => `
        <p style="margin:0 0 10px;font-size:13.5px;font-weight:700;color:#241f38;">${titulo}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
                <th align="left" style="${TH}">Producto</th>
                <th align="right" style="${TH}">Cant.</th>
                <th align="right" style="${TH}">Precio</th>
                <th align="right" style="${TH}">Subtotal</th>
            </tr>
            ${items.map(filaProducto).join('')}
        </table>`;

/** Botón principal (degradado de marca, como .btn-primary del panel). */
export const botonCorreo = (url, texto) => `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
        <tr><td style="border-radius:12px;background:${C.primary};background-image:linear-gradient(90deg,#F794C9,${C.primary});">
            <a href="${url}" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${texto}</a>
        </td></tr>
    </table>`;

/** Fila del cuerpo con el padding lateral de la plantilla. */
export const filaCorreo = (html, { arriba = 22 } = {}) =>
    `<tr><td style="padding:${arriba}px 32px 0;font-family:Helvetica,Arial,sans-serif;">${html}</td></tr>`;

/** Aviso ámbar (el "Importante" del pago por QR). */
export const avisoCorreo = (titulo, html) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff6e5;border:1px solid #f6dfab;border-radius:14px;">
        <tr><td style="padding:18px;font-family:Helvetica,Arial,sans-serif;">
            <p style="margin:0 0 6px;font-size:13.5px;font-weight:700;color:#7a4d00;">${titulo}</p>
            <div style="font-size:12.8px;line-height:1.6;color:#8a5a00;">${html}</div>
        </td></tr>
    </table>`;

/**
 * El correo completo. `filasHtml` son filas <tr> (usar filaCorreo) entre el encabezado y el pie.
 *   icono      { simbolo: '&#10003;', ...ICONO_CORREO.ok }
 *   despedida  la línea en negrita del pie (por defecto, ninguna)
 *   pieBaja    URL de baja, solo para correos que salen por lista (producto disponible)
 */
export function plantillaMarca({ icono, titulo, saludo, intro, filasHtml = '', despedida, pieBaja }) {
    return `<!DOCTYPE html>
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
        ${icono ? `<div style="width:44px;height:44px;line-height:44px;border-radius:50%;background:${icono.fondo};color:${icono.color};margin:0 auto 14px;font-size:20px;">${icono.simbolo}</div>` : ''}
        <h1 style="margin:0 0 6px;font-size:21px;color:#241f38;">${titulo}</h1>
        ${saludo ? `<p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#4b4560;">${saludo}</p>` : ''}
        ${intro ? `<p style="margin:0 auto;max-width:38ch;font-size:13.5px;color:#8a84a0;line-height:1.6;">${intro}</p>` : ''}
    </td></tr>

    ${filasHtml}

    <tr><td style="padding:26px 32px 30px;text-align:center;font-family:Helvetica,Arial,sans-serif;">
        ${despedida ? `<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#241f38;">${despedida}</p>` : ''}
        <p style="margin:0;font-size:12px;color:#8a84a0;">Grupo GH · Medellín, Colombia</p>
        <p style="margin:8px 0 0;font-size:12px;color:#8a84a0;">Este es un mensaje automático — no respondas directamente a este correo.</p>
        ${pieBaja ? `<p style="margin:8px 0 0;font-size:12px;"><a href="${pieBaja}" style="color:#8a84a0;text-decoration:underline;">Dar de baja este aviso</a></p>` : ''}
        ${process.env.FOOTER_CODEDREAM ? `<p style="margin:14px 0 0;font-size:9.5px;color:#8a84a0;opacity:.75;">${process.env.FOOTER_CODEDREAM}</p>` : ''}
    </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
