// Panel de estado de crédito de un cliente (views/administrador/customers/views/creditoCliente.pug).
// window.fmtCOP, window.initMoneyInput, window.parseMoney y el interceptor de logout de
// fetch (data.logout === true) ya los trae helpers.js; window.valorEnLetras lo trae
// numeroALetras.js — ambos cargados antes que este archivo.
document.addEventListener('DOMContentLoaded', () => {
    const datos = window.__creditoCliente || {};
    const csrfToken = () => document.querySelector('[name="_csrf"]')?.value
        || document.querySelector('meta[name="csrf-token"]')?.content
        || '';

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const mostrarError = (mensaje) => Swal.fire({ icon: 'error', title: 'No se pudo completar', text: mensaje, confirmButtonColor: '#EC5FA3' });

    const recargar = () => window.location.reload();

    // ── Dropdown "Más acciones" y menús "..." de fila: un solo patrón, se abre uno a la
    // vez y se cierra al hacer clic afuera. ──────────────────────────────────────────
    const menusAbiertos = [];
    const cerrarMenus = (excepto = null) => {
        menusAbiertos.forEach(m => { if (m !== excepto) m.classList.add('hidden'); });
    };
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#menu-mas-acciones, #btn-mas-acciones, .menu-fila, .btn-fila-mas')) cerrarMenus();
    });

    const btnMasAcciones = document.getElementById('btn-mas-acciones');
    const menuMasAcciones = document.getElementById('menu-mas-acciones');
    if (btnMasAcciones && menuMasAcciones) {
        menusAbiertos.push(menuMasAcciones);
        btnMasAcciones.addEventListener('click', (e) => {
            e.stopPropagation();
            const abrir = menuMasAcciones.classList.contains('hidden');
            cerrarMenus();
            menuMasAcciones.classList.toggle('hidden', !abrir);
        });
    }

    // La tabla de facturas vive dentro de un contenedor overflow-x-auto (para poder
    // desplazarla en pantallas angostas) — por la propia spec de CSS Overflow, fijar
    // overflow-x fuerza overflow-y a 'auto' también, así que un menú `position: absolute`
    // ahí adentro queda recortado por ese mismo contenedor. Se saca del flujo con
    // `position: fixed` calculado contra el botón y se reubica en <body>, que sí escapa
    // el recorte (fixed se ubica contra el viewport, no contra el ancestro con scroll).
    document.querySelectorAll('.btn-fila-mas').forEach(btn => {
        const menu = btn.nextElementSibling;
        if (!menu) return;
        document.body.appendChild(menu);
        menu.classList.remove('absolute', 'right-0', 'top-[calc(100%+4px)]');
        menu.style.position = 'fixed';
        menusAbiertos.push(menu);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const abrir = menu.classList.contains('hidden');
            cerrarMenus();
            if (abrir) {
                // offsetWidth solo es válido con la clase `hidden` ya quitada — medir
                // antes daría 0 (display:none) y el menú saldría pegado al borde izquierdo.
                menu.classList.remove('hidden');
                const r = btn.getBoundingClientRect();
                menu.style.top  = `${r.bottom + 4}px`;
                menu.style.left = `${r.right - menu.offsetWidth}px`;
            }
        });
    });

    // ── Verificación de código de empleado en vivo (mismo endpoint que otorgar/suspender
    // crédito en adminClientes.js — solo valida, no ejecuta nada). ─────────────────────
    const activarVerificacionCodigo = (inputId, estadoId, onVerificado) => {
        const input = document.getElementById(inputId);
        const estado = document.getElementById(estadoId);
        if (!input || !estado) return;

        const setEstado = (tipo, texto) => {
            estado.style.color = tipo === 'ok' ? '#10b981' : tipo === 'error' ? '#f43f5e' : '#94a3b8';
            estado.textContent = texto;
        };

        let timer = null;
        input.addEventListener('input', () => {
            onVerificado(null);
            const btn = Swal.getConfirmButton();
            if (btn) btn.disabled = true;
            clearTimeout(timer);
            const codigo = input.value.trim();
            if (!codigo) { setEstado('info', ''); return; }
            setEstado('info', 'Verificando código...');
            timer = setTimeout(async () => {
                try {
                    const r = await fetch('/admin/api/clientes/verificar-codigo-credito', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ codigoEmpleado: codigo, _csrf: csrfToken() })
                    });
                    const data = await r.json();
                    if (!data.success) { setEstado('error', data.mensaje || 'Código inválido.'); return; }
                    setEstado('ok', `✓ ${data.empleado?.nombre || 'Empleado verificado'}`);
                    onVerificado(data.empleado);
                    if (btn) btn.disabled = false;
                } catch (_) {
                    setEstado('error', 'No se pudo verificar el código.');
                }
            }, 400);
        });
    };

    // ── Aumentar Crédito ──────────────────────────────────────────────────────────────
    document.getElementById('btn-aumentar-credito')?.addEventListener('click', async () => {
        let empleadoVerificado = null;
        const nombre = esc(datos.nombreCliente);
        const cupoActual = window.fmtCOP(datos.valorCreditoCliente);

        const { value } = await Swal.fire({
            html: `
                <div class="gh-conf-html">
                    <div class="gh-conf-cabecera gh-conf--neutro-cabecera" style="background:#F1F5F9;">
                        <span class="gh-conf-badge" style="background:#E2E8F0;color:#334155;"><i class="fi fi-rr-arrow-trend-up" style="font-size:.625rem"></i> Aumentar crédito</span>
                        <p class="gh-conf-cuenta" style="color:#475569;margin-top:.5rem;">Cupo actual de <strong>${nombre}</strong>: ${cupoActual}</p>
                    </div>
                    <div style="padding: 1.25rem 1.75rem 0;">
                        <label for="gh-input-nuevo-cupo" style="display:block; text-align:left; font-size:12px; font-weight:600; color:#64748b; margin-bottom:8px;">
                            Nuevo valor del cupo
                        </label>
                        <div style="position:relative;">
                            <span style="position:absolute; left:18px; top:50%; transform:translateY(-50%); font-size:26px; font-weight:800; color:#10b981; pointer-events:none;">$</span>
                            <input id="gh-input-nuevo-cupo" type="text" inputmode="numeric" placeholder="0" autocomplete="off"
                                   style="width:100%; box-sizing:border-box; padding:16px 16px 16px 42px; font-size:26px; font-weight:800; color:#10b981; border:2px solid #e2e8f0; border-radius:14px; text-align:right; outline:none;" />
                        </div>
                    </div>
                    <p style="text-align:left; font-size:12px; font-weight:600; color:#64748b; margin:1.25rem 1.75rem 8px;">
                        Código del empleado que autoriza:
                    </p>
                    <div style="padding: 0 1.75rem;">
                        <input id="gh-input-codigo-aumentar" type="password" placeholder="Código de empleado" autocomplete="off"
                               style="width:100%; box-sizing:border-box; padding:12px 14px; font-size:14px; border:1px solid #cbd5e1; border-radius:10px; outline:none;" />
                    </div>
                    <p id="gh-estado-codigo-aumentar" style="text-align:left; font-size:11.5px; font-weight:600; margin:6px 1.75rem 0; min-height:14px;"></p>
                </div>`,
            didOpen: () => {
                const inputValor = document.getElementById('gh-input-nuevo-cupo');
                window.initMoneyInput?.(inputValor);
                inputValor?.focus();
                activarVerificacionCodigo('gh-input-codigo-aumentar', 'gh-estado-codigo-aumentar', (emp) => { empleadoVerificado = emp; });
                const btn = Swal.getConfirmButton();
                if (btn) btn.disabled = true;
            },
            showCancelButton: true,
            confirmButtonText: 'Continuar',
            cancelButtonText: 'Cancelar',
            reverseButtons: true,
            buttonsStyling: false,
            width: '30rem',
            customClass: {
                popup: 'gh-conf-popup gh-conf--neutro', htmlContainer: 'gh-conf-html-container',
                actions: 'gh-conf-acciones', confirmButton: 'gh-conf-btn gh-conf-confirmar', cancelButton: 'gh-conf-btn gh-conf-cancelar'
            },
            showClass: { popup: 'gh-conf-entra', backdrop: 'swal2-backdrop-show' },
            preConfirm: () => {
                const nuevoValor = window.parseMoney(document.getElementById('gh-input-nuevo-cupo').value);
                const codigoEmpleado = document.getElementById('gh-input-codigo-aumentar').value.trim();
                if (!nuevoValor || nuevoValor <= datos.valorCreditoCliente) {
                    Swal.showValidationMessage(`El nuevo cupo debe ser mayor al actual (${cupoActual}).`);
                    return false;
                }
                if (!codigoEmpleado || !empleadoVerificado) {
                    Swal.showValidationMessage('Verificá el código del empleado.');
                    return false;
                }
                return { nuevoValor, codigoEmpleado };
            }
        });
        if (!value) return;

        const enLetras = window.valorEnLetras ? esc(window.valorEnLetras(value.nuevoValor).toUpperCase()) : '';
        const { isConfirmed } = await Swal.fire({
            html: `
                <div class="gh-conf-html">
                    <div class="gh-conf-cabecera">
                        <span class="gh-conf-badge"><i class="fi fi-rr-badge-check" style="font-size:.625rem"></i> Confirmar aumento</span>
                        <p class="gh-conf-monto">${window.fmtCOP(value.nuevoValor)}</p>
                        <p class="gh-conf-cuenta">nuevo cupo de <strong>${nombre}</strong></p>
                    </div>
                    <div class="gh-conf-saldo">
                        <div class="gh-conf-saldo-bloque">
                            <span class="gh-conf-saldo-label">Cupo actual</span>
                            <span class="gh-conf-saldo-valor">${cupoActual}</span>
                        </div>
                        <i class="fi fi-rr-arrow-right gh-conf-flecha"></i>
                        <div class="gh-conf-saldo-bloque gh-conf-saldo-bloque--final">
                            <span class="gh-conf-saldo-label">Va a quedar</span>
                            <span class="gh-conf-saldo-valor">${window.fmtCOP(value.nuevoValor)}</span>
                        </div>
                    </div>
                    ${enLetras ? `<p style="text-align:left; font-size:12.5px; line-height:1.5; color:#334155; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; margin:1.125rem 1.75rem;">El nuevo cupo queda en <strong style="color:#10b981;">${enLetras}</strong>.</p>` : ''}
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Aumentar crédito',
            cancelButtonText: 'Volver',
            focusCancel: true,
            reverseButtons: true,
            buttonsStyling: false,
            width: '30rem',
            customClass: {
                popup: 'gh-conf-popup gh-conf--neutro', htmlContainer: 'gh-conf-html-container',
                actions: 'gh-conf-acciones', confirmButton: 'gh-conf-btn gh-conf-confirmar', cancelButton: 'gh-conf-btn gh-conf-cancelar'
            },
            showClass: { popup: 'gh-conf-entra', backdrop: 'swal2-backdrop-show' }
        });
        if (!isConfirmed) return;

        try {
            const r = await fetch(`/admin/api/clientes/${datos.idCliente}/credito/aumentar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ valorCreditoCliente: value.nuevoValor, codigoEmpleado: value.codigoEmpleado, _csrf: csrfToken() })
            });
            const data = await r.json();
            if (!data.success) return mostrarError(data.mensaje);
            await Swal.fire({ icon: 'success', title: 'Crédito aumentado', text: `Nuevo cupo: ${window.fmtCOP(value.nuevoValor)}.`, timer: 2200, showConfirmButton: false });
            recargar();
        } catch (_) {
            mostrarError('Error de conexión.');
        }
    });

    // ── Suspender Crédito ─────────────────────────────────────────────────────────────
    document.getElementById('btn-suspender-credito')?.addEventListener('click', async () => {
        const nombre = esc(datos.nombreCliente);
        const { value: codigoEmpleado } = await Swal.fire({
            html: `
                <div class="gh-conf-html">
                    <div class="gh-conf-cabecera">
                        <span class="gh-conf-badge"><i class="fi fi-rr-lock" style="font-size:.625rem"></i> Suspender crédito</span>
                        <p class="gh-conf-monto">Sin crédito</p>
                        <p class="gh-conf-cuenta">para <strong>${nombre}</strong></p>
                    </div>
                    <div class="gh-conf-saldo">
                        <div class="gh-conf-saldo-bloque">
                            <span class="gh-conf-saldo-label">Estado actual</span>
                            <span class="gh-conf-saldo-valor">Con crédito</span>
                        </div>
                        <i class="fi fi-rr-arrow-right gh-conf-flecha"></i>
                        <div class="gh-conf-saldo-bloque gh-conf-saldo-bloque--final">
                            <span class="gh-conf-saldo-label">Va a quedar</span>
                            <span class="gh-conf-saldo-valor">Sin crédito</span>
                        </div>
                    </div>
                    <p style="text-align:left; font-size:12px; color:#64748b; margin:1.125rem 1.75rem 4px;">
                        Código del empleado que autoriza:
                    </p>
                </div>`,
            input: 'password',
            inputPlaceholder: 'Código de empleado',
            inputAttributes: { autocomplete: 'off', 'aria-label': 'Código de empleado', style: 'margin: 0 1.75rem; width: calc(100% - 3.5rem);' },
            inputValidator: (v) => (!v || !v.trim()) && 'Ingresá el código del empleado.',
            showCancelButton: true,
            confirmButtonText: 'Suspender crédito',
            cancelButtonText: 'Volver',
            focusCancel: true,
            reverseButtons: true,
            buttonsStyling: false,
            width: '30rem',
            customClass: {
                popup: 'gh-conf-popup gh-conf--neutro', htmlContainer: 'gh-conf-html-container',
                actions: 'gh-conf-acciones', confirmButton: 'gh-conf-btn gh-conf-confirmar', cancelButton: 'gh-conf-btn gh-conf-cancelar'
            },
            showClass: { popup: 'gh-conf-entra', backdrop: 'swal2-backdrop-show' }
        });
        if (!codigoEmpleado?.trim()) return;

        try {
            const r = await fetch(`/admin/api/clientes/${datos.idCliente}/credito/suspender`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codigoEmpleado: codigoEmpleado.trim(), _csrf: csrfToken() })
            });
            const data = await r.json();
            if (!data.success) return mostrarError(data.mensaje);
            await Swal.fire({ icon: 'success', title: 'Crédito suspendido', timer: 2000, showConfirmButton: false });
            window.location.href = '/admin/clientes';
        } catch (_) {
            mostrarError('Error de conexión.');
        }
    });

    // ── Abonar a una factura puntual / Abono global — comparten el mismo modal de monto +
    // método de pago + código de empleado; solo cambia el título, el tope y el endpoint. ──
    const pedirAbono = async ({ titulo, icono, tope, nombreDestino }) => {
        let empleadoVerificado = null;
        const topeTexto = window.fmtCOP(tope);

        const { value } = await Swal.fire({
            html: `
                <div class="gh-conf-html">
                    <div class="gh-conf-cabecera" style="background:#ECFDF5;">
                        <span class="gh-conf-badge" style="background:#A7F3D0;color:#065F46;"><i class="fi ${icono}" style="font-size:.625rem"></i> ${esc(titulo)}</span>
                        <p class="gh-conf-cuenta" style="color:#047857;margin-top:.5rem;">${esc(nombreDestino)} · deuda actual: ${topeTexto}</p>
                    </div>
                    <div style="padding: 1.25rem 1.75rem 0;">
                        <label for="gh-input-valor-abono" style="display:block; text-align:left; font-size:12px; font-weight:600; color:#64748b; margin-bottom:8px;">Valor del abono</label>
                        <div style="position:relative;">
                            <span style="position:absolute; left:18px; top:50%; transform:translateY(-50%); font-size:26px; font-weight:800; color:#10b981; pointer-events:none;">$</span>
                            <input id="gh-input-valor-abono" type="text" inputmode="numeric" placeholder="0" autocomplete="off"
                                   style="width:100%; box-sizing:border-box; padding:16px 16px 16px 42px; font-size:26px; font-weight:800; color:#10b981; border:2px solid #e2e8f0; border-radius:14px; text-align:right; outline:none;" />
                        </div>
                    </div>
                    <div style="padding: 1.125rem 1.75rem 0;">
                        <label for="gh-select-metodo-abono" style="display:block; text-align:left; font-size:12px; font-weight:600; color:#64748b; margin-bottom:8px;">Método de pago</label>
                        <select id="gh-select-metodo-abono" style="width:100%; box-sizing:border-box; padding:12px 14px; font-size:14px; border:1px solid #cbd5e1; border-radius:10px; outline:none; background:#fff;">
                            <option value="Efectivo">Efectivo</option>
                            <option value="Banco">Banco</option>
                            <option value="Billetera Virtual">Billetera Virtual</option>
                            <option value="Tarjeta Credito">Tarjeta Crédito</option>
                        </select>
                    </div>
                    <div style="padding: 1.125rem 1.75rem 0;">
                        <input id="gh-input-referencia-abono" type="text" placeholder="Referencia (opcional)" autocomplete="off"
                               style="width:100%; box-sizing:border-box; padding:12px 14px; font-size:14px; border:1px solid #cbd5e1; border-radius:10px; outline:none;" />
                    </div>
                    <p style="text-align:left; font-size:12px; font-weight:600; color:#64748b; margin:1.125rem 1.75rem 8px;">Código del empleado que recibe:</p>
                    <div style="padding: 0 1.75rem;">
                        <input id="gh-input-codigo-abono" type="password" placeholder="Código de empleado" autocomplete="off"
                               style="width:100%; box-sizing:border-box; padding:12px 14px; font-size:14px; border:1px solid #cbd5e1; border-radius:10px; outline:none;" />
                    </div>
                    <p id="gh-estado-codigo-abono" style="text-align:left; font-size:11.5px; font-weight:600; margin:6px 1.75rem 0; min-height:14px;"></p>
                </div>`,
            didOpen: () => {
                const inputValor = document.getElementById('gh-input-valor-abono');
                window.initMoneyInput?.(inputValor);
                inputValor?.focus();
                activarVerificacionCodigo('gh-input-codigo-abono', 'gh-estado-codigo-abono', (emp) => { empleadoVerificado = emp; });
                const btn = Swal.getConfirmButton();
                if (btn) btn.disabled = true;
            },
            showCancelButton: true,
            confirmButtonText: 'Registrar abono',
            cancelButtonText: 'Cancelar',
            reverseButtons: true,
            buttonsStyling: false,
            width: '30rem',
            customClass: {
                popup: 'gh-conf-popup gh-conf--ingreso', htmlContainer: 'gh-conf-html-container',
                actions: 'gh-conf-acciones', confirmButton: 'gh-conf-btn gh-conf-confirmar', cancelButton: 'gh-conf-btn gh-conf-cancelar'
            },
            showClass: { popup: 'gh-conf-entra', backdrop: 'swal2-backdrop-show' },
            preConfirm: () => {
                const valorAbono = window.parseMoney(document.getElementById('gh-input-valor-abono').value);
                const metodoPago = document.getElementById('gh-select-metodo-abono').value;
                const nroReferencia = document.getElementById('gh-input-referencia-abono').value.trim() || null;
                const codigoEmpleado = document.getElementById('gh-input-codigo-abono').value.trim();
                if (!valorAbono || valorAbono <= 0) { Swal.showValidationMessage('Ingresá un valor de abono mayor a 0.'); return false; }
                if (valorAbono > tope) { Swal.showValidationMessage(`El abono no puede superar ${topeTexto}.`); return false; }
                if (!codigoEmpleado || !empleadoVerificado) { Swal.showValidationMessage('Verificá el código del empleado.'); return false; }
                return { valorAbono, metodoPago, nroReferencia, codigoEmpleado };
            }
        });
        return value || null;
    };

    document.querySelectorAll('.btn-abonar-factura').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idFacturaCliente = btn.dataset.id;
            const nroFactura = btn.dataset.nro;
            const deuda = parseFloat(btn.dataset.deuda);

            const abono = await pedirAbono({ titulo: `Abonar a ${nroFactura}`, icono: 'fi-rr-coins', tope: deuda, nombreDestino: nroFactura });
            if (!abono) return;

            try {
                const r = await fetch(`/admin/api/clientes/${datos.idCliente}/facturas/${idFacturaCliente}/abonar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...abono, _csrf: csrfToken() })
                });
                const data = await r.json();
                if (!data.success) return mostrarError(data.mensaje);
                await Swal.fire({ icon: 'success', title: data.liquidada ? 'Factura liquidada' : 'Abono registrado', text: data.liquidada ? undefined : `Saldo restante: ${window.fmtCOP(data.saldoRestante)}.`, timer: 2400, showConfirmButton: false });
                recargar();
            } catch (_) {
                mostrarError('Error de conexión.');
            }
        });
    });

    document.getElementById('btn-abono-global')?.addEventListener('click', async () => {
        if (!datos.deudaTotal || datos.deudaTotal <= 0) {
            return Swal.fire({ icon: 'info', title: 'Sin deuda pendiente', text: 'Este cliente no tiene facturas de crédito pendientes.', confirmButtonColor: '#EC5FA3' });
        }
        const abono = await pedirAbono({ titulo: 'Abono global', icono: 'fi-rr-hand-holding-usd', tope: datos.deudaTotal, nombreDestino: datos.nombreCliente });
        if (!abono) return;

        try {
            const r = await fetch(`/admin/api/clientes/${datos.idCliente}/credito/abono-global`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...abono, _csrf: csrfToken() })
            });
            const data = await r.json();
            if (!data.success) return mostrarError(data.mensaje);
            await Swal.fire({ icon: 'success', title: 'Abono global registrado', text: data.mensaje, timer: 2600, showConfirmButton: false });
            recargar();
        } catch (_) {
            mostrarError('Error de conexión.');
        }
    });
});
