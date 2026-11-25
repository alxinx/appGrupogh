import { escaparHtml as esc } from './escaparHtml.js';
import { opcionesConfirmacion, cabeceraConfirmacion, activarVerificacionCodigo } from './modalConfirmacion.js';
import { campoCodigoEmpleado, codigoRequerido } from './codigoCajitas.js';

// Detalle de una orden de corte (views/administrador/produccion/ordenCorteDetalle.pug):
// registrar el corte (la tela sale de los rollos; pide código de empleado con Insumos EDIT) y
// cancelar un borrador (con motivo). El servidor vuelve a revisar todo
// (controller/ordenCorteController.js, helpers/ordenesCorte.js).
(function () {
    const acciones = document.getElementById('corte-acciones');
    if (!acciones) return;
    const { idCorte, numero, capas, metros, tela } = acciones.dataset;
    const motivoMax = Number(acciones.dataset.motivoMax) || 500;
    const base = `/admin/procesos/cortes/${encodeURIComponent(idCorte)}`;
    const mts = Number(metros).toLocaleString('es-CO', { maximumFractionDigits: 2 });

    const enviar = async (accion, cuerpo) => {
        let r;
        try {
            r = await fetch(`${base}/${accion}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
        } catch {
            // Sin red, fetch lanza TypeError con el texto del navegador, en inglés.
            throw new Error('No hubo conexión con el servidor. Revisa la red e inténtalo otra vez.');
        }
        const d = await r.json().catch(() => ({}));
        if (d.logout) { window.location.href = '/'; return null; }
        if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo completar la acción.');
        return d;
    };

    document.getElementById('btn-registrar-corte')?.addEventListener('click', async () => {
        const INPUT = 'corte-codigo-empleado';
        const ESTADO = 'corte-codigo-estado';
        const r = await Swal.fire(opcionesConfirmacion({
            variante: 'egreso',
            html: `
                <div class="gh-conf-html">
                    ${cabeceraConfirmacion({
                        icono: 'fi-rr-scissors',
                        badge: `Registrar el corte ${esc(numero)}`,
                        contexto: `Salen ${esc(mts)} m de ${esc(tela)} (${esc(capas)} capas) de los rollos del tendido y nace una orden de confección por referencia. No se puede deshacer.`
                    })}
                    <p class="gh-conf-campo-label">Código de empleado que autoriza</p>
                    ${campoCodigoEmpleado(INPUT, '1.75rem')}
                    <p class="gh-conf-estado" id="${ESTADO}"></p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Registrar corte',
            cancelButtonText: 'Volver',
            didOpen: () => {
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                activarVerificacionCodigo(INPUT, ESTADO, (emp) => { boton.disabled = !emp; }, {
                    urlValidar: (codigo) => `/admin/insumos/empleado/validar/${encodeURIComponent(codigo)}`
                });
            },
            preConfirm: async () => {
                const codigoEmpleado = codigoRequerido(INPUT, ESTADO);
                if (!codigoEmpleado) return false;
                try { return await enviar('registrar', { codigoEmpleado }); }
                catch (e) { Swal.showValidationMessage(esc(e.message)); return false; }
            }
        }));
        if (!r.isConfirmed || !r.value) return;
        await Swal.fire(opcionesConfirmacion({
            variante: 'ingreso',
            html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono: 'fi-rr-check', badge: 'Corte registrado', contexto: esc(r.value.mensaje) })}</div>`,
            confirmButtonText: 'Ver el corte'
        }));
        window.location.reload();
    });

    document.getElementById('btn-cancelar-corte')?.addEventListener('click', async () => {
        const r = await Swal.fire(opcionesConfirmacion({
            variante: 'egreso',
            html: `<div class="gh-conf-html">${cabeceraConfirmacion({
                icono: 'fi-rr-ban',
                badge: `Cancelar ${esc(numero)}`,
                contexto: 'El corte no se hizo: no se movió tela. Queda cancelado con su motivo en la bitácora.'
            })}</div><textarea id="motivo-cancelar-corte" rows="3" maxlength="${motivoMax}" placeholder="Motivo de la cancelación" aria-label="Motivo de la cancelación" class="field-text resize-none mt-3"></textarea><p id="motivo-cancelar-contador" class="text-[11px] text-slate-400 text-right tabular-nums mt-1">0 / ${motivoMax}</p>`,
            showCancelButton: true,
            confirmButtonText: 'Cancelar corte',
            cancelButtonText: 'Volver',
            showLoaderOnConfirm: true,
            didOpen: () => {
                const campo = document.getElementById('motivo-cancelar-corte');
                campo.addEventListener('input', () => {
                    document.getElementById('motivo-cancelar-contador').textContent = `${campo.value.length} / ${motivoMax}`;
                });
                campo.focus();
            },
            preConfirm: async () => {
                const motivo = document.getElementById('motivo-cancelar-corte').value.trim();
                if (motivo.length < 3) { Swal.showValidationMessage('Escribe el motivo de la cancelación (al menos 3 caracteres).'); return false; }
                if (motivo.length > motivoMax) { Swal.showValidationMessage(`El motivo no puede pasar de ${motivoMax} caracteres.`); return false; }
                try { return await enviar('cancelar', { motivo }); }
                catch (e) { Swal.showValidationMessage(esc(e.message)); return false; }
            }
        }));
        if (r.isConfirmed) window.location.reload();
    });
})();
