import dotenv from 'dotenv';
dotenv.config();

// Fuente única de la marca para todo lo que sale del backend hacia afuera: correos,
// links al sitio público, contactos de soporte y redes.
//
// Antes cada archivo se armaba lo suyo con `process.env.X || 'default'`, y los defaults
// no coincidían entre sí (helpers/mailPedidoCancelado.js caía en `info@grupogh.com` con
// .com, el resto en .co). Peor: solo helpers/emailSes.js le quitaba la barra final a
// WEB_STORE_URL. Como en .env el valor termina en `/`, los otros tres consumidores
// generaban URLs con doble barra — `https://grupogh.co//producto/slug` en el correo de
// cancelación y `https://grupogh.co//checkout/resultado` en el redirect posterior al
// pago. Normalizando acá una sola vez, el bug no puede volver por otro archivo.

const sinBarraFinal = (url) => String(url || '').replace(/\/+$/, '');

// ─── URLs ───────────────────────────────────────────────────────────────────

/** Sitio público / catálogo (dominio grupogh.co). */
export const WEB_STORE_URL = sinBarraFinal(process.env.WEB_STORE_URL || 'https://www.grupogh.co');

/** Logo servido desde el sitio público: es la única URL de imagen que un cliente de
 *  correo puede resolver siempre (este backend no es alcanzable desde afuera). */
export const LOGO_URL = `${WEB_STORE_URL}/logo.png`;
export const LOGO_WEBP_URL = `${WEB_STORE_URL}/logo.webp`;
export const BOX_URL = `${WEB_STORE_URL}/box.webp`;

/**
 * Panel/API de este backend, como URL absoluta y alcanzable desde afuera.
 *
 * Es el origen del botón "Acceder a mi portal" del correo de bienvenida, del link de baja
 * de INTERESADOS, del QR de verificación del cierre de caja, del QR del comprobante de
 * dosificación y del link a la tirilla dentro del .xlsx de facturas. Todos salen del
 * proceso: se abren en el teléfono de un empleado o en el equipo de otra persona, así que
 * tienen que apuntar a la URL pública real.
 *
 * El puerto NO se anexa cuando APP_URL ya es https: en producción el backend está detrás
 * de Nginx en 443 y APP_URL es la URL pública completa, de modo que pegarle APP_PORT daba
 * `https://billware.grupogh.co:9090` — un host que no resuelve desde afuera. En local, en
 * cambio, no hay proxy delante y `http://localhost` sin puerto no llega a ningún lado.
 *
 * `PORTAL_URL` en el entorno permite fijarla a mano y saltarse toda la deducción.
 */
export const PORTAL_URL = (() => {
    if (process.env.PORTAL_URL) return sinBarraFinal(process.env.PORTAL_URL);

    const base = sinBarraFinal(process.env.APP_URL || 'http://localhost');
    const puerto = process.env.APP_PORT;

    if (!puerto) return base;                    // sin puerto configurado, nada que anexar
    if (/^https:\/\//i.test(base)) return base;   // detrás de un proxy TLS: la URL ya es pública
    if (/:\d+$/.test(base)) return base;         // APP_URL ya trae su propio puerto
    return `${base}:${puerto}`;
})();

// ─── Identidad y contacto ───────────────────────────────────────────────────

export const NOMBRE_EMPRESA = process.env.APP_NAME || 'Grupo GH';
export const DIRECCION_EMPRESA = process.env.APP_COMPANY_ADDRESS || 'Medellín, Colombia';
export const SOPORTE_EMAIL = process.env.SOPORTE_EMAIL || 'info@grupogh.co';
export const SOPORTE_WHATSAPP = process.env.SOPORTE_WHATSAPP || '';
export const WHATSAPP_URL = SOPORTE_WHATSAPP
    ? `https://api.whatsapp.com/send?phone=${SOPORTE_WHATSAPP}`
    : null;

export const REDES = {
    instagram: process.env.LINK_INSTAGRAM || '#',
    facebook: process.env.LINK_FACEBOOK || '#',
    tiktok: process.env.LINK_TIKTOK || '#'
};

// ─── Paleta de correo ───────────────────────────────────────────────────────
//
// El rosa y su versión suave salen de los tokens del sistema de diseño (CLAUDE.md §4.1:
// --color-gh-primaryHover y --color-gh-primarySoft), para que un correo no tenga un rosa
// distinto al del panel. Antes había tres rosas de marca conviviendo: #EC1876 en la
// cancelación, #D44289 en la bienvenida y #E24C95 en la confirmación de pedido.
//
// Los grises los define cada plantilla: la de tienda y la interna son diseños distintos
// a propósito (CLAUDE.md §4.2) y colapsar sus escalas neutras sería rediseñarlas, no
// deduplicarlas. Lo que se unifica acá es el color de marca y los de estado.
export const COLORES_CORREO = {
    primary: '#E24C95',
    primarySoft: '#FDE7F2',
    lila: '#bc8be0',

    fondo: '#FDF3F8',
    fondoNeutro: '#f9fafb',
    tarjeta: '#ffffff',

    texto: '#1f2430',
    textoSuave: '#6b7280',
    borde: '#F0E4EA',
    bordeSuave: '#FBDCEA',

    ok: '#12a370',
    alerta: '#dc2626',
    alertaSuave: '#fef2f2',
    alertaTexto: '#991b1b'
};
