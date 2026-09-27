// Zona de carga de un Excel: muestra el archivo elegido y habilita el botón de importar.
// Lo comparten las pantallas de importación (productos y clientes), que se ven igual y se
// comportan igual — solo cambia qué hace el servidor con el archivo.

/**
 * @param input   el <input type="file">
 * @param zona    el recuadro con el texto de "sube o arrastrá"
 * @param boton   el botón de importar, que arranca deshabilitado
 * @param alElegir  opcional, recibe el archivo elegido (o null si lo quitaron)
 */
export function montarDropzoneExcel({ input, zona, boton, alElegir }) {
    if (!input || !zona || !boton) return;

    // El texto inicial se guarda para poder volver a él si quitan el archivo.
    const textoOriginal = zona.innerHTML;

    input.addEventListener('change', () => {
        const archivo = input.files?.[0] || null;

        if (!archivo) {
            zona.innerHTML = textoOriginal;
            boton.disabled = true;
        } else {
            zona.innerHTML = `
                <div class="w-12 h-12 bg-white shadow-sm rounded-full flex items-center justify-center mb-3 text-emerald-500">
                    <i class="fi-rr-file-spreadsheet text-2xl"></i>
                </div>
                <span class="text-sm font-bold text-gray-700">${archivo.name}</span>
                <span class="text-xs text-gray-400 mt-1">${(archivo.size / 1024).toFixed(0)} KB — click o soltá otro archivo para cambiarlo</span>`;
            boton.disabled = false;
        }

        alElegir?.(archivo);
    });
}
