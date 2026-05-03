(function () {
    // ── Utilidades ───────────────────────────────────────────────────────────
    const fmt   = (n) => '$' + Math.round(n).toLocaleString('es-CO');
    const parse = (s) => parseInt(String(s).replace(/\./g, '').replace(/[^0-9]/g, ''), 10) || 0;

    const formatInput = (inp) => {
        const raw = parse(inp.value);
        inp.value = raw === 0 ? '' : Math.round(raw).toLocaleString('es-CO');
    };

    // ── Estado ───────────────────────────────────────────────────────────────
    let dataSistema  = null;
    let empleadoId   = null;
    let empleadoNombre = null;

    // ── Referencias DOM ──────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);

    const sVentas   = $('cc-s-ventas');
    const sBase     = $('cc-s-base');
    const sEgresos  = $('cc-s-egresos');
    const sEfectivo = $('cc-s-efectivo');
    const sMedios   = $('cc-s-medios');
    const sCredito  = $('cc-s-credito');

    const oBase     = $('cc-o-base');
    const oEgresos  = $('cc-o-egresos');
    const oEfectivo = $('cc-o-efectivo');
    const oMedios   = $('cc-o-medios');
    const oCredito  = $('cc-o-credito');

    const codEmpleado  = $('cc-codigo-empleado');
    const btnValidar   = $('cc-btn-validar');
    const btnCerrar    = $('cc-btn-cerrar');
    const empleadoInfo = $('cc-empleado-info');
    const nota         = $('cc-nota');

    // ── Acordeones ───────────────────────────────────────────────────────────
    const initAcordeon = (btnId, panelId, iconId) => {
        const btn   = $(btnId);
        const panel = $(panelId);
        const icon  = $(iconId);
        if (!btn) return;
        btn.addEventListener('click', () => {
            const open = !panel.classList.contains('hidden');
            panel.classList.toggle('hidden', open);
            icon.style.transform = open ? '' : 'rotate(180deg)';
        });
    };
    initAcordeon('cc-toggle-egresos',  'cc-acordeon-egresos',  'cc-icon-egresos');
    initAcordeon('cc-toggle-medios',   'cc-acordeon-medios',   'cc-icon-medios');
    initAcordeon('cc-toggle-credito',  'cc-acordeon-credito',  'cc-icon-credito');

    // ── Fila de acordeón ────────────────────────────────────────────────────
    const buildRow = (tx) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 hover:bg-slate-50';
        tr.innerHTML = `
            <td class="py-1.5 px-2">
                <button class="text-pink-500 underline text-xs hover:text-pink-700 font-medium"
                    onclick="window.open('/store/facturas/${tx.idFacturaCliente}/tirilla','_blank')">
                    ${tx.nroFactura}
                </button>
            </td>
            <td class="py-1.5 px-2 text-slate-600 text-xs">${tx.entidad}</td>
            <td class="py-1.5 px-2 text-slate-500 text-xs">${tx.referencia}</td>
            <td class="py-1.5 px-2 text-right font-mono text-xs font-semibold text-slate-700">${fmt(tx.valor)}</td>`;
        return tr;
    };

    // ── Cargar datos del sistema ──────────────────────────────────────────────
    const cargarDatos = async () => {
        try {
            const r = await fetch('/store/storebehivors/caja/datos');
            const d = await r.json();
            if (!d.success) {
                $('cc-apertura-info').textContent = d.mensaje || 'No hay caja abierta.';
                return;
            }
            dataSistema = d;

            // Header info
            $('cc-apertura-info').textContent =
                `Abierta por: ${d.caja.empleadoApertura} • Base: ${fmt(d.caja.cajaMenor)}`;

            // Sistema
            sVentas.textContent   = fmt(d.totales.ventas);
            sBase.textContent     = fmt(d.caja.cajaMenor);
            sEgresos.textContent  = `-${fmt(d.totales.egresos)}`;
            sEfectivo.textContent = fmt(d.totales.efectivo);
            sMedios.textContent   = fmt(d.totales.mediosElectronicos);
            sCredito.textContent  = fmt(d.totales.credito);

            // Default operador
            oBase.value = Math.round(d.caja.cajaMenor).toLocaleString('es-CO');

            // Acordeón — egresos
            const tbodyE = $('cc-tbody-egresos');
            if (!d.txEgresos || d.txEgresos.length === 0) {
                tbodyE.innerHTML = '<tr><td colspan="3" class="py-2 px-2 text-xs text-slate-400 text-center">Sin egresos</td></tr>';
            } else {
                d.txEgresos.forEach(e => {
                    const tr = document.createElement('tr');
                    tr.className = 'border-b border-slate-100';
                    tr.innerHTML = `
                        <td class="py-1.5 px-2 text-slate-600 text-xs">${e.referencia}</td>
                        <td class="py-1.5 px-2 text-slate-500 text-xs">${e.descripcion}</td>
                        <td class="py-1.5 px-2 text-right font-mono text-xs font-semibold text-rose-600">${fmt(e.valor)}</td>`;
                    tbodyE.appendChild(tr);
                });
            }

            // Acordeón — medios
            const tbodyM = $('cc-tbody-medios');
            if (d.txElectronicos.length === 0) {
                tbodyM.innerHTML = '<tr><td colspan="4" class="py-2 px-2 text-xs text-slate-400 text-center">Sin transacciones</td></tr>';
            } else {
                d.txElectronicos.forEach(tx => tbodyM.appendChild(buildRow(tx)));
            }

            // Acordeón — crédito
            const tbodyC = $('cc-tbody-credito');
            if (d.txCredito.length === 0) {
                tbodyC.innerHTML = '<tr><td colspan="4" class="py-2 px-2 text-xs text-slate-400 text-center">Sin transacciones</td></tr>';
            } else {
                d.txCredito.forEach(tx => tbodyC.appendChild(buildRow(tx)));
            }

            comparar();
        } catch (_) {
            $('cc-apertura-info').textContent = 'Error al cargar datos.';
        }
    };

    // ── Formateo y comparación en tiempo real ─────────────────────────────────
    const ALERT_CLASS   = 'border-red-400 bg-red-50 text-red-700 focus:ring-red-300/40';
    const NORMAL_CLASS  = 'border-slate-200 bg-white text-slate-800 focus:ring-pink-300/40';

    const comparar = () => {
        if (!dataSistema) return;
        const pares = [
            { inp: oBase,     sys: dataSistema.caja.cajaMenor },
            { inp: oEgresos,  sys: dataSistema.totales.egresos },
            { inp: oEfectivo, sys: dataSistema.totales.efectivo },
            { inp: oMedios,   sys: dataSistema.totales.mediosElectronicos },
            { inp: oCredito,  sys: dataSistema.totales.credito },
        ];
        for (const { inp, sys } of pares) {
            const val    = parse(inp.value);
            const vacio  = inp.value.trim() === '';
            const diff   = !vacio && Math.abs(val - sys) > 0.5;
            inp.classList.remove(...ALERT_CLASS.split(' '), ...NORMAL_CLASS.split(' '));
            inp.classList.add(...(diff ? ALERT_CLASS : NORMAL_CLASS).split(' '));
        }
    };

    // Inputs: formateo al blur y comparación al input
    [oBase, oEgresos, oEfectivo, oMedios, oCredito].forEach(inp => {
        inp.addEventListener('keydown', (e) => {
            const ok = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Enter','Home','End'];
            if (!ok.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault();
        });
        inp.addEventListener('input', comparar);
        inp.addEventListener('blur', () => { formatInput(inp); comparar(); });
    });

    // ── Validar empleado ──────────────────────────────────────────────────────
    const setEmpInfo = (txt, ok) => {
        empleadoInfo.textContent = txt;
        empleadoInfo.className = ok
            ? 'text-xs mt-1.5 h-4 text-green-600 font-medium'
            : 'text-xs mt-1.5 h-4 text-red-500';
    };

    btnValidar.addEventListener('click', async () => {
        const codigo = codEmpleado.value.trim().toUpperCase();
        if (!codigo) { setEmpInfo('Ingresa el código', false); return; }

        try {
            const r = await fetch(`/store/json/personal/codigo/${encodeURIComponent(codigo)}`);
            const d = await r.json();
            if (d.success) {
                empleadoId     = d.idEmpleado;
                empleadoNombre = d.nombre;
                setEmpInfo(d.nombre, true);
                btnCerrar.disabled = false;
            } else {
                empleadoId = null;
                setEmpInfo('Empleado no encontrado en esta tienda', false);
                btnCerrar.disabled = true;
            }
        } catch (_) {
            setEmpInfo('Error al verificar', false);
        }
    });

    codEmpleado.addEventListener('input', () => {
        empleadoId = null;
        btnCerrar.disabled = true;
        setEmpInfo('', false);
    });

    // ── Cerrar caja ───────────────────────────────────────────────────────────
    btnCerrar.addEventListener('click', async () => {
        if (!dataSistema || !empleadoId) return;

        const oE  = parse(oEgresos.value);
        const oEf = parse(oEfectivo.value);
        const oM  = parse(oMedios.value);
        const oCr = parse(oCredito.value);
        const oB  = parse(oBase.value);

        const { result } = await Swal.fire({
            icon: 'question',
            title: '¿Cerrar esta caja?',
            html: `
                <div style="text-align:left;font-size:13px;line-height:1.8">
                    <strong>Estás seguro de cerrar esta caja con los siguientes valores:</strong><br><br>
                    <table style="width:100%;border-collapse:collapse">
                        <tr style="border-bottom:1px solid #eee">
                            <td style="padding:2px 6px;color:#888">Concepto</td>
                            <td style="padding:2px 6px;text-align:right;color:#888">Sistema</td>
                            <td style="padding:2px 6px;text-align:right;color:#888">Registrado</td>
                        </tr>
                        ${buildConfirmRow('Egresos', dataSistema.totales.egresos, oE)}
                        ${buildConfirmRow('Efectivo', dataSistema.totales.efectivo, oEf)}
                        ${buildConfirmRow('Medios Elect.', dataSistema.totales.mediosElectronicos, oM)}
                        ${buildConfirmRow('Crédito', dataSistema.totales.credito, oCr)}
                        ${buildConfirmRow('Base', dataSistema.caja.cajaMenor, oB)}
                    </table>
                    <br><em style="font-size:11px;color:#999">Vendedor autorizado: ${empleadoNombre}</em>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Sí, cerrar caja',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#EC5FA3',
            cancelButtonColor: '#94a3b8',
            width: '480px'
        });

        if (!result.isConfirmed) return;

        btnCerrar.disabled = true;
        btnCerrar.querySelector('span').textContent = 'Cerrando...';

        // Abrir ventana ANTES del await para evitar el popup-blocker
        const pdfWin = window.open('about:blank', '_blank');

        const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
        try {
            const r = await fetch('/store/storebehivors/caja/cerrar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({
                    codigoEmpleado:       codEmpleado.value.trim().toUpperCase(),
                    operadorEgresos:      oE,
                    operadorEfectivo:     oEf,
                    operadorElectronicos: oM,
                    operadorCredito:      oCr,
                    operadorBase:         oB,
                    nota:                 nota.value.trim() || null
                })
            });

            const d = await r.json().catch(() => ({}));

            if (!r.ok || !d.success) {
                pdfWin.close();
                Swal.fire({ icon: 'error', title: 'Error', text: d.mensaje || 'Error al cerrar caja.', confirmButtonColor: '#EC5FA3' });
                btnCerrar.disabled = false;
                btnCerrar.querySelector('span').textContent = 'Cerrar e imprimir cuadre de caja';
                return;
            }

            // Navegar la ventana ya abierta al PDF (GET — sin bloqueo de popup)
            pdfWin.location.href = `/store/storebehivors/caja/${d.idCajaTienda}/pdf`;
            window.location.href = '/store';
        } catch (_) {
            pdfWin.close();
            Swal.fire({ icon: 'error', title: 'Error de conexión', confirmButtonColor: '#EC5FA3' });
            btnCerrar.disabled = false;
            btnCerrar.querySelector('span').textContent = 'Cerrar e imprimir cuadre de caja';
        }
    });

    // ── Helper fila tabla confirmación ────────────────────────────────────────
    function buildConfirmRow(label, sys, op) {
        const diff = Math.abs(sys - op) > 0.5;
        const color = diff ? 'color:#ef4444;font-weight:bold' : 'color:#334155';
        const icon  = diff ? ' ✗' : '';
        return `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:3px 6px;${color}">${label}${icon}</td>
            <td style="padding:3px 6px;text-align:right">${fmt(sys)}</td>
            <td style="padding:3px 6px;text-align:right;${color}">${fmt(op)}</td>
        </tr>`;
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', cargarDatos);
})();
