import { opcionesConfirmacion, cabeceraConfirmacion, activarVerificacionCodigo } from './modalConfirmacion.js';
import { campoCodigoEmpleado, codigoRequerido } from './codigoCajitas.js';
import { escaparHtml as esc } from './escaparHtml.js';

// Tarjeta "Rollos de tela" del perfil de un insumo (views/administrador/produccion/insumoPerfil.pug).
// Tender los rollos elegidos, adelantar un reposo o deshacer un tendido. Los tres piden
// código de empleado; adelantar y deshacer además un motivo. El servidor revisa todo otra
// vez (controller/rollosTelaController.js, helpers/rollosTela.js).
(function () {
    const tarjeta = document.getElementById('rollos-tela');
    if (!tarjeta) return;
    const idMaterial = tarjeta.dataset.idMaterial;

    // ── Buscar / escanear un rollo ───────────────────────────────────────────────────────
    // Filtra por código o color. Un lector de código de barras escribe el código y manda
    // Enter: si queda un solo rollo, se abre su etiqueta para reimprimirla (Enter es un gesto
    // de la persona, así que el navegador no bloquea la pestaña nueva).
    const buscador = document.getElementById('buscar-rollo');
    const vacio = document.getElementById('buscar-rollo-vacio');
    const filasRollo = () => [...tarjeta.querySelectorAll('tr[data-rollo]')];
    const visibles = () => filasRollo().filter(f => f.style.display !== 'none');
    buscador?.addEventListener('input', () => {
        const t = buscador.value.toLowerCase().trim();
        filasRollo().forEach(f => { f.style.display = f.dataset.buscar.includes(t) ? '' : 'none'; });
        vacio?.classList.toggle('hidden', visibles().length > 0);
    });
    buscador?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const t = buscador.value.trim().toUpperCase();
        const exacta = filasRollo().find(f => f.dataset.codigo.toUpperCase() === t);
        const una = exacta || (visibles().length === 1 ? visibles()[0] : null);
        const enlace = una?.querySelector('[data-etiqueta-rollo]');
        if (enlace) window.open(enlace.href, '_blank', 'noopener');
    });

    // ── Elegir rollos sin tender ─────────────────────────────────────────────────────────
    const btnTender = document.getElementById('btn-tender-rollos');
    const textoTender = btnTender?.querySelector('[data-texto-tender]');
    const todos = document.getElementById('rollos-todos');
    const casillas = () => [...tarjeta.querySelectorAll('[data-elegir-rollo]')];
    const elegidos = () => casillas().filter(c => c.checked);
    const pintarBoton = () => {
        if (!btnTender) return;
        const n = elegidos().length;
        btnTender.disabled = n === 0;
        textoTender.textContent = n ? `Tender ${n} rollo${n === 1 ? '' : 's'}` : 'Tender seleccionados';
        if (todos) {
            todos.checked = n > 0 && n === casillas().length;
            todos.indeterminate = n > 0 && n < casillas().length;
        }
    };
    tarjeta.addEventListener('change', (e) => { if (e.target.matches('[data-elegir-rollo]')) pintarBoton(); });
    todos?.addEventListener('change', () => { casillas().forEach(c => { c.checked = todos.checked; }); pintarBoton(); });

    // Una ventana con código de empleado (y motivo si se pide) que manda `cuerpo` a `url`.
    const confirmarConCodigo = async ({ icono, badge, contexto, pedirMotivo = false, placeholderMotivo = '', textoBoton, url, cuerpo = {} }) => {
        const INPUT = 'rollo-codigo-empleado';
        const ESTADO = 'rollo-codigo-estado';
        const r = await Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: `
                <div class="gh-conf-html">
                    ${cabeceraConfirmacion({ icono, badge, contexto })}
                    ${pedirMotivo ? `<div class="px-7 pt-1 pb-3 text-left">
                        <label class="flex flex-col gap-1 text-xs font-semibold text-slate-500">Motivo
                            <textarea id="rollo-motivo" rows="2" maxlength="300" class="field-text text-sm" placeholder="${esc(placeholderMotivo)}"></textarea></label>
                    </div>` : ''}
                    <p class="gh-conf-campo-label">Código de empleado que autoriza</p>
                    ${campoCodigoEmpleado(INPUT, '1.75rem')}
                    <p class="gh-conf-estado" id="${ESTADO}"></p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: textoBoton,
            cancelButtonText: 'Cancelar',
            didOpen: () => {
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                activarVerificacionCodigo(INPUT, ESTADO, (emp) => { boton.disabled = !emp; }, {
                    urlValidar: (codigo) => `/admin/insumos/empleado/validar/${encodeURIComponent(codigo)}`
                });
                (document.getElementById('rollo-motivo') || null)?.focus();
            },
            preConfirm: async () => {
                const motivo = pedirMotivo ? document.getElementById('rollo-motivo').value.trim() : undefined;
                if (pedirMotivo && motivo.length < 5) { Swal.showValidationMessage('Explica el motivo (mínimo 5 caracteres).'); return false; }
                const codigoEmpleado = codigoRequerido(INPUT, ESTADO);
                if (!codigoEmpleado) return false;
                try {
                    const resp = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...cuerpo, motivo, codigoEmpleado })
                    });
                    const d = await resp.json().catch(() => ({}));
                    if (d.logout) { window.location.href = '/'; return false; }
                    if (!resp.ok || !d.success) throw new Error(d.mensaje || 'No se pudo completar.');
                    return d;
                } catch (e) {
                    Swal.showValidationMessage(esc(e.message));
                    return false;
                }
            }
        }));
        if (r.isConfirmed) window.location.reload();
    };

    btnTender?.addEventListener('click', () => {
        const filas = elegidos();
        if (!filas.length) return;
        const codigos = filas.map(c => c.closest('[data-rollo]').dataset.codigo);
        confirmarConCodigo({
            icono: 'fi-rr-layers',
            badge: `Tender ${filas.length} rollo${filas.length === 1 ? '' : 's'}`,
            contexto: `${esc(codigos.join(', '))}. Desde ahora reposan antes de poder cortarse.`,
            textoBoton: 'Tender',
            url: `/admin/insumos/${encodeURIComponent(idMaterial)}/rollos/tender`,
            cuerpo: { idsRollo: filas.map(c => c.value) }
        });
    });

    // ── Adelantar reposo / deshacer tendido (por fila) ───────────────────────────────────
    tarjeta.addEventListener('click', (e) => {
        const fila = e.target.closest('[data-rollo]');
        if (!fila) return;
        const codigo = esc(fila.dataset.codigo);
        const base = `/admin/insumos/rollos/${encodeURIComponent(fila.dataset.rollo)}`;
        if (e.target.closest('[data-adelantar-rollo]')) {
            confirmarConCodigo({
                icono: 'fi-rr-time-fast',
                badge: `Adelantar reposo de ${codigo}`,
                contexto: 'El rollo queda listo para cortar ya, antes de cumplir su reposo. Queda registrado con el motivo.',
                pedirMotivo: true,
                placeholderMotivo: 'Ej. Corte urgente del pedido de la tienda; la tela ya estaba destendida',
                textoBoton: 'Adelantar',
                url: `${base}/adelantar-reposo`
            });
        }
        if (e.target.closest('[data-deshacer-rollo]')) {
            confirmarConCodigo({
                icono: 'fi-rr-undo',
                badge: `Deshacer tendido de ${codigo}`,
                contexto: 'El rollo vuelve a sin tender. Si se tiende otra vez, el reposo empieza de cero.',
                pedirMotivo: true,
                placeholderMotivo: 'Ej. Se tendió el rollo equivocado',
                textoBoton: 'Deshacer tendido',
                url: `${base}/deshacer-tendido`
            });
        }
    });
})();
