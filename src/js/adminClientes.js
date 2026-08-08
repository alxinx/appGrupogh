(function () {
    'use strict';

    const fmtCOP = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;

    const fmtFecha = (val) => {
        if (!val) return '—';
        const d = new Date(val + 'T00:00:00');
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const capitalizar = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

    // "Cliente desde junio 2025" — createdAt viene como datetime ISO completo
    const fmtMesAnio = (val) => {
        if (!val) return null;
        const d = new Date(val);
        if (isNaN(d)) return null;
        return `${d.toLocaleDateString('es-CO', { month: 'long' })} ${d.getFullYear()}`;
    };

    // Descompone una fecha DATEONLY en las tres líneas de la píldora de fecha
    const partesFecha = (val) => {
        if (!val) return { dia: '—', mesAnio: '' };
        const d = new Date(val + 'T00:00:00');
        if (isNaN(d)) return { dia: '—', mesAnio: '' };
        const mes = d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
        return { dia: String(d.getDate()).padStart(2, '0'), mesAnio: `${capitalizar(mes)} ${d.getFullYear()}` };
    };

    // horaEmision llega como TIME de MySQL ("10:42:00")
    const fmtHora = (val) => {
        if (!val) return '';
        const [h, m] = String(val).split(':');
        if (h === undefined || m === undefined) return '';
        const d = new Date();
        d.setHours(parseInt(h), parseInt(m), 0, 0);
        return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    // ─── STATS TARJETAS ───────────────────────────────────────────────────────
    const countUp = (el, to, formateador) => {
        if (!el) return;
        const from  = parseFloat(el.dataset.val || '0');
        const toVal = parseFloat(to) || 0;
        if (from === toVal) return;
        el.dataset.val = toVal;
        const duration = 800;
        const start    = performance.now();
        const step = (ts) => {
            const progress = Math.min((ts - start) / duration, 1);
            const eased    = 1 - Math.pow(1 - progress, 3);
            const current  = from + (toVal - from) * eased;
            el.textContent = formateador ? formateador(current) : Math.round(current).toLocaleString('es-CO');
            if (progress < 1) requestAnimationFrame(step);
            else el.textContent = formateador ? formateador(toVal) : Math.round(toVal).toLocaleString('es-CO');
        };
        requestAnimationFrame(step);
    };

    const mostrarTrend = (wrapId, iconId, pctId, pct) => {
        const wrap  = document.getElementById(wrapId);
        const icon  = document.getElementById(iconId);
        const pctEl = document.getElementById(pctId);
        if (!wrap || pct === null || pct === undefined) return;
        const sube = pct >= 0;
        wrap.className = `mt-4 flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg ${sube ? 'text-emerald-600 bg-emerald-50' : 'text-red-500 bg-red-50'}`;
        if (icon)  icon.className   = `fi fi-rr-arrow-trend-${sube ? 'up' : 'down'}`;
        if (pctEl) pctEl.textContent = `${sube ? '+' : ''}${pct}% vs período anterior`;
        wrap.classList.remove('hidden');
    };

    const actualizarStats = ({ nuevos, recurrentes, ticket, vip }) => {
        countUp(document.getElementById('stat-cli-nuevos'), nuevos.total);
        mostrarTrend('stat-cli-nuevos-trend', 'stat-cli-nuevos-icon', 'stat-cli-nuevos-pct', nuevos.pct);
        countUp(document.getElementById('stat-cli-recu'), recurrentes.total);
        countUp(document.getElementById('stat-cli-ticket'), ticket.valor, fmtCOP);
        mostrarTrend('stat-cli-ticket-trend', 'stat-cli-ticket-icon', 'stat-cli-ticket-pct', ticket.pct);
        countUp(document.getElementById('stat-cli-vip'), vip.total);
    };

    // ─── PANEL: TABS ─────────────────────────────────────────────────────────
    const tabs = ['resumen', 'historial', 'archivos'];

    const activarTab = (nombre) => {
        tabs.forEach(t => {
            const btn = document.querySelector(`.panel-tab[data-tab="${t}"]`);
            const pane = document.getElementById(`tab-${t}`);
            if (btn) {
                if (t === nombre) {
                    btn.style.borderColor = '#EC5FA3';
                    btn.style.color       = '#EC5FA3';
                    btn.style.fontWeight  = '700';
                } else {
                    btn.style.borderColor = 'transparent';
                    btn.style.color       = '#94a3b8';
                    btn.style.fontWeight  = '600';
                }
            }
            if (pane) pane.classList.toggle('hidden', t !== nombre);
        });
        if (nombre === 'historial') cargarHistorial(idClienteActivo, 1);
        if (nombre === 'archivos')  cargarArchivos(idClienteActivo);
    };

    document.querySelectorAll('.panel-tab').forEach(btn => {
        btn.addEventListener('click', () => activarTab(btn.dataset.tab));
    });

    // ─── PANEL: PERFIL ────────────────────────────────────────────────────────
    let idClienteActivo = null;

    const setTexto = (id, val, fallback = '—') => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || fallback;
    };

    // ─── PANEL: CRÉDITO ──────────────────────────────────────────────────────
    let creditoActivo = false;

    const BTN_ACCION_BASE = 'flex flex-col items-center gap-2 py-3 px-1 w-full transition-colors';
    const TILE_BASE       = 'w-9 h-9 rounded-xl flex items-center justify-center';
    const LABEL_BASE      = 'text-[10px] font-bold leading-tight text-center';

    const actualizarBtnCredito = (credito, puedeActivar) => {
        const btn   = document.getElementById('panel-btn-credito');
        const tile  = document.getElementById('panel-credito-tile');
        const icon  = document.getElementById('panel-credito-icon');
        const label = document.getElementById('panel-credito-label');
        if (!btn) return;

        if (credito) {
            // Ya tiene crédito activado
            btn.disabled  = true;
            btn.className = `${BTN_ACCION_BASE} cursor-default`;
            if (tile)  tile.className = `${TILE_BASE} bg-emerald-50`;
            if (icon)  icon.className = 'fi fi-rr-badge-check text-sm text-emerald-500 flex items-center justify-center';
            if (label) { label.textContent = 'Con crédito'; label.className = `${LABEL_BASE} text-emerald-500`; }
        } else if (!puedeActivar) {
            // Sin permiso
            btn.disabled  = true;
            btn.className = `${BTN_ACCION_BASE} cursor-not-allowed`;
            if (tile)  tile.className = `${TILE_BASE} bg-slate-100`;
            if (icon)  icon.className = 'fi fi-rr-lock text-sm text-slate-300 flex items-center justify-center';
            if (label) { label.textContent = 'Sin permiso'; label.className = `${LABEL_BASE} text-slate-300`; }
        } else {
            // Puede activar
            btn.disabled  = false;
            btn.className = `${BTN_ACCION_BASE} hover:bg-slate-50 cursor-pointer`;
            if (tile)  tile.className = `${TILE_BASE} bg-violet-50`;
            if (icon)  icon.className = 'fi fi-rr-hand-holding-usd text-sm text-violet-500 flex items-center justify-center';
            if (label) { label.textContent = 'Activar crédito'; label.className = `${LABEL_BASE} text-slate-700`; }
        }
    };

    document.getElementById('panel-btn-credito')?.addEventListener('click', () => {
        if (creditoActivo) return;
        const nombreEl = document.getElementById('panel-nombre');
        const modalNombre = document.getElementById('modal-credito-nombre');
        if (modalNombre && nombreEl) modalNombre.textContent = `¿Confirmas activar crédito para ${nombreEl.textContent}?`;
        document.getElementById('modal-credito')?.classList.remove('hidden');
    });

    window.cerrarModalCredito = () => document.getElementById('modal-credito')?.classList.add('hidden');

    window.confirmarCredito = async () => {
        const confirmBtn = document.getElementById('modal-credito-confirm');
        if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Activando...'; }
        try {
            const r = await fetch(`/admin/api/clientes/${idClienteActivo}/credito`, { method: 'POST' });
            const d = await r.json();
            if (d.success) {
                creditoActivo = true;
                actualizarBtnCredito(true, true);
                cerrarModalCredito();
            } else {
                alert(d.mensaje || 'Error al activar crédito');
            }
        } catch (_) {
            alert('Error de conexión');
        } finally {
            if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Sí, activar'; }
        }
    };

    // ─── PANEL: PERFIL ────────────────────────────────────────────────────────
    const cargarPerfil = async (idCliente) => {
        idClienteActivo = idCliente;

        // Resaltar fila activa
        document.querySelectorAll('#contenedor-clientes tr').forEach(tr => tr.classList.remove('bg-pink-50'));
        const filaActiva = document.querySelector(`#contenedor-clientes tr[data-id="${idCliente}"]`);
        if (filaActiva) filaActiva.classList.add('bg-pink-50');

        document.getElementById('panel-vacio')?.classList.add('hidden');
        const contenido = document.getElementById('panel-contenido');
        if (contenido) { contenido.classList.remove('hidden'); contenido.classList.add('flex'); }

        try {
            const d = await fetch(`/admin/api/clientes/${idCliente}/perfil`).then(r => r.json());
            if (!d.success) return;

            const { cliente, ubicacion, stats, esVip, puedeActivarCredito } = d;

            // Avatar con iniciales
            const nombre = cliente.razon_social
                ? cliente.razon_social
                : `${cliente.primer_nombre || ''} ${cliente.primer_apellido || ''}`.trim();
            const palabras = nombre.split(' ').filter(Boolean);
            const iniciales = palabras.length >= 2
                ? palabras[0][0] + palabras[1][0]
                : (palabras[0]?.[0] || '?');

            setTexto('panel-iniciales', iniciales.toUpperCase());
            setTexto('panel-nombre', nombre || '—');
            setTexto('panel-doc', `${cliente.tipo_documento} ${cliente.numero_doc}`);

            const desde = fmtMesAnio(cliente.createdAt);
            setTexto('panel-desde', desde ? `Cliente desde ${desde}` : 'Sin fecha de registro');

            const vipEl = document.getElementById('panel-vip');
            if (vipEl) {
                vipEl.classList.toggle('hidden', !esVip);
                vipEl.classList.toggle('inline-flex', esVip);
            }

            // Cifras del header y de la fila de indicadores
            const nroPedidos = String(stats.totalPedidos ?? 0);
            setTexto('panel-hd-pedidos', nroPedidos);
            setTexto('panel-hd-total',   fmtCOP(stats.totalComprado));
            setTexto('panel-saldo',      fmtCOP(stats.cartera));
            setTexto('panel-compras',    nroPedidos);
            setTexto('panel-pagado',     fmtCOP(stats.totalPagado));

            // WhatsApp
            const wspEl = document.getElementById('panel-btn-wsp');
            if (wspEl) {
                const tel = (cliente.telefono || '').replace(/\D/g, '');
                wspEl.href = tel ? `https://api.whatsapp.com/send?phone=57${tel}` : '#';
            }

            // Editar
            const editEl = document.getElementById('panel-btn-editar');
            if (editEl) editEl.href = `/admin/clientes/editar/${idCliente}`;

            // Botón crédito
            creditoActivo = !!cliente.credito;
            actualizarBtnCredito(creditoActivo, puedeActivarCredito);

            // Resumen
            setTexto('panel-telefono', cliente.telefono);
            setTexto('panel-email', cliente.email);

            const dir = [ubicacion?.direccion, ubicacion?.nombreMunicipio, ubicacion?.nombreDepartamento]
                .filter(Boolean).join(', ');
            setTexto('panel-direccion', dir);
            setTexto('panel-vendedor', stats.vendedor);
            setTexto('panel-ultima-compra', fmtFecha(stats.ultimaCompra));

            const totalEl = document.getElementById('panel-total-comprado');
            if (totalEl) totalEl.textContent = fmtCOP(stats.totalComprado);

            const carteraEl = document.getElementById('panel-cartera');
            if (carteraEl) {
                carteraEl.textContent = fmtCOP(stats.cartera);
                carteraEl.className = `text-sm font-black ${stats.cartera > 0 ? 'text-red-500' : 'text-emerald-600'}`;
            }

            // Resetear a tab resumen
            activarTab('resumen');
        } catch (_) {}
    };

    // ─── PANEL: HISTORIAL ─────────────────────────────────────────────────────
    const cargarHistorial = async (idCliente, pagina) => {
        const list = document.getElementById('panel-historial-list');
        const pag  = document.getElementById('panel-historial-pag');
        if (!list || !idCliente) return;

        list.innerHTML = `<li class="bg-white rounded-2xl border border-slate-100 text-center py-6 text-xs text-slate-400"><i class="fi fi-rr-spinner animate-spin mr-1"></i> Cargando...</li>`;

        try {
            const d = await fetch(`/admin/api/clientes/${idCliente}/historial?pagina=${pagina}`).then(r => r.json());
            if (!d.success) return;

            if (!d.facturas.length) {
                list.innerHTML = `<li class="bg-white rounded-2xl border border-slate-100 text-center py-8 text-xs text-slate-400">Sin compras registradas</li>`;
                return;
            }

            list.innerHTML = d.facturas.map(f => {
                const { dia, mesAnio } = partesFecha(f.fechaEmision);
                const hora    = fmtHora(f.horaEmision);
                const estado  = f.estado === 'liquidada'
                    ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                           <i class="fi fi-rr-check-circle text-[11px] w-3 shrink-0 flex items-center justify-center"></i>Liquidada
                       </span>`
                    : `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                           <i class="fi fi-rr-clock text-[11px] w-3 shrink-0 flex items-center justify-center"></i>Pendiente
                       </span>`;
                return `
                <li class="bg-white rounded-2xl shadow-sm border border-slate-100 p-3">
                    <div class="flex items-start gap-3">
                        <div class="w-14 shrink-0 rounded-xl bg-pink-50 border border-pink-100 py-2 flex flex-col items-center gap-1">
                            <i class="fi fi-rr-calendar text-sm text-[#EC5FA3] flex items-center justify-center"></i>
                            <span class="text-lg font-black text-slate-800 leading-none">${dia}</span>
                            <span class="text-[9px] font-semibold text-slate-500 leading-none">${mesAnio}</span>
                            ${hora ? `<span class="text-[9px] text-slate-400 leading-none">${hora}</span>` : ''}
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="text-sm font-black text-slate-800 leading-tight truncate">Factura ${f.prefijo || '#'}${f.numeroFactura || '—'}</p>
                            <div class="mt-1.5 space-y-1">
                                <p class="flex items-center gap-1.5 text-[11px] text-slate-500">
                                    <i class="fi fi-rr-user text-[11px] w-3.5 shrink-0 flex items-center justify-center text-slate-300"></i>
                                    <span class="truncate">${f.vendedor?.trim() || '—'}</span>
                                </p>
                                <p class="flex items-start gap-1.5 text-[11px] text-slate-500">
                                    <i class="fi fi-rr-comment text-[11px] w-3.5 shrink-0 flex items-center justify-center text-slate-300 mt-px"></i>
                                    <span class="line-clamp-2">${f.concepto || 'Sin detalle de productos'}</span>
                                </p>
                            </div>
                        </div>
                    </div>
                    <div class="mt-3 pt-2.5 border-t border-dashed border-slate-200 flex items-center justify-between gap-2">
                        <span class="text-base font-black text-slate-800">${fmtCOP(f.total)}</span>
                        <div class="flex items-center gap-2 shrink-0">
                            ${estado}
                            <a href="/admin/api/factura/${f.idFacturaCliente}/tirilla" target="_blank" rel="noopener"
                               class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xl border border-pink-200 bg-white text-[#EC5FA3] text-[11px] font-bold hover:bg-pink-50 transition-colors"
                               title="Ver tirilla PDF">
                                <i class="fi fi-rr-file-pdf text-[11px] w-3 shrink-0 flex items-center justify-center"></i>PDF
                            </a>
                        </div>
                    </div>
                </li>`;
            }).join('');

            // Paginación simple
            if (pag && d.totalPaginas > 1) {
                pag.innerHTML = Array.from({ length: d.totalPaginas }, (_, i) => i + 1).map(p =>
                    `<button class="w-7 h-7 text-[10px] rounded-full font-bold transition-colors ${p === d.paginaActual ? 'text-white' : 'text-slate-400 hover:bg-slate-100'}"
                             style="${p === d.paginaActual ? 'background:#EC5FA3' : ''}"
                             onclick="cargarHistorialPag(${p})">${p}</button>`
                ).join('');
            } else if (pag) pag.innerHTML = '';
        } catch (_) {}
    };

    window.cargarHistorialPag = (p) => cargarHistorial(idClienteActivo, p);

    // ─── PANEL: ARCHIVOS ──────────────────────────────────────────────────────
    const iconoFormato = (fmt) => {
        const f = (fmt || '').toLowerCase();
        if (f === 'pdf')  return 'fi-rr-file-pdf text-red-400';
        if (f === 'doc' || f === 'docx') return 'fi-rr-file-word text-blue-400';
        if (f === 'xls' || f === 'xlsx') return 'fi-rr-file-spreadsheet text-emerald-500';
        if (['jpg','jpeg','png','webp','gif'].includes(f)) return 'fi-rr-picture text-purple-400';
        return 'fi-rr-document text-slate-400';
    };

    const cargarArchivos = async (idCliente) => {
        const list = document.getElementById('panel-archivos-list');
        if (!list || !idCliente) return;

        list.innerHTML = `<li class="text-center py-6 text-xs text-slate-400"><i class="fi fi-rr-spinner animate-spin mr-1"></i> Cargando...</li>`;

        try {
            const d = await fetch(`/admin/api/clientes/${idCliente}/archivos`).then(r => r.json());
            if (!d.success) return;

            if (!d.archivos.length) {
                list.innerHTML = `
                    <li class="flex flex-col items-center py-8 text-center">
                        <i class="fi fi-rr-folder-open text-3xl text-slate-200 mb-3"></i>
                        <p class="text-xs text-slate-400">Sin archivos adjuntos</p>
                    </li>`;
                return;
            }

            list.innerHTML = d.archivos.map(a => `
                <li class="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
                    <div class="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center flex-shrink-0 border border-slate-100">
                        <i class="fi ${iconoFormato(a.formato)} text-lg"></i>
                    </div>
                    <div class="min-w-0 flex-1">
                        <p class="text-xs font-semibold text-slate-700 truncate">${a.nombreDocumento}</p>
                        <p class="text-[10px] text-slate-400 uppercase">${a.formato}</p>
                    </div>
                    <a href="${a.url}" target="_blank" rel="noopener"
                       class="flex-shrink-0 w-7 h-7 rounded-lg bg-slate-100 hover:bg-pink-50 flex items-center justify-center transition-colors"
                       title="Ver archivo">
                        <i class="fi fi-rr-eye text-sm text-slate-400 hover:text-pink-400"></i>
                    </a>
                </li>`
            ).join('');
        } catch (_) {
            list.innerHTML = `<li class="text-center py-6 text-xs text-red-400">Error al cargar archivos</li>`;
        }
    };

    // ─── LISTA DE CLIENTES ────────────────────────────────────────────────────
    const contenedorClientes = document.getElementById('contenedor-clientes');
    const inputBusqueda      = document.getElementById('busquedaCliente');
    const resumenEl          = document.getElementById('resumenClientes');

    let paginaActual = 1;

    const mostrarClientes = (clientes) => {
        if (!contenedorClientes) return;
        if (!clientes.length) {
            contenedorClientes.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-400">No se encontraron clientes.</td></tr>';
            return;
        }

        contenedorClientes.innerHTML = clientes.map(c => {
            const nombre = c.razon_social
                ? c.razon_social
                : `${c.primer_nombre || ''} ${c.primer_apellido || ''}`.trim() || '—';
            const identificacion = `<span class="text-[10px] text-slate-400 uppercase">${c.tipo_documento}</span> ${c.numero_doc}`;
            const vendedor = c.vendedor?.trim() || '<span class="text-slate-300 italic text-xs">—</span>';

            return `
            <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer" data-id="${c.idCliente}">
                <td class="px-6 py-4">
                    <p class="font-bold text-slate-800">${nombre}</p>
                    <p class="text-xs text-slate-400">${c.numero_doc}</p>
                </td>
                <td class="px-4 py-4 text-center text-sm text-slate-600">${identificacion}</td>
                <td class="px-4 py-4 text-center text-sm text-slate-500">${fmtFecha(c.ultimaCompra)}</td>
                <td class="px-4 py-4 text-center text-sm text-slate-600">${vendedor}</td>
                <td class="px-4 py-4 text-center">
                    <button class="btn btn-secondary text-xs ver-cliente" data-id="${c.idCliente}">
                        <i class="fi-rr-eye text-xs"></i> Ver más
                    </button>
                </td>
            </tr>`;
        }).join('');
    };

    // Delegación de eventos para "Ver más"
    contenedorClientes?.addEventListener('click', (e) => {
        const btn = e.target.closest('.ver-cliente');
        if (btn) cargarPerfil(btn.dataset.id);
    });

    const obtenerClientes = async () => {
        if (!contenedorClientes) return;
        contenedorClientes.style.opacity = '0.5';
        try {
            const params = new URLSearchParams({ busqueda: inputBusqueda?.value || '', pagina: paginaActual });
            const data   = await fetch(`/admin/json/clientes/lista?${params}`).then(r => r.json());
            contenedorClientes.style.opacity = '1';
            if (!data.success) return;

            mostrarClientes(data.clientes);

            if (resumenEl) {
                resumenEl.innerHTML = `Mostrando <span class="font-bold text-slate-600">${data.clientes.length}</span> de <span class="font-bold text-slate-600">${data.totalRegistros}</span> clientes`;
            }

            if (typeof generarPaginacion === 'function') {
                generarPaginacion('#paginacionClientes', data.totalPaginas, data.paginaActual, (p) => {
                    paginaActual = p;
                    obtenerClientes();
                });
            }
        } catch (_) {
            contenedorClientes.style.opacity = '1';
            contenedorClientes.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-red-500">Error al cargar datos.</td></tr>';
        }
    };

    let debounce;
    if (inputBusqueda) {
        inputBusqueda.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => { paginaActual = 1; obtenerClientes(); }, 300);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        fetch('/admin/api/clientes/stats').then(r => r.json()).then(d => { if (d.success) actualizarStats(d); }).catch(() => {});
        obtenerClientes();
    });
})();
