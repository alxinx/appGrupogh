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
// La tela sale del DXF de la ficha (`idDxf`) o, cuando todavía no hay ficha (el corte nuevo),
// del material del trazo (`idMaterial`).
export const iniciarGeneracionIa = (idMolde, { pattern, colors, idDxf = null, idMaterial = null }) => pedir(`${URL_MOLDE}/${idMolde}/generar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern, colors, idDxf, idMaterial })
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

/**
 * Abre el modal "Generar vista previa con IA" (views/components/modalMoldeIa.pug) y espera la
 * respuesta: `{ pattern, colors }` al generar, `null` al cerrar. `inicial` precarga los campos
 * (para "Repetir"). Lo usa el "Crear la ficha" del corte nuevo; el asistente y el editor tienen
 * todavía su propio cableado del mismo modal.
 */
export function pedirDatosIa(inicial = {}) {
    const modal = document.getElementById('modal-molde-ia');
    if (!modal) return Promise.resolve(null);
    const pattern = document.getElementById('molde-ia-pattern');
    const colors = document.getElementById('molde-ia-colors');
    pattern.value = inicial.pattern || '';
    colors.value = inicial.colors || '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    pattern.focus();
    return new Promise((resolve) => {
        const botones = ['modal-molde-ia-cerrar', 'btn-molde-ia-cancelar', 'btn-molde-ia-generar'].map((id) => document.getElementById(id));
        const terminar = (valor) => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            botones.forEach((b) => b?.removeEventListener('click', alClic));
            modal.removeEventListener('click', alFondo);
            modal.removeEventListener('keydown', alTecla);
            resolve(valor);
        };
        const alClic = (e) => terminar(e.currentTarget.id === 'btn-molde-ia-generar'
            ? { pattern: pattern.value.trim().slice(0, 255), colors: colors.value.trim().slice(0, 255) }
            : null);
        const alFondo = (e) => { if (e.target === modal) terminar(null); };
        const alTecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); terminar(null); } };
        botones.forEach((b) => b?.addEventListener('click', alClic));
        modal.addEventListener('click', alFondo);
        modal.addEventListener('keydown', alTecla);
    });
}
