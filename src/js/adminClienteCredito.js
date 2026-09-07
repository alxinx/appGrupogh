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
    // `puedeConfirmar` es opcional: cuando se pasa, verificar el código ya no alcanza para
    // habilitar el botón — tiene que decir que sí todo el formulario. Los otros modales de
    // esta pantalla no lo pasan y siguen funcionando igual que antes.
    const activarVerificacionCodigo = (inputId, estadoId, onVerificado, puedeConfirmar = null) => {
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
                    if (btn) btn.disabled = puedeConfirmar ? !puedeConfirmar() : false;
                } catch (_) {
                    setEstado('error', 'No se pudo verificar el código.');
                }
            }, 400);
        });
    };

    // ── Modificar Crédito (aumentar o disminuir) ────────────────────────────────────────
    document.getElementById('btn-modificar-credito')?.addEventListener('click', async () => {
        let empleadoVerificado = null;
        const nombre = esc(datos.nombreCliente);
        const cupoActual = window.fmtCOP(datos.valorCreditoCliente);

        const { value } = await Swal.fire({
            html: `
                <div class="gh-conf-html">
                    <div class="gh-conf-cabecera gh-conf--neutro-cabecera" style="background:#F1F5F9;">
                        <span class="gh-conf-badge" style="background:#E2E8F0;color:#334155;"><i class="fi fi-rr-pencil" style="font-size:.625rem"></i> Modificar crédito</span>
                        <p class="gh-conf-cuenta" style="color:#475569;margin-top:.5rem;">Cupo actual de <strong>${nombre}</strong>: ${cupoActual}</p>
                    </div>
                    <div style="padding: 1.25rem 1.75rem 0;">
                        <label for="gh-input-nuevo-cupo" style="display:block; text-align:left; font-size:12px; font-weight:600; color:#64748b; margin-bottom:8px;">
                            Nuevo valor del cupo
                        </label>
                        <div style="position:relative;">
                            <span style="position:absolute; left:18px; top:50%; transform:translateY(-50%); font-size:26px; font-weight:800; color:#334155; pointer-events:none;">$</span>
                            <input id="gh-input-nuevo-cupo" type="text" inputmode="numeric" placeholder="0" autocomplete="off"
                                   style="width:100%; box-sizing:border-box; padding:16px 16px 16px 42px; font-size:26px; font-weight:800; color:#334155; border:2px solid #e2e8f0; border-radius:14px; text-align:right; outline:none;" />
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
                if (!nuevoValor || nuevoValor <= 0) {
                    Swal.showValidationMessage('Ingresá un valor mayor a 0.');
                    return false;
                }
                if (nuevoValor === datos.valorCreditoCliente) {
                    Swal.showValidationMessage(`Ese ya es el cupo actual (${cupoActual}) — cambiá el valor para modificarlo.`);
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

        // El modal de confirmación cambia de tono según la dirección: aumentar es una
        // acción normal (verde, como un ingreso), disminuir es una advertencia real —
        // le está bajando la capacidad de compra a crédito a alguien que ya la tenía.
        const esAumento = value.nuevoValor > datos.valorCreditoCliente;
        const delta = Math.abs(value.nuevoValor - datos.valorCreditoCliente);
        const enLetras = window.valorEnLetras ? esc(window.valorEnLetras(value.nuevoValor).toUpperCase()) : '';

        const { isConfirmed } = await Swal.fire({
            html: `
                <div class="gh-conf-html">
                    <div class="gh-conf-cabecera">
                        <span class="gh-conf-badge"><i class="fi ${esAumento ? 'fi-rr-arrow-trend-up' : 'fi-rr-triangle-warning'}" style="font-size:.625rem"></i> ${esAumento ? 'Vas a aumentar el crédito' : 'Vas a disminuir el crédito'}</span>
                        <p class="gh-conf-monto">${esAumento ? '+' : '−'} ${window.fmtCOP(delta)}</p>
                        <p class="gh-conf-cuenta">${esAumento ? 'de aumento para' : 'de disminución para'} <strong>${nombre}</strong></p>
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
                    ${enLetras ? `<p style="text-align:left; font-size:12.5px; line-height:1.5; color:#334155; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; margin:1.125rem 1.75rem;">El nuevo cupo queda en <strong style="color:${esAumento ? '#047857' : '#BE123C'};">${enLetras}</strong>.</p>` : ''}
                    ${esAumento ? '' : `<p class="gh-conf-aviso" style="margin:1.125rem 1.75rem 0;"><i class="fi fi-rr-triangle-warning"></i><span>Le estás bajando el cupo a un cliente que ya lo tenía asignado — si ya consumió más de lo que va a quedar, su disponible baja a $0 hasta que abone.</span></p>`}
                </div>`,
            showCancelButton: true,
            confirmButtonText: esAumento ? 'Aumentar crédito' : 'Disminuir crédito',
            cancelButtonText: 'Volver',
            focusCancel: true,
            reverseButtons: true,
            buttonsStyling: false,
            width: '30rem',
            customClass: {
                popup: `gh-conf-popup ${esAumento ? 'gh-conf--ingreso' : 'gh-conf--egreso'}`, htmlContainer: 'gh-conf-html-container',
                actions: 'gh-conf-acciones', confirmButton: 'gh-conf-btn gh-conf-confirmar', cancelButton: 'gh-conf-btn gh-conf-cancelar'
            },
            showClass: { popup: 'gh-conf-entra', backdrop: 'swal2-backdrop-show' }
        });
        if (!isConfirmed) return;

        try {
            const r = await fetch(`/admin/api/clientes/${datos.idCliente}/credito/modificar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ valorCreditoCliente: value.nuevoValor, codigoEmpleado: value.codigoEmpleado, _csrf: csrfToken() })
            });
            const data = await r.json();
            if (!data.success) return mostrarError(data.mensaje);
            await Swal.fire({
                icon: 'success',
                title: esAumento ? 'Crédito aumentado' : 'Crédito disminuido',
                text: `Nuevo cupo: ${window.fmtCOP(value.nuevoValor)}.`,
                timer: 2200, showConfirmButton: false
            });
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
    // Cuentas agrupadas como en /admin/bankentities: "Cajas" por un lado, "Bancos y
    // billeteras" por el otro. El método de pago ya no se pregunta — el backend lo deduce
    // del tipo de la cuenta elegida.
    const opcionesCuentas = () => {
        const cuentas = datos.cuentas || [];
        if (!cuentas.length) return '<option value="">No hay cajas ni bancos activos</option>';

        const grupo = (etiqueta, tipos) => {
            const items = cuentas.filter(c => tipos.includes(c.tipo));
            if (!items.length) return '';
            return `<optgroup label="${etiqueta}">` + items.map(c =>
                `<option value="${esc(c.idCajaBanco)}">${esc(c.nombreCajaBanco)}${c.referencia ? ` · ${esc(c.referencia)}` : ''}</option>`
            ).join('') + '</optgroup>';
        };
        return grupo('Cajas', ['caja']) + grupo('Bancos y billeteras', ['banco', 'billetera']);
    };

    const pedirAbono = async ({ titulo, icono, tope, nombreDestino, descripcionSugerida = '' }) => {
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
                        <p id="gh-aviso-tope-abono" style="text-align:right; font-size:11.5px; font-weight:600; color:#f59e0b; margin:6px 0 0; min-height:14px;"></p>
                    </div>
                    <div style="padding: 1.125rem 1.75rem 0;">
                        <label for="gh-select-cuenta-abono" style="display:block; text-align:left; font-size:12px; font-weight:600; color:#64748b; margin-bottom:8px;">¿A qué cuenta entra el dinero? *</label>
                        <select id="gh-select-cuenta-abono" style="width:100%; box-sizing:border-box; padding:12px 14px; font-size:14px; border:1px solid #cbd5e1; border-radius:10px; outline:none; background:#fff;">
                            ${opcionesCuentas()}
                        </select>
                    </div>
                    <div style="padding: 1.125rem 1.75rem 0;">
                        <label for="gh-input-descripcion-abono" style="display:block; text-align:left; font-size:12px; font-weight:600; color:#64748b; margin-bottom:8px;">Descripción</label>
                        <input id="gh-input-descripcion-abono" type="text" readonly value="${esc(descripcionSugerida)}"
                               style="width:100%; box-sizing:border-box; padding:12px 14px; font-size:14px; border:1px solid #e2e8f0; border-radius:10px; outline:none; background:#f8fafc; color:#64748b; cursor:default;" />
                    </div>
                    <div style="padding: 1.125rem 1.75rem 0; display:flex; gap:.75rem;">
                        <div style="flex:1;">
                            <label for="gh-input-fecha-abono" style="display:block; text-align:left; font-size:12px; font-weight:600; color:#64748b; margin-bottom:8px;">Fecha</label>
                            <input id="gh-input-fecha-abono" type="datetime-local" value="${datos.ahora || ''}" max="${datos.ahora || ''}"
                                   style="width:100%; box-sizing:border-box; padding:11px 12px; font-size:13px; border:1px solid #cbd5e1; border-radius:10px; outline:none;" />
                        </div>
                        <div style="flex:1;">
                            <label for="gh-input-referencia-abono" style="display:block; text-align:left; font-size:12px; font-weight:600; color:#64748b; margin-bottom:8px;">Referencia *</label>
                            <input id="gh-input-referencia-abono" type="text" maxlength="50" placeholder="Ej: REC-003" autocomplete="off"
                                   style="width:100%; box-sizing:border-box; padding:11px 12px; font-size:13px; border:1px solid #cbd5e1; border-radius:10px; outline:none;" />
                        </div>
                    </div>
                    <div style="padding: 1.125rem 1.75rem 0;">
                        <label for="gh-input-comprobantes-abono" style="display:block; text-align:left; font-size:12px; font-weight:600; color:#64748b; margin-bottom:8px;">Comprobante <span style="font-weight:400;color:#94a3b8;">(opcional)</span></label>
                        <label for="gh-input-comprobantes-abono" style="display:flex; align-items:center; justify-content:center; gap:8px; padding:11px 12px; border:1px solid #cbd5e1; border-radius:10px; font-size:13px; font-weight:600; color:#64748b; cursor:pointer; background:#fff;">
                            <i class="fi fi-rr-cloud-upload"></i> Subir archivos
                        </label>
                        <input id="gh-input-comprobantes-abono" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" style="display:none;" />
                        <p id="gh-lista-comprobantes-abono" style="text-align:left; font-size:11px; color:#94a3b8; margin:6px 0 0;">PDF, JPG o PNG. Máx. 5MB cada uno, hasta 10 archivos.</p>
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

                // El tope se aplica MIENTRAS se escribe, no solo al confirmar: escribir
                // 40.000.000 sobre una deuda de 28.700 y enterarse recién al final es
                // perder el formulario entero. El listener va después de initMoneyInput
                // para corregir el valor ya formateado por ese.
                const avisoTope = document.getElementById('gh-aviso-tope-abono');
                inputValor?.addEventListener('input', () => {
                    if (window.parseMoney(inputValor.value) <= tope) {
                        avisoTope.textContent = '';
                        return;
                    }
                    inputValor.value = new Intl.NumberFormat('es-CO').format(tope);
                    inputValor.setSelectionRange(inputValor.value.length, inputValor.value.length);
                    avisoTope.textContent = `El máximo es ${topeTexto}.`;
                });
                // El botón se habilita solo cuando están los cuatro obligatorios: valor,
                // cuenta, referencia y empleado verificado. Antes bastaba con verificar el
                // código y quedaba activo aunque faltara la referencia.
                const selCuenta = document.getElementById('gh-select-cuenta-abono');
                const inputRef  = document.getElementById('gh-input-referencia-abono');

                const camposCompletos = () =>
                    window.parseMoney(inputValor.value) > 0 &&
                    !!selCuenta.value &&
                    !!inputRef.value.trim() &&
                    !!empleadoVerificado;

                const refrescarBoton = () => {
                    const b = Swal.getConfirmButton();
                    if (b) b.disabled = !camposCompletos();
                };

                [inputValor, selCuenta, inputRef].forEach(el => {
                    el.addEventListener('input', refrescarBoton);
                    el.addEventListener('change', refrescarBoton);
                });

                activarVerificacionCodigo(
                    'gh-input-codigo-abono', 'gh-estado-codigo-abono',
                    (emp) => { empleadoVerificado = emp; refrescarBoton(); },
                    camposCompletos
                );

                // Sin esto no hay forma de saber qué se va a subir (mismo detalle que el
                // formulario de movimiento de caja/banco).
                const inputArchivos = document.getElementById('gh-input-comprobantes-abono');
                const listaArchivos = document.getElementById('gh-lista-comprobantes-abono');
                inputArchivos?.addEventListener('change', () => {
                    const n = inputArchivos.files.length;
                    listaArchivos.textContent = n
                        ? [...inputArchivos.files].map(f => f.name).join(' · ')
                        : 'PDF, JPG o PNG. Máx. 5MB cada uno, hasta 10 archivos.';
                    listaArchivos.style.color = n ? '#059669' : '#94a3b8';
                });
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
                const idCajaBanco = document.getElementById('gh-select-cuenta-abono').value;
                const descripcion = document.getElementById('gh-input-descripcion-abono').value.trim();
                const fecha = document.getElementById('gh-input-fecha-abono').value;
                const nroReferencia = document.getElementById('gh-input-referencia-abono').value.trim();
                const codigoEmpleado = document.getElementById('gh-input-codigo-abono').value.trim();
                const comprobantes = document.getElementById('gh-input-comprobantes-abono').files;

                if (!valorAbono || valorAbono <= 0) { Swal.showValidationMessage('Ingresá un valor de abono mayor a 0.'); return false; }
                if (valorAbono > tope) { Swal.showValidationMessage(`El abono no puede superar ${topeTexto}.`); return false; }
                if (!idCajaBanco) { Swal.showValidationMessage('Elegí la caja o el banco que recibe el dinero.'); return false; }
                if (!nroReferencia) { Swal.showValidationMessage('La referencia es obligatoria.'); return false; }
                // El servidor la rechaza igual, pero avisar acá evita perder el formulario.
                if (fecha && new Date(fecha).getTime() > Date.now() + 60000) { Swal.showValidationMessage('La fecha no puede ser futura.'); return false; }
                if (!codigoEmpleado || !empleadoVerificado) { Swal.showValidationMessage('Verificá el código del empleado.'); return false; }

                return { valorAbono, idCajaBanco, descripcion, fecha, nroReferencia, codigoEmpleado, comprobantes };
            }
        });
        return value || null;
    };

    // El abono viaja como multipart porque lleva comprobantes, igual que el movimiento
    // manual de una caja o banco. Un solo armador para los dos envíos de esta pantalla.
    const cuerpoAbono = (abono) => {
        const fd = new FormData();
        fd.append('valorAbono',     abono.valorAbono);
        fd.append('idCajaBanco',    abono.idCajaBanco);
        fd.append('descripcion',    abono.descripcion);
        fd.append('codigoEmpleado', abono.codigoEmpleado);
        if (abono.fecha)         fd.append('fecha', abono.fecha);
        fd.append('nroReferencia', abono.nroReferencia);
        for (const archivo of abono.comprobantes || []) fd.append('comprobantes', archivo);
        // El _csrf va igual en el body por si algún día la ruta se valida después de
        // multer, pero el que cuenta es el de la cabecera (ver `cabecerasAbono`).
        fd.append('_csrf', csrfToken());
        return fd;
    };

    // csurf corre GLOBAL en index.js, antes que multer: con multipart, `req.body` todavía
    // está vacío cuando valida, así que un `_csrf` metido en el FormData no lo ve y
    // responde EBADCSRFTOKEN. Por eso el token viaja en la cabecera, que csurf sí lee sin
    // depender del parseo del cuerpo — mismo patrón que el formulario de movimientos de
    // caja/banco (perfilCajaBanco.pug).
    const cabecerasAbono = () => ({ 'X-CSRF-Token': csrfToken(), Accept: 'application/json' });

    // Cierre del flujo: confirmación con los DOS comprobantes que deja un abono.
    //
    //   · Abono   → lo que el cliente entregó contra su deuda (se le da a él).
    //   · Ingreso → que esa plata quedó asentada en el libro de la caja o el banco.
    //
    // Son documentos distintos y los dos hacen falta: el primero lo firma el cliente, el
    // segundo es el respaldo contable de la cuenta. Se abren en pestaña nueva porque los
    // endpoints los sirven inline, listos para imprimir.
    const confirmarConComprobantes = async ({ titulo, texto, idAbono, idMovimiento }) => {
        const abrir = (url) => window.open(url, '_blank', 'noopener');

        const r = await Swal.fire({
            icon: 'success',
            title: titulo,
            html: `<p style="margin:0 0 4px;">${esc(texto)}</p>
                   <p style="font-size:12.5px;color:#94a3b8;margin:0;">Se generaron dos comprobantes.</p>`,
            showDenyButton: !!idMovimiento,
            showCancelButton: true,
            confirmButtonText: 'Comprobante de abono',
            denyButtonText: 'Comprobante de ingreso',
            cancelButtonText: 'Cerrar',
            reverseButtons: true,
            buttonsStyling: false,
            customClass: {
                popup: 'gh-conf-popup', actions: 'gh-conf-acciones',
                confirmButton: 'gh-conf-btn gh-conf-confirmar',
                denyButton: 'gh-conf-btn gh-conf-cancelar',
                cancelButton: 'gh-conf-btn gh-conf-cancelar'
            }
        });

        if (r.isConfirmed && idAbono)      abrir(`/admin/api/clientes/abonos/${idAbono}/tirilla`);
        if (r.isDenied    && idMovimiento) abrir(`/admin/bankentities/movimientos/${idMovimiento}/tirilla`);
    };

    document.querySelectorAll('.btn-abonar-factura').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idFacturaCliente = btn.dataset.id;
            const nroFactura = btn.dataset.nro;
            const deuda = parseFloat(btn.dataset.deuda);

            const abono = await pedirAbono({
                titulo: `Abonar a ${nroFactura}`, icono: 'fi-rr-coins', tope: deuda, nombreDestino: nroFactura,
                descripcionSugerida: `Abono factura ${nroFactura} — ${datos.nombreCliente}`
            });
            if (!abono) return;

            try {
                // Sin Content-Type a mano: el navegador tiene que ponerle el boundary.
                const r = await fetch(`/admin/api/clientes/${datos.idCliente}/facturas/${idFacturaCliente}/abonar`, {
                    method: 'POST',
                    headers: cabecerasAbono(),
                    body: cuerpoAbono(abono)
                });
                const data = await r.json();
                if (!data.success) return mostrarError(data.mensaje);
                await confirmarConComprobantes({
                    titulo: data.liquidada ? 'Factura liquidada' : 'Abono registrado',
                    texto: data.liquidada
                        ? `${nroFactura} quedó sin saldo pendiente.`
                        : `Saldo restante: ${window.fmtCOP(data.saldoRestante)}.`,
                    idAbono: data.idAbonoClienteCredito,
                    idMovimiento: data.idMovimientoCuenta
                });
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
        const abono = await pedirAbono({
            titulo: 'Abono global', icono: 'fi-rr-hand-holding-usd', tope: datos.deudaTotal, nombreDestino: datos.nombreCliente,
            descripcionSugerida: `Abono global — ${datos.nombreCliente}`
        });
        if (!abono) return;

        try {
            const r = await fetch(`/admin/api/clientes/${datos.idCliente}/credito/abono-global`, {
                method: 'POST',
                headers: cabecerasAbono(),
                body: cuerpoAbono(abono)
            });
            const data = await r.json();
            if (!data.success) return mostrarError(data.mensaje);
            await confirmarConComprobantes({
                titulo: 'Abono global registrado',
                texto: data.mensaje,
                idAbono: data.loteAbonoGlobal,
                idMovimiento: data.idMovimientoCuenta
            });
            recargar();
        } catch (_) {
            mostrarError('Error de conexión.');
        }
    });
});
