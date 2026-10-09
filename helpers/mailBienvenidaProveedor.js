import dotenv from 'dotenv';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {
    COLORES_CORREO, LOGO_URL, PORTAL_URL, WEB_STORE_URL,
    SOPORTE_EMAIL, WHATSAPP_URL, REDES
} from '../config/marca.js';
import { fmtFechaCorta } from './plantillaCorreo.js';
import { buscarEntidadFinanciera, buscarTipoLlaveBreb, TIPOS_CUENTA_BANCARIA } from './catalogos.js';
import { destinoDe } from './almacenamientoDocumentos.js';
import { enviarCorreoSes, REMITENTE_COMPRAS } from './emailSes.js';
dotenv.config();

// Mismo esqueleto que helpers/mailPedidoCancelado.js (barra superior + logo superpuesto,
// tarjetas de info, bloque de ayuda, footer con redes): es el tercer correo con layout
// propio del proyecto y repite ese patrón en vez de inventar uno nuevo.
const C = COLORES_CORREO;
const COLOR_PRIMARY = C.primary;
const COLOR_PRIMARY_SOFT = C.primarySoft;
const COLOR_BG = C.fondo;
const COLOR_TEXT = C.texto;
const COLOR_MUTED = C.textoSuave;

// La mano que estrecha la del cliente se sirve desde este mismo backend (PORTAL_URL),
// no desde el sitio público: es un activo de marketing interno, no una imagen de catálogo.
// En PNG, no WebP: Outlook de escritorio no decodifica WebP y mostraba el espacio vacío,
// el mismo problema de fondo que los íconos SVG de acá arriba.
const IMG_MANOS = `${PORTAL_URL}/img/avatars/hands.png`;

// Íconos como PNG, no SVG inline: Outlook de escritorio (y otros clientes de correo) quitan
// las etiquetas <svg> del HTML antes de renderizar, dejando el círculo de fondo vacío. Cada
// PNG se generó una sola vez a partir de la misma definición de formas que usa
// helpers/plantillaCorreo.js (icono()), así que el dibujo es idéntico al SVG original — no
// es una familia de íconos nueva, es el mismo arte exportado a un formato que todo cliente
// de correo sabe pintar. Viven en public/img/avatars/, igual que hands.png, servidos por
// este backend (PORTAL_URL).
const ICONO_PNG_BASE = `${PORTAL_URL}/img/avatars`;
function icono(nombre, { size = 20 } = {}) {
    // El único ícono con un color distinto al rosa de marca en este correo es la alerta de
    // "cuenta sin verificar": su PNG ya se generó en ámbar, no hace falta un color por parámetro.
    const archivo = nombre === 'alerta' ? 'alerta-ambar' : nombre;
    return `<img src="${ICONO_PNG_BASE}/icono-${archivo}.png" width="${size}" height="${size}" alt="" style="display:inline-block; vertical-align:middle;">`;
}

function infoCardHtml(iconoNombre, label, valor) {
    return `
    <td class="info-card" width="33%" style="padding:20px 10px; text-align:center; vertical-align:top;">
        <div style="margin-bottom:8px;">${icono(iconoNombre, { size: 20 })}</div>
        <p style="margin:0 0 4px; font-size:11px; font-weight:700; color:${COLOR_MUTED}; text-transform:uppercase; letter-spacing:.04em;">${label}</p>
        <p style="margin:0; font-size:14px; font-weight:700; color:${COLOR_TEXT};">${valor}</p>
    </td>`;
}

/** Tabla etiqueta → valor, igual a plantillaCorreo.filasDefinicion pero reescrita acá
 *  porque esta tarjeta necesita su propio padding de fila (las de plantillaCorreo son
 *  para el cuerpo de un correo "simple", más angostas). */
