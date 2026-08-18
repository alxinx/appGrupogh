(function () {
    // ── Utilidades ───────────────────────────────────────────────────────────
    const fmt   = (n) => '$' + Math.round(n).toLocaleString('es-CO');
    const parse = (s) => parseInt(String(s).replace(/\./g, '').replace(/[^0-9]/g, ''), 10) || 0;

    const formatInput = (inp) => {
        const raw = parse(inp.value);
        inp.value = raw === 0 ? '' : Math.round(raw).toLocaleString('es-CO');
    };

    // Formatea mientras el usuario escribe preservando la posición del cursor
    const formatInputLive = (inp) => {
        const oldVal = inp.value;
        const start  = inp.selectionStart;

        // Contar dígitos antes del cursor en el valor actual
        const digitsAntes = oldVal.slice(0, start).replace(/[^0-9]/g, '').length;

        const raw    = parse(oldVal);
        const newVal = raw === 0 ? '' : Math.round(raw).toLocaleString('es-CO');
        if (newVal === oldVal) return;
        inp.value = newVal;

        // Restaurar cursor: avanzar hasta haber contado los mismos dígitos
        let cnt = 0, newPos = newVal.length;
        for (let i = 0; i < newVal.length; i++) {
            if (/\d/.test(newVal[i])) cnt++;
            if (cnt === digitsAntes) { newPos = i + 1; break; }
        }
        if (digitsAntes === 0) newPos = 0;
        inp.setSelectionRange(newPos, newPos);
    };

    // ── Estado ───────────────────────────────────────────────────────────────
    let dataSistema  = null;
    let empleadoId   = null;
    let empleadoNombre = null;

    // ── Referencias DOM ──────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);

    const sVentas   = $('cc-s-ventas');
    // Un egreso por transferencia no mueve el cajón: se distingue a simple vista.
    const etiquetaMedio = (e) => e.metodoPago === 'Electronico'
        ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 whitespace-nowrap">${e.entidad || 'Transferencia'}</span>`
        : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 whitespace-nowrap">Cajón</span>`;

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

    const codEmpleado    = $('cc-codigo-empleado');
    const btnCerrar      = $('cc-btn-cerrar');
    const empleadoInfo   = $('cc-empleado-info');
    const nota           = $('cc-nota');
    const cardDescuadre  = $('cc-card-descuadre');
    const checkDescuadre = $('cc-check-descuadre');

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
    initAcordeon('cc-toggle-efectivo', 'cc-acordeon-efectivo', 'cc-icon-efectivo');
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

            // Efectivo que debería estar en el cajón. Antes esta cuenta la hacía el
            // vendedor de cabeza; ahora sale del backend con el mismo criterio.
            const elEsp = $('cc-s-esperado');
            if (elEsp) {
                elEsp.textContent = fmt(d.totales.efectivoEsperado);
                $('cc-s-esperado-detalle').textContent =
                    `Base ${fmt(d.caja.cajaMenor)} + ventas en efectivo ${fmt(d.totales.efectivo)} − egresos en efectivo ${fmt(d.totales.egresosEfectivo)}`;
            }

            // Acordeón — egresos
            const tbodyE = $('cc-tbody-egresos');
            if (!d.txEgresos || d.txEgresos.length === 0) {
                tbodyE.innerHTML = '<tr><td colspan="4" class="py-2 px-2 text-xs text-slate-400 text-center">Sin egresos</td></tr>';
            } else {
                d.txEgresos.forEach(e => {
                    const tr = document.createElement('tr');
                    tr.className = 'border-b border-slate-100';
                    tr.innerHTML = `
                        <td class="py-1.5 px-2 text-xs">
                            <a href="/store/storebehivors/expenses/${e.idEgreso}/pdf" target="_blank"
                               class="text-pink-500 underline hover:text-pink-700 font-medium">${e.referencia}</a>
                        </td>
                        <td class="py-1.5 px-2 text-slate-500 text-xs">${e.descripcion}</td>
                        <td class="py-1.5 px-2 text-center">${etiquetaMedio(e)}</td>
                        <td class="py-1.5 px-2 text-right font-mono text-xs font-semibold text-rose-600">${fmt(e.valor)}</td>`;
                    tbodyE.appendChild(tr);
                });
            }

            // El desglose deja claro cuánto de los egresos salió del cajón y cuánto no.
            const desglose = $('cc-egresos-desglose');
            if (desglose && d.totales.egresos > 0) {
                desglose.textContent = d.totales.egresosElectronicos > 0
                    ? `Del cajón salieron ${fmt(d.totales.egresosEfectivo)}; ${fmt(d.totales.egresosElectronicos)} se pagaron por transferencia y no afectan el efectivo.`
                    : `Todos los egresos salieron del cajón.`;
                desglose.classList.remove('hidden');
            }

            // Acordeón — efectivo
            const tbodyEf = $('cc-tbody-efectivo');
            if (d.txEfectivo.length === 0) {
                tbodyEf.innerHTML = '<tr><td colspan="4" class="py-2 px-2 text-xs text-slate-400 text-center">Sin transacciones</td></tr>';
            } else {
                d.txEfectivo.forEach(tx => tbodyEf.appendChild(buildRow(tx)));
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
        let hayDescuadre = false;
        for (const { inp, sys } of pares) {
            const val    = parse(inp.value);
            const vacio  = inp.value.trim() === '';
            const diff   = !vacio && Math.abs(val - sys) > 0.5;
            if (diff) hayDescuadre = true;
            inp.classList.remove(...ALERT_CLASS.split(' '), ...NORMAL_CLASS.split(' '));
            inp.classList.add(...(diff ? ALERT_CLASS : NORMAL_CLASS).split(' '));
        }
        toggleDescuadre(hayDescuadre);
    };

    // ── Checkbox de responsabilidad por descuadre ─────────────────────────────
    const toggleDescuadre = (hayDescuadre) => {
        if (!cardDescuadre) return;
        cardDescuadre.classList.toggle('hidden', !hayDescuadre);
        cardDescuadre.classList.toggle('flex',   hayDescuadre);
        if (!hayDescuadre) checkDescuadre.checked = false;
        actualizarBotonCerrar();
    };

    // Inputs: formateo en tiempo real + comparación
    [oBase, oEgresos, oEfectivo, oMedios, oCredito].forEach(inp => {
        inp.addEventListener('keydown', (e) => {
            const ok = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Enter','Home','End'];
            if (!ok.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault();
        });
        inp.addEventListener('input', () => { formatInputLive(inp); comparar(); });
        inp.addEventListener('blur',  () => { formatInput(inp);     comparar(); });
    });

    // ── Validar empleado ──────────────────────────────────────────────────────
    const setEmpInfo = (txt, ok) => {
        empleadoInfo.textContent = txt;
        empleadoInfo.className = ok
            ? 'text-xs mt-1.5 h-4 text-green-600 font-medium'
            : 'text-xs mt-1.5 h-4 text-red-500';
    };

    let validarTimer = null;
    let empleadoOk    = false;

    // Habilita "Cerrar caja" solo si el empleado quedó validado y, en caso de
    // descuadre, el responsable marcó la casilla de aceptación.
    const actualizarBotonCerrar = () => {
        const descuadreOk = !cardDescuadre || cardDescuadre.classList.contains('hidden') || checkDescuadre.checked;
        btnCerrar.disabled = !empleadoOk || !descuadreOk;
    };

    checkDescuadre?.addEventListener('change', actualizarBotonCerrar);

    const validarEmpleado = async () => {
        const codigo = codEmpleado.value.trim().toUpperCase();
        if (!codigo) { setEmpInfo('', false); return; }
        setEmpInfo('Verificando...', false);
        try {
            const r = await fetch(`/store/json/personal/validar/${encodeURIComponent(codigo)}?accion=EDIT`);
            const d = await r.json();
            if (d.success) {
                empleadoId     = d.idEmpleado;
                empleadoNombre = d.nombre;
                setEmpInfo(d.nombre, true);
                empleadoOk = true;
            } else {
                empleadoId = null;
                setEmpInfo(d.mensaje || 'No pertenece a esta tienda', false);
                empleadoOk = false;
            }
        } catch (_) {
            setEmpInfo('Error al verificar', false);
            empleadoOk = false;
        }
        actualizarBotonCerrar();
    };

    codEmpleado.addEventListener('input', () => {
        empleadoId = null;
        clearTimeout(validarTimer);
        const codigo = codEmpleado.value.trim();
        // Se habilita de forma optimista por longitud; la validación asíncrona
        // (debounce) confirma o revoca el acceso al terminar.
        empleadoOk = codigo.length >= 2;
        actualizarBotonCerrar();
        if (codigo.length >= 2) {
            setEmpInfo('Verificando...', false);
            validarTimer = setTimeout(validarEmpleado, 600);
        } else {
            setEmpInfo('', false);
        }
    });

    codEmpleado.addEventListener('blur', () => {
        clearTimeout(validarTimer);
        if (codEmpleado.value.trim()) validarEmpleado();
    });

    // ── Cerrar caja ───────────────────────────────────────────────────────────
    btnCerrar.addEventListener('click', async () => {
        if (!dataSistema) return;
        if (!codEmpleado.value.trim()) { setEmpInfo('Ingresa el código de empleado', false); return; }
        if (cardDescuadre && !cardDescuadre.classList.contains('hidden') && !checkDescuadre.checked) {
            Swal.fire({
                icon: 'warning',
                title: 'Confirma el descuadre',
                text: 'Debes marcar la casilla de responsabilidad antes de cerrar la caja.',
                confirmButtonColor: '#EC5FA3'
            });
            return;
        }

        const oE  = parse(oEgresos.value);
        const oEf = parse(oEfectivo.value);
        const oM  = parse(oMedios.value);
        const oCr = parse(oCredito.value);
        const oB  = parse(oBase.value);

        const swalResult = await Swal.fire({
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
                    <br><em style="font-size:11px;color:#999">Vendedor: ${empleadoNombre || codEmpleado.value.trim().toUpperCase()}</em>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Sí, cerrar caja',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#EC5FA3',
            cancelButtonColor: '#94a3b8',
            width: '480px'
        });

        if (!swalResult.isConfirmed) return;

        btnCerrar.disabled = true;
        btnCerrar.querySelector('span').textContent = 'Cerrando...';

        // Abrir ventana ANTES del await para evitar el popup-blocker
        const pdfWin = window.open('about:blank', '_blank');

        const csrf = document.getElementById('csrf-token')?.value || '';
        try {
            const r = await fetch('/store/storebehivors/caja/cerrar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({
                    idCajaTienda:         dataSistema.caja.idCajaTienda,
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

            if (r.status === 403) {
                pdfWin.close();
                Swal.fire({
                    icon: 'warning',
                    title: 'Sin permiso',
                    text: d.mensaje || 'No tienes permiso para cerrar la caja.',
                    confirmButtonColor: '#EC5FA3'
                });
                btnCerrar.disabled = false;
                btnCerrar.querySelector('span').textContent = 'Cerrar e imprimir cuadre de caja';
                return;
            }

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

    // ── Modal: egreso olvidado ────────────────────────────────────────────────
    const abrirModalEgreso = async () => {
        const { value: resultado, isConfirmed } = await Swal.fire({
            title: 'Registrar Egreso Olvidado',
            html: `
                <div style="text-align:left;display:flex;flex-direction:column;gap:12px">
                    <div>
                        <label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Valor *</label>
                        <div style="position:relative;margin-top:4px">
                            <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;font-weight:bold;pointer-events:none">$</span>
                            <input id="me-valor" type="text" inputmode="numeric" placeholder="0"
                                style="width:100%;padding:8px 12px 8px 24px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:monospace;box-sizing:border-box">
                        </div>
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Referencia</label>
                        <input id="me-referencia" type="text" maxlength="100" placeholder="Ej: EG-001"
                            style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;margin-top:4px;box-sizing:border-box">
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Descripción</label>
                        <input id="me-descripcion" type="text" maxlength="200" placeholder="Motivo del egreso"
                            style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;margin-top:4px;box-sizing:border-box">
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Código del vendedor *</label>
                        <input id="me-codigo" type="password" maxlength="10" placeholder="• • • • • •"
                            style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:monospace;letter-spacing:.15em;margin-top:4px;box-sizing:border-box">
                    </div>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Registrar egreso',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#EC5FA3',
            cancelButtonColor: '#94a3b8',
            width: '420px',
            didOpen: () => {
                const inp = document.getElementById('me-valor');
                inp.addEventListener('keydown', (e) => {
                    const ok = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Enter','Home','End'];
                    if (!ok.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault();
                });
                inp.addEventListener('input', () => formatInputLive(inp));
                inp.addEventListener('blur',  () => formatInput(inp));
                inp.focus();
            },
            preConfirm: async () => {
                const valor      = parse(document.getElementById('me-valor').value);
                const referencia = document.getElementById('me-referencia').value.trim();
                const descripcion = document.getElementById('me-descripcion').value.trim();
                const codigo     = document.getElementById('me-codigo').value.trim().toUpperCase();

                if (!valor || valor <= 0) { Swal.showValidationMessage('Ingresa un valor mayor a 0'); return false; }
                if (!codigo)              { Swal.showValidationMessage('Ingresa el código del vendedor'); return false; }

                const csrf = document.getElementById('csrf-token')?.value || '';
                const r = await fetch('/store/storebehivors/expenses/crear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                    body: JSON.stringify({ valorEgreso: valor, referencia, descripcion, codigoEmpleado: codigo })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || !d.success) { Swal.showValidationMessage(d.mensaje || 'Error al registrar el egreso'); return false; }
                return { valor, referencia, descripcion, idEgreso: d.idEgreso, nombreEmpleado: d.nombreEmpleado };
            }
        });

        if (!isConfirmed || !resultado) return;

        // Actualizar totales en caliente
        dataSistema.totales.egresos = (dataSistema.totales.egresos || 0) + resultado.valor;
        sEgresos.textContent = `-${fmt(dataSistema.totales.egresos)}`;

        // Agregar fila al acordeón (quita el placeholder "Sin egresos" si existe)
        const tbodyE = $('cc-tbody-egresos');
        const placeholder = tbodyE.querySelector('td[colspan="3"]');
        if (placeholder) placeholder.closest('tr').remove();
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100';
        tr.innerHTML = `
            <td class="py-1.5 px-2 text-xs">
                <a href="/store/storebehivors/expenses/${resultado.idEgreso}/pdf" target="_blank"
                   class="text-pink-500 underline hover:text-pink-700 font-medium">${resultado.referencia || `EG-${resultado.idEgreso}`}</a>
            </td>
            <td class="py-1.5 px-2 text-slate-500 text-xs">${resultado.descripcion || '—'}</td>
            <td class="py-1.5 px-2 text-right font-mono text-xs font-semibold text-rose-600">${fmt(resultado.valor)}</td>`;
        tbodyE.insertBefore(tr, tbodyE.firstChild);

        comparar();

        Swal.fire({
            icon: 'success',
            title: 'Egreso registrado',
            text: `Se registró ${fmt(resultado.valor)}${resultado.nombreEmpleado ? ` — ${resultado.nombreEmpleado}` : ''}.`,
            confirmButtonColor: '#EC5FA3',
            timer: 3000,
            timerProgressBar: true
        });
    };

    $('cc-btn-nuevo-egreso')?.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirModalEgreso();
    });

    // ── Init ──────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', cargarDatos);
})();
