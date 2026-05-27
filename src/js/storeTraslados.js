(function () {
    const csrfToken = document.getElementById('csrf-token')?.value || '';

    // ─── ESTADO ──────────────────────────────────────────────────────────────
    let trasladoActivo = null;
    let empleadoValidado = null;
    let paginaHistorial = 1;
    let busquedaHistorial = '';
    let miPdvId = null;

    // ─── HELPERS ─────────────────────────────────────────────────────────────
    const BADGE = {
        PENDIENTE:       ['badge-warning',  'Pendiente'],
        EN_TRANSITO:     ['badge-info',     'En tránsito'],
        RECIBIDO:        ['badge-success',  'Recibido'],
        ANULADO:         ['badge-ghost',    'Anulado'],
        EN_CONTROVERSIA: ['badge-error',    'Controversia'],
        DEVUELTO:        ['badge-ghost',    'Devuelto'],
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

    const _setupLookupEmpleado = (inputEl, feedbackEl, accion, onFound) => {
        if (!inputEl) return;
        let timer;
        inputEl.addEventListener('input', () => {
            clearTimeout(timer);
            onFound(null);
            const code = inputEl.value.trim();
            if (!code) { feedbackEl.innerHTML = ''; return; }
            feedbackEl.innerHTML = `<span class="text-slate-400 text-xs"><i class="fi fi-rr-spinner animate-spin mr-1"></i>Buscando...</span>`;
            timer = setTimeout(async () => {
                try {
                    const r = await fetch(`/store/inventario/json/empleado-traslado?codigo=${encodeURIComponent(code.toUpperCase())}&accion=${accion}`);
                    const d = await r.json();
                    if (d.success) {
                        onFound({ nombre: d.nombre });
                        feedbackEl.innerHTML = `<span class="text-emerald-600 font-semibold text-xs"><i class="fi fi-rr-check mr-1"></i>${d.nombre}</span>`;
                    } else {
                        feedbackEl.innerHTML = `<span class="text-red-500 text-xs"><i class="fi fi-rr-cross-circle mr-1"></i>${d.mensaje || 'Sin permiso'}</span>`;
                    }
                } catch {
                    feedbackEl.innerHTML = `<span class="text-red-500 text-xs">Error al buscar</span>`;
                }
            }, 500);
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
            const { success, traslados, idPdv } = await res.json();
            if (!success) throw new Error();
            if (idPdv) miPdvId = idPdv;

            if (!traslados.length) {
                tbody.innerHTML = `<tr>
                    <td colspan="5" class="px-4 py-10 text-center text-slate-400 text-sm">
                        <i class="fi fi-rr-check-circle text-emerald-400 mr-2 text-lg"></i>Sin traslados pendientes
                    </td></tr>`;
                return;
            }

            tbody.innerHTML = traslados.map(t => {
                const soyDestino = t.idDestino === idPdv;
                const contraparte = soyDestino
                    ? (t.origen?.nombreComercial || origenLabel(t))
                    : (t.destino?.nombreComercial || t.idDestino);
                const dirTag = soyDestino
                    ? `<span class="badge badge-info badge-xs">Entrante</span>`
                    : `<span class="badge badge-ghost badge-xs">Enviado</span>`;
                const accion = soyDestino
                    ? `<button class="btn btn-xs btn-primary cursor-pointer"
                            onclick="window._abrirLightbox('${t.idTraslado}')">
                            <i class="fi fi-rr-box-open-full text-xs mr-1"></i>Recibir
                        </button>`
                    : `<span class="text-xs text-slate-400">En tránsito</span>`;
                return `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-4 py-3 font-mono font-bold text-slate-700 text-xs">${t.codigoTraslado}</td>
                    <td class="px-4 py-3 text-slate-500 text-xs">${contraparte} ${dirTag}</td>
                    <td class="px-4 py-3 text-slate-500 text-xs">${fmtHora(t.fechaEnvio)}</td>
                    <td class="px-4 py-3 text-center">${estadoBadge(t.estado)}</td>
                    <td class="px-4 py-3 text-right">${accion}</td>
                </tr>`;
            }).join('');
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

            const { traslados, totalPaginas, paginaActual, total, idPdv: myPdv } = data;
            data.idPdv = myPdv;
            if (myPdv) miPdvId = myPdv;

            if (!traslados.length) {
                tbody.innerHTML = `<tr>
                    <td colspan="4" class="px-4 py-10 text-center text-slate-400 text-sm">Sin registros en el historial</td>
                </tr>`;
                if (resumen) resumen.textContent = '0 registros';
                renderPaginacion(0, 0);
                return;
            }

            tbody.innerHTML = traslados.map(t => {
                const esControversia   = t.estado === 'EN_CONTROVERSIA';
                const esDevuelto       = t.estado === 'DEVUELTO';
                const soyDestino       = t.idDestino === data.idPdv;
                const soyOrigenCtv     = esControversia && t.idOrigen === data.idPdv;
                const contraparte      = soyDestino
                    ? (t.origen?.nombreComercial  || t.idOrigen)
                    : (t.destino?.nombreComercial || t.idDestino);
                const dirTag = soyDestino
                    ? `<span class="badge badge-info badge-xs ml-1">Recibido</span>`
                    : `<span class="badge badge-ghost badge-xs ml-1">Enviado</span>`;
                const rowCls = soyOrigenCtv
                    ? 'bg-orange-50 border-l-2 border-orange-500'
                    : esControversia
                        ? 'bg-red-50 border-l-2 border-red-400'
                        : esDevuelto
                            ? 'bg-orange-50 border-l-2 border-orange-400'
                            : 'hover:bg-slate-50';
                return `
                <tr class="${rowCls} transition-colors">
                    <td class="px-4 py-3 font-mono font-bold text-slate-700 text-xs">${t.codigoTraslado}</td>
                    <td class="px-4 py-3 text-slate-500 text-xs">${contraparte}${dirTag}</td>
                    <td class="px-4 py-3 text-slate-500 text-xs">${fmtFecha(t.fechaEnvio)}</td>
                    <td class="px-4 py-3 text-center">${estadoBadge(t.estado)}</td>
                    <td class="px-4 py-3 text-right flex gap-1 justify-end">
                        ${soyOrigenCtv ? `
                        <button class="btn btn-xs btn-warning cursor-pointer" title="Resolver controversia"
                            onclick="window._abrirLightbox('${t.idTraslado}')">
                            <i class="fi fi-rr-wrench text-xs mr-1"></i>Resolver
                        </button>` : `
                        <button class="btn btn-xs btn-ghost cursor-pointer" title="Ver detalle"
                            onclick="window._abrirLightbox('${t.idTraslado}')">
                            <i class="fi fi-rr-eye text-xs"></i>
                        </button>`}
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
        window.generarPaginacion('#paginacion-historial', totalPaginas, paginaActual, (p) => loadHistorial(busquedaHistorial, p));
    };

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
        const esPendiente    = ['PENDIENTE', 'EN_TRANSITO'].includes(traslado.estado);
        const esControvTras  = traslado.estado === 'EN_CONTROVERSIA';
        const soyOrigen      = traslado.idOrigen === miPdvId;
        const esInteractivo  = esPendiente || (esControvTras && soyOrigen);

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

                const yaRecibido     = item.estado === 'RECIBIDO';
                const esControversia = item.estado === 'CONTROVERSIA';
                const deshabilitado  = !esPendiente ? 'disabled' : '';
                const checkDefault   = (esPendiente || yaRecibido) ? 'checked' : '';
                // When showing a controversy item to origin, work with the disputed quantity
                const cantMostrar    = esControversia ? (item.cantidadControversia ?? item.cantidad) : item.cantidad;

                let iconHtml;
                if (esControvTras && esControversia) {
                    if (soyOrigen) {
                        iconHtml = `<span class="badge badge-warning text-xs item-resolucion"
                            data-index="${i}"
                            data-id="${item.idDetalleTraslado}"
                            data-pack="${item.idPack || ''}"
                            data-resolucion="RECIBIDO">Se recibirá</span>`;
                    } else {
                        iconHtml = `<span class="badge badge-error text-xs">En controversia</span>`;
                    }
                } else if (yaRecibido || esPendiente) {
                    iconHtml = `<i class="fi fi-rr-check text-emerald-500 text-sm"></i>`;
                } else {
                    iconHtml = `<i class="fi fi-rr-cross-circle text-red-400 text-sm"></i>`;
                }

                return `
                <tr id="item-row-${i}" class="item-row"
                    data-index="${i}"
                    data-id="${item.idDetalleTraslado}"
                    data-pack="${item.idPack || ''}"
                    data-producto="${item.idProducto || ''}"
                    data-cantidad="${cantMostrar}">
                    <td class="px-3 py-2.5">
                        <input type="checkbox" class="item-check checkbox checkbox-sm checkbox-primary"
                            data-index="${i}" ${checkDefault} ${deshabilitado} />
                    </td>
                    <td class="px-3 py-2.5">
                        <div class="text-sm text-slate-700">${nombre}</div>
                        ${detalle ? `<div class="text-sm text-slate-400 mt-0.5">${detalle}</div>` : ''}
                        ${esControversia ? `<div class="text-sm text-orange-500 font-medium mt-0.5">En controversia: ${cantMostrar} uds.</div>` : ''}
                    </td>
                    <td class="px-3 py-2.5 text-center">
                        <input type="number"
                            class="item-qty input input-sm w-24 text-center font-mono"
                            value="${cantMostrar}"
                            min="0" max="${cantMostrar}"
                            data-original="${cantMostrar}"
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
            footerArea.classList.toggle('hidden', !esInteractivo);
        }
        if (btnCancelar) {
            btnCancelar.textContent = esInteractivo ? 'Cancelar' : 'Cerrar';
        }
        if (btnAceptar) {
            if (esControvTras) {
                if (soyOrigen) {
                    btnAceptar.disabled = false;
                    btnAceptar.dataset.modo = 'resolver';
                    btnAceptar.innerHTML = '<i class="fi fi-rr-check mr-2"></i>Resolver Controversia';
                } else {
                    btnAceptar.disabled = true;
                    btnAceptar.dataset.modo = '';
                    btnAceptar.innerHTML = '<i class="fi fi-rr-clock mr-2"></i>Esperando resolución del origen';
                }
            } else {
                btnAceptar.disabled = !esPendiente;
                btnAceptar.dataset.modo = 'aceptar';
                btnAceptar.innerHTML = '<i class="fi fi-rr-check mr-2"></i>Aceptar Traslado';
            }
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
                <p class="text-sm font-bold text-red-600 uppercase tracking-wider mb-2">
                    <i class="fi fi-rr-triangle-warning mr-1"></i>Incidencias registradas
                </p>
                ${insidencias.map(ins => {
                    const codigo = ins.detalle?.pack?.codigoEtiqueta
                        || ins.detalle?.producto?.sku
                        || `#${ins.idDetalleTraslado}`;
                    return `
                    <div class="text-sm text-slate-700 border-b border-red-100 last:border-0 pb-1.5 mb-1.5 last:mb-0">
                        <span class="font-semibold">Ítem ${codigo}:</span>
                        Recibido <strong>${ins.cantidadAceptada}</strong>/${ins.cantidadOriginal} —
                        <span class="italic text-slate-500">${ins.razonInsidencia}</span>
                        ${ins.resuelta === 'si'
                            ? `<span class="ml-1 badge badge-success badge-xs">Resuelta</span>`
                            : `<span class="ml-1 badge badge-error badge-xs">Pendiente</span>`}
                    </div>`;
                }).join('')}
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
    _setupLookupEmpleado(lbCodEmp, lbFeedback, 'EDIT', v => { empleadoValidado = v; });

    // ─── SUBMIT ACEPTAR ──────────────────────────────────────────────────────
    btnAceptar?.addEventListener('click', async () => {
        if (!trasladoActivo) return;

        if (btnAceptar.dataset.modo === 'resolver') {
            await submitResolver();
        } else {
            await submitAceptar();
        }
    });

    const submitAceptar = async () => {
        if (!empleadoValidado) {
            window.showToast?.('Ingresa un código de empleado válido.', 'warning');
            lbCodEmp?.focus();
            return;
        }

        // Recopilar items desde el DOM
        const items = [];
        document.querySelectorAll('.item-row').forEach(row => {
            const idx               = row.dataset.index;
            const idDetalleTraslado = parseInt(row.dataset.id);
            const idPack            = row.dataset.pack || null;
            const idProducto        = row.dataset.producto || null;
            const cantidadOriginal  = parseInt(row.dataset.cantidad);
            const chk               = row.querySelector('.item-check');
            const qty               = row.querySelector('.item-qty');
            const razonEl           = document.querySelector(`.item-razon[data-index="${idx}"]`);

            const aceptado          = chk?.checked ?? true;
            const cantidadAceptada  = parseInt(qty?.value ?? cantidadOriginal);
            const razon             = razonEl?.value?.trim() || '';

            items.push({ idDetalleTraslado, idPack, idProducto, cantidadOriginal, cantidadAceptada, aceptado, razon });
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
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
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
    };

    // ─── SUBMIT RESOLVER CONTROVERSIA ───────────────────────────────────────
    const submitResolver = async () => {
        if (!empleadoValidado) {
            window.showToast?.('Ingresa un código de empleado válido.', 'warning');
            lbCodEmp?.focus();
            return;
        }

        // Recopilar ítems en controversia (todos se aceptan como RECIBIDO)
        const resoluciones = [];
        document.querySelectorAll('.item-resolucion').forEach(el => {
            resoluciones.push({
                idDetalleTraslado: parseInt(el.dataset.id),
                idPack:            el.dataset.pack || null,
                resolucion:        'RECIBIDO'
            });
        });

        if (!resoluciones.length) {
            window.showToast?.('No hay ítems en controversia por resolver.', 'warning');
            return;
        }

        btnAceptar.disabled = true;
        btnAceptar.innerHTML = '<i class="fi fi-rr-spinner animate-spin mr-2"></i>Procesando...';

        try {
            const r = await fetch('/store/traslados/resolver', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({
                    idTraslado:     trasladoActivo.idTraslado,
                    codigoEmpleado: lbCodEmp.value.trim().toUpperCase(),
                    resoluciones
                })
            });
            const data = await r.json();

            if (data.success) {
                window.showToast?.('Controversia resuelta correctamente.', 'success');
                cerrarLightbox();
                await loadPendientes();
                await loadHistorial();
            } else {
                window.showToast?.(data.mensaje || 'Error al resolver.', 'error');
                btnAceptar.disabled = false;
                btnAceptar.innerHTML = '<i class="fi fi-rr-check mr-2"></i>Resolver Controversia';
            }
        } catch {
            window.showToast?.('Error de conexión.', 'error');
            btnAceptar.disabled = false;
            btnAceptar.innerHTML = '<i class="fi fi-rr-check mr-2"></i>Resolver Controversia';
        }
    };

    // ─── INIT ─────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        loadPendientes();
        loadHistorial();
    });

    // ─── NUEVO TRASLADO ───────────────────────────────────────────────────────
    (() => {
        const modal      = document.getElementById('modal-nuevo-traslado');
        const overlay    = document.getElementById('nt-overlay');
        const btnAbrir   = document.getElementById('btn-nuevo-traslado');
        const btnClose   = document.getElementById('nt-close');
        const btnCancelar= document.getElementById('nt-cancelar');
        const btnSubmit  = document.getElementById('nt-submit');
        const btnAgregar = document.getElementById('nt-agregar');
        const tbodyItems = document.getElementById('nt-items');
        const inputEmp   = document.getElementById('nt-codigo-empleado');
        const feedbackEmp= document.getElementById('nt-feedback-empleado');
        const selectDest = document.getElementById('nt-destino');
        const txtNotas   = document.getElementById('nt-notas');

        if (!modal) return;

        let ntItems    = [];   // [{ id, idProducto, sku, nombreProducto, stockDisponible, cantidad }]
        let ntEmpleado = null;
        let ntRowId    = 0;

        // ── Abrir / cerrar ───────────────────────────────────────────────────
        const abrir = async () => {
            ntItems    = [];
            ntEmpleado = null;
            ntRowId    = 0;
            if (inputEmp)  inputEmp.value  = '';
            if (feedbackEmp) feedbackEmp.innerHTML = '';
            if (txtNotas) txtNotas.value = '';
            tbodyItems.innerHTML = '';
            agregarFila();

            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';

            try {
                const r = await fetch('/store/json/destinos');
                const destinos = await r.json();
                selectDest.innerHTML = `<option value="">— Selecciona destino —</option>` +
                    destinos.map(d => `<option value="${d.idPuntoDeVenta}">${d.nombreComercial} (${d.tipo})</option>`).join('');
            } catch {
                selectDest.innerHTML = `<option value="">Error al cargar destinos</option>`;
            }
        };

        const cerrar = () => {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
        };

        btnAbrir?.addEventListener('click', abrir);
        btnClose?.addEventListener('click', cerrar);
        btnCancelar?.addEventListener('click', cerrar);
        overlay?.addEventListener('click', cerrar);

        // ── Filas de ítems ───────────────────────────────────────────────────
        const agregarFila = () => {
            const id = ntRowId++;
            ntItems.push({ id, idProducto: null, sku: '', nombreProducto: '', stockDisponible: 0, cantidad: 1 });

            const tr = document.createElement('tr');
            tr.id = `nt-row-${id}`;
            tr.className = 'align-top';
            tr.innerHTML = `
                <td class="px-3 py-2.5">
                    <input type="text"
                        class="input input-bordered input-sm w-full font-mono uppercase tracking-widest rounded-lg nt-sku"
                        placeholder="SKU..."
                        data-rowid="${id}"
                        autocomplete="off" />
                    <div class="nt-sku-feedback text-xs mt-0.5 min-h-[1rem]"></div>
                </td>
                <td class="px-3 py-2.5">
                    <span class="nt-nombre text-xs text-slate-400 italic">Busca el SKU →</span>
                </td>
                <td class="px-3 py-2.5 text-center">
                    <input type="number"
                        class="input input-bordered input-sm w-20 text-center font-mono rounded-lg nt-qty"
                        value="1" min="1" max="9999"
                        data-rowid="${id}"
                        disabled />
                </td>
                <td class="px-3 py-2.5 text-center">
                    <button class="btn btn-ghost btn-xs text-red-400 hover:text-red-600 cursor-pointer nt-remove"
                        data-rowid="${id}" title="Eliminar fila">
                        <i class="fi fi-rr-trash text-xs"></i>
                    </button>
                </td>`;
            tbodyItems.appendChild(tr);

            // SKU lookup
            const skuInput = tr.querySelector('.nt-sku');
            const feedback = tr.querySelector('.nt-sku-feedback');
            const nombreEl = tr.querySelector('.nt-nombre');
            const qtyInput = tr.querySelector('.nt-qty');
            let skuTimer;

            skuInput.addEventListener('input', () => {
                clearTimeout(skuTimer);
                const val = skuInput.value.trim();
                if (!val) {
                    feedback.innerHTML = '';
                    nombreEl.innerHTML = `<span class="text-slate-400 italic">Busca el SKU →</span>`;
                    qtyInput.disabled = true;
                    qtyInput.max = 9999;
                    const item = ntItems.find(i => i.id === id);
                    if (item) { item.idProducto = null; item.stockDisponible = 0; }
                    return;
                }
                feedback.innerHTML = `<span class="text-slate-400"><i class="fi fi-rr-spinner animate-spin mr-1"></i>Buscando...</span>`;
                skuTimer = setTimeout(async () => {
                    try {
                        const r = await fetch(`/store/json/traslados/buscar-sku?sku=${encodeURIComponent(val.toUpperCase())}`);
                        const d = await r.json();
                        if (d.success) {
                            // Deduplicar: si ya existe este SKU en otra fila, rechazar
                            const duplicado = ntItems.find(i => i.id !== id && i.sku === d.sku);
                            if (duplicado) {
                                feedback.innerHTML = `<span class="text-orange-500 text-xs">SKU ya está en otra fila — edita esa cantidad</span>`;
                                nombreEl.innerHTML = `<span class="text-slate-400 italic text-xs">Duplicado</span>`;
                                qtyInput.disabled = true;
                                const item = ntItems.find(i => i.id === id);
                                if (item) item.idProducto = null;
                                return;
                            }

                            // Calcular stock restante (descontar lo ya asignado en otras filas del mismo producto)
                            const yaAsignado = ntItems
                                .filter(i => i.id !== id && i.idProducto === d.idProducto)
                                .reduce((s, i) => s + i.cantidad, 0);
                            const stockRestante = d.stockDisponible - yaAsignado;

                            const item = ntItems.find(i => i.id === id);
                            if (item) {
                                item.idProducto     = d.idProducto;
                                item.sku            = d.sku;
                                item.nombreProducto = d.nombreProducto;
                                item.stockDisponible= d.stockDisponible;
                            }
                            nombreEl.innerHTML = `<span class="text-slate-700 font-medium text-xs">${d.nombreProducto}</span>`;
                            qtyInput.max = stockRestante;
                            if (stockRestante <= 0) {
                                feedback.innerHTML = `<span class="text-red-500 text-xs">Sin stock disponible</span>`;
                                qtyInput.disabled = true;
                            } else {
                                feedback.innerHTML = `<span class="text-emerald-600 text-xs">Disponible: ${stockRestante}</span>`;
                                qtyInput.disabled = false;
                                qtyInput.value = Math.min(parseInt(qtyInput.value) || 1, stockRestante);
                            }
                        } else {
                            nombreEl.innerHTML = `<span class="text-red-400 italic text-xs">No encontrado</span>`;
                            feedback.innerHTML = `<span class="text-red-400 text-xs">${d.mensaje || 'SKU no existe'}</span>`;
                            qtyInput.disabled = true;
                            const item = ntItems.find(i => i.id === id);
                            if (item) item.idProducto = null;
                        }
                    } catch {
                        feedback.innerHTML = `<span class="text-red-400 text-xs">Error de conexión</span>`;
                    }
                }, 500);
            });

            // qty change → actualizar ntItems
            qtyInput.addEventListener('change', () => {
                const max = parseInt(qtyInput.max) || 9999;
                let val = parseInt(qtyInput.value) || 1;
                if (val < 1) val = 1;
                if (val > max) val = max;
                qtyInput.value = val;
                const item = ntItems.find(i => i.id === id);
                if (item) item.cantidad = val;
            });

            // remove row
            tr.querySelector('.nt-remove').addEventListener('click', () => {
                ntItems = ntItems.filter(i => i.id !== id);
                tr.remove();
            });
        };

        btnAgregar?.addEventListener('click', agregarFila);

        // ── Validación empleado ──────────────────────────────────────────────
        _setupLookupEmpleado(inputEmp, feedbackEmp, 'CREATE', v => { ntEmpleado = v; });

        // ── Submit ───────────────────────────────────────────────────────────
        btnSubmit?.addEventListener('click', async () => {
            const idDestino = selectDest?.value;
            if (!idDestino) {
                window.showToast?.('Selecciona un destino.', 'warning'); return;
            }
            if (!ntEmpleado) {
                window.showToast?.('Ingresa un código de empleado válido.', 'warning');
                inputEmp?.focus(); return;
            }

            // Leer cantidades actuales del DOM antes de validar
            tbodyItems.querySelectorAll('tr').forEach(tr => {
                const rowId  = parseInt(tr.id.replace('nt-row-', ''));
                const qtyEl  = tr.querySelector('.nt-qty');
                const item   = ntItems.find(i => i.id === rowId);
                if (item && qtyEl) item.cantidad = parseInt(qtyEl.value) || 1;
            });

            const validos = ntItems.filter(i => i.idProducto && i.cantidad > 0);
            if (!validos.length) {
                window.showToast?.('Agrega al menos un producto con SKU válido.', 'warning'); return;
            }
            const sinStock = validos.filter(i => i.cantidad > i.stockDisponible);
            if (sinStock.length) {
                window.showToast?.(`Cantidad supera el stock disponible en: ${sinStock.map(i => i.sku).join(', ')}`, 'warning'); return;
            }

            btnSubmit.disabled = true;
            btnSubmit.innerHTML = '<i class="fi fi-rr-spinner animate-spin mr-2"></i>Procesando...';

            try {
                const r = await fetch('/store/traslados/crear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                    body: JSON.stringify({
                        items:          validos.map(i => ({ idProducto: i.idProducto, sku: i.sku, cantidad: i.cantidad })),
                        idDestino,
                        codigoEmpleado: inputEmp.value.trim().toUpperCase(),
                        notas:          txtNotas?.value.trim() || null
                    })
                });
                const data = await r.json();

                if (data.success) {
                    cerrar();
                    await loadHistorial();
                    window.open(`/store/traslados/comprobante/${data.idTraslado}`, '_blank');
                } else {
                    window.showToast?.(data.mensaje || 'Error al crear el traslado.', 'error');
                    btnSubmit.disabled = false;
                    btnSubmit.innerHTML = '<i class="fi fi-rr-paper-plane mr-2"></i>Hacer Traslado';
                }
            } catch {
                window.showToast?.('Error de conexión.', 'error');
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = '<i class="fi fi-rr-paper-plane mr-2"></i>Hacer Traslado';
            }
        });
    })();

})();
