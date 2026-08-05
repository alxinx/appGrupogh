import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const WEB_STORE_URL = process.env.WEB_STORE_URL || 'https://www.grupogh.com';
const SOPORTE_EMAIL = process.env.SOPORTE_EMAIL || 'info@grupogh.com';
const SOPORTE_WHATSAPP = process.env.SOPORTE_WHATSAPP || '573000000000';
const LINK_INSTAGRAM = process.env.LINK_INSTAGRAM || '#';
const LINK_FACEBOOK = process.env.LINK_FACEBOOK || '#';
const LINK_TIKTOK = process.env.LINK_TIKTOK || '#';

const COLOR_PRIMARY = '#EC1876';
const COLOR_PRIMARY_SOFT = '#FDEBF3';
const COLOR_BG = '#FDF3F8';
const COLOR_TEXT = '#1f2430';
const COLOR_MUTED = '#6b7280';

// Iconos de línea, en primitivas simples (nada de paths largos) — se ven iguales en
// cualquier cliente moderno de correo y heredan el color de marca en vez de depender
// de cómo cada sistema operativo dibuje los emoji.
function icono(nombre, { size = 20, color = COLOR_PRIMARY } = {}) {
    const base = `viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"`;
    const formas = {
        doc: `<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>`,
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
        sobre: `<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 6 12 13 21 6"/>`
    };
    return `<svg ${base}>${formas[nombre] || ''}</svg>`;
}

function fmtCOP(n) {
    return `$${Math.round(Number(n) || 0).toLocaleString('es-CO')} COP`;
}

function fmtFecha(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Formato "10:30 AM" — deliberadamente no-locale para que sea igual en cualquier cliente de correo.
function fmtHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    let horas = d.getHours();
    const minutos = String(d.getMinutes()).padStart(2, '0');
    const ampm = horas >= 12 ? 'PM' : 'AM';
    horas = horas % 12 || 12;
    return `${horas}:${minutos} ${ampm}`;
}

function itemFilaHtml(it) {
    const linkProducto = it.slug ? `${WEB_STORE_URL}/producto/${it.slug}` : null;
    return `
    <tr>
        <td style="padding:16px 0; border-bottom:1px solid #F3E4EC;" valign="top">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td width="56" valign="top">
                        ${it.imagen
                            ? `<img src="${it.imagen}" width="56" height="66" alt="${it.nombre}" style="display:block; border-radius:10px; object-fit:cover; background:#F3E4EC;">`
                            : `<div style="width:56px; height:66px; border-radius:10px; background:#F3E4EC;"></div>`}
                    </td>
                    <td width="14"></td>
                    <td valign="top">
                        <p style="margin:0; font-size:14px; font-weight:700; color:${COLOR_TEXT};">${it.nombre}</p>
                        ${linkProducto ? `<a href="${linkProducto}" style="font-size:12px; color:${COLOR_PRIMARY}; text-decoration:none; font-weight:600;">Ver producto en tienda ↗</a>` : ''}
                        <p class="prod-mobile-meta" style="display:none; margin:4px 0 0; font-size:12px; color:${COLOR_MUTED};">${it.referencia || '—'} · x${Number(it.cantidad)} · ${fmtCOP(it.valorUnidad)} c/u</p>
                    </td>
                </tr>
            </table>
        </td>
        <td class="prod-col-ref" style="padding:16px 0; border-bottom:1px solid #F3E4EC; font-size:13px; color:${COLOR_MUTED}; font-family:monospace;" valign="top">${it.referencia || '—'}</td>
        <td class="prod-col-qty" style="padding:16px 0; border-bottom:1px solid #F3E4EC; font-size:13px; color:${COLOR_TEXT}; text-align:center;" valign="top">${Number(it.cantidad)}</td>
        <td class="prod-col-price" style="padding:16px 0; border-bottom:1px solid #F3E4EC; font-size:13px; color:${COLOR_TEXT}; text-align:right;" valign="top">${fmtCOP(it.valorUnidad)}</td>
        <td style="padding:16px 0; border-bottom:1px solid #F3E4EC; font-size:14px; font-weight:700; color:${COLOR_TEXT}; text-align:right;" valign="top">${fmtCOP(it.subTotal)}</td>
    </tr>`;
}

function infoCardHtml(iconoNombre, label, valor) {
    return `
    <td class="info-card" width="25%" style="padding:20px 10px; text-align:center; vertical-align:top;">
        <div style="margin-bottom:8px;">${icono(iconoNombre, { size: 20 })}</div>
        <p style="margin:0 0 4px; font-size:11px; font-weight:700; color:${COLOR_MUTED}; text-transform:uppercase; letter-spacing:.04em;">${label}</p>
        <p style="margin:0; font-size:14px; font-weight:700; color:${COLOR_TEXT}; white-space:pre-line;">${valor}</p>
    </td>`;
}

