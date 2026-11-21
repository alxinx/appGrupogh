import dotenv from 'dotenv';

dotenv.config();

// Cloudflare Stream (admin/procesos/fichas-confeccion, "Carga el video del proceso") —
// Direct Creator Uploads: el navegador sube el video DIRECTO a Cloudflare, nunca pasa por
// este servidor (helpers/cloudflareStream.js, controller/fichaConfeccionVideoController.js).
// Sin las dos variables, CLOUDFLARE_STREAM_CONFIGURADO queda en false. El modo simulado (una
// subida que no va a ningún lado) SOLO corre con VIDEO_SIMULADO=true, para probar en local:
// sin configuración y sin esa variable, la subida de videos no está disponible y se dice así.
// Antes producción no tenía el token y "subía" videos que nunca existieron (2026-11-20).
// Mismo criterio que IA_SIMULADA en config/openai.js.
//
// El Account ID de Cloudflare es uno solo por cuenta y ya está en uso para R2
// (R2_ACCOUNT_ID, config/r2.js) — Stream es otro producto de la MISMA cuenta, así que no se
// vuelve a pedir: CLOUDFLARE_ACCOUNT_ID queda como variable opcional solo por si alguna vez
// hay que separarlas (otra cuenta de Cloudflare para streaming), y R2_ACCOUNT_ID es el valor
// real hoy (DRY, CLAUDE.md).
export const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || null;
export const CLOUDFLARE_STREAM_API_TOKEN = process.env.CLOUDFLARE_STREAM_API_TOKEN || null;
export const CLOUDFLARE_STREAM_CONFIGURADO = !!(CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_STREAM_API_TOKEN);
export const VIDEO_SIMULADO = !CLOUDFLARE_STREAM_CONFIGURADO && process.env.VIDEO_SIMULADO === 'true';
export const VIDEO_DISPONIBLE = CLOUDFLARE_STREAM_CONFIGURADO || VIDEO_SIMULADO;
export const MENSAJE_VIDEO_NO_DISPONIBLE = 'La subida de videos no está disponible en este momento. Avísale al administrador del sistema.';

export const CLOUDFLARE_STREAM_BASE_URL = CLOUDFLARE_ACCOUNT_ID
    ? `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream`
    : null;

// Subdominio de reproducción (distinto del Account ID de arriba) — lo da Cloudflare al
// activar Stream, uno por cuenta. Con esto se arma la URL pública de ver un video
// (`.../{uid}/watch`), usada para el QR "link al video de referencia" de la ficha de
// confección (helpers/fichaConfeccionPdf.js). Sin esta variable no se puede armar ese QR —
// el PDF simplemente omite esa sección.
export const CLOUDFLARE_STREAMING_SUBDOMAIN = process.env.CLOUDFLARE_STREAMING_SUBDOMAIN || null;
