// Llamadas del molde (controller/fichaConfeccionMoldeController.js): subir una imagen (el
// molde o la foto de referencia) y la generación con IA. Las usan el asistente de ficha
// nueva y el editor de una ficha creada: una sola copia de las rutas, los cuerpos y los
// mensajes de error.
const URL_MOLDE = '/admin/procesos/fichas-confeccion/molde';

async function pedir(url, opciones, mensajeError) {
    const r = await fetch(url, opciones);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) throw new Error(d.mensaje || mensajeError);
    return d;
}

/** Sube el molde o la foto de referencia (JPG, WebP o PDF; el servidor valida el contenido real). Devuelve `{ idMolde, … }`. */
export function subirArchivoMolde(archivo, mensajeError = 'No se pudo subir el archivo.') {
    const datos = new FormData();
    datos.append('molde', archivo);
    return pedir(URL_MOLDE, { method: 'POST', body: datos }, mensajeError);
}

/** Abre un intento nuevo a partir del molde (JPG). Devuelve `{ idIntento, … }`. */
export const iniciarGeneracionIa = (idMolde, { pattern, colors, idDxf }) => pedir(`${URL_MOLDE}/${idMolde}/generar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern, colors, idDxf })
}, 'No se pudo iniciar la generación.');

/** Estado del intento (`procesando`, `listo`, `error`) con su vista previa. Null si la consulta falla. */
export async function consultarIntentoIa(idIntento) {
    try {
        const d = await pedir(`${URL_MOLDE}/intento/${idIntento}`, {}, '');
        return d.intento;
    } catch {
        return null;   // red caída un instante: quien consulta reintenta en la próxima vuelta
    }
}

/** Aprueba el intento: recién ahí la imagen queda guardada como definitiva. */
export const aprobarIntentoIa = (idIntento) => pedir(`${URL_MOLDE}/intento/${idIntento}/aprobar`, { method: 'POST' }, 'No se pudo aprobar la imagen.');
