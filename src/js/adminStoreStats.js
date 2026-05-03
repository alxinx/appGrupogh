(function () {
    'use strict';

    const pdvId = document.getElementById('pdv-current-id')?.value;
    if (!pdvId) return;

    const fmtCOP = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;

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

    // ─── INIT ─────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        cargarStats();
        conectarSSE();
    });

})();
