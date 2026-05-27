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

    // ─── VENTAS DEL MES ──────────────────────────────────────────────────────
    const actualizarVentasMes = (total, dias, ultimos7) => {
        const el = document.getElementById('stat-ventas-mes');
        if (el) {
            const from = parseFloat(el.dataset.val || '0');
            const to   = Math.round(parseFloat(total) || 0);
            if (from !== to) {
                el.dataset.val = to;
                const duration = 900;
                const start    = performance.now();
                const step = (ts) => {
                    const progress = Math.min((ts - start) / duration, 1);
                    const eased    = 1 - Math.pow(1 - progress, 3);
                    el.textContent = fmtCOP(from + (to - from) * eased);
                    if (progress < 1) requestAnimationFrame(step);
                    else el.textContent = fmtCOP(to);
                };
                requestAnimationFrame(step);
            }
        }

        const elDias = document.getElementById('stat-ventas-mes-dias');
        if (elDias) elDias.textContent = `en los últimos ${dias} días`;

        if (!Array.isArray(ultimos7) || ultimos7.length !== 7) return;

        const DIAS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const hoyRef  = new Date();
        const max     = Math.max(...ultimos7, 1);
        const tooltip = document.getElementById('tooltip-mes');
        const tooltipTxt = document.getElementById('tooltip-mes-texto');

        ultimos7.forEach((valor, i) => {
            const bar = document.getElementById(`bar-dia-${i}`);
            if (!bar) return;

            const ratio  = valor / max;
            const height = Math.max(ratio * 100, 8);
            const alpha  = valor === 0 ? 0.12 : 0.25 + 0.75 * ratio;
            bar.style.height          = `${height}%`;
            bar.style.backgroundColor = `rgba(236,95,163,${alpha.toFixed(2)})`;
            bar.style.transition      = 'height 0.6s cubic-bezier(.4,0,.2,1), background-color 0.6s';

            const d = new Date(hoyRef);
            d.setDate(d.getDate() - (6 - i));
            const label = `${DIAS_ES[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
            bar.dataset.label = label;
            bar.dataset.valor = valor;

            if (!bar.dataset.listenersSet) {
                bar.dataset.listenersSet = '1';
                bar.addEventListener('mouseenter', () => {
                    if (!tooltip || !tooltipTxt) return;
                    tooltipTxt.textContent = `${bar.dataset.label} · ${fmtCOP(bar.dataset.valor)}`;
                    const barRect    = bar.getBoundingClientRect();
                    const parentRect = bar.parentElement.getBoundingClientRect();
                    tooltip.style.left = `${barRect.left - parentRect.left + barRect.width / 2}px`;
                    tooltip.classList.remove('hidden');
                });
                bar.addEventListener('mouseleave', () => {
                    if (tooltip) tooltip.classList.add('hidden');
                });
            }
        });
    };

    // ─── TICKET PROMEDIO ──────────────────────────────────────────────────────
    const actualizarTicketPromedio = (valor, pct) => {
        const el = document.getElementById('stat-ticket-promedio');
        if (!el) return;

        const from = parseFloat(el.dataset.val || '0');
        const to   = Math.round(parseFloat(valor) || 0);
        if (from !== to) {
            el.dataset.val = to;
            const duration = 800;
            const start    = performance.now();
            const step = (ts) => {
                const progress = Math.min((ts - start) / duration, 1);
                const eased    = 1 - Math.pow(1 - progress, 3);
                el.textContent = fmtCOP(from + (to - from) * eased);
                if (progress < 1) requestAnimationFrame(step);
                else el.textContent = fmtCOP(to);
            };
            requestAnimationFrame(step);
        }

        const trend = document.getElementById('stat-ticket-promedio-trend');
        const icon  = document.getElementById('stat-ticket-promedio-icon');
        const label = document.getElementById('stat-ticket-promedio-label');
        if (!trend || pct === null || pct === undefined) return;

        const sube = pct >= 0;
        trend.className = `mt-4 flex items-center space-x-2 text-xs font-medium p-2 rounded-lg ${sube ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50'}`;
        icon.textContent  = sube ? 'trending_up' : 'trending_down';
        label.textContent = `${Math.abs(pct)}% ${sube ? 'Más' : 'Menos'} que el mismo día hace una semana`;
        trend.classList.remove('hidden');
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
            if (json.ticketPromedio   !== undefined) actualizarTicketPromedio(json.ticketPromedio, json.ticketPct ?? null);
            if (json.ventasMes        !== undefined) actualizarVentasMes(json.ventasMes, json.diasTranscurridos, json.ultimos7);
        } catch (_) {}
    };

    // ─── SSE (conexión compartida vía window.__adminSSE) ─────────────────────
    const conectarSSE = () => {
        if (!window.__adminSSE) {
            const sse = new EventSource('/admin/sse');
            window.__adminSSE = sse;
            sse.onerror = () => {
                window.__adminSSE = null;
                setTimeout(conectarSSE, 5000);
            };
        }

        const sse = window.__adminSSE;

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
    };

    // ─── INIT ─────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        cargarStats();
        conectarSSE();
    });

})();
