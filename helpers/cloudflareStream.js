import crypto from 'crypto';
import {
    CLOUDFLARE_STREAM_CONFIGURADO, CLOUDFLARE_STREAM_BASE_URL, CLOUDFLARE_STREAM_API_TOKEN,
    VIDEO_SIMULADO, VIDEO_DISPONIBLE, MENSAJE_VIDEO_NO_DISPONIBLE,
    CLOUDFLARE_STREAMING_SUBDOMAIN
} from '../config/cloudflareStream.js';

// Cloudflare Stream — Direct Creator Uploads (admin/procesos/fichas-confeccion, "Carga el
// video del proceso").
//
//   1. crearSubidaDirecta() → POST simple de un solo request. Cloudflare le pone un tope
//      DURO de 200MB a este método (documentado, probado en sesión: un archivo más grande
//      vuelve un 4xx) — por eso existe crearSubidaTus de abajo, para lo que se pase de ahí.
//      El navegador sube el archivo DIRECTO a la URL que devuelve (src/js/
//      fichaConfeccionNueva.js) — este backend nunca ve los bytes del video, por eso no hay
//      multer ni validación de contenido acá como con el DXF o el molde.
//   2. crearSubidaTus({ uploadLength, nombreArchivo }) → protocolo TUS (resumable, por
//      partes) para un archivo de más de 200MB — un video de un celular grabando el proceso
//      completo lo pasa fácil. La creación de la sesión SÍ necesita el token (por eso es acá
//      y no en el navegador): un POST con los headers Tus-Resumable/Upload-Length/
//      Upload-Metadata a la base de Stream con `?direct_user=true`, y Cloudflare devuelve la
//      URL de subida en el header `Location` (no en el cuerpo). De ahí para adelante el
//      navegador le manda los PATCH de cada parte directo a esa URL — los bytes tampoco
//      pasan por acá.
//   3. obtenerEstadoVideoCloudflare(uid) → consulta si Cloudflare ya terminó de procesar
//      (transcodear) el video. Se llama desde el GET de estado (controller/
//      fichaConfeccionVideoController.js estadoVideo), nunca automático: no hay webhook
//      configurado todavía, así que un video se queda en 'uploading' hasta que algo
//      vuelva a preguntar — el requerimiento ya contempla eso ("la ficha puede guardarse
//      con status uploading en los videos").
//
// MODO SIMULADO — sin CLOUDFLARE_STREAM_API_TOKEN/CLOUDFLARE_ACCOUNT_ID
// (CLOUDFLARE_STREAM_CONFIGURADO=false) no se le pide nada a Cloudflare: no hay con qué
// darle al navegador una URL real para subir el archivo. `crearSubidaDirecta` devuelve
// `uploadURL: null`, y el front lo toma como señal para simular la barra de progreso en
// vez de hacer la subida real — así todo el flujo (slots, progreso, persistencia entre
// pasos, reintentar) se puede probar sin la clave y sin gastar nada, mismo espíritu que
// OPENAI_CONFIGURADO en config/openai.js, adaptado: acá lo que falta no es el trabajo de
// ESTE backend, es el destino al que el navegador tendría que subir.
const UID_SIMULADO_PREFIJO = 'simulado-';

// Duración máxima de un video de la ficha, en segundos. Se cambia en el entorno
// (VIDEO_FICHA_MAX_SEGUNDOS) sin tocar código; sin la variable, o con un valor inválido, 120.
// La aplican tres capas: el navegador antes de subir, solicitarSubidaVideo y Cloudflare
// (maxDurationSeconds, en la subida simple y en la TUS).
export const VIDEO_FICHA_MAX_SEGUNDOS = (() => {
    const n = parseInt(process.env.VIDEO_FICHA_MAX_SEGUNDOS, 10);
    return Number.isInteger(n) && n > 0 ? n : 120;
})();

export async function crearSubidaDirecta({ maxDurationSeconds = VIDEO_FICHA_MAX_SEGUNDOS } = {}) {
    if (!VIDEO_DISPONIBLE) throw new Error(MENSAJE_VIDEO_NO_DISPONIBLE);
    if (VIDEO_SIMULADO) {
        return { uid: `${UID_SIMULADO_PREFIJO}${crypto.randomUUID()}`, uploadURL: null };
    }

    const r = await fetch(`${CLOUDFLARE_STREAM_BASE_URL}/direct_upload`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${CLOUDFLARE_STREAM_API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ maxDurationSeconds })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.success) {
        throw new Error(data.errors?.[0]?.message || 'Cloudflare Stream no pudo crear la URL de subida.');
    }
    return { uid: data.result.uid, uploadURL: data.result.uploadURL };
}