function filasEtiquetaValor(lineas) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${lineas.map(([etiqueta, valor]) => `
        <tr>
            <td style="padding:9px 0; border-bottom:1px solid #F3E4EC; font-size:13px; color:${COLOR_MUTED};">${etiqueta}</td>
            <td style="padding:9px 0; border-bottom:1px solid #F3E4EC; font-size:14px; font-weight:700; color:${COLOR_TEXT}; text-align:right;">${valor}</td>
        </tr>`).join('')}
    </table>`;
}

function contentCardHtml(iconoNombre, titulo, innerHtml) {
    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #F0E4EA; border-radius:16px;">
        <tr><td style="padding:22px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="padding-right:8px;">${icono(iconoNombre, { size: 18 })}</td>
                <td style="font-size:15px; font-weight:700; color:${COLOR_TEXT};">${titulo}</td>
            </tr></table>
            <div style="margin-top:14px;">${innerHtml}</div>
        </td></tr>
    </table>`;
}

// Un chip por categoría, con el mismo rosa suave que el resto del correo.
function chipsCategorias(categorias) {
    return categorias.map(nombre => `
        <span style="display:inline-block; margin:0 6px 8px 0; padding:6px 14px; background:${COLOR_PRIMARY_SOFT}; color:${COLOR_PRIMARY}; font-size:11.5px; font-weight:700; letter-spacing:.02em; text-transform:uppercase; border-radius:999px;">${nombre}</span>`
    ).join('');
}

// Nombre del banco/billetera y del tipo de cuenta a partir de los catálogos
// (helpers/catalogos.js) — los mismos que usa el panel y el formulario de proveedores:
// nunca un nombre a mano, porque la fuente real es el código guardado en la cuenta.
function describirCuenta(c) {
    const entidad = buscarEntidadFinanciera(c.codigoEntidadFinanciera);
    const nombreEntidad = entidad?.nombre ?? c.codigoEntidadFinanciera;
    const tipoLabel = c.tipoCuenta === 'llave_breb'
        ? (buscarTipoLlaveBreb(c.tipoLlaveBreb)?.etiqueta ?? 'Llave Bre-B')
        : (TIPOS_CUENTA_BANCARIA.find(t => t.codigo === c.tipoCuenta)?.descripcion ?? c.tipoCuenta);
    return { nombreEntidad, tipoLabel };
}

/** Tarjeta de una cuenta bancaria: banco, tipo y número, con el aviso de "sin verificar"
 *  si nadie del panel la confirmó todavía (ProvedoresCuentasBancarias.verificada). */
