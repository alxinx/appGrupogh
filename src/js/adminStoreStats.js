(function () {
    'use strict';

    const pdvId = document.getElementById('pdv-current-id')?.value;
    if (!pdvId) return;

    const fmtCOP = window.fmtCOP;

    // ─── MAPA: stat id → metodoPago / clave ──────────────────────────────────
    const STATS = [
        { id: 'stat-ventas',     bar: null,            key: null },
        { id: 'stat-efectivo',   bar: 'bar-efectivo',  key: 'Efectivo' },
        { id: 'stat-banco',      bar: 'bar-banco',      key: 'Banco' },
        { id: 'stat-billetera',  bar: 'bar-billetera',  key: 'Billetera Virtual' },
        { id: 'stat-crediticia', bar: 'bar-crediticia', key: 'Entidad Crediticia' },
        { id: 'stat-tarjeta',    bar: 'bar-tarjeta',    key: 'Tarjeta Credito' },
    ];

    // ─── DÍA ELEGIDO ──────────────────────────────────────────────────────────
    // Las ocho tarjetas y el detalle que abren son del mismo día. Hoy se actualizan en vivo;
    // un día pasado queda fijo. La fecha viaja como YYYY-MM-DD en la hora local, que es la
    // que el servidor usa para cortar el día (_rangoDia en adminControllers.js).
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hoyISO = () => iso(new Date());
    const desplazar = (f, dias) => { const d = new Date(`${f}T00:00:00`); d.setDate(d.getDate() + dias); return iso(d); };

    let fechaSel = hoyISO();
    const esHoy = () => fechaSel === hoyISO();
    const qFecha = () => (esHoy() ? '' : `fecha=${fechaSel}`);

    const textoDia = () => {
        const d = new Date(`${fechaSel}T00:00:00`);
        const largo = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long',
            ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
        if (esHoy()) return `Hoy · ${largo}`;
        if (fechaSel === desplazar(hoyISO(), -1)) return `Ayer · ${largo}`;
        return largo;
    };

    // ─── ANIMACIÓN COUNT-UP ───────────────────────────────────────────────────
    // `destello`: el verde/rojo que marca que una cifra subió o bajó en vivo. Al cambiar de
    // día no va: ahí la cifra no subió ni bajó, es otro día.
    const countUp = (el, toValue, destello = true) => {
        const from = parseFloat(el.dataset.val || '0');
        const to   = parseFloat(toValue);
        // Sin cambio no hay animación, pero la cifra se pinta igual: si no, una tarjeta
        // que carga en $0 se quedaba con el "—" inicial, y la misma tarjeta mostraba "$0"
        // cuando llegaba a cero desde otra cifra.
        if (from === to) { el.textContent = fmtCOP(to); return; }
        el.dataset.val = to;

        const duration = 750;
        const start    = performance.now();

        const step = (ts) => {
            const progress = Math.min((ts - start) / duration, 1);
            const eased    = 1 - Math.pow(1 - progress, 3);
            el.textContent = fmtCOP(from + (to - from) * eased);
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = fmtCOP(to);
                if (!destello) return;
                el.style.color = to > from ? '#059669' : '#dc2626';
                setTimeout(() => { el.style.color = ''; }, 1400);
            }
        };
        requestAnimationFrame(step);
    };

    // ─── ACTUALIZAR BARRA DE PROPORCIÓN ──────────────────────────────────────
    const anchoBarra = (id, parte, total) => {
        const bar = document.getElementById(id);
        if (!bar) return;
        const pct = total > 0 ? Math.min((parte / total) * 100, 100) : 0;
        bar.style.transition = 'width 0.7s cubic-bezier(0.16, 1, 0.3, 1)';
        bar.style.width = `${pct.toFixed(1)}%`;
    };

    // Un día sin ventas deja las barras en cero (antes no se tocaban y conservaban las del
    // día anterior al cambiar de fecha).
    const actualizarBarras = (ventasTotal, pagos) => {
        STATS.filter(s => s.bar).forEach(s => anchoBarra(s.bar, pagos[s.key] || 0, ventasTotal));
    };

    // ─── APLICAR DATOS A LA UI ────────────────────────────────────────────────
    const aplicarStats = (ventasHoy, pagos, destello = true) => {
        const ventasEl = document.getElementById('stat-ventas');
        if (ventasEl) countUp(ventasEl, ventasHoy, destello);

        STATS.filter(s => s.key).forEach(s => {
            const el = document.getElementById(s.id);
            if (el) countUp(el, pagos[s.key] || 0, destello);
        });

        actualizarBarras(ventasHoy, pagos);
    };

    // Egresos y traslados: el total, y la barra partida en la proporción de cada uno.
    const aplicarEgresos = (eg, destello) => {
        const total = document.getElementById('stat-egresos-dia');
        if (total) countUp(total, eg.total, destello);
        const gasto = document.getElementById('stat-egresos-gasto');
        const tras  = document.getElementById('stat-egresos-traslado');
        if (gasto) gasto.textContent = fmtCOP(eg.egresos);
        if (tras)  tras.textContent  = fmtCOP(eg.traslados);
        anchoBarra('bar-egresos-gasto',    eg.egresos,   eg.total);
        anchoBarra('bar-egresos-traslado', eg.traslados, eg.total);
    };

    // De dónde sale la cifra del efectivo, en palabras: no es lo mismo lo que hay ahora
    // en el cajón que lo que quedó al cerrar un turno de otro día.
    const ESTADO_EFECTIVO = {
        abierta:    { texto: 'En el cajón ahora',   clase: 'text-emerald-700', punto: 'bg-emerald-500 animate-pulse' },
        cerrada:    { texto: 'Al cierre del turno', clase: 'text-slate-500',   punto: 'bg-slate-400' },
        'sin-caja': { texto: 'Sin caja ese día',    clase: 'text-slate-400',   punto: 'bg-slate-300' }
    };

    const aplicarEfectivo = (ef, destello) => {
        const valor = document.getElementById('stat-efectivo-disp');
        if (valor) countUp(valor, ef.disponible, destello);
        anchoBarra('bar-efectivo-disp', ef.disponible, ef.recaudado);

        const estado = document.getElementById('efectivo-estado');
        const e = ESTADO_EFECTIVO[ef.estado] || ESTADO_EFECTIVO['sin-caja'];
        if (estado) {
            estado.className = `inline-flex items-center gap-1.5 text-[10px] font-bold ${e.clase}`;
            estado.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${e.punto}"></span>${e.texto}`;
        }
        const detalle = document.getElementById('efectivo-detalle');
        if (detalle) {
            detalle.textContent = ef.estado === 'sin-caja' ? '' : `${fmtCOP(ef.recaudado)} − ${fmtCOP(ef.salidas)}`;
            detalle.title = ef.estado === 'sin-caja' ? '' : 'Recaudado en efectivo menos lo que salió en efectivo, sin la base';
        }
    };

    // ─── CARGA ────────────────────────────────────────────────────────────────
    // Un contador descarta respuestas viejas: si se cambia de día dos veces seguidas, la
    // respuesta del día anterior puede llegar después y pintaría el día equivocado.
    let pedido = 0;
    const cargarStats = async ({ destello = true } = {}) => {
        const miPedido = ++pedido;
        try {
            const q   = qFecha();
            const res = await fetch(`/admin/api/tiendas/${pdvId}/stats-hoy-detalle${q ? `?${q}` : ''}`);
            const json = await res.json();
            if (miPedido !== pedido || !json.success) return;
            aplicarStats(json.ventasHoy, json.pagos, destello);
            aplicarEgresos(json.egresosDia, destello);
            aplicarEfectivo(json.efectivo, destello);
        } catch (_) {}
    };

    // ─── SELECTOR DEL DÍA ─────────────────────────────────────────────────────
    const inputFecha = document.getElementById('stats-fecha');
    const btnAnt     = document.getElementById('stats-dia-anterior');
    const btnSig     = document.getElementById('stats-dia-siguiente');
    const btnHoy     = document.getElementById('stats-hoy');

    const pintarSelector = () => {
        const hoy = hoyISO();
        if (inputFecha) { inputFecha.max = hoy; inputFecha.value = fechaSel; }
        if (btnSig) btnSig.disabled = fechaSel >= hoy;
        if (btnHoy) btnHoy.disabled = fechaSel === hoy;
        const texto = document.getElementById('stats-dia-texto');
        if (texto) texto.textContent = textoDia();
        document.getElementById('stats-en-vivo')?.classList.toggle('hidden', !esHoy());
        const sub = document.getElementById('stat-ventas-sub');
        if (sub) sub.textContent = esHoy() ? 'Total facturado hoy' : 'Total facturado ese día';
    };

    const elegirDia = (f) => {
        const hoy = hoyISO();
        // Nada de días futuros, ni una fecha borrada a mano en el input.
        fechaSel = !f || f > hoy ? hoy : f;
        pintarSelector();
        cargarStats({ destello: false });
    };

    inputFecha?.addEventListener('change', () => elegirDia(inputFecha.value));
    btnAnt?.addEventListener('click', () => elegirDia(desplazar(fechaSel, -1)));
    btnSig?.addEventListener('click', () => elegirDia(desplazar(fechaSel, 1)));
    btnHoy?.addEventListener('click', () => elegirDia(hoyISO()));

    // ─── SSE — JAMÁS POLLING (conexión compartida, ver helpers.js) ───────────
    // Solo con hoy elegido: un día pasado no cambia. Una venta llega como
    // `store_stats_detail` y un egreso o traslado como `store_stats`; los dos piden de
    // nuevo el resumen, que es donde están egresos y efectivo. El debounce junta los
    // eventos de una misma operación (una venta dispara los dos).
    let recarga = null;
    const alCambiarHoy = (e) => {
        if (!esHoy()) return;
        const data = JSON.parse(e.data);
        if (data.idPuntoDeVenta !== pdvId) return;
        clearTimeout(recarga);
        recarga = setTimeout(() => cargarStats(), 250);
    };
    const conectarSSE = () => {
        window.adminSSE.on('store_stats_detail', alCambiarHoy);
        window.adminSSE.on('store_stats', alCambiarHoy);
        window.adminSSE.connect();
    };

    // ─── MODAL PAGOS POR MÉTODO ───────────────────────────────────────────────
    const CLICKABLES = [
        { id: 'stat-efectivo',   metodo: 'Efectivo',           label: 'En Efectivo' },
        { id: 'stat-banco',      metodo: 'Banco',              label: 'Transferencias / Banco' },
        { id: 'stat-billetera',  metodo: 'Billetera Virtual',  label: 'Nequi / Daviplata' },
        { id: 'stat-crediticia', metodo: 'Entidad Crediticia', label: 'Entidad Crediticia' },
    ];

    const modal       = document.getElementById('modalPagosMetodo');
    const modalTitulo = document.getElementById('modalPagosTitulo');
    const modalBody   = document.getElementById('modalPagosBody');
    const modalTotal  = document.getElementById('modalPagosTotal');

    const fmtHora = (h) => h && h !== '—' ? h.slice(0, 5) : '—';

    const abrirModalPagos = async (metodo, label) => {
        if (!modal) return;
        modalTitulo.textContent = esHoy() ? label : `${label} · ${textoDia()}`;
        modalBody.innerHTML = '<p class="text-sm text-slate-400 text-center py-6">Cargando...</p>';
        modalTotal.textContent = '—';
        modal.classList.remove('hidden');

        try {
            const q    = qFecha();
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/pagos-hoy/${encodeURIComponent(metodo)}${q ? `?${q}` : ''}`);
            const json = await res.json();
            if (!json.success) throw new Error();

            if (!json.movimientos.length) {
                modalBody.innerHTML = `<p class="text-sm text-slate-400 text-center py-6">Sin movimientos ${esHoy() ? 'hoy' : 'ese día'}</p>`;
                modalTotal.textContent = fmtCOP(0);
                return;
            }

            const filas = json.movimientos.map(m => `
                <tr class="border-b border-slate-100 last:border-0">
                    <td class="py-2 pr-3 text-xs font-semibold text-slate-700">${m.nroFactura}</td>
                    <td class="py-2 pr-3 text-xs text-slate-500">${fmtHora(m.hora)}</td>
                    <td class="py-2 pr-3 text-xs text-slate-500 text-right font-mono">${fmtCOP(m.valor)}</td>
                    <td class="py-2 text-xs text-slate-400">${m.referencia}</td>
                </tr>
            `).join('');

            modalBody.innerHTML = `
                <table class="w-full">
                    <thead>
                        <tr class="text-[10px] font-bold uppercase text-slate-400 border-b border-slate-200">
                            <th class="pb-2 pr-3 text-left">Factura</th>
                            <th class="pb-2 pr-3 text-left">Hora</th>
                            <th class="pb-2 pr-3 text-right">Valor</th>
                            <th class="pb-2 text-left">Referencia</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            `;
            modalTotal.textContent = fmtCOP(json.total);
        } catch (_) {
            modalBody.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Error al cargar</p>';
        }
    };

    // Detalle de la tarjeta "Egresos y Traslados", en el mismo modal que los pagos.
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const abrirModalEgresos = async () => {
        if (!modal) return;
        modalTitulo.textContent = `Egresos y traslados · ${textoDia()}`;
        modalBody.innerHTML = '<p class="text-sm text-slate-400 text-center py-6">Cargando...</p>';
        modalTotal.textContent = '—';
        modal.classList.remove('hidden');

        try {
            const q    = qFecha();
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/egresos-dia${q ? `?${q}` : ''}`);
            const json = await res.json();
            if (!json.success) throw new Error();

            if (!json.movimientos.length) {
                modalBody.innerHTML = `<p class="text-sm text-slate-400 text-center py-6">Sin egresos ni traslados ${esHoy() ? 'hoy' : 'ese día'}</p>`;
                modalTotal.textContent = fmtCOP(0);
                return;
            }

            const filas = json.movimientos.map(m => {
                const traslado = m.tipo === 'Traslado';
                return `
                <tr class="border-b border-slate-100 last:border-0 align-top">
                    <td class="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">${esc(m.hora)}</td>
                    <td class="py-2 pr-3">
                        <p class="text-xs font-semibold text-slate-700">${esc(m.descripcion)}</p>
                        <p class="text-[11px] text-slate-400">
                            <span class="font-bold ${traslado ? 'text-amber-800' : 'text-rose-700'}">${traslado ? 'Traslado' : 'Egreso'}</span>
                            · ${esc(m.detalle)} · ${esc(m.responsable)}
                        </p>
                    </td>
                    <td class="py-2 text-xs text-right font-mono whitespace-nowrap ${traslado ? 'text-amber-800' : 'text-rose-700'}">${fmtCOP(m.valor)}</td>
                </tr>`;
            }).join('');

            modalBody.innerHTML = `
                <table class="w-full">
                    <thead>
                        <tr class="text-[10px] font-bold uppercase text-slate-400 border-b border-slate-200">
                            <th class="pb-2 pr-3 text-left">Hora</th>
                            <th class="pb-2 pr-3 text-left">Detalle</th>
                            <th class="pb-2 text-right">Valor</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>`;
            modalTotal.textContent = fmtCOP(json.total);
        } catch (_) {
            modalBody.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Error al cargar</p>';
        }
    };

    const cerrarModalPagos = () => modal?.classList.add('hidden');

    // ─── INIT ─────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        pintarSelector();
        cargarStats({ destello: false });
        conectarSSE();

        const cardEgresos = document.getElementById('card-egresos-dia');
        cardEgresos?.addEventListener('click', abrirModalEgresos);
        cardEgresos?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirModalEgresos(); }
        });

        // Hacer clickables las tarjetas de métodos de pago
        CLICKABLES.forEach(({ id, metodo, label }) => {
            const h3 = document.getElementById(id);
            if (!h3) return;
            const card = h3.closest('.tarjetaBase');
            if (!card) return;
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => abrirModalPagos(metodo, label));
        });

        // Cerrar modal
        document.querySelectorAll('.cerrar-modal-pagos').forEach(btn => {
            btn.addEventListener('click', cerrarModalPagos);
        });
        modal?.addEventListener('click', (e) => { if (e.target === modal) cerrarModalPagos(); });
    });

})();
