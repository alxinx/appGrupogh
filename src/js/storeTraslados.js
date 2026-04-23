(function () {
    const csrfToken = document.getElementById('csrf-token')?.value || '';

    // ─── ESTADO ──────────────────────────────────────────────────────────────
    let trasladoActivo = null;
    let empleadoValidado = null;
    let employeeLookupTimer = null;
    let paginaHistorial = 1;
    let busquedaHistorial = '';

    // ─── HELPERS ─────────────────────────────────────────────────────────────
    const BADGE = {
        PENDIENTE:       ['badge-warning',  'Pendiente'],
        EN_TRANSITO:     ['badge-info',     'En tránsito'],
        RECIBIDO:        ['badge-success',  'Recibido'],
        ANULADO:         ['badge-ghost',    'Anulado'],
        EN_CONTROVERSIA: ['badge-error',    'Controversia'],
    };

    const estadoBadge = (estado) => {
        const [cls, label] = BADGE[estado] || ['badge-ghost', estado];
        return `<span class="badge ${cls} text-xs">${label}</span>`;
    };

    const fmtFecha = (iso) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('es-CO', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const fmtHora = (iso) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleTimeString('es-CO', {
            hour: '2-digit', minute: '2-digit'
        });
    };

    const origenLabel = (t) => {
        if (t.origen?.nombreComercial) return t.origen.nombreComercial;
        if (t.idOrigen === 'PRODUCCION') return 'Producción';
        if (t.idOrigen === 'BODEGA-VIRTUAL') return 'Producción';
        return t.idOrigen || '—';
    };

    // ─── PENDIENTES ──────────────────────────────────────────────────────────
    const loadPendientes = async () => {
        const tbody = document.getElementById('tabla-pendientes');
        if (!tbody) return;
        try {
            const res = await fetch('/store/traslados/pendientes');
            const { success, traslados } = await res.json();
            if (!success) throw new Error();

            if (!traslados.length) {
                tbody.innerHTML = `<tr>
                    <td colspan="5" class="px-4 py-10 text-center text-slate-400 text-sm">
                        <i class="fi fi-rr-check-circle text-emerald-400 mr-2 text-lg"></i>Sin traslados pendientes
                    </td></tr>`;
                return;
            }

            tbody.innerHTML = traslados.map(t => `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-4 py-3 font-mono font-bold text-slate-700 text-xs">${t.codigoTraslado}</td>
                    <td class="px-4 py-3 text-slate-500 text-xs">${origenLabel(t)}</td>
                    <td class="px-4 py-3 text-slate-500 text-xs">${fmtHora(t.fechaEnvio)}</td>
                    <td class="px-4 py-3 text-center">${estadoBadge(t.estado)}</td>
                    <td class="px-4 py-3 text-right">
                        <button class="btn btn-xs btn-primary cursor-pointer"
                            onclick="window._abrirLightbox('${t.idTraslado}')">
                            <i class="fi fi-rr-box-open-full text-xs mr-1"></i>Recibir
                        </button>
                    </td>
                </tr>`).join('');
        } catch {
            tbody.innerHTML = `<tr>
                <td colspan="5" class="px-4 py-10 text-center text-red-400 text-sm">Error al cargar pendientes</td>
            </tr>`;
        }
    };
    window.loadPendientes = loadPendientes;

    // ─── HISTORIAL ───────────────────────────────────────────────────────────
    const loadHistorial = async (busqueda, pagina) => {
        busquedaHistorial = busqueda ?? busquedaHistorial;
        paginaHistorial   = pagina   ?? paginaHistorial;

        const tbody   = document.getElementById('tabla-historial');
        const resumen = document.getElementById('resumen-historial');
        if (!tbody) return;

        try {
            const params = new URLSearchParams({ busqueda: busquedaHistorial, pagina: paginaHistorial });
            const res  = await fetch(`/store/traslados/historial?${params}`);
            const data = await res.json();
            if (!data.success) throw new Error();

            const { traslados, totalPaginas, paginaActual, total } = data;

            if (!traslados.length) {
                tbody.innerHTML = `<tr>
                    <td colspan="4" class="px-4 py-10 text-center text-slate-400 text-sm">Sin registros en el historial</td>
                </tr>`;
                if (resumen) resumen.textContent = '0 registros';
                renderPaginacion(0, 0);
                return;
            }

            tbody.innerHTML = traslados.map(t => {
                const esControversia = t.estado === 'EN_CONTROVERSIA';
                return `
                <tr class="${esControversia ? 'bg-red-50 border-l-2 border-red-400' : 'hover:bg-slate-50'} transition-colors">
                    <td class="px-4 py-3 font-mono font-bold text-slate-700 text-xs">${t.codigoTraslado}</td>
                    <td class="px-4 py-3 text-slate-500 text-xs">${fmtFecha(t.fechaEnvio)}</td>
                    <td class="px-4 py-3 text-center">${estadoBadge(t.estado)}</td>
                    <td class="px-4 py-3 text-right flex gap-1 justify-end">
                        <button class="btn btn-xs btn-ghost cursor-pointer" title="Ver detalle"
                            onclick="window._abrirLightbox('${t.idTraslado}')">
                            <i class="fi fi-rr-eye text-xs"></i>
                        </button>
                        <a href="/store/traslados/comprobante/${t.idTraslado}" target="_blank"
                            class="btn btn-xs btn-ghost cursor-pointer" title="Imprimir comprobante">
                            <i class="fi fi-rr-print text-xs"></i>
                        </a>
                    </td>
                </tr>`;
            }).join('');

            if (resumen) resumen.textContent = `${total} registro${total !== 1 ? 's' : ''}`;
            renderPaginacion(totalPaginas, paginaActual);
        } catch {
            tbody.innerHTML = `<tr>
                <td colspan="4" class="px-4 py-10 text-center text-red-400 text-sm">Error al cargar historial</td>
            </tr>`;
        }
    };

    const renderPaginacion = (totalPaginas, paginaActual) => {
        const container = document.getElementById('paginacion-historial');
        if (!container) return;
        if (totalPaginas <= 1) { container.innerHTML = ''; return; }

        let btns = '';
        for (let i = 1; i <= totalPaginas; i++) {
            btns += `<button class="btn btn-xs ${i === paginaActual ? 'btn-primary' : 'btn-ghost'} cursor-pointer"
                onclick="window._irPagina(${i})">${i}</button>`;
        }
        container.innerHTML = `<div class="flex gap-1 flex-wrap">${btns}</div>`;
    };

    window._irPagina = (p) => loadHistorial(busquedaHistorial, p);

    const inputBusqueda = document.getElementById('busqueda-historial');
    if (inputBusqueda) {
        let searchTimer;
        inputBusqueda.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => loadHistorial(inputBusqueda.value, 1), 400);
        });
    }

    // ─── LIGHTBOX ─────────────────────────────────────────────────────────────
    const lightbox    = document.getElementById('lightbox-traslado');
    const overlay     = document.getElementById('lightbox-overlay');
    const btnClose    = document.getElementById('lb-close');
    const lbTitulo    = document.getElementById('lb-titulo');
    const lbSubtitulo = document.getElementById('lb-subtitulo');
    const lbInfo      = document.getElementById('lb-info');
    const lbItems     = document.getElementById('lb-items');
    const lbRazones   = document.getElementById('lb-razones');
    const lbCodEmp    = document.getElementById('lb-codigo-empleado');
    const lbFeedback  = document.getElementById('lb-feedback-empleado');
    const btnAceptar  = document.getElementById('lb-aceptar');
    const btnCancelar = document.getElementById('lb-cancelar');
    const lbFooter    = document.getElementById('lb-footer');

    const abrirLightbox = async (idTraslado) => {
        if (!lightbox) return;

        lbTitulo.textContent    = 'Cargando...';
        lbSubtitulo.textContent = '—';
        lbInfo.innerHTML  = '';
        lbItems.innerHTML = `<tr>
            <td colspan="4" class="px-3 py-8 text-center text-slate-400 text-sm">
                <i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando...
            </td></tr>`;
        lbRazones.innerHTML = '';
        if (lbCodEmp) lbCodEmp.value = '';
        if (lbFeedback) lbFeedback.innerHTML = '';
        empleadoValidado = null;

        lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        try {
            const res = await fetch(`/store/traslados/detalle/${idTraslado}`);
            const { success, traslado } = await res.json();
            if (!success) throw new Error();
            trasladoActivo = traslado;
            renderLightbox(traslado);
        } catch {
            lbTitulo.textContent = 'Error';
            lbItems.innerHTML    = `<tr>
                <td colspan="4" class="px-3 py-8 text-center text-red-400 text-sm">No se pudo cargar el traslado</td>
            </tr>`;
        }
    };

    window._abrirLightbox = abrirLightbox;

    // ─── RENDER LIGHTBOX ──────────────────────────────────────────────────────
    const renderLightbox = (traslado) => {
        const esPendiente = ['PENDIENTE', 'EN_TRANSITO'].includes(traslado.estado);

        lbTitulo.textContent    = `Traslado ${traslado.codigoTraslado}`;
        lbSubtitulo.textContent = fmtFecha(traslado.fechaEnvio);

        // Info grid
        lbInfo.innerHTML = [
            ['Estado',   estadoBadge(traslado.estado)],
            ['Enviado',  fmtFecha(traslado.fechaEnvio)],
            ['Origen',   origenLabel(traslado)],
            ['Notas',    traslado.notas || '—'],
        ].map(([k, v]) => `
            <div>
                <p class="text-xs text-slate-400 uppercase tracking-wider font-bold mb-0.5">${k}</p>
                <p class="text-sm text-slate-700 font-medium">${v}</p>
            </div>`).join('');

        // Items table
        const items = traslado.items || [];
        if (!items.length) {
            lbItems.innerHTML = `<tr>
                <td colspan="4" class="px-3 py-6 text-center text-slate-400 text-sm">Sin ítems</td>
            </tr>`;
        } else {
            lbItems.innerHTML = items.map((item, i) => {
                const { nombre, detalle } = buildItemLabel(item);

                const yaRecibido      = item.estado === 'RECIBIDO';
                const esControversia  = item.estado === 'CONTROVERSIA';
                const deshabilitado   = !esPendiente ? 'disabled' : '';
                const checkDefault    = (esPendiente || yaRecibido) ? 'checked' : '';

                const iconHtml = (yaRecibido || esPendiente)
                    ? `<i class="fi fi-rr-check text-emerald-500 text-sm"></i>`
                    : `<i class="fi fi-rr-cross-circle text-red-400 text-sm"></i>`;

                return `
                <tr id="item-row-${i}" class="item-row"
                    data-index="${i}"
                    data-id="${item.idDetalleTraslado}"
                    data-pack="${item.idPack || ''}"
                    data-cantidad="${item.cantidad}">
                    <td class="px-3 py-2.5">
                        <input type="checkbox" class="item-check checkbox checkbox-sm checkbox-primary"
                            data-index="${i}" ${checkDefault} ${deshabilitado} />
                    </td>
                    <td class="px-3 py-2.5">
                        <div class="text-sm text-slate-700">${nombre}</div>
                        ${detalle ? `<div class="text-xs text-slate-400 mt-0.5">${detalle}</div>` : ''}
                    </td>
                    <td class="px-3 py-2.5 text-center">
                        <input type="number"
                            class="item-qty input input-xs w-20 text-center font-mono"
                            value="${item.cantidad}"
                            min="0" max="${item.cantidad}"
                            data-original="${item.cantidad}"
                            data-index="${i}"
                            readonly ${deshabilitado}
                            title="Doble clic para editar" />
                    </td>
                    <td class="px-3 py-2.5 text-center" id="item-icon-${i}">${iconHtml}</td>
                </tr>
                <tr id="razon-row-${i}" class="hidden bg-red-50">
                    <td colspan="4" class="px-3 pb-2.5">
                        <textarea class="item-razon w-full text-xs border border-red-200 rounded-xl p-2
                            resize-none focus:outline-none focus:ring-1 focus:ring-red-300"
                            rows="2"
                            placeholder="Describe la incidencia..."
                            data-index="${i}"></textarea>
                    </td>
                </tr>`;
            }).join('');

            activarEventosItems();
        }

        // Incidencias previas
        renderIncidencias(traslado.insidencias || []);

        // Footer según estado
        const footerArea = document.getElementById('lb-footer-form');
        if (footerArea) {
            footerArea.classList.toggle('hidden', !esPendiente);
        }
        if (btnCancelar) {
            btnCancelar.textContent = esPendiente ? 'Cancelar' : 'Cerrar';
        }
        if (btnAceptar) {
            btnAceptar.disabled = !esPendiente;
            btnAceptar.innerHTML = '<i class="fi fi-rr-check mr-2"></i>Aceptar Traslado';
        }
    };

    const buildItemLabel = (item) => {
        if (item.pack) {
            const prods = (item.pack.DetallesPacks || [])
                .map(dp => dp.producto?.nombreProducto)
                .filter(Boolean)
                .join(', ');
            return {
                nombre: `<span class="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">${item.pack.codigoEtiqueta}</span>`,
                detalle: prods
            };
        }
        if (item.producto) {
            return {
                nombre: item.producto.nombreProducto,
                detalle: item.producto.sku || ''
            };
        }
        return { nombre: '—', detalle: '' };
    };

    // ─── EVENTOS ITEMS ────────────────────────────────────────────────────────
    const activarEventosItems = () => {
        document.querySelectorAll('.item-qty').forEach(inp => {
            inp.addEventListener('dblclick', () => {
                if (!inp.disabled) {
                    inp.removeAttribute('readonly');
                    inp.focus();
                    inp.select();
                }
            });
            inp.addEventListener('blur', () => inp.setAttribute('readonly', ''));
            inp.addEventListener('input', () => actualizarIcono(inp.dataset.index));
            inp.addEventListener('change', () => {
                const max = parseInt(inp.dataset.original);
                if (parseInt(inp.value) > max) inp.value = max;
                if (parseInt(inp.value) < 0 || isNaN(parseInt(inp.value))) inp.value = 0;
                actualizarIcono(inp.dataset.index);
            });
        });

        document.querySelectorAll('.item-check').forEach(chk => {
            chk.addEventListener('change', () => actualizarIcono(chk.dataset.index));
        });
    };

    const actualizarIcono = (idx) => {
        const row   = document.getElementById(`item-row-${idx}`);
        const razon = document.getElementById(`razon-row-${idx}`);
        const icon  = document.getElementById(`item-icon-${idx}`);
        if (!row) return;

        const chk     = row.querySelector('.item-check');
        const qty     = row.querySelector('.item-qty');
        const aceptado   = chk?.checked ?? true;
        const cantAcep   = parseInt(qty?.value ?? 0);
        const cantOrig   = parseInt(qty?.dataset.original ?? 0);
        const esProblema = !aceptado || cantAcep < cantOrig;

        if (icon) icon.innerHTML = esProblema
            ? `<i class="fi fi-rr-cross-circle text-red-400 text-sm"></i>`
            : `<i class="fi fi-rr-check text-emerald-500 text-sm"></i>`;

        if (razon) razon.classList.toggle('hidden', !esProblema);
    };

    // ─── INCIDENCIAS ──────────────────────────────────────────────────────────
    const renderIncidencias = (insidencias) => {
        if (!lbRazones) return;
        if (!insidencias.length) { lbRazones.innerHTML = ''; return; }

        lbRazones.innerHTML = `
            <div class="border border-red-200 rounded-2xl p-3 bg-red-50">
                <p class="text-xs font-bold text-red-600 uppercase tracking-wider mb-2">
                    <i class="fi fi-rr-triangle-warning mr-1"></i>Incidencias registradas
                </p>
                ${insidencias.map(ins => `
                    <div class="text-xs text-slate-700 border-b border-red-100 last:border-0 pb-1.5 mb-1.5 last:mb-0">
                        <span class="font-semibold">Ítem #${ins.idDetalleTraslado}:</span>
                        Recibido <strong>${ins.cantidadAceptada}</strong>/${ins.cantidadOriginal} —
                        <span class="italic text-slate-500">${ins.razonInsidencia}</span>
                        ${ins.resuelta === 'si'
                            ? `<span class="ml-1 badge badge-success badge-xs">Resuelta</span>`
                            : `<span class="ml-1 badge badge-error badge-xs">Pendiente</span>`}
                    </div>`).join('')}
            </div>`;
    };

    // ─── CERRAR LIGHTBOX ─────────────────────────────────────────────────────
    const cerrarLightbox = () => {
        if (!lightbox) return;
        lightbox.classList.add('hidden');
        document.body.style.overflow = '';
        trasladoActivo = null;
        empleadoValidado = null;
    };

    overlay?.addEventListener('click', cerrarLightbox);
    btnClose?.addEventListener('click', cerrarLightbox);
    btnCancelar?.addEventListener('click', cerrarLightbox);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cerrarLightbox();
    });

    // ─── LOOKUP EMPLEADO ─────────────────────────────────────────────────────
    lbCodEmp?.addEventListener('input', () => {
        clearTimeout(employeeLookupTimer);
        empleadoValidado = null;
        const code = lbCodEmp.value.trim();

        if (!code) { lbFeedback.innerHTML = ''; return; }

        lbFeedback.innerHTML = `<span class="text-slate-400 text-xs">
            <i class="fi fi-rr-spinner animate-spin mr-1"></i>Buscando...</span>`;

        employeeLookupTimer = setTimeout(async () => {
            try {
                const r = await fetch(`/store/json/personal/codigo/${encodeURIComponent(code.toUpperCase())}`);
                const d = await r.json();
                if (d.success) {
                    empleadoValidado = { idEmpleado: d.idEmpleado, nombre: d.nombre };
                    lbFeedback.innerHTML = `<span class="text-emerald-600 font-semibold text-xs">
                        <i class="fi fi-rr-check mr-1"></i>${d.nombre}</span>`;
                } else {
                    lbFeedback.innerHTML = `<span class="text-red-500 text-xs">
                        <i class="fi fi-rr-cross-circle mr-1"></i>No encontrado</span>`;
                }
            } catch {
                lbFeedback.innerHTML = `<span class="text-red-500 text-xs">Error al buscar</span>`;
            }
        }, 500);
    });

    // ─── SUBMIT ACEPTAR ──────────────────────────────────────────────────────
    btnAceptar?.addEventListener('click', async () => {
        if (!trasladoActivo) return;

        if (!empleadoValidado) {
            window.showToast?.('Ingresa un código de empleado válido.', 'warning');
            lbCodEmp?.focus();
            return;
        }

        // Recopilar items desde el DOM
        const items = [];
        document.querySelectorAll('.item-row').forEach(row => {
            const idx             = row.dataset.index;
            const idDetalleTraslado = parseInt(row.dataset.id);
            const idPack          = row.dataset.pack || null;
            const cantidadOriginal = parseInt(row.dataset.cantidad);
            const chk             = row.querySelector('.item-check');
            const qty             = row.querySelector('.item-qty');
            const razonEl         = document.querySelector(`.item-razon[data-index="${idx}"]`);

            const aceptado        = chk?.checked ?? true;
            const cantidadAceptada = parseInt(qty?.value ?? cantidadOriginal);
            const razon           = razonEl?.value?.trim() || '';

            items.push({ idDetalleTraslado, idPack, cantidadOriginal, cantidadAceptada, aceptado, razon });
        });

        // Validar que los ítems con incidencia tengan razón
        const sinRazon = items.filter(i =>
            (!i.aceptado || i.cantidadAceptada < i.cantidadOriginal) && !i.razon
        );
        if (sinRazon.length) {
            window.showToast?.(`${sinRazon.length} ítem(s) con incidencia sin descripción.`, 'warning');
            return;
        }

        btnAceptar.disabled = true;
        btnAceptar.innerHTML = '<i class="fi fi-rr-spinner animate-spin mr-2"></i>Procesando...';

        try {
            const r = await fetch('/store/traslados/aceptar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({
                    idTraslado: trasladoActivo.idTraslado,
                    codigoEmpleado: lbCodEmp.value.trim().toUpperCase(),
                    items
                })
            });
            const data = await r.json();

            if (data.success) {
                const controversia = data.estado === 'EN_CONTROVERSIA';
                window.showToast?.(
                    controversia
                        ? 'Traslado recibido con incidencias registradas.'
                        : 'Traslado recibido correctamente.',
                    controversia ? 'warning' : 'success'
                );
                cerrarLightbox();
                await loadPendientes();
                await loadHistorial();
            } else {
                window.showToast?.(data.mensaje || 'Error al procesar.', 'error');
                btnAceptar.disabled = false;
                btnAceptar.innerHTML = '<i class="fi fi-rr-check mr-2"></i>Aceptar Traslado';
            }
        } catch {
            window.showToast?.('Error de conexión.', 'error');
            btnAceptar.disabled = false;
            btnAceptar.innerHTML = '<i class="fi fi-rr-check mr-2"></i>Aceptar Traslado';
        }
    });

    // ─── INIT ─────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        loadPendientes();
        loadHistorial();
    });

})();