export async function crearSubidaTus({ uploadLength, nombreArchivo }) {
    if (!VIDEO_DISPONIBLE) throw new Error(MENSAJE_VIDEO_NO_DISPONIBLE);
    if (VIDEO_SIMULADO) {
        return { uid: `${UID_SIMULADO_PREFIJO}${crypto.randomUUID()}`, uploadURL: null };
    }

    // Upload-Metadata: pares "clave valorBase64" separados por coma. `maxDurationSeconds` es
    // la clave documentada por Cloudflare para TUS de creador directo (verificado el
    // 2026-11-20 en developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads):
    // un video más largo que el tope no se procesa. Solo cuenta en este primer request.
    const b64 = (v) => Buffer.from(String(v)).toString('base64');
    const metadata = `name ${b64(nombreArchivo || 'video')},maxDurationSeconds ${b64(VIDEO_FICHA_MAX_SEGUNDOS)}`;

    const r = await fetch(`${CLOUDFLARE_STREAM_BASE_URL}?direct_user=true`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${CLOUDFLARE_STREAM_API_TOKEN}`,
            'Tus-Resumable': '1.0.0',
            'Upload-Length': String(uploadLength),
            'Upload-Metadata': metadata
        }
    });
    if (!r.ok) {
        const texto = await r.text().catch(() => '');
        throw new Error(texto || 'Cloudflare Stream no pudo crear la sesión de subida (TUS).');
    }
    const location = r.headers.get('Location');
    if (!location) throw new Error('Cloudflare Stream no devolvió una URL de subida (TUS).');

    // El último segmento de la RUTA (sin el ?tusv2=true que Cloudflare le agrega a la
    // query) es el uid real — con el que después se consulta el estado (`/stream/{uid}`,
    // obtenerEstadoVideoCloudflare más abajo). Usar el string crudo incluiría la query y
    // rompería esa URL.
    const uid = new URL(location).pathname.split('/').pop();

    return { uid, uploadURL: location };
}

/**
 * URL pública de reproducción de un video ya listo — la página "watch" que Cloudflare aloja
 * por defecto (`preview` en su propia API). Null sin CLOUDFLARE_STREAMING_SUBDOMAIN o para
 * un uid simulado (no existe en Cloudflare de verdad). La usa el QR de la ficha de
 * confección (helpers/fichaConfeccionPdf.js) — no hace falta autenticarse para verla.
 */
export function urlVerVideo(uid) {
    if (!CLOUDFLARE_STREAMING_SUBDOMAIN || !uid || uid.startsWith(UID_SIMULADO_PREFIJO)) return null;
    return `https://${CLOUDFLARE_STREAMING_SUBDOMAIN}/${uid}/watch`;
}

/**
 * `estado`: 'ready' (listo para reproducir), 'error' (Cloudflare no pudo procesarlo) o
 * 'uploading' (todavía recibiendo o transcodeando — mismo valor para las dos, el
 * requerimiento no pide distinguirlas).
 */
export async function obtenerEstadoVideoCloudflare(uid) {
    if (!CLOUDFLARE_STREAM_CONFIGURADO || uid.startsWith(UID_SIMULADO_PREFIJO)) {
        return { estado: 'ready', errorMensaje: null };
    }

    const r = await fetch(`${CLOUDFLARE_STREAM_BASE_URL}/${uid}`, {
        headers: { Authorization: `Bearer ${CLOUDFLARE_STREAM_API_TOKEN}` }
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.success) return { estado: 'uploading', errorMensaje: null };

    if (data.result?.status?.state === 'error') {
        return { estado: 'error', errorMensaje: data.result.status.errorReasonText || 'No se pudo procesar el video.' };
    }
    return { estado: data.result?.readyToStream ? 'ready' : 'uploading', errorMensaje: null };
}


/**
 * URL del reproductor embebible (iframe) de un video listo — para verlo dentro de un modal del
 * panel. Null en los mismos casos que urlVerVideo.
 */
export function urlIframeVideo(uid) {
    if (!CLOUDFLARE_STREAMING_SUBDOMAIN || !uid || uid.startsWith(UID_SIMULADO_PREFIJO)) return null;
    return `https://${CLOUDFLARE_STREAMING_SUBDOMAIN}/${uid}/iframe`;
}

/**
 * Borra el video en Cloudflare Stream. Un 404 cuenta como borrado (ya no estaba). Lanza si
 * Cloudflare no lo pudo borrar: quien llama no debe quitar la fila de la base en ese caso,
 * o el video quedaría en Cloudflare sin nada que lo referencie.
 */
export async function eliminarVideoCloudflare(uid) {
    if (!CLOUDFLARE_STREAM_CONFIGURADO || !uid || uid.startsWith(UID_SIMULADO_PREFIJO)) return;
    const r = await fetch(`${CLOUDFLARE_STREAM_BASE_URL}/${uid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${CLOUDFLARE_STREAM_API_TOKEN}` }
    });
    if (!r.ok && r.status !== 404) {
        const texto = await r.text().catch(() => '');
        throw new Error(`Cloudflare no pudo borrar el video (HTTP ${r.status}). ${texto.slice(0, 200)}`);
    }
}


/** Miniatura del video (un cuadro del segundo 2) para la lista del editor. Null si es simulado. */
export function urlMiniaturaVideo(uid) {
    if (!CLOUDFLARE_STREAMING_SUBDOMAIN || !uid || uid.startsWith(UID_SIMULADO_PREFIJO)) return null;
    return `https://${CLOUDFLARE_STREAMING_SUBDOMAIN}/${uid}/thumbnails/thumbnail.jpg?time=2s&height=160`;
}

/**
 * Duración en segundos de varios videos (Map uid → segundos). Una consulta por video, todas a
 * la vez y con tope de 3 s cada una: una ficha tiene a lo sumo 3 videos. Lo que no responde a
 * tiempo queda sin duración; la lista se pinta igual.
 */
export async function duracionesVideosCloudflare(uids) {
    const duraciones = new Map();
    if (!CLOUDFLARE_STREAM_CONFIGURADO) return duraciones;
    await Promise.all(uids.filter((uid) => uid && !uid.startsWith(UID_SIMULADO_PREFIJO)).map(async (uid) => {
        try {
            const r = await fetch(`${CLOUDFLARE_STREAM_BASE_URL}/${uid}`, {
                headers: { Authorization: `Bearer ${CLOUDFLARE_STREAM_API_TOKEN}` },
                signal: AbortSignal.timeout(3000)
            });
            const d = await r.json().catch(() => ({}));
            const segundos = Number(d?.result?.duration);
            if (r.ok && segundos > 0) duraciones.set(uid, segundos);
        } catch { /* sin duración: se muestra la fila sin ella */ }
    }));
    return duraciones;
}
