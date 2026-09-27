import { montarDropzoneExcel } from './dropzoneExcel.js';

// Importación de clientes — pantalla.
//
// Sube el Excel, muestra el resumen de lo que pasó y descarga el informe. Mismo flujo que la
// importación de productos (importaciones.js): el servidor devuelve el .xlsx del informe, no
// un JSON, así que el éxito se reconoce por el Content-Type y los totales vienen en headers.

const CSRF_TOKEN = document.getElementById('csrfImportarClientes')?.value || '';

(() => {
    'use strict';

    const form  = document.getElementById('formImportarClientes');
    const input = document.getElementById('archivoClientes');
    const zona  = document.getElementById('dropzoneClientes');
    const boton = document.getElementById('btnImportarClientes');
    if (!form || !input || !boton) return;

    const textoZona = zona?.innerHTML;
    montarDropzoneExcel({ input, zona, boton });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const archivo = input.files?.[0];
        if (!archivo) return;

        const { isConfirmed } = await Swal.fire({
            title: '¿Importar este Excel?',
            html: 'Se crean los clientes de la hoja <b>Clientes</b> con su régimen y su ubicación.<br><br>Un documento que ya exista no se carga, y los NIT con observación en la hoja <b>Verificación NIT</b> quedan afuera. Al final se descarga un informe con el detalle.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, importar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#E24C95'
        });
        if (!isConfirmed) return;

        boton.disabled = true;
        const textoBoton = boton.innerHTML;
        boton.innerHTML = '<i class="fi-rr-spinner animate-spin"></i> Procesando...';

        try {
            const fd = new FormData();
            fd.append('_csrf', CSRF_TOKEN);
            fd.append('archivo', archivo);

            const respuesta = await fetch('/admin/configuracion/clientes', {
                method: 'POST',
                headers: { 'CSRF-Token': CSRF_TOKEN },
                body: fd
            });

            const tipo = respuesta.headers.get('Content-Type') || '';
            if (!respuesta.ok || !tipo.includes('spreadsheetml')) {
                const data = await respuesta.json().catch(() => ({}));
                throw new Error(data.mensaje || 'No se pudo procesar la importación.');
            }

            const total    = respuesta.headers.get('X-Importacion-Total') || '0';
            const creados  = respuesta.headers.get('X-Importacion-Creados') || '0';
            const malos    = respuesta.headers.get('X-Importacion-Malos') || '0';
            const ubicMal  = Number(respuesta.headers.get('X-Importacion-Ubicacion-Incompleta') || '0');
            const correos  = Number(respuesta.headers.get('X-Importacion-Correos-Descartados') || '0');

            const blob = await respuesta.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'informe-importacion-clientes.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            const notas = [];
            if (ubicMal) notas.push(`<b>${ubicMal}</b> quedaron con la ubicación incompleta porque su código de municipio o departamento no está en la base (columna AVISO del informe).`);
            if (correos) notas.push(`A <b>${correos}</b> se les dejó el correo en blanco: era un correo de la casa o compartido por varios clientes.`);

            await Swal.fire({
                title: 'Importación terminada',
                html: `De <b>${total}</b> filas: <b class="text-emerald-600">${creados} creados</b>, <b class="text-pink-600">${malos} no se importaron</b> (ver el informe descargado).${notas.length ? `<br><br>${notas.join('<br>')}` : ''}`,
                icon: Number(malos) > 0 ? 'warning' : 'success',
                confirmButtonText: 'Listo',
                confirmButtonColor: '#E24C95'
            });

            form.reset();
            if (zona && textoZona !== undefined) zona.innerHTML = textoZona;
            boton.disabled = true;
        } catch (error) {
            Swal.fire({ title: 'Error', text: error.message || 'No se pudo procesar la importación.', icon: 'error', confirmButtonColor: '#E24C95' });
        } finally {
            boton.innerHTML = textoBoton;
            if (input.files?.[0]) boton.disabled = false;
        }
    });
})();
