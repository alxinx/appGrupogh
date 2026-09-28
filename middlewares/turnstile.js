import { ipDe } from './apiRateLimit.js';

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Turnstile: prueba de que quien envía un formulario público es una persona.
//
// El navegador resuelve el reto y recibe un token de un solo uso. Ese token viaja en el
// header `X-Turnstile-Token` —no en el body— para poder verificarlo ANTES de que multer
// lea los archivos: una petición de un bot se corta sin haber gastado memoria ni CPU en
// parsear lo que subió.
//
// La verificación falla CERRADA: sin secreto configurado, con Cloudflare caído o con una
// respuesta rara, la petición se rechaza. Un formulario abierto a internet no puede quedar
// sin protección porque un servicio externo tardó en contestar.
//
// Variables de entorno:
//   TURNSTILE_SECRET           secreto del widget (nunca sale del backend)
//   TURNSTILE_HOSTNAMES        hostnames del frontend permitidos, separados por coma
//                              (producción: www.grupogh.co,grupogh.co — nunca localhost)
//   TURNSTILE_PERMITIR_PRUEBA  'true' SOLO en local, para aceptar las claves de prueba de
//                              Cloudflare (1x000…AA). Esas claves siempre aprueban y
//                              devuelven hostname example.com sin action; en producción
//                              una respuesta de clave de prueba se rechaza siempre.
// ─────────────────────────────────────────────────────────────────────────────

const URL_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const hostnamesPermitidos = () => new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? '')
        .split(',')
        .map(h => h.trim().toLowerCase())
        .filter(Boolean)
);

/**
 * Verifica un token contra Cloudflare. Devuelve true solo si el reto se resolvió, para
 * la acción esperada y desde un hostname permitido. Nunca lanza.
 */
export const verificarTokenTurnstile = async ({ token, ip, accion }) => {
    const secreto = process.env.TURNSTILE_SECRET;
    if (!secreto) {
        console.error('[turnstile] TURNSTILE_SECRET no está configurado: se rechaza la petición.');
        return false;
    }
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;

    let resultado;
    try {
        const r = await fetch(URL_SITEVERIFY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal: AbortSignal.timeout(10_000),
            body: new URLSearchParams({ secret: secreto, response: token, remoteip: ip })
        });
        if (!r.ok) throw new Error(`siteverify ${r.status}`);
        resultado = await r.json();
    } catch (e) {
        console.error('[turnstile] no se pudo verificar el token:', e.message);
        return false;
    }

    if (!resultado?.success) {
        console.warn(`[turnstile] token rechazado · accion=${accion} · ip=${ip} · ${(resultado?.['error-codes'] || []).join(',')}`);
        return false;
    }

    if (resultado.metadata?.result_with_testing_key) {
        if (process.env.TURNSTILE_PERMITIR_PRUEBA === 'true') return true;
        console.error('[turnstile] llegó un token de CLAVE DE PRUEBA y TURNSTILE_PERMITIR_PRUEBA no está activo: se rechaza.');
        return false;
    }

    const hostnames = hostnamesPermitidos();
    if (resultado.action !== accion || !hostnames.has(String(resultado.hostname).toLowerCase())) {
        console.warn(`[turnstile] acción u hostname inesperados · esperado=${accion} · recibido=${resultado.action}@${resultado.hostname}`);
        return false;
    }
    return true;
};

/**
 * Middleware: exige un token válido de Turnstile para `accion` en el header
 * `X-Turnstile-Token`. Responde 403 con un mensaje genérico si no lo es.
 */
export const exigirTurnstile = (accion) => async (req, res, next) => {
    const valido = await verificarTokenTurnstile({
        token: req.get('X-Turnstile-Token'),
        ip:    ipDe(req),
        accion
    });
    if (valido) return next();
    return res.status(403).json({
        success: false,
        mensaje: 'No pudimos hacer la verificación de seguridad. Inténtalo de nuevo; lo que llevas escrito no se pierde.'
    });
};
