import dotenv from 'dotenv';

dotenv.config();

// Cloudflare Stream (admin/procesos/fichas-confeccion, "Carga el video del proceso") —
// Direct Creator Uploads: el navegador sube el video DIRECTO a Cloudflare, nunca pasa por
// este servidor (helpers/cloudflareStream.js, controller/fichaConfeccionVideoController.js).
// Sin las dos variables, CLOUDFLARE_STREAM_CONFIGURADO queda en false y la subida corre en
// modo simulado — mismo criterio que OPENAI_CONFIGURADO en config/openai.js.
//
// El Account ID de Cloudflare es uno solo por cuenta y ya está en uso para R2
// (R2_ACCOUNT_ID, config/r2.js) — Stream es otro producto de la MISMA cuenta, así que no se
// vuelve a pedir: CLOUDFLARE_ACCOUNT_ID queda como variable opcional solo por si alguna vez
// hay que separarlas (otra cuenta de Cloudflare para streaming), y R2_ACCOUNT_ID es el valor
// real hoy (DRY, CLAUDE.md).
export const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || null;
export const CLOUDFLARE_STREAM_API_TOKEN = process.env.CLOUDFLARE_STREAM_API_TOKEN || null;
export const CLOUDFLARE_STREAM_CONFIGURADO = !!(CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_STREAM_API_TOKEN);

export const CLOUDFLARE_STREAM_BASE_URL = CLOUDFLARE_ACCOUNT_ID
    ? `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream`
    : null;
