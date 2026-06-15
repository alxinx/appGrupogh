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

    // ─── ANIMACIÓN COUNT-UP ───────────────────────────────────────────────────
    const countUp = (el, toValue) => {
        const from = parseFloat(el.dataset.val || '0');
        const to   = parseFloat(toValue);
        if (from === to) return;
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
                el.style.color = to > from ? '#059669' : '#dc2626';
                setTimeout(() => { el.style.color = ''; }, 1400);
            }
        };
        requestAnimationFrame(step);
    };

    // ─── ACTUALIZAR BARRA DE PROPORCIÓN ──────────────────────────────────────
    const actualizarBarras = (ventasTotal, pagos) => {
        if (!ventasTotal) return;
        STATS.filter(s => s.bar).forEach(s => {
            const bar = document.getElementById(s.bar);
            if (!bar) return;
            const pct = Math.min(((pagos[s.key] || 0) / ventasTotal) * 100, 100);
            bar.style.transition = 'width 0.7s ease';
            bar.style.width = `${pct.toFixed(1)}%`;
        });
    };

    // ─── APLICAR DATOS A LA UI ────────────────────────────────────────────────
    const aplicarStats = (ventasHoy, pagos) => {
        const ventasEl = document.getElementById('stat-ventas');
        if (ventasEl) countUp(ventasEl, ventasHoy);

        STATS.filter(s => s.key).forEach(s => {
            const el = document.getElementById(s.id);
            if (el) countUp(el, pagos[s.key] || 0);
        });

        actualizarBarras(ventasHoy, pagos);
    };

    // ─── CARGA INICIAL ────────────────────────────────────────────────────────
    const cargarStats = async () => {
        try {
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/stats-hoy-detalle`);
            const json = await res.json();
            if (json.success) aplicarStats(json.ventasHoy, json.pagos);
        } catch (_) {}
    };

    // ─── SSE — JAMÁS POLLING ──────────────────────────────────────────────────
    const conectarSSE = () => {
        const sse = new EventSource('/admin/sse');

        sse.addEventListener('store_stats_detail', (e) => {
            const data = JSON.parse(e.data);
            if (data.idPuntoDeVenta !== pdvId) return;
            aplicarStats(data.ventasHoy, data.pagos);
        });

        sse.onerror = () => setTimeout(conectarSSE, 5000);
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
        modalTitulo.textContent = label;
        modalBody.innerHTML = '<p class="text-sm text-slate-400 text-center py-6">Cargando...</p>';
        modalTotal.textContent = '—';
        modal.classList.remove('hidden');

        try {
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/pagos-hoy/${encodeURIComponent(metodo)}`);
            const json = await res.json();
            if (!json.success) throw new Error();

            if (!json.movimientos.length) {
                modalBody.innerHTML = '<p class="text-sm text-slate-400 text-center py-6">Sin movimientos hoy</p>';
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

    const cerrarModalPagos = () => modal?.classList.add('hidden');

    // ─── INIT ─────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        cargarStats();
        conectarSSE();

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
