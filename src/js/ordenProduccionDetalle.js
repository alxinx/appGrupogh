import { escaparHtml as esc } from './escaparHtml.js';
import { opcionesConfirmacion, cabeceraConfirmacion, avisoConfirmacion } from './modalConfirmacion.js';

// Detalle de una orden de producción (views/administrador/produccion/ordenProduccionDetalle.pug):
// confirmar (borrador → en curso) y cancelar (con motivo). El servidor vuelve a verificar el
// estado y el permiso en cada uno (controller/ordenProduccionController.js).
(function () {
    const acciones = document.getElementById('orden-acciones');
    if (!acciones) return;
    const idOrden = acciones.dataset.idOrden;
    const numero = acciones.dataset.numero;
    const conFaltante = Number(acciones.dataset.conFaltante) || 0;
    const motivoMax = Number(acciones.dataset.motivoMax) || 500;
    const html = (cabecera) => `<div class="gh-conf-html">${cabecera}</div>`;

    const enviar = async (accion, cuerpo = {}) => {
        const r = await fetch(`/admin/procesos/ordenes/${encodeURIComponent(idOrden)}/${accion}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo)
        });
        const datos = await r.json().catch(() => ({}));
        if (!r.ok || !datos.success) throw new Error(datos.mensaje || 'No se pudo completar la acción.');
        return datos;
    };

    document.getElementById('btn-confirmar-orden')?.addEventListener('click', async () => {
        // Confirmar con faltante se puede (la orden solo avisa), pero que se vea antes.
        const aviso = conFaltante
            ? `Hay ${conFaltante} insumo(s) que no alcanzan con lo que hay en bodega. La orden no reserva material: habrá que comprarlo antes del corte.`
            : 'El material de insumos alcanza con lo que hay hoy en bodega.';
        const r = await Swal.fire(opcionesConfirmacion({
            variante: conFaltante ? 'egreso' : 'neutro',
            html: html(cabeceraConfirmacion({
                icono: 'fi-rr-check',
                badge: `Confirmar ${esc(numero)}`,
                contexto: `${esc(aviso)}<br>Después de confirmarla ya no se edita.`
            })),
            showCancelButton: true,
            confirmButtonText: 'Confirmar orden',
            cancelButtonText: 'Volver',
            showLoaderOnConfirm: true,
            preConfirm: async () => {
                try { return await enviar('confirmar'); }
                catch (e) { Swal.showValidationMessage(esc(e.message)); return false; }
            }
        }));
        if (r.isConfirmed) window.location.reload();
    });

    document.getElementById('btn-cancelar-orden')?.addEventListener('click', async () => {
        const r = await Swal.fire(opcionesConfirmacion({
            variante: 'egreso',
            html: html(cabeceraConfirmacion({
                icono: 'fi-rr-ban',
                badge: `Cancelar ${esc(numero)}`,
                contexto: 'La orden queda cancelada con su motivo en la bitácora. No se puede deshacer.'
            })) + `<textarea id="motivo-cancelar-orden" rows="3" maxlength="${motivoMax}" placeholder="Motivo de la cancelación" aria-label="Motivo de la cancelación" class="field-text resize-none mt-3"></textarea>`,
            showCancelButton: true,
            confirmButtonText: 'Cancelar orden',
            cancelButtonText: 'Volver',
            showLoaderOnConfirm: true,
            didOpen: () => document.getElementById('motivo-cancelar-orden')?.focus(),
            preConfirm: async () => {
                const motivo = document.getElementById('motivo-cancelar-orden').value.trim();
                if (motivo.length < 3) { Swal.showValidationMessage('Escribe el motivo de la cancelación.'); return false; }
                try { return await enviar('cancelar', { motivo }); }
                catch (e) { Swal.showValidationMessage(esc(e.message)); return false; }
            }
        }));
        if (r.isConfirmed) {
            await avisoConfirmacion({ variante: 'neutro', icono: 'fi-rr-ban', badge: 'Orden cancelada', contexto: `${numero} quedó cancelada.` });
            window.location.reload();
        }
    });
})();
