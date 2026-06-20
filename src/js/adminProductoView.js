import Chart from 'chart.js/auto';

(function () {
    const idProducto = document.getElementById('producto-id')?.value;
    if (!idProducto) return;

    // ─── HELPERS ─────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    const toISO = (d) => d.toISOString().slice(0, 10);
    const fmtFecha = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

    const hoy    = new Date();
    const hace30 = new Date(hoy); hace30.setDate(hoy.getDate() - 30);

    // ─── STOCK TOTAL ─────────────────────────────────────────────────────────
    fetch(`/admin/api/inventario/${idProducto}/stock-total`)
        .then(r => r.json())
        .then(({ stockTotal }) => {
            const el = $('stockTotalGlobal');
            if (el) el.textContent = (stockTotal || 0).toLocaleString('es-CO');
        })
        .catch(() => { const el = $('stockTotalGlobal'); if (el) el.textContent = '—'; });

    // ─── UNIDADES VENDIDAS (30d) ──────────────────────────────────────────────
    const actualizarUnidadesVendidas = () => {
        fetch(`/admin/api/inventario/${idProducto}/unidades-vendidas`)
            .then(r => r.json())
            .then(({ success, actual, variacion, tendencia }) => {
                if (!success) return;
                const signo = variacion > 0 ? '+' : '';
                const color = tendencia === 'up' ? '#078859' : tendencia === 'down' ? '#e53e3e' : '#6b7280';

                const elValor = $('stat-unidades-valor');
                const elBadge = $('stat-unidades-badge');
                const elPct   = $('stat-unidades-pct');
                const elIcon  = $('stat-unidades-icon');

                if (elValor) elValor.textContent = actual.toLocaleString('es-CO');
                if (elBadge) { elBadge.textContent = `${signo}${variacion}% vs mes ant.`; elBadge.style.color = color; elBadge.closest('div').style.background = color + '1a'; }
                if (elPct)   { elPct.textContent = `${signo}${variacion}%`; elPct.style.color = color; }
                if (elIcon)  { elIcon.className = `fi-rr-arrow-trend-${tendencia === 'down' ? 'down' : 'up'} text-3xl`; elIcon.style.color = color; }
            })
            .catch(() => {});
    };
    actualizarUnidadesVendidas();
    setInterval(actualizarUnidadesVendidas, 30000);

    // ─── DÍAS DE INVENTARIO ──────────────────────────────────────────────────
    const COLORES = {
        critico:    { bg: '#fef2f2', icon: '#dc2626', badge: '#dc2626', badgeBg: '#fee2e2', texto: '#dc2626', iconFooter: 'fi-rr-triangle-warning' },
        alerta:     { bg: '#fffbeb', icon: '#d97706', badge: '#d97706', badgeBg: '#fef3c7', texto: '#d97706', iconFooter: 'fi-rr-triangle-warning' },
        suficiente: { bg: '#f0fdf4', icon: '#16a34a', badge: '#16a34a', badgeBg: '#dcfce7', texto: '#16a34a', iconFooter: 'fi-rr-check-circle'     }
    };
    const LABELS = { critico: 'CRÍTICO', alerta: 'ALERTA', suficiente: 'SUFICIENTE' };

    const actualizarDiasInventario = () => {
        fetch(`/admin/api/inventario/${idProducto}/dias-inventario`)
            .then(r => r.json())
            .then(({ success, dias, estado, mensaje }) => {
                if (!success) return;
                const c = COLORES[estado];
                const emergencia = dias <= 5;

                const card    = $('inv-days-card');
                const wrap    = $('inv-days-icon-wrap');
                const badge   = $('inv-days-badge');
                const badgeW  = $('inv-days-badge-wrap');
                const valor   = $('inv-days-valor');
                const label   = $('inv-days-label');
                const footerI = $('inv-days-icon-footer-i');
                const msg     = $('inv-days-mensaje');

                if (emergencia && card) {
                    card.style.background  = '#dc2626';
                    card.style.borderColor = '#b91c1c';
                    card.style.boxShadow   = '0 0 0 3px #fca5a5, 0 10px 30px rgba(220,38,38,0.4)';
                    const w = '#ffffff';
                    if (wrap)    { wrap.style.background = 'rgba(255,255,255,0.2)'; wrap.style.color = w; }
                    if (badgeW)  { badgeW.style.background = 'rgba(255,255,255,0.25)'; }
                    if (badge)   { badge.textContent = '⚠ URGENTE'; badge.style.color = w; }
                    if (valor)   { valor.textContent = dias; valor.style.color = w; }
                    if (label)   { label.style.color = 'rgba(255,255,255,0.85)'; }
                    if (footerI) { footerI.className = 'fi-rr-triangle-warning text-xl'; footerI.style.color = w; }
                    if (msg)     { msg.textContent = mensaje; msg.style.color = w; msg.style.fontWeight = '700'; }
                } else {
                    if (card)    { card.style.background = ''; card.style.borderColor = ''; card.style.boxShadow = ''; }
                    if (wrap)    { wrap.style.background = c.bg; wrap.style.color = c.icon; }
                    if (badgeW)  { badgeW.style.background = c.badgeBg; }
                    if (badge)   { badge.textContent = LABELS[estado]; badge.style.color = c.badge; }
                    if (valor)   { valor.textContent = dias >= 999 ? '∞' : dias; valor.style.color = c.icon; }
                    if (label)   { label.style.color = c.texto; }
                    if (footerI) { footerI.className = `${c.iconFooter} text-xl`; footerI.style.color = c.texto; }
                    if (msg)     { msg.textContent = mensaje; msg.style.color = c.texto; msg.style.fontWeight = ''; }
                }
            })
            .catch(() => {});
    };
    actualizarDiasInventario();
    setInterval(actualizarDiasInventario, 30000);

    // ─── GRÁFICAS ─────────────────────────────────────────────────────────────
    const PALETTE = ['#EC5FA3', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#14B8A6', '#F97316'];

    const elDesde = $('graf-desde');
    const elHasta = $('graf-hasta');
    if (elDesde) elDesde.value = toISO(hace30);
    if (elHasta) elHasta.value = toISO(hoy);

    let chartLinea = null;
    let chartDona  = null;

    const renderLinea = (datos) => {
        const ctx = $('graf-linea');
        if (!ctx) return;
        if (chartLinea) chartLinea.destroy();
        chartLinea = new Chart(ctx, {
            type: 'line',
            data: {
                labels: datos.map(d => fmtFecha(d.fecha)),
                datasets: [{
                    label: 'Unidades',
                    data: datos.map(d => d.unidades),
                    borderColor: '#EC5FA3',
                    backgroundColor: 'rgba(236,95,163,0.12)',
                    borderWidth: 2.5,
                    pointRadius: datos.length > 20 ? 0 : 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#EC5FA3',
                    tension: 0.35,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => ` ${c.parsed.y} uds.` } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 }, maxRotation: 0 } },
                    y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#94a3b8', font: { size: 11 }, precision: 0 } }
                }
            }
        });
    };

    const renderDona = (tiendas, total) => {
        const ctx     = $('graf-dona');
        const leyenda = $('graf-dona-leyenda');
        const totalEl = $('graf-dona-total');
        if (!ctx) return;
        if (chartDona) chartDona.destroy();

        if (!tiendas.length) {
            if (totalEl) totalEl.textContent = '0';
            if (leyenda) leyenda.innerHTML = '<li class="text-xs text-slate-400 text-center">Sin datos en el periodo</li>';
            return;
        }

        chartDona = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: tiendas.map(t => t.nombre),
                datasets: [{
                    data: tiendas.map(t => t.unidades),
                    backgroundColor: tiendas.map((_, i) => PALETTE[i % PALETTE.length]),
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
                    tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed} uds. (${tiendas[c.dataIndex].pct}%)` } }
                }
            }
        });

        if (totalEl) totalEl.textContent = total.toLocaleString('es-CO');
        if (leyenda) leyenda.innerHTML = tiendas.map((t, i) => `
            <li class="flex items-center justify-between text-xs">
                <span class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${PALETTE[i % PALETTE.length]}"></span>
                    <span class="text-slate-600 font-medium">${t.nombre}</span>
                </span>
                <span class="font-bold text-slate-700">${t.pct}%</span>
            </li>`).join('');
    };

    const cargarGraficas = () => {
        const desde = elDesde?.value || toISO(hace30);
        const hasta = elHasta?.value || toISO(hoy);
        const qs = `?desde=${desde}&hasta=${hasta}`;
        Promise.all([
            fetch(`/admin/api/inventario/${idProducto}/ventas-historico${qs}`).then(r => r.json()),
            fetch(`/admin/api/inventario/${idProducto}/ventas-por-tienda${qs}`).then(r => r.json())
        ]).then(([hist, tienda]) => {
            if (hist.success)   renderLinea(hist.datos);
            if (tienda.success) renderDona(tienda.tiendas, tienda.total);
        }).catch(() => {});
    };

    $('graf-filtrar')?.addEventListener('click', cargarGraficas);
    cargarGraficas();

    // ─── STOCK POR PUNTO DE VENTA ────────────────────────────────────────────
    const cargarStockTiendas = () => {
        fetch(`/admin/api/inventario/${idProducto}/stock-por-tienda`)
            .then(r => r.json())
            .then(({ success, datos, umbral }) => {
                if (!success) return;
                const tbody   = $('stock-tiendas-body');
                const totalEl = $('stock-tiendas-total');
                if (!tbody) return;

                const totalUds = datos.reduce((s, d) => s + d.total, 0);
                if (totalEl) totalEl.textContent = `${totalUds.toLocaleString('es-CO')} uds. en ${datos.length} ubicación${datos.length !== 1 ? 'es' : ''}`;

                if (!datos.length) {
                    tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-slate-400 text-sm">Sin existencias registradas</td></tr>`;
                    return;
                }

                tbody.innerHTML = datos.map(d => `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="px-6 py-3 font-semibold text-slate-700">${d.nombre}</td>
                        <td class="px-6 py-3 text-slate-500 capitalize text-xs">${d.tipo || '—'}</td>
                        <td class="px-6 py-3 text-center font-bold ${d.bajo ? 'text-red-500' : 'text-slate-700'}">${d.total.toLocaleString('es-CO')}</td>
                        <td class="px-6 py-3 text-center">
                            ${d.bajo
                                ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-100 text-red-600">
                                       <i class="fi fi-rr-triangle-warning"></i> Stock bajo
                                   </span>`
                                : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">
                                       <i class="fi fi-rr-check"></i> Normal
                                   </span>`
                            }
                        </td>
                    </tr>`).join('');
            })
            .catch(() => {});
    };

    cargarStockTiendas();

    // ─── MODAL HACER TRASLADO ─────────────────────────────────────────────────
    const modal       = $('modal-traslado');
    const btnAbrir    = $('btn-hacer-traslado');
    const btnCerrar   = $('modal-traslado-cerrar');
    const selOrigen   = $('trl-origen');
    const selDestino  = $('trl-destino');
    const inpCantidad = $('trl-cantidad');
    const spanMax     = $('trl-max');
    const inpNotas    = $('trl-notas');
    const btnSubmit   = $('trl-submit');
    const csrfToken   = $('csrf-token-admin')?.value;

    if (!modal || !btnAbrir) return;

    // stock por tienda cacheado para el modal
    let stockData = [];
    let todasTiendas = [];

    const abrirModal = async () => {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        selOrigen.innerHTML   = '<option value="">Cargando...</option>';
        selDestino.innerHTML  = '<option value="">Cargando...</option>';
        spanMax.textContent   = '';
        inpCantidad.value     = 1;
        inpCantidad.removeAttribute('max');
        btnSubmit.disabled    = true;

        const [resStock, resTiendas] = await Promise.all([
            fetch(`/admin/api/inventario/${idProducto}/stock-por-tienda`).then(r => r.json()).catch(() => ({ success: false })),
            fetch('/admin/json/tiendas/').then(r => r.json()).catch(() => [])
        ]);

        stockData    = (resStock.success && resStock.datos.length) ? resStock.datos : [];
        todasTiendas = Array.isArray(resTiendas) ? resTiendas : [];

        selOrigen.innerHTML = stockData.length
            ? '<option value="">Selecciona origen...</option>' + stockData.map(d => `<option value="${d.idPuntoVenta ?? ''}" data-max="${d.total}">${d.nombre} (${d.total} uds.)</option>`).join('')
            : '<option value="">Sin stock disponible</option>';

        actualizarDestinos();
        validarModal();
    };

    const actualizarDestinos = () => {
        const idOrigenVal = selOrigen.value;
        const opts = todasTiendas
            .filter(t => String(t.idPuntoDeVenta) !== idOrigenVal)
            .map(t => `<option value="${t.idPuntoDeVenta}">${t.nombreComercial}</option>`)
            .join('');
        selDestino.innerHTML = '<option value="">Selecciona destino...</option>' + opts;
    };

    const actualizarMax = () => {
        const opt = selOrigen.options[selOrigen.selectedIndex];
        const max = opt ? parseInt(opt.dataset.max) || 0 : 0;
        if (max > 0) {
            inpCantidad.max   = max;
            spanMax.textContent = `Máx: ${max}`;
            if (parseInt(inpCantidad.value) > max) inpCantidad.value = max;
        } else {
            inpCantidad.removeAttribute('max');
            spanMax.textContent = '';
        }
    };

    const validarModal = () => {
        const ok = selOrigen.value && selDestino.value && parseInt(inpCantidad.value) > 0;
        btnSubmit.disabled = !ok;
    };

    selOrigen.addEventListener('change', () => { actualizarMax(); actualizarDestinos(); validarModal(); });
    selDestino.addEventListener('change', validarModal);
    inpCantidad.addEventListener('input', validarModal);

    btnAbrir.addEventListener('click', abrirModal);
    btnCerrar.addEventListener('click', () => { modal.classList.add('hidden'); modal.classList.remove('flex'); });
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); } });

    btnSubmit.addEventListener('click', async () => {
        btnSubmit.disabled = true;
        const body = {
            idOrigen:  selOrigen.value,
            idDestino: selDestino.value,
            cantidad:  parseInt(inpCantidad.value),
            notas:     inpNotas?.value?.trim() || ''
        };
        try {
            const r = await fetch(`/admin/api/inventario/${idProducto}/traslado`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
                body:    JSON.stringify(body)
            });
            const data = await r.json();
            if (data.success) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                if (window.Swal) {
                    Swal.fire({ icon: 'success', title: '¡Traslado creado!', text: `Código: ${data.codigo}`, confirmButtonColor: '#EC5FA3' });
                } else {
                    alert(`Traslado creado. Código: ${data.codigo}`);
                }
                cargarStockTiendas();
            } else {
                if (window.Swal) {
                    Swal.fire({ icon: 'error', title: 'Error', text: data.mensaje || 'No se pudo crear el traslado.', confirmButtonColor: '#EC5FA3' });
                } else {
                    alert(data.mensaje || 'Error al crear el traslado.');
                }
                btnSubmit.disabled = false;
            }
        } catch {
            btnSubmit.disabled = false;
            if (window.Swal) {
                Swal.fire({ icon: 'error', title: 'Error de red', text: 'No se pudo conectar al servidor.', confirmButtonColor: '#EC5FA3' });
            }
        }
    });

})();
