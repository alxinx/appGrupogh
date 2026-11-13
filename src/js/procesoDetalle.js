// Detalle de un proceso de producción (admin/procesos/:idProceso) — avanzar de etapa y
// agregar novedades a la bitácora (controller/fichaConfeccionProcesoController.js).
(function () {
    const raiz = document.getElementById('proceso-detalle');
    if (!raiz) return;

    const CSRF = raiz.dataset.csrf;
    const idProceso = raiz.dataset.idProceso;

    // ── Avanzar etapa ────────────────────────────────────────────────────────────────────
    (function () {
        const btn = document.getElementById('btn-avanzar');
        if (!btn) return;
        const inputCantidad = document.getElementById('avanzar-cantidad');
        const inputNotas = document.getElementById('avanzar-notas');
        const errorEl = document.getElementById('error-avanzar');

        btn.addEventListener('click', async () => {
            errorEl?.classList.add('hidden');
            const siguienteEstado = btn.dataset.siguienteEstado;

            if (inputCantidad) {
                const cantidad = parseInt(inputCantidad.value, 10);
                if (!Number.isInteger(cantidad) || cantidad <= 0) {
                    if (errorEl) { errorEl.textContent = 'Escribe cuántas unidades, mayor a 0.'; errorEl.classList.remove('hidden'); }
                    return;
                }
            }

            const textoOriginal = btn.innerHTML;
            btn.disabled = true;
            btn.textContent = 'Guardando…';
            try {
                const r = await fetch(`/admin/procesos/${idProceso}/avanzar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                    body: JSON.stringify({
                        estado: siguienteEstado,
                        cantidad: inputCantidad ? inputCantidad.value : null,
                        notas: inputNotas?.value || ''
                    })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo avanzar el proceso.');
                // La página entera se repinta (estado, historial, siguiente etapa) — más
                // simple y confiable que reconstruir todo eso a mano en JS.
                window.location.reload();
            } catch (e) {
                if (errorEl) { errorEl.textContent = e.message; errorEl.classList.remove('hidden'); }
                btn.disabled = false;
                btn.innerHTML = textoOriginal;
            }
        });
    })();

    // ── Bitácora ─────────────────────────────────────────────────────────────────────────
    (function () {
        const btn = document.getElementById('btn-agregar-bitacora');
        const input = document.getElementById('nueva-bitacora');
        const lista = document.getElementById('lista-bitacora');
        const vacio = document.getElementById('bitacora-vacio');
        const errorEl = document.getElementById('error-bitacora');
        if (!btn || !input || !lista) return;

        const agregar = async () => {
            const nota = input.value.trim();
            errorEl?.classList.add('hidden');
            if (!nota) {
                if (errorEl) { errorEl.textContent = 'Escribe la novedad.'; errorEl.classList.remove('hidden'); }
                return;
            }

            btn.disabled = true;
            try {
                const r = await fetch(`/admin/procesos/${idProceso}/bitacora`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                    body: JSON.stringify({ nota })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo guardar la novedad.');

                vacio?.remove();
                const fila = document.createElement('div');
                fila.className = 'flex items-start gap-2.5 text-sm bg-slate-50 rounded-xl px-3 py-2.5';
                fila.innerHTML = `
                    <i class="fi fi-rr-comment-alt text-slate-400 text-xs flex-shrink-0 mt-0.5"></i>
                    <div class="flex-1 min-w-0">
                        <p class="text-slate-700"></p>
                        <p class="text-[11px] text-slate-400 mt-0.5"></p>
                    </div>`;
                fila.querySelector('p').textContent = d.bitacora.nota;
                fila.querySelectorAll('p')[1].textContent = `${d.bitacora.usuario} · ${new Date(d.bitacora.createdAt).toLocaleString('es-CO')}`;
                lista.prepend(fila);
                input.value = '';
            } catch (e) {
                if (errorEl) { errorEl.textContent = e.message; errorEl.classList.remove('hidden'); }
            } finally {
                btn.disabled = false;
            }
        };

        btn.addEventListener('click', agregar);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') agregar(); });
    })();
})();
