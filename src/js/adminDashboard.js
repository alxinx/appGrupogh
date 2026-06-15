import Chart from 'chart.js/auto';

(function () {
    'use strict';

    const PALETTE = ['#EC5FA3', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#14B8A6', '#F97316'];

    const fmtFecha = (iso) =>
        new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

    const fmtCOP = window.fmtCOP;

    // ─── FLAGS de carga ───────────────────────────────────────────────────────
    let stockCargado   = false;
    let chartCargado   = false;
    let carteraCargada = false;

    // ─── STOCK BAJO GLOBAL ────────────────────────────────────────────────────
    const renderStockBajoGlobal = (productos) => {
        const list  = document.getElementById('stock-bajo-global-list');
        const badge = document.getElementById('stock-bajo-global-count');
        if (!list) return;

        if (badge) badge.textContent = `${productos.length} productos`;

        if (!productos.length) {
            list.innerHTML = `<li class="text-center py-8 text-xs text-slate-400">Sin productos con stock crítico</li>`;
            return;
        }

        const maxVal = productos[productos.length - 1]?.total || 1;

        list.innerHTML = productos.map((p, i) => {
            const pct      = Math.max((p.total / maxVal) * 100, 4);
            const critico  = p.total <= 2;
            const alerta   = !critico && p.total <= 5;
            const color    = critico ? '#dc2626' : alerta ? '#d97706' : '#16a34a';
            const rowBg    = critico ? 'background:rgba(254,242,242,0.8);border-left:3px solid #dc2626;' : alerta ? 'border-left:3px solid #d97706;' : 'border-left:3px solid transparent;';
            const badge    = critico
                ? `<span style="background:#dc2626;color:#fff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:99px;letter-spacing:.04em;animation:pulse 1.6s infinite">CRÍTICO</span>`
                : alerta
                ? `<span style="background:#fef3c7;color:#d97706;font-size:9px;font-weight:800;padding:1px 6px;border-radius:99px;">ALERTA</span>`
                : '';
            return `
            <li class="flex items-center gap-3 py-2.5 px-2 rounded-lg border-b border-slate-50 last:border-0 transition-all" style="${rowBg}">
                <span class="text-[10px] font-black text-slate-300 w-4 shrink-0 text-center">${i + 1}</span>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between mb-1 gap-2">
                        <span class="text-xs font-semibold text-slate-700 truncate">${p.nombre}</span>
                        <div class="flex items-center gap-1.5 shrink-0">
                            ${badge}
                            <span class="text-xs font-black tabular-nums" style="color:${color}">${p.total} uds.</span>
                        </div>
                    </div>
                    <div class="h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full rounded-full transition-all duration-700" style="width:${pct}%;background:${color}"></div>
                    </div>
                    <span class="text-[10px] text-slate-400">SKU: ${p.sku}</span>
                </div>
            </li>`;
        }).join('');
    };

    // ─── STOCK BAJO POR TIENDA ────────────────────────────────────────────────
    const renderStockBajoPorTienda = (tiendas) => {
        const container = document.getElementById('stock-bajo-tiendas-list');
        if (!container) return;

        if (!tiendas.length) {
            container.innerHTML = `<div class="text-center py-8 text-xs text-slate-400">Sin alertas de stock por tienda</div>`;
            return;
        }

        container.innerHTML = tiendas.map(t => `
            <div class="rounded-xl border border-slate-100 overflow-hidden">
                <div class="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
                    <span class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <i class="fi fi-rr-store" style="color:#EC5FA3"></i>
                        ${t.nombre}
                    </span>
                    <span class="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">${t.productos.length} crítico${t.productos.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="divide-y divide-slate-50">
                    ${t.productos.map(p => {
                        const critico = p.total <= 2;
                        const rowStyle = critico ? 'background:rgba(254,242,242,0.7);border-left:3px solid #dc2626;' : 'border-left:3px solid transparent;';
                        const numColor = critico ? 'color:#dc2626' : 'color:#d97706';
                        const badge    = critico
                            ? `<span style="background:#dc2626;color:#fff;font-size:9px;font-weight:800;padding:1px 5px;border-radius:99px;animation:pulse 1.6s infinite">!</span>`
                            : '';
                        return `
                    <div class="flex items-center justify-between px-3 py-2 transition-colors" style="${rowStyle}">
                        <span class="text-xs text-slate-600 truncate">${p.nombre}</span>
                        <div class="flex items-center gap-1.5 ml-2 shrink-0">
                            ${badge}
                            <span class="text-xs font-black tabular-nums" style="${numColor}">${p.total} uds.</span>
                        </div>
                    </div>`;
                    }).join('')}
                </div>
            </div>`).join('');
    };

    // ─── CHART VENTAS PDV 30D ─────────────────────────────────────────────────
    let chartPdv = null;

    const renderChartPdv = ({ fechas, series }) => {
        const ctx     = document.getElementById('chart-ventas-pdv');
        const leyenda = document.getElementById('chart-pdv-leyenda');
        if (!ctx) return;
        if (chartPdv) chartPdv.destroy();

        if (!series.length) {
            ctx.parentElement.innerHTML = `<p class="text-center text-xs text-slate-400 py-20">Sin datos de ventas en los últimos 30 días</p>`;
            return;
        }

        chartPdv = new Chart(ctx, {
            type: 'line',
            data: {
                labels: fechas.map(fmtFecha),
                datasets: series.map((s, i) => ({
                    label:           s.nombre,
                    data:            s.valores,
                    borderColor:     PALETTE[i % PALETTE.length],
                    backgroundColor: PALETTE[i % PALETTE.length] + '18',
                    borderWidth:      2,
                    pointRadius:      fechas.length > 20 ? 1 : 3,
                    pointHoverRadius: 5,
                    pointHitRadius:   10,
                    tension:          0.35,
                    fill:            false
                }))
            },
            options: {
                responsive:          true,
                maintainAspectRatio: false,
                interaction:         { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: c => ` ${c.dataset.label}: ${fmtCOP(c.parsed.y)}` }
                    }
                },
                scales: {
                    x: {
                        grid:  { display: false },
                        ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 0, maxTicksLimit: 10 }
                    },
                    y: {
                        beginAtZero: true,
                        grid:  { color: 'rgba(0,0,0,0.04)' },
                        ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmtCOP(v) }
                    }
                }
            }
        });

        if (leyenda) {
            leyenda.innerHTML = series.map((s, i) => `
                <span class="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${PALETTE[i % PALETTE.length]}"></span>
                    ${s.nombre}
                </span>`).join('');
        }
    };

    // ─── CARTERA URGENTE ─────────────────────────────────────────────────────
    const renderCarteraUrgente = ({ clientes, totalEnMora }) => {
        const tbody   = document.getElementById('cartera-urgente-body');
        const footer  = document.getElementById('cartera-urgente-footer');
        if (!tbody) return;

        if (!clientes.length) {
            tbody.innerHTML = `<tr><td colspan="3" class="py-8 text-center text-xs text-slate-400">Sin cartera vencida — ¡todo al día!</td></tr>`;
            if (footer) footer.textContent = '';
            return;
        }

        tbody.innerHTML = clientes.map(c => {
            const doc = c.tipoDoc === 'NIT' && c.digitoVerif
                ? `NIT: ${c.nroDoc}-${c.digitoVerif}`
                : `${c.tipoDoc}: ${c.nroDoc}`;
            return `
            <tr class="border-b border-slate-100 last:border-0">
                <td class="py-3 pr-4">
                    <p class="font-bold text-slate-800 text-sm">${c.nombre}</p>
                    <p class="text-xs text-slate-400">${doc}</p>
                </td>
                <td class="py-3 pr-4 font-bold text-sm" style="color:#EC5FA3">$${fmtCOP(c.saldoPendiente)}</td>
                <td class="py-3 text-sm text-slate-700">${c.diasEnMora} Dias</td>
            </tr>`;
        }).join('');

        if (footer)
            footer.innerHTML = `Mostrando <strong>${clientes.length}</strong> de <strong>${totalEnMora}</strong> clientes en mora`;
    };

    // ─── CARGA POR SECCIÓN ────────────────────────────────────────────────────
    const cargarStock = () => {
        Promise.all([
            fetch('/admin/api/dashboard/stock-bajo-global').then(r => r.json()),
            fetch('/admin/api/dashboard/stock-bajo-por-tienda').then(r => r.json()),
        ]).then(([global, porTienda]) => {
            if (global.success)    renderStockBajoGlobal(global.productos);
            if (porTienda.success) renderStockBajoPorTienda(porTienda.tiendas);
            stockCargado = true;
        }).catch(() => {});
    };

    const cargarChart = () => {
        fetch('/admin/api/dashboard/ventas-pdv-30d').then(r => r.json())
            .then(d => { if (d.success) { renderChartPdv(d); chartCargado = true; } })
            .catch(() => {});
    };

    const cargarCartera = () => {
        fetch('/admin/api/dashboard/cartera-urgente').then(r => r.json())
            .then(d => { if (d.success) { renderCarteraUrgente(d); carteraCargada = true; } })
            .catch(() => {});
    };

    // ─── SSE: recarga chart con debounce solo si ya fue cargado ──────────────
    const conectarSSEChart = () => {
        let chartDebounce = null;
        const recargarChart = () => {
            if (!chartCargado) return;
            clearTimeout(chartDebounce);
            chartDebounce = setTimeout(cargarChart, 5000);
        };

        if (window.__adminSSE) {
            window.__adminSSE.addEventListener('store_stats', recargarChart);
            return;
        }
        const sse = new EventSource('/admin/sse');
        window.__adminSSE = sse;
        sse.addEventListener('store_stats', recargarChart);
        sse.onerror = () => {
            window.__adminSSE = null;
            setTimeout(conectarSSEChart, 5000);
        };
    };

    // ─── LAZY LOAD CON IntersectionObserver ───────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                obs.unobserve(entry.target);
                const seccion = entry.target.dataset.lazy;
                if (seccion === 'stock')   cargarStock();
                if (seccion === 'chart')   cargarChart();
                if (seccion === 'cartera') cargarCartera();
            });
        }, { rootMargin: '150px' });

        document.querySelectorAll('[data-lazy]').forEach(el => observer.observe(el));

        conectarSSEChart();

        // Refresco periódico de stock solo si ya fue cargado al menos una vez
        setInterval(() => {
            if (!stockCargado) return;
            fetch('/admin/api/dashboard/stock-bajo-global').then(r => r.json())
                .then(d => { if (d.success) renderStockBajoGlobal(d.productos); }).catch(() => {});
            fetch('/admin/api/dashboard/stock-bajo-por-tienda').then(r => r.json())
                .then(d => { if (d.success) renderStockBajoPorTienda(d.tiendas); }).catch(() => {});
        }, 120_000);
    });
})();
