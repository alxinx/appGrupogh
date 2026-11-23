// Subida de un video del proceso al servicio de videos, desde el navegador. La usan el
// asistente de ficha nueva (src/js/fichaConfeccionNueva.js) y el editor de una ficha creada
// (src/js/fichaConfeccionEditar.js): una sola copia del protocolo.
//
// El backend ya creó la sesión (solicitarSubidaVideo) y decidió el modo por el peso: 'simple'
// (un POST) o 'tus' (por partes, para archivos de más de ~190 MB). Los bytes van DIRECTO del
// navegador al servicio de videos; este servidor nunca los ve. Los mensajes de error no
// nombran el servicio: el detalle técnico va a la consola.

const TAMANO_PARTE_TUS = 50 * 1024 * 1024;

const motivoRechazo = (xhr) => {
    try {
        const cuerpo = JSON.parse(xhr.responseText);
        return cuerpo?.errors?.[0]?.message || cuerpo?.messages?.[0]?.message || '';
    } catch {
        return (xhr.responseText || '').slice(0, 200);
    }
};

const rechazo = (xhr, texto) => {
    console.error('[video] rechazo del servicio de videos:', xhr.status, motivoRechazo(xhr));
    return new Error(`${texto} (HTTP ${xhr.status}).`);
};

const subirSimple = (archivo, uploadURL, alProgreso) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadURL);
    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) alProgreso(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(rechazo(xhr, 'No se pudo subir el video'))));
    xhr.addEventListener('error', () => reject(new Error('Se perdió la conexión subiendo el video.')));
    const datos = new FormData();
    datos.append('file', archivo);
    xhr.send(datos);
});

// TUS 1.0.0: PATCH por partes respetando el offset que confirma cada respuesta.
const subirPorPartes = (archivo, uploadURL, alProgreso) => new Promise((resolve, reject) => {
    const total = archivo.size;
    const enviarParte = (offset) => {
        const parte = archivo.slice(offset, Math.min(offset + TAMANO_PARTE_TUS, total));
        const xhr = new XMLHttpRequest();
        xhr.open('PATCH', uploadURL);
        xhr.setRequestHeader('Tus-Resumable', '1.0.0');
        xhr.setRequestHeader('Upload-Offset', String(offset));
        xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) alProgreso(Math.round(((offset + e.loaded) / total) * 100));
        });
        xhr.addEventListener('load', () => {
            if (xhr.status < 200 || xhr.status >= 300) return reject(rechazo(xhr, 'No se pudo subir una parte del video'));
            const confirmado = Number(xhr.getResponseHeader('Upload-Offset'));
            const siguiente = Number.isFinite(confirmado) ? confirmado : offset + parte.size;
            if (siguiente >= total) { alProgreso(100); return resolve(); }
            enviarParte(siguiente);
        });
        xhr.addEventListener('error', () => reject(new Error('Se perdió la conexión subiendo el video.')));
        xhr.send(parte);
    };
    enviarParte(0);
});

/**
 * Sube el archivo a la sesión ya creada. `alProgreso(porcentaje)` se llama mientras sube.
 * @param {File} archivo
 * @param {{ uploadURL: string, modo: 'simple'|'tus', alProgreso?: (p: number) => void }} o
 */
export function subirVideo(archivo, { uploadURL, modo, alProgreso = () => {} }) {
    return modo === 'tus' ? subirPorPartes(archivo, uploadURL, alProgreso) : subirSimple(archivo, uploadURL, alProgreso);
}

/**
 * Espera a que el video termine de procesarse ('ready'). El procesamiento puede tardar más que
 * la subida, así que se consulta cada 3 s; una consulta caída (red) se reintenta, no es error.
 * Lanza si el video quedó en 'error'.
 */
export async function esperarVideoListo(urlBase, idVideo) {
    for (;;) {
        const r = await fetch(`${urlBase}/${idVideo}`).catch(() => null);
        if (r) {
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success) {
                if (d.video.estado === 'ready') return;
                if (d.video.estado === 'error') throw new Error(d.video.errorMensaje || 'No se pudo procesar el video.');
            }
        }
        await new Promise((listo) => setTimeout(listo, 3000));
    }
}

