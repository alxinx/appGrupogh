(function () {
    'use strict';

    const fmtCOP = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;

    // ─── ANIMACIÓN CONTADOR ASCENDENTE ───────────────────────────────────────
    const countUp = (el, toValue) => {
        const from = parseFloat(el.dataset.val || '0');
        const to   = parseFloat(toValue);
        if (from === to) return;

        el.dataset.val = to;

        const duration = 700;
        const start = performance.now();
        const range = to - from;

        const step = (ts) => {
            const elapsed  = ts - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased    = 1 - Math.pow(1 - progress, 3);
            el.textContent = fmtCOP(from + range * eased);
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = fmtCOP(to);
                el.style.transition = 'color 0.3s';
                el.style.color = to > from ? '#059669' : '#dc2626';
                setTimeout(() => { el.style.color = ''; }, 1200);
            }
        };
        requestAnimationFrame(step);
    };

    // ─── ACTUALIZAR CELDA ─────────────────────────────────────────────────────
    const actualizarCelda = (idPdv, tipo, valor) => {
        const el = document.querySelector(`[data-stat="${tipo}"][data-pdv="${idPdv}"]`);
        if (el) countUp(el, valor);
    };

    // ─── BADGE DE CAJA ────────────────────────────────────────────────────────
    const BADGE_CONFIG = {
        abierta: {
            cls:  'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-600',
            dot:  'w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2',
            text: 'ABIERTA'
        },
        cuadrada: {
            cls:  'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-600',
            dot:  'w-1.5 h-1.5 rounded-full bg-blue-500 mr-2',
            text: 'CUADRADA'
        },
        cerrada: {
            cls:  'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500',
            dot:  'w-1.5 h-1.5 rounded-full bg-slate-400 mr-2',
            text: 'CERRADA'
        }
    };

    const actualizarBadgeCaja = (idPdv, estado) => {
        const badge = document.querySelector(`[data-caja-badge="${idPdv}"]`);
        if (!badge) return;

        const cfg = BADGE_CONFIG[estado] || BADGE_CONFIG.cerrada;

        // Efecto: fade out → swap → fade in + ring flash
        badge.style.transition = 'opacity 0.25s, transform 0.25s';
        badge.style.opacity    = '0';
        badge.style.transform  = 'scale(0.85)';

        setTimeout(() => {
            badge.className = cfg.cls;
            badge.innerHTML = `<span class="${cfg.dot} transition-all duration-300"></span>${cfg.text}`;
            badge.style.opacity   = '1';
            badge.style.transform = 'scale(1)';

            // Ring flash para llamar la atención
            badge.style.outline = '3px solid currentColor';
            badge.style.outlineOffset = '2px';
            setTimeout(() => {
                badge.style.outline      = '';
                badge.style.outlineOffset = '';
            }, 1400);
        }, 260);
    };

    // ─── MÉTODOS DE PAGO ─────────────────────────────────────────────────────
    const PM_IDS = {
        efectivo:  'pm-efectivo',
        transBill: 'pm-transbill',
        tCredito:  'pm-tcredito',
        creditos:  'pm-creditos'
    };

    const countUpEl = (el, toValue) => {
        if (!el) return;
        const from = parseFloat(el.dataset.val || '0');
        const to   = Math.round(parseFloat(toValue) || 0);
        if (from === to) return;
        el.dataset.val = to;

        const duration = 800;
        const start    = performance.now();
        const step = (ts) => {
            const progress = Math.min((ts - start) / duration, 1);
            const eased    = 1 - Math.pow(1 - progress, 3);
            el.textContent = fmtCOP(from + (to - from) * eased);
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = fmtCOP(to);
                el.style.transition = 'color 0.3s';
                el.style.color = to > from ? '#059669' : '#dc2626';
                setTimeout(() => { el.style.color = ''; }, 1400);
            }
        };
        requestAnimationFrame(step);
    };

    const actualizarPagos = (pagosGlobales) => {
        if (!pagosGlobales) return;
        for (const [key, id] of Object.entries(PM_IDS)) {
            countUpEl(document.getElementById(id), pagosGlobales[key] || 0);
        }
    };

    // ─── STAT GLOBAL ─────────────────────────────────────────────────────────
    const elGlobal    = document.getElementById('stat-ventas-globales');
    const elGlobalBar = document.getElementById('stat-ventas-globales-bar');

    const actualizarGlobal = (nuevoValor) => {
        if (!elGlobal) return;
        const from = parseFloat(elGlobal.dataset.val || '0');
        const to   = Math.round(parseFloat(nuevoValor) || 0);
        if (from === to) return;

        elGlobal.dataset.val = to;

        const duration = 900;
        const start    = performance.now();

        const step = (ts) => {
            const progress = Math.min((ts - start) / duration, 1);
            const eased    = 1 - Math.pow(1 - progress, 3);
            const current  = from + (to - from) * eased;
            elGlobal.textContent = fmtCOP(current);

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                elGlobal.textContent = fmtCOP(to);
                // Flash de color verde
                elGlobal.style.transition = 'color 0.3s';
                elGlobal.style.color = '#059669';
                setTimeout(() => { elGlobal.style.color = ''; }, 1400);
                // Barra de progreso: relativa al máximo visible (propio)
                if (elGlobalBar && to > 0) {
                    const pct = Math.min((to / (to * 1.25)) * 100, 100);
                    elGlobalBar.style.width = pct + '%';
                }
            }
        };
        requestAnimationFrame(step);
    };

    // ─── CARGAR STATS INICIALES ───────────────────────────────────────────────
    const cargarStats = async () => {
        try {
            const res  = await fetch('/admin/api/tiendas/stats-hoy');
            const json = await res.json();
            if (!json.success) return;
            for (const s of json.stats) {
                actualizarCelda(s.idPuntoDeVenta, 'ventas',   s.ventasHoy);
                actualizarCelda(s.idPuntoDeVenta, 'egresos',  s.egresosHoy);
            }
            if (json.ventasGlobalesHoy !== undefined) actualizarGlobal(json.ventasGlobalesHoy);
            if (json.pagosGlobales)                  actualizarPagos(json.pagosGlobales);
        } catch (_) {}
    };

    // ─── SSE ─────────────────────────────────────────────────────────────────
    const conectarSSE = () => {
        const sse = new EventSource('/admin/sse');

        sse.addEventListener('store_stats', (e) => {
            const data = JSON.parse(e.data);
            if (data.ventasHoy  !== undefined) actualizarCelda(data.idPuntoDeVenta, 'ventas',  data.ventasHoy);
            if (data.egresosHoy !== undefined) actualizarCelda(data.idPuntoDeVenta, 'egresos', data.egresosHoy);
        });

        sse.addEventListener('caja_status', (e) => {
            const { idPuntoDeVenta, estado } = JSON.parse(e.data);
            actualizarBadgeCaja(idPuntoDeVenta, estado);
        });

        sse.addEventListener('global_stats', (e) => {
            const data = JSON.parse(e.data);
            if (data.ventasGlobalesHoy !== undefined) actualizarGlobal(data.ventasGlobalesHoy);
            if (data.pagosGlobales)                   actualizarPagos(data.pagosGlobales);
        });

        sse.onerror = () => setTimeout(conectarSSE, 5000);
    };

    // ─── INIT ─────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        cargarStats();
        conectarSSE();
    });

})();