function featureHtml(iconoNombre, titulo, subtitulo) {
    return `
    <td class="feature-card" width="25%" style="padding:14px 8px; text-align:center; vertical-align:top;">
        <div style="margin-bottom:6px;">${icono(iconoNombre, { size: 20 })}</div>
        <p style="margin:0; font-size:12px; font-weight:700; color:${COLOR_TEXT};">${titulo}</p>
        <p style="margin:0; font-size:11px; color:${COLOR_MUTED};">${subtitulo}</p>
    </td>`;
}

const ESTILOS_RESPONSIVE = `
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; line-height:100%; outline:none; text-decoration:none; }
    body { margin:0; padding:0; width:100% !important; }
    .prod-mobile-meta { display: none; }

    @media screen and (max-width: 480px) {
        .email-container { width:100% !important; }
        .px-mobile { padding-left:20px !important; padding-right:20px !important; }

        /* Hero: texto arriba, caja debajo, centrado */
        .hero-text-cell, .hero-img-cell { display:block !important; width:100% !important; text-align:center !important; }
        .hero-text-cell p { text-align:left !important; }
        .hero-img-cell { padding-top:16px !important; }
        .hero-img-cell img { margin:0 auto !important; }

        /* Tarjetas de info: 2 columnas en vez de 4 */
        .info-card { display:inline-block !important; width:46% !important; padding:14px 4px !important; }

        /* Ayuda: texto arriba, botones debajo, apilados */
        .help-text-cell, .help-btns-cell { display:block !important; width:100% !important; text-align:left !important; }
        .help-btns-cell { padding-top:16px !important; }
        .help-btns-cell a { display:block !important; }

        /* Iconos de confianza: 2 columnas */
        .feature-card { display:inline-block !important; width:46% !important; padding:10px 4px !important; }

        /* Tabla de productos: ocultar columnas secundarias, mostrar resumen bajo el nombre */
        .prod-col-ref, .prod-col-qty, .prod-col-price { display:none !important; }
        .prod-mobile-meta { display:block !important; }

        .h1-mobile { font-size:22px !important; }
    }
`;

