(function () {
    'use strict';

    const hoy = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };
    const fmtCOP = (n) => `$${Math.round(parseFloat(n) || 0).toLocaleString('es-CO')}`;

    const fmtFechaHora = (fecha, hora) => {
        if (!fecha) return '—';
        const [y, m, d] = fecha.split('-');
        const h = hora ? ` ${hora.slice(0, 5)}` : '';
        return `${d}/${m}/${y}${h}`;
    };

    // ─── ESTADO LOCAL ─────────────────────────────────────────────────────────
    let pdvId        = null;
    let fechaActual  = hoy();
    let paginaActual = 1;

    // ─── ROW HTML ─────────────────────────────────────────────────────────────
    const facturaRow = (f) => {
        return `
            <tr class="border-b border-slate-100 hover:bg-pink-50/30 transition-colors">
                <td class="px-4 py-3 font-mono text-xs font-bold text-slate-700">${f.nroFactura}</td>
                <td class="px-4 py-3">
                    <p class="text-sm font-medium text-slate-800">${f.cliente}</p>
                    <p class="text-xs text-slate-400">${f.docCliente}</p>
                </td>
                <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${fmtFechaHora(f.fechaEmision, f.horaEmision)}</td>
                <td class="px-4 py-3 text-right font-bold text-slate-800 text-sm whitespace-nowrap">${fmtCOP(f.total)}</td>
                <td class="px-4 py-3 text-center">
                    <a href="/admin/api/factura/${f.idFacturaCliente}/tirilla" target="_blank"
                       class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-600 transition-colors"
                       title="Ver tirilla PDF">
                        <i class="fi fi-rr-file-pdf text-sm"></i>
                    </a>
                </td>
            </tr>`;
    };

    // ─── CARGAR TABLA ─────────────────────────────────────────────────────────
    const cargarFacturas = async (pagina = 1) => {
        paginaActual = pagina;
        const tbody = document.getElementById('billing-tbody');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400 text-sm">
            <i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando...</td></tr>`;

        try {
            const params = new URLSearchParams({ fecha: fechaActual, pagina });
            const res    = await fetch(`/admin/api/tiendas/${pdvId}/facturas?${params}`);
            const json   = await res.json();

            if (!json.success) {
                tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-red-400 text-sm">Error al cargar facturas.</td></tr>`;
                return;
            }

            if (!json.facturas.length) {
                tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-10 text-center text-slate-400 text-sm">
                    <i class="fi fi-rr-receipt mr-2"></i>Sin facturas para esta fecha.</td></tr>`;
                document.getElementById('billing-paginacion').innerHTML = '';
                return;
            }

            tbody.innerHTML = json.facturas.map(facturaRow).join('');
            generarPaginacion('#billing-paginacion', json.totalPaginas, json.paginaActual, cargarFacturas);
        } catch (_) {
            tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-red-400 text-sm">Error de red.</td></tr>`;
        }
    };

    // ─── EXPORTAR A EXCEL ─────────────────────────────────────────────────────
    // El archivo lo arma el servidor con ExcelJS y baja por streaming, igual que el
    // informe de movimientos de caja. Antes se generaba acá con SheetJS traído de un CDN:
    // eso obligaba a bajar todas las facturas como JSON al navegador, no permitía dar
    // formato a la hoja, y sumaba una dependencia externa cargada en caliente.
    const exportarExcel = () => {
        const params = new URLSearchParams({ fecha: fechaActual });
        window.location.href = `/admin/api/tiendas/${pdvId}/facturas/export?${params}`;
    };

    // ─── BOTONES VER CUADRE ───────────────────────────────────────────────────
    const fmtHora = (iso) => {
        if (!iso) return '';
        return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    const cargarBotonesCuadre = async () => {
        const cont = document.getElementById('billing-cuadre-btns');
        if (!cont) return;
        cont.innerHTML = '';

        try {
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/cajas-cerradas?fecha=${fechaActual}`);
            const json = await res.json();
            if (!json.success || !json.cajas.length) return;

            json.cajas.forEach((c, i) => {
                const label = json.cajas.length > 1
                    ? `Ver cuadre #${i + 1} (${fmtHora(c.apertura)} – ${fmtHora(c.cierre)})`
                    : `Ver cuadre (${fmtHora(c.apertura)} – ${fmtHora(c.cierre)})`;

                const a = document.createElement('a');
                a.href   = `/admin/tiendas/${pdvId}/cuadre/${c.idCajaTienda}/pdf`;
                a.target = '_blank';
                a.className = 'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white transition-all active:scale-95';
                a.style.background = '#EC5FA3';
                a.innerHTML = `<i class="fi fi-rr-print"></i> ${label}`;
                cont.appendChild(a);
            });
        } catch (_) {}
    };

    // ─── BOTÓN AUTORIZAR FACTURAS EXTEMPORÁNEAS ───────────────────────────────
    let _cajasAbiertas = [];

    const cargarBotonExtemporanea = async () => {
        const cont = document.getElementById('billing-cuadre-btns');
        if (!cont) return;

        // Limpiar botón previo si existe
        const prevBtn = document.getElementById('btn-autorizar-extemporanea');
        if (prevBtn) prevBtn.remove();

        try {
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/cajas-abiertas?fecha=${fechaActual}`);
            const json = await res.json();
            if (!json.success || !json.cajas.length || !json.tienePermiso) return;

            // Solo mostrar si hay cajas SIN autorización activa
            const cajasParaAutorizar = json.cajas.filter(c => !c.tieneExtemporanea);
            if (!cajasParaAutorizar.length) return;

            _cajasAbiertas = cajasParaAutorizar;

            const btn = document.createElement('button');
            btn.id        = 'btn-autorizar-extemporanea';
            btn.className = 'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white transition-all active:scale-95';
            btn.style.background = '#f59e0b';
            btn.innerHTML = '<i class="fi fi-rr-clock-five"></i> Autorizar Facturas Extemporáneas';
            btn.addEventListener('click', abrirModalExtemporanea);
            cont.appendChild(btn);
        } catch (_) {}
    };

    const abrirModalExtemporanea = () => {
        const modal    = document.getElementById('modal-extemporanea');
        const select   = document.getElementById('ext-caja-select');
        const errMsg   = document.getElementById('ext-error-msg');
        if (!modal || !select) return;

        // Poblar select de cajas
        select.innerHTML = '<option value="" disabled selected>Selecciona una caja...</option>';
        _cajasAbiertas.forEach(c => {
            const opt   = document.createElement('option');
            opt.value   = c.idCajaTienda;
            opt.textContent = `${c.codigo} — ${fmtHora(c.fechaApertura)} (${c.empleadoApertura || 'Sin empleado'})`;
            select.appendChild(opt);
        });

        document.getElementById('ext-cantidad').value        = '';
        document.getElementById('ext-codigo-empleado').value = '';
        errMsg.textContent = '';
        errMsg.classList.add('hidden');
        modal.classList.remove('hidden');
    };

    const cerrarModalExtemporanea = () => {
        document.getElementById('modal-extemporanea')?.classList.add('hidden');
    };

    const confirmarExtemporanea = async () => {
        const idCajaTienda    = document.getElementById('ext-caja-select')?.value;
        const cantidadFacturas = document.getElementById('ext-cantidad')?.value;
        const codigoEmpleado  = document.getElementById('ext-codigo-empleado')?.value;
        const errMsg          = document.getElementById('ext-error-msg');
        const btnConfirmar    = document.getElementById('btn-confirmar-extemporanea');

        if (!idCajaTienda || !cantidadFacturas || !codigoEmpleado) {
            errMsg.textContent = 'Todos los campos son obligatorios.';
            errMsg.classList.remove('hidden');
            return;
        }

        const csrf = document.getElementById('billing-csrf-token')?.value || '';

        btnConfirmar.disabled = true;
        btnConfirmar.textContent = 'Autorizando...';
        errMsg.classList.add('hidden');

        try {
            const res  = await fetch(`/admin/api/tiendas/${pdvId}/autorizar-factura-extemporanea`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrf },
                body:    JSON.stringify({ idCajaTienda, cantidadFacturas: parseInt(cantidadFacturas), codigoEmpleado })
            });
            const json = await res.json();

            if (!json.success) {
                errMsg.textContent = json.mensaje || 'Error al autorizar.';
                errMsg.classList.remove('hidden');
                btnConfirmar.disabled = false;
                btnConfirmar.textContent = 'Autorizar';
                return;
            }

            cerrarModalExtemporanea();
            // Ocultar el botón de autorizar (cupo ya asignado)
            document.getElementById('btn-autorizar-extemporanea')?.remove();
        } catch (_) {
            errMsg.textContent = 'Error de conexión.';
            errMsg.classList.remove('hidden');
            btnConfirmar.disabled = false;
            btnConfirmar.textContent = 'Autorizar';
        }
    };

    const initModalExtemporanea = () => {
        document.getElementById('btn-cerrar-modal-extemporanea')
            ?.addEventListener('click', cerrarModalExtemporanea);
        document.getElementById('btn-cancelar-extemporanea')
            ?.addEventListener('click', cerrarModalExtemporanea);
        document.getElementById('btn-confirmar-extemporanea')
            ?.addEventListener('click', confirmarExtemporanea);
        document.getElementById('modal-extemporanea')
            ?.addEventListener('click', (e) => { if (e.target === e.currentTarget) cerrarModalExtemporanea(); });
    };

    // ─── INICIALIZAR (llamado cuando el tab se carga en el DOM) ───────────────
    const initBilling = () => {
        pdvId = document.getElementById('billing-pdv-id')?.value;
        if (!pdvId) return;

        // Fecha por defecto: hoy
        const inputFecha = document.getElementById('billing-fecha');
        const fechaHoy = hoy();
        const tabBtn   = document.getElementById('facturacionHoy');

        const actualizarNombreTab = (fecha) => {
            if (!tabBtn) return;
            if (fecha === fechaHoy) {
                tabBtn.textContent = 'Facturación de hoy';
            } else {
                const [y, m, d] = fecha.split('-');
                tabBtn.textContent = `Facturación del ${d}/${m}/${y}`;
            }
        };

        if (inputFecha) {
            inputFecha.value = fechaActual;
            inputFecha.max   = fechaHoy;
            inputFecha.addEventListener('change', (e) => {
                fechaActual = e.target.value;
                actualizarNombreTab(fechaActual);
                cargarFacturas(1);
                cargarBotonesCuadre();
                cargarBotonExtemporanea();
            });
        }

        // Botón exportar
        const btnExport = document.getElementById('billing-export');
        if (btnExport) btnExport.addEventListener('click', exportarExcel);

        initModalExtemporanea();
        cargarFacturas(1);
        cargarBotonesCuadre();
        cargarBotonExtemporanea();
    };

    // ─── ESCUCHAR EVENTO DE TAB CARGADO ──────────────────────────────────────
    document.addEventListener('tabLoaded', ({ detail }) => {
        if (detail.tabId === 'facturacionHoy') initBilling();
    });

})();
