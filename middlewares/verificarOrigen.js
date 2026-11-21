// Protección CSRF sin token. Reemplaza a `csurf` (archivado y sin mantenimiento).
//
// Con csurf el navegador guardaba un secreto en la cookie `_csrf` —legible por cualquier
// script de la página— y cada vista llevaba el token en un input oculto, un <meta> o un
// data-atributo. Acá no hay nada que guardar en el navegador: el servidor decide si la
// petición nació en una página de esta misma aplicación, con dos señales que pone el
// NAVEGADOR y que ningún script (propio ni ajeno) puede escribir:
//
//   1. `Sec-Fetch-Site` (Fetch Metadata, todos los navegadores desde 2023). Si viene, manda:
//      solo se acepta `same-origin`. `same-site` NO alcanza: grupogh.co y
//      billware.grupogh.co son el mismo "sitio", y la cookie `sameSite: strict` de la sesión
//      no protege de un subdominio hermano. Esta cabecera sí lo distingue.
//   2. Sin esa cabecera (navegador viejo), `Origin` —o `Referer` como último recurso—
//      tiene que ser el origen del propio panel.
//
// Si no viene ninguna de las tres, se rechaza: falla cerrado. Es el criterio de OWASP
// ("Fetch Metadata" + "Verifying Origin With Standard Headers").
//
// Solo mira los métodos que escriben. Un GET no debe cambiar estado; si alguno lo hace,
// esta capa no lo cubre (tampoco lo cubría csurf).

import { PORTAL_URL } from '../config/marca.js';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

const origenDe = (url) => {
    try { return new URL(url).origin; } catch { return null; }
};

const ORIGEN_PORTAL = origenDe(PORTAL_URL);

/** Orígenes válidos: el del portal configurado y el que el propio request dice tener. */
const origenesPermitidos = (req) => {
    const propio = origenDe(`${req.protocol}://${req.get('host')}`);
    return new Set([ORIGEN_PORTAL, propio].filter(Boolean));
};

const rechazar = (req, res, motivo) => {
    console.warn(`[CSRF] ${req.method} ${req.originalUrl} rechazado · ${motivo} · ip=${req.ip}`);
    const esJson = req.headers.accept?.includes('application/json') ||
                   req.headers['content-type']?.includes('application/json') ||
                   req.xhr;
    const mensaje = 'La solicitud no viene de esta aplicación. Recarga la página e intenta de nuevo.';
    if (esJson) return res.status(403).json({ success: false, mensaje });
    return res.status(403).send(`<h2>${mensaje} <a href="javascript:location.reload()">Recargar</a></h2>`);
};

const verificarOrigen = (req, res, next) => {
    if (METODOS_SEGUROS.has(req.method)) return next();

    const sitio = req.get('sec-fetch-site');
    if (sitio) {
        return sitio === 'same-origin' ? next() : rechazar(req, res, `sec-fetch-site=${sitio}`);
    }

    const origen = req.get('origin') || origenDe(req.get('referer') || '');
    if (!origen) return rechazar(req, res, 'sin Origin ni Referer');
    if (!origenesPermitidos(req).has(origen)) return rechazar(req, res, `origin=${origen}`);
    return next();
};

/**
 * Borra la cookie `_csrf` que dejó csurf en los navegadores que ya entraron antes del
 * cambio. Ya nadie la lee; se quita para que no quede ningún secreto CSRF en el navegador.
 */
export const limpiarCookieCsrfVieja = (req, res, next) => {
    if (req.cookies?._csrf !== undefined) res.clearCookie('_csrf', { path: '/' });
    next();
};

export default verificarOrigen;
