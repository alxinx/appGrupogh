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

// ─── Iconos de línea ────────────────────────────────────────────────────────
//
// Primitivas simples (nada de paths largos) para los correos con layout propio
// (confirmación/cancelación de pedido, bienvenida de proveedor): se ven iguales en
// cualquier cliente moderno y heredan el color de marca, en vez de depender de cómo cada
// sistema operativo dibuje un emoji. Nació de dos copias idénticas de esta misma función
// en helpers/mailPedidoCancelado.js y helpers/mailBienvenidaProveedor.js.
export function icono(nombre, { size = 20, color = C.primary } = {}) {
    const base = `viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"`;
    const formas = {
        doc: `<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>`,
        carpeta: `<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>`,
        calendario: `<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/>`,
        calendarioX: `<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9.5" y1="14.5" x2="14.5" y2="19.5"/><line x1="14.5" y1="14.5" x2="9.5" y2="19.5"/>`,
        dolar: `<circle cx="12" cy="12" r="9"/><text x="12" y="16.3" text-anchor="middle" font-size="11" font-weight="700" fill="${color}" stroke="none" font-family="Helvetica,Arial,sans-serif">$</text>`,
        alerta: `<path d="M12 3 L22 21 L2 21 Z"/><line x1="12" y1="9.5" x2="12" y2="14"/><circle cx="12" cy="17" r="0.7" fill="${color}" stroke="none"/>`,
        bolsa: `<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>`,
        audifonos: `<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19v1a3 3 0 0 1-3 3h-3"/>`,
        escudo: `<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><polyline points="8.5 12 11 14.5 15.5 9.5"/>`,
        estrella: `<polygon points="12 2 15 9 22 9.5 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.5 9 9"/>`,
        camion: `<rect x="1" y="7" width="13" height="10"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="6" cy="19" r="1.6" fill="${color}" stroke="none"/><circle cx="17" cy="19" r="1.6" fill="${color}" stroke="none"/>`,
        mensaje: `<path d="M4 4h16v12H8l-4 4z"/>`,
        sobre: `<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 6 12 13 21 6"/>`,
        banco: `<polygon points="12 2 22 8 2 8"/><line x1="4" y1="8" x2="4" y2="19"/><line x1="9" y1="8" x2="9" y2="19"/><line x1="15" y1="8" x2="15" y2="19"/><line x1="20" y1="8" x2="20" y2="19"/><line x1="2" y1="21" x2="22" y2="21"/>`,
        llave: `<circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12 L21 2"/><path d="M17 6 L20 9"/><path d="M14 9 L16.5 11.5"/>`,
        etiqueta: `<path d="M3 11.5V4a1 1 0 0 1 1-1h7.5L21 11.5 12.5 20 3 11.5z"/><circle cx="7.5" cy="7.5" r="1.3" fill="${color}" stroke="none"/>`,
        instagram: `<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="${color}" stroke="none"/>`,
        facebook: `<circle cx="12" cy="12" r="9"/><path d="M14 8.5h-1.8c-.9 0-1.4.5-1.4 1.4V11h3.1l-.4 2.6h-2.7V21"/>`,
        tiktok: `<path d="M13 3v12.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M13 6.5c0 2.5 2 4.3 4.3 4.3"/>`
    };
    return `<svg ${base}>${formas[nombre] || ''}</svg>`;
}

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
