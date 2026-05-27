(function () {
    'use strict';

    const fmtCOP = (n) => `$${Math.round(parseFloat(n) || 0).toLocaleString('es-CO')}`;

    const fmtFechaLarga = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        const offset = d.getTimezoneOffset();
        const local  = new Date(d.getTime() + offset * 60000);
        return local.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    };

    const hoy = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    let pdvId      = null;
    let cajaActual = null; // idCajaTienda del cierre cargado

    // ─── MOSTRAR U OCULTAR EL BLOQUE DE CONTENIDO ────────────────────────────
    const mostrarContenido = (visible) => {
        const ids = ['cc-empleados', 'cc-stats', 'cc-medios-container', 'cc-subtabs',
                     'cc-panel-ingresos', 'cc-panel-egresos'];
        ids.forEach(id => document.getElementById(id)?.classList.toggle('hidden', !visible));
        document.getElementById('cc-empty')?.classList.toggle('hidden', visible);
        const btnPdf = document.getElementById('cc-btn-pdf');
        if (btnPdf) btnPdf.classList.toggle('hidden', !visible);
    };

    // ─── CARGAR CIERRE POR FECHA ──────────────────────────────────────────────
    const cargarPorFecha = async (fecha) => {
        // Paso 1: obtener el idCajaTienda del cierre cerrado para esa fecha
        try {
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/cajas-cerradas?fecha=${fecha}`);
            const json = await res.json();

            if (!json.success || !json.cajas.length) {
                mostrarContenido(false);
                cajaActual = null;
                const pdfBtn = document.getElementById('cc-btn-pdf');
                if (pdfBtn) { pdfBtn.href = '#'; pdfBtn.classList.add('hidden'); }
                return;
            }

            // Tomar el cierre más reciente del día
            const caja = json.cajas[json.cajas.length - 1];
            await cargarCierre(caja.idCajaTienda);
        } catch (e) {
            console.error('cargarPorFecha:', e);
        }
    };

    // ─── CARGAR DATOS DEL CIERRE ──────────────────────────────────────────────
    const cargarCierre = async (idCajaTienda) => {
        cajaActual = idCajaTienda;

        try {
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/cierre/${idCajaTienda}`);
            const json = await res.json();
            if (!json.success) { mostrarContenido(false); return; }

            mostrarContenido(true);

            const c = json.caja;

            // Fecha display
            const fechaEl = document.getElementById('cc-fecha-display');
            if (fechaEl) fechaEl.textContent = fmtFechaLarga(c.fechaCierre || c.fechaApertura);

            // Empleados
            document.getElementById('cc-empleado-apertura').textContent = c.empleadoApertura;
            document.getElementById('cc-empleado-cierre').textContent   = c.empleadoCierre;

            // Stats
            document.getElementById('cc-stat-ingresos').textContent     = fmtCOP(c.ventasTotales);
            document.getElementById('cc-stat-egresos').textContent      = fmtCOP(c.egresosTotales);
            document.getElementById('cc-stat-efectivo').textContent     = fmtCOP(c.ventasEfectivo);
            document.getElementById('cc-stat-electronicos').textContent = fmtCOP(c.ventasMediosElectronicos);

            // Desglose medios electrónicos
            renderMediosPago(json.mediosPago);

            // PDF button
            const pdfBtn = document.getElementById('cc-btn-pdf');
            if (pdfBtn) {
                pdfBtn.href = `/admin/tiendas/${pdvId}/cuadre/${idCajaTienda}/pdf`;
                pdfBtn.classList.remove('hidden');
            }

            // Sub-tab activo (ingresos por defecto)
            activarSubTab('ingresos');
            cargarFacturas(1);
        } catch (e) {
            console.error('cargarCierre:', e);
        }
    };

    // ─── DESGLOSE DE MEDIOS ELECTRÓNICOS ─────────────────────────────────────
    const renderMediosPago = (medios) => {
        const cont = document.getElementById('cc-medios-container');
        if (!cont) return;
        if (!medios?.length) { cont.innerHTML = ''; return; }

        const colores = [
            'border-blue-100 bg-blue-50/50',
            'border-purple-100 bg-purple-50/50',
            'border-emerald-100 bg-emerald-50/50',
            'border-orange-100 bg-orange-50/50'
        ];
        const iconos = {
            'Banco':              'fi-rr-bank',
            'Billetera Virtual':  'fi-rr-smartphone',
            'Tarjeta Credito':    'fi-rr-credit-card',
            'Entidad Crediticia': 'fi-rr-building'
        };

        const cols = Math.min(medios.length, 3);
        let html = `<div class="grid grid-cols-1 md:grid-cols-${cols} gap-3 mb-4">`;
        medios.forEach((m, i) => {
            const total = m.entidades.reduce((s, e) => s + e.valor, 0);
            const icono = iconos[m.metodo] || 'fi-rr-credit-card';
            const color = colores[i % colores.length];
            html += `
                <div class="tarjetaBase border ${color}">
                    <p class="text-xs font-bold text-gh-primaryHover uppercase tracking-wider mb-1">${m.metodo}</p>
                    <p class="text-xl font-bold text-slate-800 mb-3">${fmtCOP(total)}</p>
                    <div class="space-y-1.5">
                        ${m.entidades.map(e => `
                            <div class="flex justify-between items-center text-xs">
                                <span class="flex items-center gap-1.5 text-slate-500">
                                    <i class="fi ${icono} text-gh-primary text-sm"></i>
                                    ${e.nombre}
                                </span>
                                <span class="font-bold text-slate-700">${fmtCOP(e.valor)}</span>
                            </div>`).join('')}
                    </div>
                </div>`;
        });
        html += '</div>';
        cont.innerHTML = html;
    };

    // ─── SUB-PESTAÑAS ─────────────────────────────────────────────────────────
    const activarSubTab = (tab) => {
        const btnI = document.getElementById('cc-subtab-ingresos');
        const btnE = document.getElementById('cc-subtab-egresos');
        if (!btnI || !btnE) return;

        [btnI, btnE].forEach(b => { b.classList.remove('tab-active'); b.classList.add('text-slate-400'); });
        const activo = tab === 'ingresos' ? btnI : btnE;
        activo.classList.add('tab-active');
        activo.classList.remove('text-slate-400');

        document.getElementById('cc-panel-ingresos').classList.toggle('hidden', tab !== 'ingresos');
        document.getElementById('cc-panel-egresos').classList.toggle('hidden',  tab !== 'egresos');
    };

    const initSubTabs = () => {
        document.getElementById('cc-subtab-ingresos')?.addEventListener('click', () => {
            activarSubTab('ingresos');
            cargarFacturas(1);
        });
        document.getElementById('cc-subtab-egresos')?.addEventListener('click', () => {
            activarSubTab('egresos');
            cargarEgresos();
        });
    };

    // ─── FACTURAS DEL CIERRE ─────────────────────────────────────────────────
    const cargarFacturas = async (pagina = 1) => {
        const tbody = document.getElementById('cc-facturas-tbody');
        if (!tbody || !cajaActual) return;

        tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400 text-sm">
            <i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando...</td></tr>`;

        try {
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/cierre/${cajaActual}/facturas?pagina=${pagina}`);
            const json = await res.json();

            if (!json.success || !json.facturas.length) {
                tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-10 text-center text-slate-400 text-sm">
                    <i class="fi fi-rr-receipt mr-2"></i>Sin facturas en este período.</td></tr>`;
                document.getElementById('cc-facturas-paginacion').innerHTML = '';
                return;
            }

            tbody.innerHTML = json.facturas.map(f => `
                <tr class="border-b border-slate-100 hover:bg-pink-50/30 transition-colors">
                    <td class="px-4 py-3 font-mono text-xs font-bold text-slate-700">${f.nroFactura}</td>
                    <td class="px-4 py-3 text-sm text-slate-800">${f.cliente}</td>
                    <td class="px-4 py-3 text-xs text-slate-500">${f.hora ? f.hora.slice(0, 5) : '—'}</td>
                    <td class="px-4 py-3 text-right font-bold text-slate-800 text-sm whitespace-nowrap">${fmtCOP(f.total)}</td>
                    <td class="px-4 py-3 text-xs text-slate-500">${f.metodos || '—'}</td>
                    <td class="px-4 py-3 text-center">
                        <a href="/admin/api/factura/${f.idFacturaCliente}/tirilla" target="_blank"
                           class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-600 transition-colors"
                           title="Ver PDF">
                            <i class="fi fi-rr-file-pdf text-sm"></i>
                        </a>
                    </td>
                </tr>`).join('');

            generarPaginacion('#cc-facturas-paginacion', json.totalPaginas, json.paginaActual, cargarFacturas);
        } catch (_) {
            tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-red-400 text-sm">Error al cargar facturas.</td></tr>`;
        }
    };

    // ─── EGRESOS DEL CIERRE ───────────────────────────────────────────────────
    const cargarEgresos = async () => {
        const tbody = document.getElementById('cc-egresos-tbody');
        if (!tbody || !cajaActual) return;

        tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-8 text-center text-slate-400 text-sm">
            <i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando...</td></tr>`;

        try {
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/cierre/${cajaActual}/egresos`);
            const json = await res.json();

            if (!json.success || !json.egresos.length) {
                tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-10 text-center text-slate-400 text-sm">
                    <i class="fi fi-rr-file-slash mr-2"></i>Sin egresos en este período.</td></tr>`;
                return;
            }

            tbody.innerHTML = json.egresos.map(e => `
                <tr class="border-b border-slate-100 hover:bg-pink-50/30 transition-colors">
                    <td class="px-4 py-3 text-xs font-mono text-slate-500">${e.referencia}</td>
                    <td class="px-4 py-3 text-sm text-slate-700">${e.descripcion}</td>
                    <td class="px-4 py-3 text-sm text-slate-500">${e.empleado}</td>
                    <td class="px-4 py-3 text-right font-bold text-red-500 text-sm whitespace-nowrap">${fmtCOP(e.valor)}</td>
                </tr>`).join('');
        } catch (_) {
            tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-8 text-center text-red-400 text-sm">Error al cargar egresos.</td></tr>`;
        }
    };

    // ─── INIT ─────────────────────────────────────────────────────────────────
    const initCierresCaja = () => {
        pdvId = document.getElementById('cc-pdv-id')?.value;
        if (!pdvId) return;

        const inputFecha = document.getElementById('cc-fecha-input');
        if (inputFecha) {
            const fechaDeHoy = hoy();
            inputFecha.value = fechaDeHoy;
            inputFecha.max   = fechaDeHoy;
            inputFecha.addEventListener('change', (e) => cargarPorFecha(e.target.value));
        }

        initSubTabs();
        // Ocultar contenido hasta que cargue
        mostrarContenido(false);
        document.getElementById('cc-empty')?.classList.add('hidden');
        cargarPorFecha(hoy());
    };

    document.addEventListener('tabLoaded', ({ detail }) => {
        if (detail.tabId === 'cierresCaja') initCierresCaja();
    });
})();
