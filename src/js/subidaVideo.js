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