// Construye el HTML del correo. `imgLogo`/`imgBox` permiten pasar data-URIs (para previsualizar
// sin depender de que el sitio esté publicado) o dejar el default (URLs públicas del sitio web).
export function construirHtmlPedidoCancelado(datos, opts = {}) {
    const {
        nombreCliente, numeroPedido, fechaPedido, fechaCancelacion,
        total, razones, items = []
    } = datos;

    const imgLogo = opts.imgLogo || `${WEB_STORE_URL}/logo.webp`;
    const imgBox = opts.imgBox || `${WEB_STORE_URL}/box.webp`;
    const listaRazones = Array.isArray(razones) ? razones : [razones];

    const totalPedido = total ?? items.reduce((s, it) => s + Number(it.subTotal || 0), 0);
    const LOGO_SIZE = 90;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>Tu pedido fue cancelado</title>
<style>${ESTILOS_RESPONSIVE}</style>
</head>
<body style="margin:0; padding:0; background-color:${COLOR_BG}; font-family:Helvetica, Arial, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR_BG};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="email-container" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px; max-width:100%; background:#ffffff; border-radius:20px; overflow:hidden; border:1px solid #FBDCEA;">

    <!-- Top bar: fondo rosa claro, línea inferior que el logo va a atravesar -->
    <tr>
        <td class="px-mobile" style="padding:18px 32px ${LOGO_SIZE / 2 + 18}px; background:${COLOR_BG}; border-bottom:1px solid #F6CFE1;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="font-size:13px; font-weight:700; color:${COLOR_PRIMARY};">Grupo GH - Tienda Web</td>
                    <td style="text-align:right; font-size:12px;"><a href="${WEB_STORE_URL}" style="color:${COLOR_MUTED}; text-decoration:underline;">Ver en el navegador</a></td>
                </tr>
            </table>
        </td>
    </tr>

    <!-- Logo — se monta sobre la línea de arriba con un margen negativo, quedando entre las dos zonas -->
    <tr>
        <td style="padding:0 32px; background:#ffffff; text-align:center;">
            <img src="${imgLogo}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" alt="Grupo GH" style="display:inline-block; border-radius:50%; margin-top:-${LOGO_SIZE / 2}px; border:4px solid #ffffff;">
        </td>
    </tr>

    <!-- Hero -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td class="hero-text-cell" valign="middle">
                        <p class="h1-mobile" style="margin:0; font-size:26px; font-weight:800; line-height:1.2; color:${COLOR_TEXT};">Tu pedido ha sido</p>
                        <p class="h1-mobile" style="margin:0 0 12px; font-size:26px; font-weight:800; line-height:1.2; color:${COLOR_PRIMARY};">cancelado</p>
                        <p style="margin:0; font-size:14px; line-height:1.6; color:${COLOR_MUTED}; max-width:320px;">Sentimos que tu pedido no haya podido completarse. Aquí te compartimos los detalles.</p>
                    </td>
                    <td class="hero-img-cell" width="150" align="right" valign="middle">
                        <img src="${imgBox}" width="140" alt="" style="display:block;">
                    </td>
                </tr>
            </table>
        </td>
    </tr>

    <!-- Info cards -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR_BG}; border:1px solid #FBDCEA; border-radius:16px;">
                <tr>
                    ${infoCardHtml('doc', 'Pedido', `#${numeroPedido}`)}
                    ${infoCardHtml('calendario', 'Fecha del pedido', `${fmtFecha(fechaPedido)}\n${fmtHora(fechaPedido)}`)}
                    ${infoCardHtml('calendarioX', 'Fecha de cancelación', `${fmtFecha(fechaCancelacion)}\n${fmtHora(fechaCancelacion)}`)}
                    ${infoCardHtml('dolar', 'Valor del pedido', fmtCOP(totalPedido))}
                </tr>
            </table>
        </td>
    </tr>

    <!-- Razones -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #F0E4EA; border-radius:16px;">
                <tr><td style="padding:22px 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                        <td style="padding-right:8px;">${icono('alerta', { size: 18 })}</td>
                        <td style="font-size:15px; font-weight:700; color:${COLOR_TEXT};">Razones de la cancelación</td>
                    </tr></table>
                    <p style="margin:8px 0 14px; font-size:13px; color:${COLOR_MUTED};">Tu pedido fue cancelado por las siguientes razones:</p>
                    <div style="background:${COLOR_PRIMARY_SOFT}; border-radius:12px; padding:16px 18px;">
                        <ul style="margin:0; padding-left:18px; font-size:13px; line-height:1.9; color:${COLOR_TEXT};">
                            ${listaRazones.map(r => `<li>${r}</li>`).join('')}
                        </ul>
                    </div>
                    <p style="margin:14px 0 0; font-size:12.5px; color:${COLOR_MUTED};">Si tenés alguna duda o considerás que esto es un error, contáctanos y con gusto te ayudamos.</p>
                </td></tr>
            </table>
        </td>
    </tr>

    <!-- Productos -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #F0E4EA; border-radius:16px;">
                <tr><td style="padding:22px 24px 8px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                        <td style="padding-right:8px;">${icono('bolsa', { size: 18 })}</td>
                        <td style="font-size:15px; font-weight:700; color:${COLOR_TEXT};">Productos que pediste</td>
                    </tr></table>
                </td></tr>
                <tr><td style="padding:0 24px; overflow-x:auto;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                            <td style="font-size:11px; font-weight:700; color:${COLOR_MUTED}; text-transform:uppercase; padding-bottom:8px; border-bottom:2px solid ${COLOR_PRIMARY_SOFT};">Producto</td>
                            <td class="prod-col-ref" style="font-size:11px; font-weight:700; color:${COLOR_MUTED}; text-transform:uppercase; padding-bottom:8px; border-bottom:2px solid ${COLOR_PRIMARY_SOFT};">Referencia</td>
                            <td class="prod-col-qty" style="font-size:11px; font-weight:700; color:${COLOR_MUTED}; text-transform:uppercase; padding-bottom:8px; border-bottom:2px solid ${COLOR_PRIMARY_SOFT}; text-align:center;">Cant.</td>
                            <td class="prod-col-price" style="font-size:11px; font-weight:700; color:${COLOR_MUTED}; text-transform:uppercase; padding-bottom:8px; border-bottom:2px solid ${COLOR_PRIMARY_SOFT}; text-align:right;">Precio</td>
                            <td style="font-size:11px; font-weight:700; color:${COLOR_MUTED}; text-transform:uppercase; padding-bottom:8px; border-bottom:2px solid ${COLOR_PRIMARY_SOFT}; text-align:right;">Total</td>
                        </tr>
                        ${items.map(itemFilaHtml).join('')}
                        <tr>
                            <td colspan="4" style="padding:16px 0; text-align:right; font-size:14px; font-weight:700; color:${COLOR_TEXT};">Total del pedido</td>
                            <td style="padding:16px 0; text-align:right; font-size:16px; font-weight:800; color:${COLOR_PRIMARY};">${fmtCOP(totalPedido)}</td>
                        </tr>
                    </table>
                </td></tr>
                <tr><td style="padding-bottom:22px;"></td></tr>
            </table>
        </td>
    </tr>

    <!-- Ayuda -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #F0E4EA; border-radius:16px;">
                <tr><td style="padding:20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                        <td class="help-text-cell" valign="middle">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                                <td style="width:44px; height:44px; background:${COLOR_PRIMARY_SOFT}; border-radius:50%; text-align:center;">${icono('audifonos', { size: 20 })}</td>
                                <td style="padding-left:12px;">
                                    <p style="margin:0; font-size:14px; font-weight:700; color:${COLOR_TEXT};">¿Necesitás ayuda?</p>
                                    <p style="margin:0; font-size:12.5px; color:${COLOR_MUTED}; max-width:260px;">Estamos acá para ayudarte. Escribinos por WhatsApp o a nuestro correo.</p>
                                </td>
                            </tr></table>
                        </td>
                        <td class="help-btns-cell" align="right" valign="middle">
                            <a href="https://api.whatsapp.com/send?phone=${SOPORTE_WHATSAPP}" style="display:block; margin-bottom:8px; border:1px solid ${COLOR_PRIMARY}; color:${COLOR_PRIMARY}; font-size:12.5px; font-weight:700; text-decoration:none; padding:9px 16px; border-radius:10px; white-space:nowrap; text-align:center;">${icono('mensaje', { size: 14 })} Escribir por WhatsApp</a>
                            <a href="mailto:${SOPORTE_EMAIL}" style="display:block; border:1px solid ${COLOR_PRIMARY}; color:${COLOR_PRIMARY}; font-size:12.5px; font-weight:700; text-decoration:none; padding:9px 16px; border-radius:10px; white-space:nowrap; text-align:center;">${icono('sobre', { size: 14 })} ${SOPORTE_EMAIL}</a>
                        </td>
                    </tr></table>
                </td></tr>
            </table>
        </td>
    </tr>

    <!-- Features -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR_BG}; border-radius:16px;">
                <tr>
                    ${featureHtml('escudo', 'Compra segura', 'Tus datos están protegidos')}
                    ${featureHtml('estrella', 'Productos de calidad', 'Lo mejor para ti')}
                    ${featureHtml('camion', 'Envíos rápidos', 'Recibe tu pedido en tiempo récord')}
                    ${featureHtml('audifonos', 'Atención personalizada', 'Te acompañamos')}
                </tr>
            </table>
        </td>
    </tr>

    <!-- Footer -->
    <tr>
        <td class="px-mobile" style="padding:32px 32px 28px; text-align:center;">
            <img src="${imgLogo}" width="52" height="52" alt="Grupo GH" style="display:inline-block; border-radius:50%; margin-bottom:10px;">
            <p style="margin:0; font-size:13px; font-weight:700; color:${COLOR_PRIMARY};">Grupo GH - Tienda Web</p>
            <p style="margin:0 0 12px; font-size:12px; color:${COLOR_MUTED};">Moda que te representa</p>
            <p style="margin:0 0 16px;">
                <a href="${LINK_INSTAGRAM}" style="display:inline-block; margin:0 6px; color:${COLOR_PRIMARY}; text-decoration:none; font-size:14px;">Instagram</a>
                <a href="${LINK_FACEBOOK}" style="display:inline-block; margin:0 6px; color:${COLOR_PRIMARY}; text-decoration:none; font-size:14px;">Facebook</a>
                <a href="${LINK_TIKTOK}" style="display:inline-block; margin:0 6px; color:${COLOR_PRIMARY}; text-decoration:none; font-size:14px;">TikTok</a>
            </p>
            <p style="margin:0; font-size:11px; color:#b9b9c2;">© ${new Date().getFullYear()} Grupo GH. Todos los derechos reservados.</p>
            <p style="margin:0; font-size:11px; color:#b9b9c2;">Este correo fue enviado automáticamente, por favor no respondas.</p>
        </td>
    </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

const mailPedidoCancelado = async (datos) => {
    const transport = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: process.env.MAIL_PORT,
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS
        }
    });

    const html = construirHtmlPedidoCancelado(datos);
    const listaRazones = Array.isArray(datos.razones) ? datos.razones : [datos.razones];

    await transport.sendMail({
        from: process.env.APP_NAME,
        to: datos.emailCliente,
        subject: `Tu pedido ${datos.numeroPedido} fue cancelado`,
        text: `Hola ${datos.nombreCliente}, tu pedido ${datos.numeroPedido} fue cancelado. Motivo: ${listaRazones.join(' / ')}`,
        html
    });
};

export { mailPedidoCancelado };
