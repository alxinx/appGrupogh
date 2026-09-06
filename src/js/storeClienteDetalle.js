// Detalle de "Mis Clientes" en tienda (views/tienda/clientes/detalle.pug) — Abono Global.
// window.fmtCOP, window.initMoneyInput, window.parseMoney y el interceptor de logout de
// fetch (data.logout === true) ya los trae helpers.js, cargado antes que este archivo.
document.addEventListener('DOMContentLoaded', () => {
    const datos = window.__clienteDetalleStore || {};
    const csrfToken = () => document.querySelector('[name="_csrf"]')?.value
        || document.querySelector('meta[name="csrf-token"]')?.content
        || '';

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pesos = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;
    // Sin "$" — para prellenar un input de monto que ya muestra el signo por separado
    // (mismo helper que src/js/pos.js `fmtMoney`, distinto de window.fmtCOP).
    const fmtMoney = (n) => n > 0 ? new Intl.NumberFormat('es-CO').format(n) : '';
    // Signo menos tipográfico (−), mismo motivo que en perfilCajaBanco.pug: el guion del
    // teclado que usa `pesos` es más corto y se ve desparejo junto al "+" de la cabecera.
    const pesosConf = (n) => pesos(n).replace('-', '−');

    const mostrarError = (mensaje) => Swal.fire({ icon: 'error', title: 'No se pudo completar', text: mensaje, confirmButtonColor: '#EC5FA3' });

    const btn = document.getElementById('btn-abono-global');
    if (!btn) return;

    // ── CAJA EN CUADRE — mismas reglas y mismo webhook en vivo que el POS ───────────────
    // Mientras se cuadra la caja del turno, esta tienda no registra dinero nuevo por ningún
    // canal (ver storeControllers.js `abonoGlobalClienteStore`, que rechaza con 409 igual
    // que procesarFactura). storeGlobal.js ya mantiene la conexión SSE a /store/sse y llama
    // a window.__posCajaEnCuadre cuando el evento "caja_en_cuadre" llega — se reutiliza el
    // mismo hook que usa pos.js, no uno aparte, para que sea una sola fuente de verdad.
    let cajaEnCuadre = false;
    let modalAbonoAbierto = false;
    const deudaOriginal = datos.deudaTotal;

    const aplicarBloqueoCuadre = () => {
        const sinDeuda = !deudaOriginal || deudaOriginal <= 0;
        btn.disabled = cajaEnCuadre || sinDeuda;
        btn.title = cajaEnCuadre ? 'La caja está en proceso de cierre — no se pueden registrar abonos.' : '';
        btn.classList.toggle('opacity-50', cajaEnCuadre);
        btn.classList.toggle('cursor-not-allowed', cajaEnCuadre);
    };

    window.__posCajaEnCuadre = (valor) => {
        cajaEnCuadre = !!valor;
        aplicarBloqueoCuadre();
        // Si el modal ya estaba abierto cuando llega el bloqueo, no puede quedar un
        // "Continuar" vivo sobre una operación que el servidor va a rechazar igual.
        if (cajaEnCuadre && modalAbonoAbierto) {
            Swal.close();
            window.showToast?.('La caja entró en cierre: el abono quedó cancelado.', 'warning', 6000);
        }
    };

    // El SSE solo avisa CAMBIOS de estado — el estado inicial al cargar la página hay que
    // pedirlo aparte, igual que hace pos.js.
    fetch('/store/storebehivors/caja/cuadre/estado')
        .then(r => r.json())
        .then(d => { if (d.success) window.__posCajaEnCuadre(d.enCuadre); })
        .catch(() => {});

    // ── Verificación de código de empleado en vivo (mismo endpoint que el resto de tienda:
    // /store/json/personal/validar/:codigo — solo confirma que pertenece a esta tienda; el
    // permiso fino real de "Mis Clientes" EDIT lo exige el propio endpoint al enviar). ────
    const activarVerificacionCodigo = (inputId, estadoId, onVerificado) => {
        const input = document.getElementById(inputId);
        const estado = document.getElementById(estadoId);
        if (!input || !estado) return;

        const setEstado = (tipo, texto) => {
            estado.style.color = tipo === 'ok' ? '#10b981' : tipo === 'error' ? '#f43f5e' : '#94a3b8';
            estado.textContent = texto;
        };

        // Habilitar "Continuar" es decisión del que llama (acá también hace falta un monto
        // > 0, no solo el código) — este helper solo confirma o invalida el código.
        let timer = null;
        input.addEventListener('input', () => {
            onVerificado(null);
            clearTimeout(timer);
            const codigo = input.value.trim();
            if (!codigo) { setEstado('info', ''); return; }
            setEstado('info', 'Verificando código...');
            timer = setTimeout(async () => {
                try {
                    const r = await fetch(`/store/json/personal/validar/${encodeURIComponent(codigo)}`);
                    const data = await r.json();
                    if (!data.success) { setEstado('error', data.mensaje || 'Código inválido.'); return; }
                    setEstado('ok', `✓ ${data.nombre || 'Empleado verificado'}`);
                    onVerificado({ idEmpleado: data.idEmpleado, nombre: data.nombre, codigoEmpleado: codigo.toUpperCase() });
                } catch (_) {
                    setEstado('error', 'No se pudo verificar el código.');
                }
            }, 400);
        });
    };

    // ── Entidades (bancos, billeteras, tarjetas, financieras) — mismo endpoint y misma
    // agrupación que el POS al pagar una factura (src/js/pos.js `cargarEntidades`). ──────
    let entidadesCargadas = null;
    const cargarEntidades = async () => {
        if (entidadesCargadas) return entidadesCargadas;
        try {
            const r = await fetch('/store/json/entidades');
            const data = await r.json();
            const todas = data.entidades || [];
            entidadesCargadas = {
                transferencia: todas.filter(e => e.tipoEntidad === 'Banco' || e.tipoEntidad === 'Billetera Virtual'),
                tarjeta:       todas.filter(e => e.tipoEntidad === 'Tarjeta Credito'),
                credito:       todas.filter(e => e.tipoEntidad === 'Entidad Crediticia')
            };
        } catch (_) {
            entidadesCargadas = { transferencia: [], tarjeta: [], credito: [] };
        }
        return entidadesCargadas;
    };

    // ── Paso 2: confirmación — mismos parámetros de diseño que el asiento de
    // admin/bankentities/cajas (.gh-conf-*, views/components/modalConfirmacion.pug):
    // cabecera tintada con el monto, "deuda actual → queda en", detalle de cada línea de
    // pago y aviso de que es append-only. ────────────────────────────────────────────
    const confirmarAbono = async (lineas) => {
        const valorTotal  = lineas.reduce((s, l) => s + l.valor, 0);
        const deudaActual = Number(datos.deudaTotal) || 0;
        const deudaFinal  = Math.max(0, Math.round((deudaActual - valorTotal) * 100) / 100);

        const fila = (etiqueta, valorHTML, vacio) =>
            `<div class="gh-conf-fila"><dt>${etiqueta}</dt><dd class="${vacio ? 'gh-conf-vacio' : ''}">${valorHTML}</dd></div>`;

        const filasLineas = lineas.map(l => {
            const etiqueta = l.entidadNombre ? `${l.metodoPago} — ${esc(l.entidadNombre)}` : l.metodoPago;
            const refHTML = l.nroReferencia ? ` <span class="gh-conf-mono">(${esc(l.nroReferencia)})</span>` : '';
            return fila(etiqueta, `${pesosConf(l.valor)}${refHTML}`);
        }).join('');

        const { isConfirmed } = await Swal.fire({
            html: `
                <div class="gh-conf-html">
                    <div class="gh-conf-cabecera">
                        <span class="gh-conf-badge"><i class="fi fi-rr-arrow-down" style="font-size:.625rem"></i> Abono</span>
                        <p class="gh-conf-monto">+ ${pesosConf(valorTotal)}</p>
                        <p class="gh-conf-cuenta">abona la deuda de <strong>${esc(datos.nombreCliente || 'este cliente')}</strong></p>
                    </div>
                    <div class="gh-conf-saldo">
                        <div class="gh-conf-saldo-bloque">
                            <span class="gh-conf-saldo-label">Deuda actual</span>
                            <span class="gh-conf-saldo-valor">${pesosConf(deudaActual)}</span>
                        </div>
                        <i class="fi fi-rr-arrow-right gh-conf-flecha"></i>
                        <div class="gh-conf-saldo-bloque gh-conf-saldo-bloque--final">
                            <span class="gh-conf-saldo-label">Queda en</span>
                            <span class="gh-conf-saldo-valor">${pesosConf(deudaFinal)}</span>
                        </div>
                    </div>
                    <dl class="gh-conf-detalle">
                        ${fila('Fecha', esc(new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })))}
                        ${filasLineas}
                    </dl>
                    <p class="gh-conf-aviso">
                        <i class="fi fi-rr-lock"></i>
                        <span>Una vez registrado no se puede editar ni eliminar. Para corregirlo habría que registrar un ajuste desde administración.</span>
                    </p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Registrar abono',
            cancelButtonText: 'Volver',
            focusCancel: true,
            reverseButtons: true,
            buttonsStyling: false,
            width: '30rem',
            customClass: {
                popup: 'gh-conf-popup gh-conf--ingreso', htmlContainer: 'gh-conf-html-container',
                actions: 'gh-conf-acciones', confirmButton: 'gh-conf-btn gh-conf-confirmar', cancelButton: 'gh-conf-btn gh-conf-cancelar'
            },
            showClass: { popup: 'gh-conf-entra', backdrop: 'swal2-backdrop-show' }
        });
        return isConfirmed;
    };

    // ── Paso 1: formulario — mismos métodos y misma mecánica de chips/filas que el POS al
    // pagar una factura (src/js/pos.js, views/components/modals.pug), pero condensado
    // dentro de un modal de SweetAlert2 (por eso va en CSS propio, no clases de Tailwind —
    // ver comentario de views/components/modalConfirmacion.pug) y sin "Crédito en Tienda"
    // (financiar con el propio cupo no aplica a pagar una deuda ya existente). Cada
    // transferencia/tarjeta/financiera queda con su propia entidad y referencia, así el
    // operador puede registrar de una vez varios pagos que llegaron por separado. ────────
    const GRUPOS = [
        { id: 'transferencia', label: 'Transferencia', sub: 'Bancos', icono: 'fi-rr-bank', color: '#2563eb', bg: '#dbeafe', borde: '#bfdbfe' },
        { id: 'tarjeta',       label: 'Tarjeta',        sub: 'Débito / Crédito', icono: 'fi-rr-credit-card', color: '#7c3aed', bg: '#ede9fe', borde: '#ddd6fe' },
        { id: 'credito',       label: 'Entidades Crediticias', sub: 'Crédito / Financiación', icono: 'fi-rr-donate', color: '#ea580c', bg: '#ffedd5', borde: '#fed7aa' }
    ];

    btn.addEventListener('click', async () => {
        if (cajaEnCuadre) {
            return window.showToast
                ? window.showToast('La caja está en proceso de cierre: no se pueden registrar abonos hasta que termine el cuadre.', 'warning', 6000)
                : Swal.fire({ icon: 'warning', title: 'Caja en cierre', text: 'No se pueden registrar abonos hasta que termine el cuadre.', confirmButtonColor: '#EC5FA3' });
        }
        if (!datos.deudaTotal || datos.deudaTotal <= 0) {
            return Swal.fire({ icon: 'info', title: 'Sin deuda pendiente', text: 'Este cliente no tiene facturas de crédito pendientes en esta tienda.', confirmButtonColor: '#EC5FA3' });
        }

        modalAbonoAbierto = true;
        try {
        const entidades = await cargarEntidades();
        let empleadoVerificado = null;
        const tope = Number(datos.deudaTotal) || 0;
        const topeTexto = pesos(tope);

        // rowId → { grupo, idEntidad, nombre } — una fila por transferencia/tarjeta/crédito
        // agregada (un mismo banco puede repetirse: dos transferencias distintas del mismo
        // banco son dos filas, no una).
        const filasActivas = new Map();
        let contadorFila = 0;

        const gruposHTML = GRUPOS.map(g => `
            <div style="margin-bottom:10px;background:#f9fafb;border-radius:14px;border:2px solid transparent;overflow:hidden;">
                <div class="gh-abono-header-st" data-grupo="${g.id}" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;user-select:none;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:32px;height:32px;border-radius:10px;background:${g.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <i class="fi ${g.icono}" style="color:${g.color};font-size:14px;"></i>
                        </div>
                        <div>
                            <p style="font-size:11px;font-weight:800;color:#1f2937;text-transform:uppercase;letter-spacing:.02em;margin:0;">${g.label}</p>
                            <p style="font-size:10px;color:#9ca3af;margin:0;">${g.sub}</p>
                        </div>
                    </div>
                    <i class="fi fi-rr-angle-small-down gh-abono-chevron-st" data-grupo="${g.id}" style="color:#9ca3af;transition:transform .2s;font-size:12px;"></i>
                </div>
                <div id="gh-body-${g.id}-st" style="display:none;padding:0 14px 12px;">
                    <div id="gh-chips-${g.id}-st" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                        <span style="font-size:11px;color:#9ca3af;font-style:italic;">Cargando...</span>
                    </div>
                    <div id="gh-rows-${g.id}-st" style="display:flex;flex-direction:column;gap:6px;"></div>
                </div>
            </div>`).join('');

        const { value } = await Swal.fire({
            html: `
                <div class="gh-conf-html">
                    <div class="gh-conf-cabecera" style="background:#ECFDF5;">
                        <span class="gh-conf-badge" style="background:#A7F3D0;color:#065F46;"><i class="fi fi-rr-hand-holding-usd" style="font-size:.625rem"></i> Abono global</span>
                        <p class="gh-conf-cuenta" style="color:#047857;margin-top:.5rem;">${esc(datos.nombreCliente || 'este cliente')} · deuda en esta tienda: ${topeTexto}</p>
                    </div>
                    <div style="padding: 1.125rem 1.5rem 0;max-height:52vh;overflow-y:auto;">
                        <!-- EFECTIVO -->
                        <div style="margin-bottom:10px;background:#f9fafb;border-radius:14px;border:2px solid transparent;overflow:hidden;">
                            <div class="gh-abono-header-st" data-grupo="efectivo" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;user-select:none;">
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <div style="width:32px;height:32px;border-radius:10px;background:#d1fae5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                        <i class="fi fi-rr-money-bill-wave" style="color:#059669;font-size:14px;"></i>
                                    </div>
                                    <div>
                                        <p style="font-size:11px;font-weight:800;color:#1f2937;text-transform:uppercase;letter-spacing:.02em;margin:0;">Efectivo</p>
                                        <p style="font-size:10px;color:#9ca3af;margin:0;">Pago físico</p>
                                    </div>
                                </div>
                                <i class="fi fi-rr-angle-small-down gh-abono-chevron-st" data-grupo="efectivo" style="color:#9ca3af;transition:transform .2s;font-size:12px;"></i>
                            </div>
                            <div id="gh-body-efectivo-st" style="display:none;padding:0 14px 12px;">
                                <div style="position:relative;">
                                    <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#9ca3af;font-weight:800;font-size:14px;pointer-events:none;">$</span>
                                    <input id="gh-efectivo-monto-st" type="text" inputmode="numeric" placeholder="0" autocomplete="off"
                                           style="width:100%;box-sizing:border-box;padding:9px 10px 9px 24px;font-size:14px;font-weight:800;color:#059669;border:1px solid #e5e7eb;border-radius:10px;text-align:right;outline:none;" />
                                </div>
                            </div>
                        </div>
                        ${gruposHTML}
                    </div>
                    <div style="padding: .75rem 1.5rem;border-top:1px solid #F1F5F9;">
                        <div style="display:flex;justify-content:space-between;align-items:baseline;">
                            <span style="font-size:12px;font-weight:700;color:#64748b;">Total ingresado</span>
                            <span id="gh-total-abono-st" style="font-size:17px;font-weight:800;color:#1e293b;">$0</span>
                        </div>
                    </div>
                    <p style="text-align:left;font-size:12px;font-weight:600;color:#64748b;margin:0 1.5rem 8px;">Código del empleado que recibe:</p>
                    <div style="padding: 0 1.5rem;">
                        <input id="gh-input-codigo-abono-st" type="password" placeholder="Código de empleado" autocomplete="off"
                               style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:14px;border:1px solid #cbd5e1;border-radius:10px;outline:none;" />
                    </div>
                    <p id="gh-estado-codigo-abono-st" style="text-align:left;font-size:11.5px;font-weight:600;margin:6px 1.5rem 0;min-height:14px;"></p>
                </div>`,
            didOpen: () => {
                const popup = Swal.getPopup();
                const b = Swal.getConfirmButton();
                if (b) b.disabled = true;

                const totalActual = () => {
                    let suma = window.parseMoney?.(document.getElementById('gh-efectivo-monto-st')?.value) ?? 0;
                    filasActivas.forEach((_, rowId) => {
                        suma += window.parseMoney?.(document.getElementById(`gh-monto-${rowId}-st`)?.value) ?? 0;
                    });
                    return Math.round(suma * 100) / 100;
                };
                // "Continuar" solo se habilita con un monto real Y un empleado verificado —
                // ninguno de los dos alcanza solo. Antes el código por sí solo lo habilitaba,
                // así que se podía "continuar" con el modal completamente vacío.
                const actualizarEstadoBoton = () => {
                    if (b) b.disabled = !(totalActual() > 0 && empleadoVerificado);
                };
                const actualizarTotal = () => {
                    const t = document.getElementById('gh-total-abono-st');
                    if (t) t.textContent = pesos(totalActual());
                    actualizarEstadoBoton();
                };

                // Efectivo
                const inputEfectivo = document.getElementById('gh-efectivo-monto-st');
                window.initMoneyInput?.(inputEfectivo);
                inputEfectivo?.addEventListener('input', actualizarTotal);

                // Acordeones (efectivo + los 3 grupos con entidad)
                popup.querySelectorAll('.gh-abono-header-st').forEach(header => {
                    header.addEventListener('click', () => {
                        const g = header.dataset.grupo;
                        const body = document.getElementById(`gh-body-${g}-st`);
                        const chev = popup.querySelector(`.gh-abono-chevron-st[data-grupo="${g}"]`);
                        const abrir = body.style.display === 'none';
                        body.style.display = abrir ? 'block' : 'none';
                        if (chev) chev.style.transform = abrir ? 'rotate(180deg)' : 'rotate(0deg)';
                    });
                });

                // Chips + filas por grupo con entidad (transferencia/tarjeta/credito)
                const colorPorGrupo = Object.fromEntries(GRUPOS.map(g => [g.id, g]));
                GRUPOS.forEach(g => {
                    const chipsEl = document.getElementById(`gh-chips-${g.id}-st`);
                    const lista = entidades[g.id] || [];
                    if (!lista.length) {
                        chipsEl.innerHTML = `<span style="font-size:11px;color:#9ca3af;">Sin entidades configuradas.</span>`;
                        return;
                    }
                    chipsEl.innerHTML = lista.map(e => `
                        <button type="button" class="gh-abono-chip-st" data-grupo="${g.id}" data-id="${e.idEntidad}" data-nombre="${esc(e.nombreEntidad)}"
                                style="padding:6px 10px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;font-size:11px;font-weight:700;color:#374151;cursor:pointer;">
                            ${esc(e.nombreEntidad)}
                        </button>`).join('');

                    chipsEl.querySelectorAll('.gh-abono-chip-st').forEach(chip => {
                        chip.addEventListener('click', () => {
                            const rowId = `${g.id}-${contadorFila++}`;
                            filasActivas.set(rowId, { grupo: g.id, idEntidad: chip.dataset.id, nombre: chip.dataset.nombre });

                            const contenedor = document.getElementById(`gh-rows-${g.id}-st`);
                            const row = document.createElement('div');
                            row.id = `gh-row-${rowId}-st`;
                            row.style.cssText = `display:flex;gap:6px;align-items:center;padding:8px;background:#fff;border-radius:10px;border:1px solid ${g.borde};`;
                            row.innerHTML = `
                                <span style="font-size:10px;font-weight:800;color:${g.color};text-transform:uppercase;width:72px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(chip.dataset.nombre)}</span>
                                <div style="position:relative;flex:2;">
                                    <span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);color:#9ca3af;font-weight:700;font-size:12px;pointer-events:none;">$</span>
                                    <input id="gh-monto-${rowId}-st" type="text" inputmode="numeric" placeholder="Monto" autocomplete="off"
                                           style="width:100%;box-sizing:border-box;padding:6px 6px 6px 18px;font-size:12px;font-weight:800;color:#1f2937;border:1px solid #e5e7eb;border-radius:8px;text-align:right;outline:none;" />
                                </div>
                                <input id="gh-ref-${rowId}-st" type="text" placeholder="Ref." autocomplete="off"
                                       style="width:80px;flex-shrink:0;box-sizing:border-box;padding:6px 8px;font-size:12px;border:1px solid #e5e7eb;border-radius:8px;outline:none;" />
                                <button type="button" data-row="${rowId}" data-grupo="${g.id}" class="gh-abono-quitar-st"
                                        style="flex-shrink:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:#cbd5e1;background:none;border:none;cursor:pointer;">
                                    <i class="fi fi-rr-cross-small"></i>
                                </button>`;
                            contenedor.appendChild(row);

                            const inputMonto = document.getElementById(`gh-monto-${rowId}-st`);
                            window.initMoneyInput?.(inputMonto);
                            const restante = tope - totalActual();
                            if (restante > 0) { inputMonto.value = fmtMoney(restante); }
                            inputMonto?.addEventListener('input', actualizarTotal);

                            row.querySelector('.gh-abono-quitar-st')?.addEventListener('click', () => {
                                row.remove();
                                filasActivas.delete(rowId);
                                actualizarTotal();
                            });

                            actualizarTotal();
                        });
                    });
                });

                activarVerificacionCodigo('gh-input-codigo-abono-st', 'gh-estado-codigo-abono-st', (emp) => { empleadoVerificado = emp; actualizarEstadoBoton(); });
            },
            showCancelButton: true,
            confirmButtonText: 'Continuar',
            cancelButtonText: 'Cancelar',
            reverseButtons: true,
            buttonsStyling: false,
            width: '32rem',
            customClass: {
                popup: 'gh-conf-popup gh-conf--ingreso', htmlContainer: 'gh-conf-html-container',
                actions: 'gh-conf-acciones', confirmButton: 'gh-conf-btn gh-conf-confirmar', cancelButton: 'gh-conf-btn gh-conf-cancelar'
            },
            showClass: { popup: 'gh-conf-entra', backdrop: 'swal2-backdrop-show' },
            preConfirm: () => {
                const lineas = [];

                const montoEfectivo = window.parseMoney(document.getElementById('gh-efectivo-monto-st').value);
                if (montoEfectivo > 0) lineas.push({ metodoPago: 'Efectivo', idEntidad: null, nroReferencia: null, valor: montoEfectivo, entidadNombre: '' });

                filasActivas.forEach((info, rowId) => {
                    const valor = window.parseMoney(document.getElementById(`gh-monto-${rowId}-st`)?.value);
                    if (!(valor > 0)) return;
                    const nroReferencia = document.getElementById(`gh-ref-${rowId}-st`)?.value.trim() || null;
                    const entidad = (entidades[info.grupo] || []).find(e => String(e.idEntidad) === String(info.idEntidad));
                    const metodoPago = info.grupo === 'tarjeta' ? 'Tarjeta Credito'
                        : info.grupo === 'credito' ? 'Entidad Crediticia'
                        : (entidad?.tipoEntidad || 'Banco');
                    lineas.push({ metodoPago, idEntidad: info.idEntidad, nroReferencia, valor, entidadNombre: info.nombre, rowId });
                });

                const total = Math.round(lineas.reduce((s, l) => s + l.valor, 0) * 100) / 100;
                const codigoEmpleado = document.getElementById('gh-input-codigo-abono-st').value.trim();

                if (!lineas.length) { Swal.showValidationMessage('Agrega al menos un método de pago con un valor mayor a 0.'); return false; }
                // La referencia de una consignación/transferencia es lo único que permite
                // conciliarla después contra el extracto — Efectivo no tiene con qué
                // conciliar, así que es la única que queda exenta.
                const sinReferencia = lineas.find(l => l.metodoPago !== 'Efectivo' && !l.nroReferencia);
                if (sinReferencia) {
                    const inputRef = document.getElementById(`gh-ref-${sinReferencia.rowId}-st`);
                    if (inputRef) inputRef.style.borderColor = '#f43f5e';
                    Swal.showValidationMessage(`Falta la referencia de ${sinReferencia.entidadNombre || sinReferencia.metodoPago}.`);
                    return false;
                }
                if (total > tope) { Swal.showValidationMessage(`El total no puede superar ${topeTexto}.`); return false; }
                if (!codigoEmpleado || !empleadoVerificado) { Swal.showValidationMessage('Verificá el código del empleado.'); return false; }

                return { lineas, codigoEmpleado };
            }
        });

        if (!value) return;

        const confirmado = await confirmarAbono(value.lineas);
        if (!confirmado) return;

        try {
            const r = await fetch(`/store/clientes/${datos.idCliente}/abono-global`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pagos: value.lineas.map(l => ({ metodoPago: l.metodoPago, idEntidad: l.idEntidad, nroReferencia: l.nroReferencia, valor: l.valor })),
                    codigoEmpleado: value.codigoEmpleado,
                    _csrf: csrfToken()
                })
            });
            const data = await r.json();
            if (!data.success) return mostrarError(data.mensaje);

            // Dos comprobantes: el voucher del abono (todas las facturas tocadas, cómo se
            // pagó) y, por cada factura afectada, su tirilla — ya trae abajo el historial de
            // abonos y el saldo (o "PAZ Y SALVO" si quedó cancelada).
            window.open(`/store/clientes/${datos.idCliente}/abono/${data.loteAbonoGlobal}/voucher`, '_blank');
            (data.facturas || []).forEach(f => {
                window.open(`/store/facturas/${f.idFacturaCliente}/tirilla`, '_blank');
            });

            await Swal.fire({ icon: 'success', title: 'Abono registrado', text: data.mensaje, timer: 2600, showConfirmButton: false });
            window.location.reload();
        } catch (_) {
            mostrarError('Error de conexión.');
        }
        } finally {
            modalAbonoAbierto = false;
        }
    });
});
