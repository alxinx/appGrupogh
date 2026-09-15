import { crearSeleccionMultiple } from './seleccionMultiple.js';
import { montarHistorialTraslado } from './historialTraslado.js';
import { pillEstadoTraslado } from './estadoTraslado.js';
import { escaparHtml as esc } from './escaparHtml.js';

(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const cargarMetadata = async () => {
            const pathParts = window.location.pathname.split('/');
            const id = pathParts[pathParts.length - 1]; // El ID es el último segmento: /admin/dosificaciones/ver/:id

            try {
                const res = await fetch(`/admin/api/dosificaciones/metadata/${id}`);
                const data = await res.json();

                // Solo actualizamos los widgets de arriba
                if (document.querySelector('#widget-fecha-creacion'))
                    document.querySelector('#widget-fecha-creacion').innerText = data.fechaFormateada;

                if (document.querySelector('#widget-units-pack'))
                    document.querySelector('#widget-units-pack').innerText = data.unidadesPorPaquete;

                if (document.querySelector('#widget-sobrantes'))
                    document.querySelector('#widget-sobrantes').innerText = data.sobrantes;

                if (document.querySelector('#widget-total-bultos'))
                    document.querySelector('#widget-total-bultos').innerText = data.totalBultos;

                if (document.querySelector('#widget-total-productos'))
                    document.querySelector('#widget-total-productos').innerText = data.totalUnidades;

            } catch (error) {
                console.error('Error cargando widgets:', error);
            }
        };

        const initPacksList = () => {
            const tbody = document.querySelector('#tbodyPacks');
            const busquedaInput = document.querySelector('#busquedaPack');
            const selectAll = document.querySelector('#selectAllPacks');
            const btnTrasladar = document.querySelector('#btnTrasladarPacks');
            const paginacionContenedor = '#paginacionPacks';

            let filteredPacks = window.initialPacks || [];
            const seleccion = crearSeleccionMultiple({ selectorCheckbox: '.checkbox-pack', selectAll, boton: btnTrasladar });
            let currentPage = 1;
            const itemsPerPage = 10;

            const renderTable = (page) => {
                currentPage = page;
                const start = (page - 1) * itemsPerPage;
                const end = start + itemsPerPage;
                const paginatedPacks = filteredPacks.slice(start, end);

                tbody.innerHTML = paginatedPacks.map(pack => {
                    let tipoClass = pack.tipo === 'RESIDUO' ? 'bg-[#ffebf0] text-[#ff4d7d]' : 'status-active';
                    let estadoClass = 'bg-slate-100 text-slate-500';
                    let displayStyle;
                    let ocultarElemento;
                    switch (pack.estado) {
                        case 'EMPACADO': 
                            estadoClass = 'status-active'; // Verde esmeralda
                            break;
                        case 'SEPARADO': 
                            estadoClass = 'status-pending'; // Ámbar/Naranja
                            ocultarElemento = 'display: none;'; // Ocultamos acciones si ya se despachó

                            break;
                        case 'TRASLADADO': 
                            estadoClass = 'bg-gh-primarySoft text-gh-primaryHover border-gh-primary'; // Fucsia/Morado
                            ocultarElemento = 'display: none;'; // Ocultamos acciones si ya se despachó

                            break;
                        case 'DESPACHADO': 
                            estadoClass = 'bg-blue-50 text-blue-700 border-blue-200'; 
                            ocultarElemento = 'display: none;'; // Ocultamos acciones si ya se despachó
                            break;
                        case 'ANULADO': 
                            estadoClass = 'status-low'; // Rojo/Pink
                            ocultarElemento = 'display: none;'; // Ocultamos acciones si ya se despachó

                            break;
                        default:
                            estadoClass = 'bg-gray-100 text-gray-600';
                    }

                    const esTrasladable = pack.estado === 'EMPACADO';
                    const checkboxHTML = esTrasladable 
                        ? `<input type="checkbox" name="selectedPack" value="${pack.idPack}" ${seleccion.estaMarcado(pack.idPack) ? 'checked' : ''} class="checkbox-pack w-4 h-4 rounded border-slate-200 text-gh-primaryHover focus:ring-gh-primaryHover">`
                        : `<span class="fi-rr-lock text-slate-300" title="No disponible para traslado"></span>`;

                    return `
                        <tr class="bg-white hover:bg-slate-50 transition-colors group border border-transparent hover:border-slate-100">
                            <td class="px-4 py-4 text-center rounded-l-2xl">

                               ${checkboxHTML}
                            </td>
                            <td class="px-4 py-4">
                                <div class="flex items-center gap-3">
                                    <span class="fi-rr-barcode-read text-slate-400 text-lg"></span>
                                    <span class="font-mono font-bold h3">
                                        <a href = "../etiquetas/unica/${pack.idPack}" target = "_blank" >
                                            ${pack.codigoEtiqueta}
                                        </a>
                                    </span>
                                </div>
                            </td>
                            <td class="px-4 py-4"><span class="text-slate-500 font-medium">LT-${pack.numLote}</span></td>
                            <td class="px-4 py-4"><span class="status-chip  ${tipoClass}">${pack.tipo}</span></td>
                            <td class="px-4 py-4"><span class="status-chip  ${estadoClass}">${pack.estado}</span></td>
                            <td class="px-4 py-4 text-right rounded-r-2xl">
                                <div class="flex items-center justify-end gap-2">
                                    <button type="button" class="btn-ver-historial p-2 text-slate-400 hover:text-gh-primaryHover hover:bg-gh-primaryHover/5 rounded-lg transition-colors" title="Ver Detalle" data-id="${pack.idPack}" data-codigo="${pack.codigoEtiqueta}"><span class="fi-rr-eye"></span></button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');

                // Actualizar contadores
                const total = filteredPacks.length;
                document.querySelector('#packsCountStart').innerText = total > 0 ? start + 1 : 0;
                document.querySelector('#packsCountEnd').innerText = Math.min(end, total);
                document.querySelector('#packsCountTotal').innerText = total;

                // Generar Paginación
                if (window.generarPaginacion) {
                    const totalPaginas = Math.ceil(total / itemsPerPage);
                    window.generarPaginacion(paginacionContenedor, totalPaginas, page, (nuevaPagina) => {
                        renderTable(nuevaPagina);
                    });
                }

                seleccion.enlazar();

                // Bind botones de historial
                document.querySelectorAll('.btn-ver-historial').forEach(btn => {
                    btn.addEventListener('click', () => {
                        window.abrirHistorialPack(btn.dataset.id, btn.dataset.codigo);
                    });
                });
            };

            // ── Filtros de lote, tipo y estado ────────────────────────────────
            const fLote   = document.querySelector('#filtroLote');
            const fTipo   = document.querySelector('#filtroTipo');
            const fEstado = document.querySelector('#filtroEstado');
            const btnLimpiar = document.querySelector('#limpiarFiltrosPack');
            const contador   = document.querySelector('#contadorPacks');
            const todos = () => window.initialPacks || [];

            // Las opciones salen de los datos reales, no de una lista fija: si mañana
            // aparece un tipo o estado nuevo, el filtro lo muestra sin tocar código.
            const llenar = (select, valores, etiqueta) => {
                if (!select) return;
                const actual = select.value;
                select.innerHTML = `<option value="">${etiqueta}</option>` +
                    valores.map(v => `<option value="${v}">${etiqueta === 'Todos los lotes' ? 'LT-' + v : v}</option>`).join('');
                if (valores.includes(actual) || actual === '') select.value = actual;
            };
            const unicos = (fn, numerico = false) => {
                const vals = [...new Set(todos().map(fn).filter(v => v !== null && v !== undefined && v !== ''))];
                return numerico ? vals.sort((a, b) => a - b).map(String) : vals.sort();
            };
            llenar(fLote,   unicos(p => p.numLote, true), 'Todos los lotes');
            llenar(fTipo,   unicos(p => p.tipo),          'Todos los tipos');
            llenar(fEstado, unicos(p => p.estado),        'Todos los estados');

            const aplicarFiltros = () => {
                const term = (busquedaInput?.value || '').toLowerCase().trim();
                // "LT-2" en el buscador también debe funcionar, no solo el número suelto.
                const termLote = term.replace(/^lt-?/, '');
                filteredPacks = todos().filter(p => {
                    if (fLote?.value   && String(p.numLote) !== fLote.value)   return false;
                    if (fTipo?.value   && p.tipo   !== fTipo.value)            return false;
                    if (fEstado?.value && p.estado !== fEstado.value)          return false;
                    if (!term) return true;
                    return (p.codigoEtiqueta || '').toLowerCase().includes(term)
                        || String(p.numLote).includes(termLote);
                });
                const hayFiltro = !!(fLote?.value || fTipo?.value || fEstado?.value || term);
                btnLimpiar?.classList.toggle('hidden', !hayFiltro);
                if (contador) contador.textContent = hayFiltro
                    ? `${filteredPacks.length} de ${todos().length} bultos`
                    : `${todos().length} bultos`;
                renderTable(1);
            };

            busquedaInput?.addEventListener('input', aplicarFiltros);
            [fLote, fTipo, fEstado].forEach(sel => sel?.addEventListener('change', aplicarFiltros));
            btnLimpiar?.addEventListener('click', () => {
                if (busquedaInput) busquedaInput.value = '';
                [fLote, fTipo, fEstado].forEach(sel => { if (sel) sel.value = ''; });
                aplicarFiltros();
            });
            aplicarFiltros();

            // Lógica del Modal
            const modal = document.querySelector('#modalTraslado');
            const selectDestino = document.querySelector('#idDestinoTraslado');
            const confirmBtn = document.querySelector('#confirmTraslado');
            const countSpan = document.querySelector('#countPacksSelected');
            const inputCodigo = document.querySelector('#codigoEmpleadoDespacha');
            const feedbackEmpleado = document.querySelector('#feedbackEmpleadoDespacha');
            const textareaNotas = document.querySelector('#notasTraslado');

            let idEmpleadoDespacha = null;
            let busquedaTimer = null;

            const resetEmpleado = () => {
                idEmpleadoDespacha = null;
                feedbackEmpleado.textContent = '';
                feedbackEmpleado.className = 'text-xs ml-2 h-4';
            };

            const buscarEmpleado = async (codigo) => {
                if (!codigo || codigo.length < 3) { resetEmpleado(); return; }
                try {
                    const res = await fetch(`/admin/json/personal/codigo/${codigo.trim().toUpperCase()}`);
                    const data = await res.json();
                    if (data.success) {
                        idEmpleadoDespacha = data.idEmpleado;
                        feedbackEmpleado.textContent = `✓ ${data.nombre}`;
                        feedbackEmpleado.className = 'text-xs ml-2 h-4 text-emerald-600 font-semibold';
                    } else {
                        idEmpleadoDespacha = null;
                        feedbackEmpleado.textContent = '✗ Código no encontrado';
                        feedbackEmpleado.className = 'text-xs ml-2 h-4 text-red-500 font-semibold';
                    }
                } catch (_) {
                    resetEmpleado();
                }
            };

            inputCodigo.addEventListener('input', () => {
                clearTimeout(busquedaTimer);
                resetEmpleado();
                busquedaTimer = setTimeout(() => buscarEmpleado(inputCodigo.value), 400);
            });

            btnTrasladar.addEventListener('click', async () => {
                countSpan.innerText = seleccion.seleccionados.size;
                inputCodigo.value = '';
                textareaNotas.value = '';
                resetEmpleado();
                modal.classList.remove('hidden');

                if (selectDestino.options.length <= 1) {
                    try {
                        const res = await fetch('/admin/json/tiendas');
                        const tiendas = await res.json();
                        tiendas.forEach(t => {
                            const opt = document.createElement('option');
                            opt.value = t.idPuntoDeVenta;
                            opt.text = t.nombreComercial;
                            selectDestino.add(opt);
                        });
                    } catch (e) {
                        console.error('Error cargando tiendas', e);
                    }
                }
            });

            document.querySelector('#closeModalTraslado').onclick = () => modal.classList.add('hidden');
            document.querySelector('#cancelTraslado').onclick = () => modal.classList.add('hidden');

            const alerta = (opts) => window.Swal?.fire({ confirmButtonColor: '#7e22ce', ...opts });

            confirmBtn.addEventListener('click', async () => {
                const idDestino = selectDestino.value;
                if (!idDestino) {
                    alerta({ icon: 'error', title: 'Selecciona un destino', text: 'Debes elegir una bodega o almacén.' });
                    return;
                }
                if (!idEmpleadoDespacha) {
                    alerta({ icon: 'error', title: 'Código requerido', text: 'Ingresa el código del empleado responsable.' });
                    inputCodigo.focus();
                    return;
                }

                const selectedPacks = [...seleccion.seleccionados];
                const notas = textareaNotas?.value?.trim() || '';

                confirmBtn.disabled = true;
                confirmBtn.innerText = 'Procesando...';

                try {
                    const res = await fetch('/admin/dosificaciones/trasladar', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content
                        },
                        body: JSON.stringify({ packs: selectedPacks, idDestino, idEmpleadoDespacha, notas })
                    });

                    const result = await res.json();
                    if (result.success) {
                        window.open(`/admin/dosificaciones/comprobante/${result.idTraslado}`, '_blank');
                        window.location.reload();
                    } else {
                        alerta({ icon: 'warning', title: 'Error', text: result.mensaje });
                    }
                } catch (error) {
                    console.error('Error en traslado', error);
                    alerta({ icon: 'error', title: 'Error de servidor', text: 'Error al comunicarse con el servidor.' });
                } finally {
                    confirmBtn.disabled = false;
                    confirmBtn.innerText = 'Confirmar Traslado';
                }
            });

            renderTable(1);
        };

        // ─── HISTORIAL DE PACK ───────────────────────────────────────────────────
        const modalHistorial   = document.querySelector('#modalHistorialPack');
        const historialBody    = document.querySelector('#historial-body');
        const historialCodigo  = document.querySelector('#historial-codigo');
        const cerrarHistorial  = document.querySelector('#cerrarModalHistorial');

        if (cerrarHistorial) cerrarHistorial.onclick = () => modalHistorial.classList.add('hidden');
        if (modalHistorial)  modalHistorial.addEventListener('click', (e) => {
            if (e.target === modalHistorial) modalHistorial.classList.add('hidden');
        });

        const estadoChip = (estado) => {
            const mapa = {
                EMPACADO:    'bg-emerald-100 text-emerald-700',
                SEPARADO:    'bg-amber-100 text-amber-700',
                DESPACHADO:  'bg-blue-100 text-blue-700',
                TRASLADADO:  'bg-purple-100 text-purple-700',
                DESEMPACADO: 'bg-orange-100 text-orange-700',
                RECIBIDO:    'bg-teal-100 text-teal-700',
                ANULADO:     'bg-red-100 text-red-600',
                EN_TRANSITO: 'bg-sky-100 text-sky-700',
                PENDIENTE:   'bg-yellow-100 text-yellow-700',
            };
            return `<span class="px-2 py-0.5 rounded-full text-xs font-bold ${mapa[estado] || 'bg-gray-100 text-gray-600'}">${estado}</span>`;
        };

        const fmtFecha = (f) => f ? new Date(f).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

        window.abrirHistorialPack = async (idPack, codigo) => {
            if (!modalHistorial) return;
            historialCodigo.textContent = codigo;
            historialBody.innerHTML = '<p class="text-center text-slate-400 py-8 animate-pulse">Cargando historial...</p>';
            modalHistorial.classList.remove('hidden');

            try {
                const res  = await fetch(`/admin/api/pack/${idPack}/historial`);
                const data = await res.json();

                let html = '';

                // Estado actual del pack
                html += `
                <div class="rounded-2xl border border-slate-100 p-4 bg-slate-50">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Estado actual del paquete</p>
                    <div class="flex flex-wrap gap-3 text-sm">
                        <span>Estado: ${estadoChip(data.pack.estado)}</span>
                        <span class="text-slate-500">Tipo: <strong>${data.pack.tipo}</strong></span>
                        <span class="text-slate-500">Lote: <strong>LT-${data.pack.numLote}</strong></span>
                        <span class="text-slate-500">Reimpresiones: <strong>${data.pack.contadorReimpresiones ?? 0}</strong></span>
                        ${data.desempacado ? '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700">Fue desempacado</span>' : ''}
                    </div>
                </div>`;

                // Traslados: cada uno con el historial de ESTE pack, pintado con el mismo
                // componente que el detalle de un traslado en la tienda y en /admin/traslados.
                if (data.traslados.length === 0) {
                    html += `<div class="text-center text-slate-400 py-4 text-sm">Sin traslados registrados.</div>`;
                } else {
                    html += `<p class="text-xs font-bold text-slate-400 uppercase tracking-wider mt-2">Traslados (${data.traslados.length})</p>`;
                    data.traslados.forEach((t, i) => {
                        html += `
                        <div class="rounded-2xl border border-slate-100 bg-white p-4 space-y-3">
                            <div class="flex items-start justify-between gap-2">
                                <div class="min-w-0">
                                    <p class="text-xs text-slate-400"><span class="font-mono font-semibold text-slate-500">${esc(t.codigo || '')}</span> · ${fmtFecha(t.fecha)}</p>
                                    <p class="flex items-center gap-2 text-sm font-semibold text-slate-700 mt-0.5">
                                        <span>${esc(t.origen)}</span>
                                        <i class="fi fi-rr-arrow-right text-[10px] text-slate-300" aria-hidden="true"></i>
                                        <span>${esc(t.destino)}</span>
                                    </p>
                                </div>
                                ${pillEstadoTraslado(t.estado)}
                            </div>
                            <div class="space-y-3" data-historial-traslado="${i}"></div>
                        </div>`;
                    });
                }

                historialBody.innerHTML = html;
                historialBody.querySelectorAll('[data-historial-traslado]').forEach((contenedor) => {
                    montarHistorialTraslado(contenedor)(data.traslados[contenedor.dataset.historialTraslado].historial);
                });
            } catch (e) {
                historialBody.innerHTML = '<p class="text-center text-red-400 py-8">Error al cargar el historial.</p>';
            }
        };

        // ── IMPRIMIR ETIQUETAS: PDF o Excel ──────────────────────────────────
        // El PDF trae una etiqueta por paquete con su código de barras, listo para
        // imprimir. El Excel trae la planilla de códigos del lote para pasarlos a otro
        // sistema. Los dos salen del mismo endpoint, que se ramifica por ?format.
        document.querySelectorAll('.btn-etiquetas-lote').forEach(btn => {
            btn.addEventListener('click', async () => {
                const url = btn.dataset.url;
                const lote = btn.dataset.lote;

                const eleccion = await Swal.fire({
                    title: `Etiquetas del lote ${lote}`,
                    html: '<p style="margin:0;font-size:14px;color:#64748b;">¿En qué formato las querés?</p>',
                    showDenyButton: true,
                    showCancelButton: true,
                    confirmButtonText: 'PDF para imprimir',
                    denyButtonText: 'Excel de códigos',
                    cancelButtonText: 'Cancelar',
                    reverseButtons: true,
                    confirmButtonColor: '#EC5FA3',
                    denyButtonColor: '#217346',
                    focusConfirm: true
                });

                // El PDF se sirve inline: se abre en una pestaña para revisarlo antes de
                // mandarlo a la impresora. El Excel viene con Content-Disposition
                // attachment, así que un <a> lo baja sin sacar al operador de la página.
                if (eleccion.isConfirmed) {
                    window.open(url, '_blank', 'noopener');
                } else if (eleccion.isDenied) {
                    const enlace = document.createElement('a');
                    enlace.href = `${url}?format=excel`;
                    enlace.click();
                }
            });
        });

        cargarMetadata();
        initPacksList();
    });
})();