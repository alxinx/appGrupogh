const CSRF_TOKEN = document.getElementById('csrfImportaciones')?.value || '';

(() => {
    'use strict';

    const form = document.getElementById('formImportacion');
    const inputArchivo = document.getElementById('archivoExcel');
    const dropzoneTexto = document.getElementById('dropzoneTexto');
    const btnImportar = document.getElementById('btnImportar');
    if (!form || !inputArchivo || !btnImportar) return;

    const textoOriginal = dropzoneTexto.innerHTML;

    inputArchivo.addEventListener('change', () => {
        const archivo = inputArchivo.files?.[0];
        if (!archivo) {
            dropzoneTexto.innerHTML = textoOriginal;
            btnImportar.disabled = true;
            return;
        }
        dropzoneTexto.innerHTML = `
            <div class="w-12 h-12 bg-white shadow-sm rounded-full flex items-center justify-center mb-3 text-emerald-500">
                <i class="fi-rr-file-spreadsheet text-2xl"></i>
            </div>
            <span class="text-sm font-bold text-gray-700">${archivo.name}</span>
            <span class="text-xs text-gray-400 mt-1">${(archivo.size / 1024).toFixed(0)} KB — click o soltá otro archivo para cambiarlo</span>
        `;
        btnImportar.disabled = false;
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const archivo = inputArchivo.files?.[0];
        if (!archivo) return;

        const { isConfirmed } = await Swal.fire({
            title: '¿Importar este Excel?',
            text: 'Los productos que ya existan (por nombre o SKU) no se van a tocar. Al final se descarga un informe con lo que no se pudo crear.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, importar',
            cancelButtonText: 'Cancelar'
        });
        if (!isConfirmed) return;

        btnImportar.disabled = true;
        const textoBoton = btnImportar.innerHTML;
        btnImportar.innerHTML = '<i class="fi-rr-spinner animate-spin"></i> Procesando...';

        // Una sola función de envío: la segunda vuelta (con generarSku=true) manda el
        // mismo archivo y el mismo checklist, solo agrega la autorización.
        const enviar = (generarSku) => {
            const fd = new FormData();
            fd.append('_csrf', CSRF_TOKEN);
            fd.append('archivo', archivo);
            form.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
                fd.append(chk.name, chk.checked ? 'true' : 'false');
            });
            if (generarSku) fd.append('generarSku', 'true');
            return fetch('/admin/configuracion/importaciones', {
                method: 'POST',
                headers: { 'CSRF-Token': CSRF_TOKEN },
                body: fd
            });
        };

        try {
            let respuesta = await enviar(false);

            // Filas sin SKU: el servidor no creó nada y pide confirmación.
            if (respuesta.status === 409) {
                const data = await respuesta.json().catch(() => ({}));
                if (!data.requiereConfirmacionSku) throw new Error(data.mensaje || 'No se pudo procesar la importación.');

                const filas = (data.ejemploFilas || []).join(', ');
                const mas = data.filasSinSku > (data.ejemploFilas || []).length ? '…' : '';
                const { isConfirmed: generar } = await Swal.fire({
                    title: 'Hay productos sin SKU',
                    html: `<b>${data.filasSinSku}</b> fila(s) del Excel no tienen código (filas ${filas}${mas}).<br><br>¿Querés que el sistema genere el SKU de esos productos?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, generarlos',
                    cancelButtonText: 'No'
                });

                if (!generar) {
                    await Swal.fire({
                        title: 'Faltan los SKU',
                        html: 'No se importó ningún producto.<br>Llená la columna <b>CODIGO</b> en la plantilla para esas filas y volvé a subir el archivo.',
                        icon: 'warning',
                        confirmButtonText: 'Entendido'
                    });
                    return;
                }

                respuesta = await enviar(true);
            }

            const tipo = respuesta.headers.get('Content-Type') || '';
            if (!respuesta.ok || !tipo.includes('spreadsheetml')) {
                const data = await respuesta.json().catch(() => ({}));
                throw new Error(data.mensaje || 'No se pudo procesar la importación.');
            }

            const creados = respuesta.headers.get('X-Importacion-Creados') || '0';
            const malos = respuesta.headers.get('X-Importacion-Malos') || '0';
            const total = respuesta.headers.get('X-Importacion-Total') || '0';
            const generados = Number(respuesta.headers.get('X-Importacion-Generados') || '0');

            // Dispara la descarga del informe.
            const blob = await respuesta.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'informe-importacion.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            await Swal.fire({
                title: 'Importación terminada',
                html: `De <b>${total}</b> filas: <b class="text-emerald-600">${creados} creadas</b>, <b class="text-pink-600">${malos} no se crearon</b> (ver el informe descargado).${generados ? `<br><br>A <b>${generados}</b> se les generó el SKU: están en la hoja <b>CREADOS</b> del informe.` : ''}`,
                icon: Number(malos) > 0 ? 'warning' : 'success',
                confirmButtonText: 'Listo'
            });

            form.reset();
            dropzoneTexto.innerHTML = textoOriginal;
        } catch (error) {
            Swal.fire('Error', error.message || 'No se pudo procesar la importación.', 'error');
        } finally {
            btnImportar.disabled = !inputArchivo.files?.[0];
            btnImportar.innerHTML = textoBoton;
        }
    });
})();