// ── El flujo completo de un video del proceso ───────────────────────────────────────────
// solicitar la sesión → subir → confirmar → esperar a que quede listo. Antes estaba escrito
// en el asistente de ficha nueva y en el editor; ahora lo usan esos dos y el "Crear la ficha"
// del corte nuevo (src/js/ordenCorteNueva.js). El video queda suelto (idFicha null) hasta que
// la ficha lo reclama: finalizar del asistente, asociar del editor o crear el corte.
const URL_VIDEO = '/admin/procesos/fichas-confeccion/video';

async function pedirJson(url, opciones, mensajeError) {
    const r = await fetch(url, opciones);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) throw new Error(d.mensaje || mensajeError);
    return d;
}

// Sin servicio de videos (VIDEO_SIMULADO, config/cloudflareStream.js) el backend no da URL de
// subida: se imita el progreso para poder probar el flujo completo.
const simularProgreso = (alProgreso) => new Promise((resolve) => {
    let pct = 0;
    const t = setInterval(() => {
        pct = Math.min(100, pct + 10 + Math.random() * 15);
        alProgreso(Math.round(pct));
        if (pct >= 100) { clearInterval(t); resolve(); }
    }, 180);
});

async function subirYConfirmar(archivo, idVideo, { uploadURL, modo }, alProgreso, alEstado) {
    alEstado('subiendo', idVideo);
    if (uploadURL) await subirVideo(archivo, { uploadURL, modo, alProgreso });
    else await simularProgreso(alProgreso);
    alEstado('procesando', idVideo);
    const d = await pedirJson(`${URL_VIDEO}/${idVideo}/confirmar`, { method: 'POST' }, 'No se pudo confirmar la subida.');
    if (d.estado === 'error') throw new Error(d.errorMensaje || 'No se pudo procesar el video.');
    if (d.estado !== 'ready') await esperarVideoListo(URL_VIDEO, idVideo);
}

// Un fallo del lado del navegador no lo reporta nadie: se avisa para que no quede en
// 'uploading' para siempre.
const marcarError = (idVideo, mensaje) => fetch(`${URL_VIDEO}/${idVideo}/marcar-error`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensaje })
}).catch(() => {});

/**
 * Sube un video del proceso de punta a punta y devuelve su idVideo ya listo. Si falla, lanza
 * un Error con `.idVideo` (cuando el servidor alcanzó a crearlo) para poder reintentar.
 * @param {File} archivo
 * @param {{ orden: number, duracionSegundos?: number|null, alProgreso?: (p:number)=>void, alEstado?: (estado:string, idVideo:string|null)=>void }} o
 */
export async function subirVideoProceso(archivo, { orden, duracionSegundos = null, alProgreso = () => {}, alEstado = () => {} }) {
    let idVideo = null;
    try {
        alEstado('pendiente', null);
        const d = await pedirJson(`${URL_VIDEO}/solicitar-subida`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden, nombreOriginal: archivo.name, pesoBytes: archivo.size, duracionSegundos })
        }, 'No se pudo iniciar la subida.');
        idVideo = d.idVideo;
        await subirYConfirmar(archivo, idVideo, d, alProgreso, alEstado);
        return idVideo;
    } catch (e) {
        if (idVideo) marcarError(idVideo, e.message);
        throw Object.assign(e, { idVideo });
    }
}

/** Reintenta la subida de un video que falló, con el mismo archivo. */
export async function reintentarVideoProceso(idVideo, archivo, { alProgreso = () => {}, alEstado = () => {} } = {}) {
    alEstado('pendiente', idVideo);
    const d = await pedirJson(`${URL_VIDEO}/${idVideo}/reintentar`, { method: 'POST' }, 'No se pudo reintentar.');
    await subirYConfirmar(archivo, idVideo, d, alProgreso, alEstado);
    return idVideo;
}