function cuentaHtml(c) {
    const { nombreEntidad, tipoLabel } = describirCuenta(c);
    const numero = `${c.numeroCuenta}${c.principal ? ' <span style="color:' + COLOR_MUTED + '; font-weight:600;">(Principal)</span>' : ''}`;
    const aviso = !c.verificada ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff6e5; border:1px solid #f6dfab; border-radius:10px; margin-bottom:14px;">
            <tr><td style="padding:10px 12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td style="padding-right:6px; vertical-align:top;">${icono('alerta', { size: 14 })}</td>
                    <td style="font-size:12px; line-height:1.5; color:#8a5a00;"><strong>Sin verificar.</strong> Nuestro equipo validará esta cuenta antes de programar tu primer pago.</td>
                </tr></table>
            </td></tr>
        </table>` : '';
    return `${aviso}${filasEtiquetaValor([
        ['Banco', nombreEntidad],
        ['Tipo de cuenta', tipoLabel],
        ['Número', numero]
    ])}`;
}

// Un cuadro de color con el formato del archivo (PDF / IMG) para el documento que NO lleva
// miniatura — cédula y RUT: son documentos de identidad, viven en el bucket PRIVADO de R2
// (CLAUDE.md §5.7) y no se embeben en un correo (reenviable y sin expiración, a diferencia
// del link firmado de 5 min que ya se evitó a propósito). Las fotos del lugar de trabajo sí
// llevan miniatura real — ver resolverMiniaturasDocumentos() — porque son fotos de un
// taller, no un documento de identidad. Decisión tomada con el usuario.
const PALETA_DOC = { PDF: { bg: '#fde2e2', fg: '#b42318' } };
const paletaDoc = (formato) => PALETA_DOC[formato] ?? { bg: COLOR_PRIMARY_SOFT, fg: COLOR_PRIMARY };

function celdaBadge(doc) {
    const { bg, fg } = paletaDoc(doc.formato);
    return `<div style="width:38px;height:38px;border-radius:9px;background:${bg};color:${fg};text-align:center;line-height:38px;font-size:10px;font-weight:800;letter-spacing:.02em;">${doc.formato}</div>`;
}

function filaDocumento(doc, idx, total) {
    const esUltima = idx === total - 1;
    const miniatura = doc.miniatura
        ? `<img src="${doc.miniatura}" width="38" height="38" alt="" style="display:block; width:38px; height:38px; border-radius:9px; object-fit:cover;">`
        : celdaBadge(doc);
    return `
    <tr>
        <td style="padding:12px 0; ${esUltima ? '' : 'border-bottom:1px solid #F3E4EC;'}">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="width:38px;">${miniatura}</td>
                <td style="padding-left:12px;">
                    <span style="font-size:13px; font-weight:600; color:${COLOR_TEXT};">${doc.nombreDocumento}</span>
                </td>
                <td align="right" style="font-size:11.5px; font-weight:700; color:${C.ok}; white-space:nowrap;">&#10003; Cargado</td>
            </tr></table>
        </td>
    </tr>`;
}

// ─── Miniaturas de las fotos del lugar de trabajo ───────────────────────────
//
// Solo "Lugar de trabajo · foto N" (CLAUDE.md §5.13: fotos del taller, obligatorias para
// confeccionistas) lleva miniatura real. Cédula y RUT se quedan con el badge — ver el
// comentario de PALETA_DOC. DOCUMENTACION no tiene una columna de "tipo" aparte del nombre
// libre que arma el controlador al subir (registroProveedorWebController.js), así que el
// nombre es la única forma de distinguirlos.
const esFotoDeTaller = (doc) => String(doc?.nombreDocumento ?? '').startsWith('Lugar de trabajo');

// 320px/60 en vez de 500px/75: a 38x38px en el correo no se nota la diferencia, y con 3
// fotos de taller (el caso real más pesado que hay hoy) el HTML pasaba los ~102KB donde
// Gmail empieza a "recortar" el mensaje — la sección de Archivos cargados, casi al final,
// quedaba en blanco. Medido con construirHtmlBienvenidaProveedor(): 99.9KB → 50.3KB.
const MINIATURA_ANCHO_MAX = 320;
const MINIATURA_CALIDAD_JPEG = 60;

// El formulario permite hasta 8 fotos de taller (registroProveedorWebController.js,
// maxFotos=8), y 8 miniaturas embebidas vuelven a pasar el límite de clip de Gmail aunque
// cada una ya esté achicada — bajar más la calidad degradaría el caso típico de 2-3 fotos
// para cubrir uno raro de 8. En cambio se tapa la cantidad: de la 4ª foto de taller en
// adelante (en el orden en que vienen en `documentos`) no se genera miniatura y
// filaDocumento() cae al badge de siempre, igual que con cualquier documento que falló.
const MAX_MINIATURAS_EMBEBIDAS = 3;

/**
 * Baja el original de R2 (helpers/almacenamientoDocumentos.js resuelve el bucket, público
 * o privado, por la ruta — nunca a mano), lo reduce a una miniatura liviana y la devuelve
 * como data URI JPEG. Nada se sube a ningún lado ni queda en disco: se genera en memoria y
 * se descarta en cuanto el correo sale.
 *
 * Si un documento puntual falla (red, archivo corrupto, lo que sea) queda sin `miniatura` y
 * filaDocumento() cae al badge de siempre — un documento roto no tira abajo el correo
 * completo, que es justo lo que no puede pasar con un envío masivo de 100+ proveedores.
 */
async function resolverMiniaturasDocumentos(documentos) {
    // Contador síncrono: Array.prototype.map ejecuta cada callback en orden hasta su primer
    // await, así que esto cuenta las fotos de taller en el mismo orden en que vienen en
    // `documentos` sin importar en qué orden terminen sus descargas.
    let fotosVistas = 0;
    return Promise.all(documentos.map(async (doc) => {
        if (!doc.keyName || !esFotoDeTaller(doc)) return doc;
        if (fotosVistas++ >= MAX_MINIATURAS_EMBEBIDAS) return doc;
        try {
            const { client, Bucket } = destinoDe(doc.keyName);
            const original = await client.send(new GetObjectCommand({ Bucket, Key: doc.keyName }));
            const bytes = Buffer.concat(await original.Body.toArray());
            const miniaturaBuffer = await sharp(bytes)
                .resize({ width: MINIATURA_ANCHO_MAX, withoutEnlargement: true })
                .jpeg({ quality: MINIATURA_CALIDAD_JPEG })
                .toBuffer();
            return { ...doc, miniatura: `data:image/jpeg;base64,${miniaturaBuffer.toString('base64')}` };
        } catch (e) {
            console.error(`[bienvenida-proveedor] no se pudo generar la miniatura de "${doc.nombreDocumento}" (${doc.keyName}): ${e.message}`);
            return doc;
        }
    }));
}

const ESTILOS_RESPONSIVE = `
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; line-height:100%; outline:none; text-decoration:none; }
    body { margin:0; padding:0; width:100% !important; }

    @media screen and (max-width: 480px) {
        .email-container { width:100% !important; }
        .px-mobile { padding-left:20px !important; padding-right:20px !important; }

        .hero-text-cell, .hero-img-cell { display:block !important; width:100% !important; text-align:center !important; }
        .hero-text-cell p { text-align:left !important; }
        .hero-img-cell { padding-top:16px !important; }
        .hero-img-cell img { margin:0 auto !important; }

        .info-card { display:block !important; width:100% !important; padding:14px 10px !important; border-bottom:1px solid #F3E4EC; }
        .info-card:last-child { border-bottom:none; }

        .help-text-cell, .help-btns-cell { display:block !important; width:100% !important; text-align:left !important; }
        .help-btns-cell { padding-top:16px !important; }
        .help-btns-cell a { display:block !important; }

        .h1-mobile { font-size:22px !important; }
    }
`;

/**
 * `imgLogo`/`imgManos` permiten pasar otra URL (ej. para previsualizar antes de publicar)
 * en vez de las públicas por defecto.
 */
export function construirHtmlBienvenidaProveedor(datos, opts = {}) {
    const {
        razonSocial, emailProveedor, tipoDocumento, taxIdSupplier, fechaRegistro,
        categorias = [], cuentas = [], documentos = []
    } = datos;

    const imgLogo = opts.imgLogo || LOGO_URL;
    const imgManos = opts.imgManos || IMG_MANOS;
    const LOGO_SIZE = 90;
    // Principal primero, pero se muestran todas: un proveedor puede tener varias cuentas
    // (una de Bancolombia y un Nequi, por ejemplo — CLAUDE.md) y la tarjeta dice
    // "Cuentas bancarias" en plural cuando hay más de una.
    const cuentasOrdenadas = [...cuentas].sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0));

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>Bienvenido a Grupo GH</title>
<style>${ESTILOS_RESPONSIVE}</style>
</head>
<body style="margin:0; padding:0; background-color:${COLOR_BG}; font-family:Helvetica, Arial, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR_BG};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="email-container" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px; max-width:100%; background:#ffffff; border-radius:20px; overflow:hidden; border:1px solid #FBDCEA;">

    <!-- Top bar -->
    <tr>
        <td class="px-mobile" style="padding:18px 32px ${LOGO_SIZE / 2 + 18}px; background:${COLOR_BG}; border-bottom:1px solid #F6CFE1;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="font-size:13px; font-weight:700; color:${COLOR_PRIMARY};">Grupo GH · Proveedores</td>
                    <td style="text-align:right; font-size:12px;"><a href="${WEB_STORE_URL}" style="color:${COLOR_MUTED}; text-decoration:underline;">Visitar grupogh.co</a></td>
                </tr>
            </table>
        </td>
    </tr>

    <!-- Logo superpuesto -->
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
                        <p class="h1-mobile" style="margin:0; font-size:26px; font-weight:800; line-height:1.2; color:${COLOR_TEXT};">Tu registro como</p>
                        <p class="h1-mobile" style="margin:0 0 12px; font-size:26px; font-weight:800; line-height:1.2; color:${COLOR_PRIMARY};">proveedor fue exitoso</p>
                        <p style="margin:0; font-size:14px; line-height:1.6; color:${COLOR_MUTED}; max-width:320px;">¡Gracias por registrarte, <strong style="color:${COLOR_TEXT};">${razonSocial}</strong>! 💜</p>
                    </td>
                    <td class="hero-img-cell" width="150" align="right" valign="middle">
                        <img src="${imgManos}" width="140" alt="" style="display:block;">
                    </td>
                </tr>
            </table>
        </td>
    </tr>

    <!-- Mensaje de bienvenida -->
    <tr>
        <td class="px-mobile" style="padding:4px 32px 0;">
            <p style="margin:0 0 12px; font-size:14px; line-height:1.65; color:${COLOR_MUTED};">Nos alegra mucho que quieras ser parte de la red de proveedores de Grupo GH. Tu registro nos permite organizar mejor la distribución y el seguimiento del trabajo, facilitando la coordinación entre todos y haciendo que trabajemos cada vez mejor juntos.</p>
            <p style="margin:0; font-size:14px; line-height:1.65; color:${COLOR_MUTED};">🎉 Te damos la bienvenida a Grupo GH. Pronto estaremos en contacto contigo.</p>
        </td>
    </tr>

    <!-- Info cards -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR_BG}; border:1px solid #FBDCEA; border-radius:16px;">
                <tr>
                    ${infoCardHtml('doc', 'Documento', `${tipoDocumento} ${taxIdSupplier}`)}
                    ${infoCardHtml('calendario', 'Fecha de registro', fmtFechaCorta(fechaRegistro))}
                    ${infoCardHtml('escudo', 'Registro', 'Completado')}
                </tr>
            </table>
        </td>
    </tr>

    <!-- Credenciales -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 0;">
            ${contentCardHtml('llave', 'Tus credenciales de acceso', `
                ${filasEtiquetaValor([
                    ['Usuario', emailProveedor],
                    ['Contraseña', 'Tu número de identificación o NIT']
                ])}
                <p style="margin:12px 0 0; font-size:12px; color:${COLOR_MUTED}; line-height:1.5;">Úsalas para consultar el estado de tus pagos y pedidos cuando habilitemos tu acceso al portal.</p>
            `)}
        </td>
    </tr>

    ${categorias.length ? `
    <!-- Categorías -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 0;">
            ${contentCardHtml('etiqueta', 'Categorías que nos vendes', chipsCategorias(categorias))}
        </td>
    </tr>` : ''}

    ${cuentasOrdenadas.length ? `
    <!-- Cuentas bancarias -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 0;">
            ${contentCardHtml('banco', cuentasOrdenadas.length > 1 ? 'Cuentas bancarias' : 'Cuenta bancaria', cuentasOrdenadas.map((c, i) => `
                ${i > 0 ? `<div style="height:1px;background:#F0E4EA;margin:16px 0;"></div>` : ''}
                ${cuentaHtml(c)}
            `).join(''))}
        </td>
    </tr>` : ''}

    ${documentos.length ? `
    <!-- Archivos cargados -->
    <tr>
        <td class="px-mobile" style="padding:20px 32px 0;">
            ${contentCardHtml('carpeta', 'Archivos cargados', `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    ${documentos.map((d, i) => filaDocumento(d, i, documentos.length)).join('')}
                </table>
            `)}
        </td>
    </tr>` : ''}

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
                                    <p style="margin:0; font-size:14px; font-weight:700; color:${COLOR_TEXT};">¿Tienes dudas sobre tu registro?</p>
                                    <p style="margin:0; font-size:12.5px; color:${COLOR_MUTED}; max-width:260px;">Nuestro equipo de compras está para ayudarte.</p>
                                </td>
                            </tr></table>
                        </td>
                        <td class="help-btns-cell" align="right" valign="middle">
                            ${WHATSAPP_URL ? `<a href="${WHATSAPP_URL}" style="display:block; margin-bottom:8px; border:1px solid ${COLOR_PRIMARY}; color:${COLOR_PRIMARY}; font-size:12.5px; font-weight:700; text-decoration:none; padding:9px 16px; border-radius:10px; white-space:nowrap; text-align:center;">${icono('mensaje', { size: 14 })} Escribir por WhatsApp</a>` : ''}
                            <a href="mailto:${SOPORTE_EMAIL}" style="display:block; border:1px solid ${COLOR_PRIMARY}; color:${COLOR_PRIMARY}; font-size:12.5px; font-weight:700; text-decoration:none; padding:9px 16px; border-radius:10px; white-space:nowrap; text-align:center;">${icono('sobre', { size: 14 })} ${SOPORTE_EMAIL}</a>
                        </td>
                    </tr></table>
                </td></tr>
            </table>
        </td>
    </tr>

    <!-- Footer -->
    <tr>
        <td class="px-mobile" style="padding:32px 32px 28px; text-align:center;">
            <img src="${imgLogo}" width="52" height="52" alt="Grupo GH" style="display:inline-block; border-radius:50%; margin-bottom:10px;">
            <p style="margin:0; font-size:13px; font-weight:700; color:${COLOR_PRIMARY};">Grupo GH · Proveedores</p>
            <p style="margin:0 0 12px; font-size:12px; color:${COLOR_MUTED};">Gracias por ser parte de nuestra red de aliados</p>
            <p style="margin:0 0 16px;">
                <a href="${REDES.instagram}" aria-label="Instagram" style="display:inline-block; width:34px; height:34px; line-height:34px; margin:0 5px; background:${COLOR_PRIMARY_SOFT}; border-radius:50%; text-align:center; vertical-align:middle;">${icono('instagram', { size: 16 })}</a>
                <a href="${REDES.facebook}" aria-label="Facebook" style="display:inline-block; width:34px; height:34px; line-height:34px; margin:0 5px; background:${COLOR_PRIMARY_SOFT}; border-radius:50%; text-align:center; vertical-align:middle;">${icono('facebook', { size: 16 })}</a>
                <a href="${REDES.tiktok}" aria-label="TikTok" style="display:inline-block; width:34px; height:34px; line-height:34px; margin:0 5px; background:${COLOR_PRIMARY_SOFT}; border-radius:50%; text-align:center; vertical-align:middle;">${icono('tiktok', { size: 16 })}</a>
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

const mailBienvenidaProveedor = async (datos) => {
    const documentos = await resolverMiniaturasDocumentos(datos.documentos ?? []);
    return enviarCorreoSes({
        remitente: REMITENTE_COMPRAS,
        destinatario: datos.emailProveedor,
        asunto: `¡Bienvenido a Grupo GH, ${datos.razonSocial}!`,
        texto: `Hola ${datos.razonSocial}, tu registro como proveedor de Grupo GH fue exitoso.\n\n`
            + `Usuario: ${datos.emailProveedor}\nContraseña: tu número de identificación o NIT\n\n`
            + `Revisaremos tus datos y tu cuenta bancaria antes de tu primer pago.`,
        html: construirHtmlBienvenidaProveedor({ ...datos, documentos }),
        contexto: 'bienvenida-proveedor'
    });
};

export { mailBienvenidaProveedor };
