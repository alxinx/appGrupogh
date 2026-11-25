// Botón "Suspender" / "Reactivar" de la ficha de un proveedor (views/administrador/supplier/ver.pug).
// Pide el motivo, que es obligatorio y queda en la bitácora (PROVEDORES_ESTADOS), y lo manda a
// POST /admin/provedores/:id/estado. Las reglas viven en el servidor (helpers/proveedores.js).
(function () {
    const boton = document.getElementById('btn-estado-proveedor');
    if (!boton) return;

    const { id, nombre, accion } = boton.dataset;
    const max = Number(boton.dataset.motivoMax) || 500;
    const suspender = accion === 'suspender';

    boton.addEventListener('click', async () => {
        const { isConfirmed, value: motivo } = await Swal.fire({
            title: suspender ? `¿Suspender a ${nombre}?` : `¿Reactivar a ${nombre}?`,
            html: suspender
                ? 'Mientras esté suspendido no recibe órdenes de compra nuevas, no se le asignan trabajos, no se le abona y no sale en listas ni buscadores. Sus órdenes y facturas anteriores quedan como están.'
                : 'Vuelve a aparecer en listas y buscadores, y se le pueden hacer órdenes, pagos y asignar trabajos.',
            icon: suspender ? 'warning' : 'question',
            input: 'textarea',
            inputLabel: 'Motivo',
            inputPlaceholder: suspender ? 'Por qué se suspende' : 'Por qué se reactiva',
            inputAttributes: { maxlength: String(max) },
            showCancelButton: true,
            confirmButtonText: suspender ? 'Suspender' : 'Reactivar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: suspender ? '#ec4899' : '#E24C95',
            showLoaderOnConfirm: true,
            allowOutsideClick: () => !Swal.isLoading(),
            preConfirm: async (texto) => {
                const limpio = String(texto || '').trim();
                if (limpio.length < 3) { Swal.showValidationMessage('Escribe el motivo.'); return false; }
                try {
                    const r = await fetch(`/admin/provedores/${encodeURIComponent(id)}/estado`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ accion, motivo: limpio })
                    });
                    const data = await r.json().catch(() => ({}));
                    if (!r.ok || !data.success) { Swal.showValidationMessage(data.mensaje || 'No se pudo guardar.'); return false; }
                    return limpio;
                } catch {
                    Swal.showValidationMessage('No hay conexión. Intenta de nuevo.');
                    return false;
                }
            }
        });
        if (!isConfirmed || !motivo) return;
        await Swal.fire({ icon: 'success', title: suspender ? 'Proveedor suspendido' : 'Proveedor reactivado', timer: 1400, showConfirmButton: false });
        window.location.reload();
    });
})();
