import Chart from 'chart.js/auto';
import { activarFormularioInsumo } from './formularioInsumo.js';
import { activarMenuMas } from './menuMasAcciones.js';
import { opcionesConfirmacion, cabeceraConfirmacion, activarVerificacionCodigo } from './modalConfirmacion.js';
import { campoCodigoEmpleado, codigoRequerido } from './codigoCajitas.js';
import { escaparHtml as esc } from './escaparHtml.js';

// Perfil de un material (admin/insumos/:id). La dona de "Resumen de compras" es la única
// pieza con JS de verdad; el resto de la pantalla ya llega pintado del servidor (los datos
// son de relleno hoy, ver helpers/insumos.js — cuando dejen de serlo, esto sigue igual: lee
// lo que haya en el data-atributo).
(function () {
    const cont = document.getElementById('resumen-compras-donut');
    const ctx  = document.getElementById('grafico-resumen-compras');
    if (!cont || !ctx) return;

    let datos = [];
    try { datos = JSON.parse(cont.dataset.resumen || '[]'); } catch { datos = []; }
    if (!datos.length) return;

    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: datos.map(d => d.nombre),
            datasets: [{
                data: datos.map(d => d.total),
                backgroundColor: datos.map(d => d.color),
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => ` ${c.label}: $${c.parsed.toLocaleString('es-CO')} (${datos[c.dataIndex].pct}%)` } }
            }
        }
    });
})();

// Copiar el código DXF al portapapeles. Sin backend: es solo conveniencia de UI.
(function () {
    const btn = document.getElementById('btn-copiar-codigo');
    if (!btn) return;
    const textoOriginal = btn.innerHTML;

    btn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(btn.dataset.codigo || '');
            btn.innerHTML = '<i class="fi fi-rr-check text-[10px]"></i> Copiado';
            setTimeout(() => { btn.innerHTML = textoOriginal; }, 1500);
        } catch {
            // Sin permiso de portapapeles (contexto no seguro, navegador viejo): no hay
            // nada más que mostrar un toast; el dato sigue visible en pantalla para copiarlo a mano.
        }
    });
})();

// ── Editar insumo + Más acciones (Suspender/Reactivar) ─────────────────────────────
// Los dos solo existen en el HTML si la sesión tiene permiso de EDIT sobre Insumos (ver
// insumoPerfil.pug, `puede('Insumos', 'EDIT')`); acá alcanza con que el formulario exista.
(function () {
    const form = document.getElementById('form-editar-insumo');
    if (!form) return;
    const idMaterial = form.dataset.idMaterial;
    const CSRF = form.dataset.csrf;

    // ── Modal de edición: mismo abrir/cerrar que "Nuevo insumo" (src/js/insumos.js) ──
    const modal = document.getElementById('modal-editar-insumo');
    const abrir  = () => { modal.classList.remove('hidden'); modal.classList.add('flex'); };
    const cerrar = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };
    document.getElementById('btn-editar-insumo')?.addEventListener('click', abrir);
    document.getElementById('modal-editar-insumo-cerrar')?.addEventListener('click', cerrar);
    modal?.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

    const previewImagen = document.getElementById('preview-imagen');
    activarFormularioInsumo({
        formId: 'form-editar-insumo',
        urlGuardar: `/admin/insumos/${idMaterial}`,
        metodoGuardar: 'PUT',
        idExcluir: idMaterial,
        iconoConfirmacion: 'fi-rr-edit',
        badgeConfirmacion: 'Confirmar cambios',
        confirmarTexto: 'Guardar cambios',
        badgeExito: 'Material actualizado',
        // "El código de empleado debe ser imperativo": a diferencia del alta, acá no hay
        // forma de guardar sin un código de un empleado con permiso de EDIT.
        requiereCodigoEmpleado: true,
        urlValidarEmpleado: (codigo) => `/admin/insumos/empleado/validar/${encodeURIComponent(codigo)}`,
        // "Limpiar"/reset vuelve a la foto que ya tenía el material, no al ícono genérico.
        fotoOriginal: previewImagen?.src ? { url: previewImagen.src, nombreArchivo: 'Foto actual del material' } : null,
        alGuardar: () => window.location.reload()
    });

    // ── "Más acciones" → Suspender / Reactivar ────────────────────────────────────
    const btnMas  = document.getElementById('btn-mas-insumo');
    const menuMas = document.getElementById('menu-mas-insumo');
    if (btnMas && menuMas) activarMenuMas(btnMas, menuMas);

    const INPUT_CODIGO = 'insumo-estado-codigo';
    const ESTADO_CODIGO = 'insumo-estado-codigo-estado';

    const cambiarEstado = async (activo) => {
        const { isConfirmed } = await Swal.fire(opcionesConfirmacion({
            variante: activo ? 'ingreso' : 'egreso',
            html: `
                <div class="gh-conf-html">
                    ${cabeceraConfirmacion({
                        icono: activo ? 'fi-rr-check-circle' : 'fi-rr-ban',
                        badge: activo ? 'Reactivar insumo' : 'Suspender insumo',
                        contexto: esc(form.querySelector('#nombre')?.value || '')
                    })}
                    <div class="px-7 pt-1 pb-5">
                        <div class="gh-conf-aviso">
                            <i class="fi fi-rr-info"></i>
                            <span>${activo
                                ? 'Vuelve a quedar disponible en el catálogo y para nuevas compras.'
                                : 'No se elimina: queda fuera del catálogo activo y no se podrá comprar ni dosificar hasta que se reactive.'}</span>
                        </div>
                    </div>
                    <p class="gh-conf-campo-label">Código de empleado que autoriza</p>
                    ${campoCodigoEmpleado(INPUT_CODIGO, '1.75rem')}
                    <p class="gh-conf-estado" id="${ESTADO_CODIGO}"></p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: activo ? 'Reactivar' : 'Suspender',
            cancelButtonText: 'Cancelar',
            focusCancel: false,
            reverseButtons: true,
            didOpen: () => {
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                activarVerificacionCodigo(INPUT_CODIGO, ESTADO_CODIGO, (emp) => { boton.disabled = !emp; }, {
                    urlValidar: (codigo) => `/admin/insumos/empleado/validar/${encodeURIComponent(codigo)}`
                });
                document.getElementById(INPUT_CODIGO)?.focus();
            },
            preConfirm: async () => {
                const codigoEmpleado = codigoRequerido(INPUT_CODIGO, ESTADO_CODIGO);
                if (!codigoEmpleado) return false;
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                boton.textContent = activo ? 'Reactivando…' : 'Suspendiendo…';
                try {
                    const r = await fetch(`/admin/insumos/${idMaterial}/estado`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                        body: JSON.stringify({ activo, codigoEmpleado })
                    });
                    const d = await r.json().catch(() => ({}));
                    if (d.logout) { window.location.href = '/'; return false; }
                    if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo cambiar el estado.');
                    return d;
                } catch (e) {
                    boton.disabled = false;
                    boton.textContent = activo ? 'Reactivar' : 'Suspender';
                    Swal.showValidationMessage(e.message);
                    return false;
                }
            }
        }));
        if (!isConfirmed) return;
        window.location.reload();
    };

    document.getElementById('opcion-suspender-insumo')?.addEventListener('click', () => cambiarEstado(false));
    document.getElementById('opcion-reactivar-insumo')?.addEventListener('click', () => cambiarEstado(true));
})();
