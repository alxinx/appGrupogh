(function () {
    'use strict';

    const fmtCOP = window.fmtCOP;

    const ESTADO_MAP = {
        pendiente_pago: { cls: 'bg-amber-100 text-amber-700', label: 'Pendiente de pago' },
        en_revision: { cls: 'bg-blue-100 text-blue-700', label: 'En revisión' },
        trasladado: { cls: 'bg-indigo-100 text-indigo-700', label: 'Trasladado a tienda' },
        facturado: { cls: 'bg-emerald-100 text-emerald-700', label: 'Facturado / Despachado' },
        cancelado: { cls: 'bg-red-100 text-red-600', label: 'Cancelado' }
    };
    const ENTREGA_MAP = {
        domicilio: { icon: 'fi-rr-home', label: 'Domicilio' },
        tienda: { icon: 'fi-rr-shop', label: 'Punto de venta' }
    };

    const estadoBadge = (estado) => {
        const s = ESTADO_MAP[estado] || { cls: 'bg-slate-100 text-slate-500', label: estado };
        return `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${s.cls}">${s.label}</span>`;
    };

    const entregaTag = (tipo) => {
        const e = ENTREGA_MAP[tipo] || { icon: 'fi-rr-question', label: tipo };
        return `<span class="flex items-center gap-1.5 text-xs text-slate-600"><i class="fi ${e.icon} text-pink-400"></i>${e.label}</span>`;
    };

    const fmtFechaHora = (iso) => {
        if (!iso) return { fecha: '—', hora: '' };
        const d = new Date(iso);
        return {
            fecha: d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }),
            hora: d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
        };
    };

    const linkWhatsapp = (tel) => {
        const digitos = (tel || '').replace(/\D/g, '');
        return digitos ? `https://api.whatsapp.com/send?phone=${digitos}` : null;
    };

    function filtrosActuales() {
        return {
            q: document.getElementById('pedido-search')?.value.trim() || '',
            estado: document.getElementById('pedido-estado-filtro')?.value || '',
            tipoEntrega: document.getElementById('pedido-entrega-filtro')?.value || '',
            fecha: document.getElementById('pedido-fecha-filtro')?.value || ''
        };
    }

    function filaPedido(p) {
        const wa = linkWhatsapp(p.telefono);
        const { fecha, hora } = fmtFechaHora(p.createdAt);
        return `
            <tr class="border-b border-slate-100 hover:bg-pink-50/30 transition-colors">
                <td class="px-4 py-3 whitespace-nowrap">
                    <p class="font-mono text-xs font-bold text-gh-primaryHover">${p.numeroPedido}</p>
                    <p class="text-[11px] text-slate-400">${p.nProductos} producto${p.nProductos === 1 ? '' : 's'}</p>
                </td>
                <td class="px-4 py-3 text-sm text-slate-700 capitalize">${p.nombreCliente}</td>
                <td class="px-4 py-3">
                    <p class="text-xs text-slate-600">${p.email}</p>
                    <p class="text-xs text-slate-500 flex items-center gap-1.5">
                        ${p.telefono || '—'}
                        ${wa ? `<a href="${wa}" target="_blank" rel="noopener" title="WhatsApp"><i class="fi fi-brands-whatsapp text-emerald-500"></i></a>` : ''}
                    </p>
                </td>
                <td class="px-4 py-3">${entregaTag(p.tipoEntrega)}</td>
                <td class="px-4 py-3 max-w-[220px]">
                    <p class="text-xs font-semibold text-slate-700 truncate">${p.direccion?.linea1 || '—'}</p>
                    ${p.direccion?.linea2 ? `<p class="text-[11px] text-slate-400 truncate">${p.direccion.linea2}</p>` : ''}
                </td>
                <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${[p.ciudad, p.departamento].filter(Boolean).join(' / ') || '—'}</td>
                <td class="px-4 py-3 text-center">${estadoBadge(p.estado)}</td>
                <td class="px-4 py-3 text-right font-bold text-slate-800 text-sm whitespace-nowrap">${fmtCOP(p.total)}</td>
                <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    <p>${fecha}</p>
                    <p class="text-slate-400">${hora}</p>
                </td>
                <td class="px-4 py-3">
                    <div class="flex items-center justify-center gap-1.5">
                        <button type="button" class="btn-ver-pedido w-8 h-8 rounded-lg bg-pink-100 hover:bg-pink-200 text-gh-primaryHover flex items-center justify-center transition-colors" data-id="${p.idPedido}" title="Ver detalle">
                            <i class="fi fi-rr-eye text-sm"></i>
                        </button>
                        <div class="relative">
                            <button type="button" class="btn-mas-pedido w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center transition-colors" data-id="${p.idPedido}" data-numero="${p.numeroPedido}" data-tel="${p.telefono || ''}" title="Más acciones">
                                <i class="fi fi-rr-menu-dots-vertical text-sm"></i>
                            </button>
                        </div>
                    </div>
                </td>
            </tr>`;
    }

    let paginaActualGlobal = 1;

    const cargarPedidos = async (pagina = 1) => {
        const tbody = document.getElementById('pedidos-tbody');
        if (!tbody) return;
        paginaActualGlobal = pagina;

        tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-10 text-center text-slate-400 text-sm">
            <i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando pedidos...</td></tr>`;

        try {
            const params = new URLSearchParams({ pagina, ...filtrosActuales() });
            const res = await fetch(`/admin/web/pedidos/json?${params}`);
            const json = await res.json();

            if (!json.success || !json.pedidos.length) {
                tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-12 text-center text-slate-400 text-sm">
                    <i class="fi fi-rr-shopping-bag mr-2"></i>Sin pedidos encontrados.</td></tr>`;
                document.getElementById('pedidos-paginacion').innerHTML = '';
                return;
            }

            tbody.innerHTML = json.pedidos.map(filaPedido).join('');
            generarPaginacion('#pedidos-paginacion', json.totalPaginas, json.paginaActual, cargarPedidos);
        } catch (_) {
            tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-8 text-center text-red-400 text-sm">Error al cargar los pedidos.</td></tr>`;
        }
    };

    // ── Debounce simple para el buscador ──────────────────────────────────────
    let debounceTimer = null;
    function onFiltroCambia() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => cargarPedidos(1), 300);
    }

    function irADetallePedido(idPedido) {
        window.location.href = `/admin/web/pedidos/${idPedido}`;
    }

    // ── Menú de acciones (3 puntos) por fila ────────────────────────────────
    function cerrarMenusAbiertos() {
        document.querySelectorAll('.menu-acciones-pedido').forEach(m => m.remove());
    }

    function abrirMenuAcciones(btn) {
        cerrarMenusAbiertos();
        const { id, numero, tel } = btn.dataset;
        const wa = linkWhatsapp(tel);
        const menu = document.createElement('div');
        menu.className = 'menu-acciones-pedido absolute right-0 top-9 z-20 w-48 bg-white border border-slate-100 rounded-xl shadow-lg py-1.5';
        menu.innerHTML = `
            <button type="button" class="op-ver-detalle w-full text-left px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2" data-id="${id}">
                <i class="fi fi-rr-eye"></i> Ver detalle
            </button>
            <button type="button" class="op-copiar-numero w-full text-left px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2" data-numero="${numero}">
                <i class="fi fi-rr-copy"></i> Copiar número
            </button>
            ${wa ? `<a href="${wa}" target="_blank" rel="noopener" class="w-full text-left px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                <i class="fi fi-brands-whatsapp text-emerald-500"></i> Contactar por WhatsApp
            </a>` : ''}
        `;
        btn.parentElement.appendChild(menu);
    }

    // ── Exportar ─────────────────────────────────────────────────────────────
    function exportarCsv() {
        const params = new URLSearchParams(filtrosActuales());
        window.location.href = `/admin/web/pedidos/exportar?${params}`;
    }

    function initPedidosWeb() {
        if (!document.getElementById('pedidos-tbody')) return;

        document.getElementById('pedido-search')?.addEventListener('input', onFiltroCambia);
        document.getElementById('pedido-estado-filtro')?.addEventListener('change', () => cargarPedidos(1));
        document.getElementById('pedido-entrega-filtro')?.addEventListener('change', () => cargarPedidos(1));
        document.getElementById('pedido-fecha-filtro')?.addEventListener('change', () => cargarPedidos(1));
        document.getElementById('pedido-limpiar-filtros')?.addEventListener('click', () => {
            document.getElementById('pedido-search').value = '';
            document.getElementById('pedido-estado-filtro').value = '';
            document.getElementById('pedido-entrega-filtro').value = '';
            document.getElementById('pedido-fecha-filtro').value = '30dias';
            cargarPedidos(1);
        });
        document.getElementById('btn-exportar-pedidos')?.addEventListener('click', exportarCsv);

        // Filtros preaplicados desde la URL — los usan las tarjetas del dashboard web
        // (/admin/web) para que al hacer clic en un contador se vea exactamente ese conjunto.
        const params = new URLSearchParams(window.location.search);
        const estadoUrl = params.get('estado');
        const fechaUrl  = params.get('fecha');
        const selEstado = document.getElementById('pedido-estado-filtro');
        const selFecha  = document.getElementById('pedido-fecha-filtro');
        if (estadoUrl && selEstado && [...selEstado.options].some(o => o.value === estadoUrl)) {
            selEstado.value = estadoUrl;
        }
        if (fechaUrl !== null && selFecha && [...selFecha.options].some(o => o.value === fechaUrl)) {
            selFecha.value = fechaUrl;
        } else if (estadoUrl && selFecha) {
            // Los contadores "en proceso" y "pendientes de pago" no filtran por fecha en el
            // dashboard, así que acá tampoco: si no, el listado mostraría menos de lo anunciado.
            selFecha.value = '';
        }

        // Tarjetas de estadísticas — accesos rápidos que aplican un filtro
        document.getElementById('atajo-pedidos-nuevos')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('pedido-fecha-filtro').value = 'hoy';
            cargarPedidos(1);
        });
        document.getElementById('atajo-pedidos-cancelados')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('pedido-estado-filtro').value = 'cancelado';
            document.getElementById('pedido-fecha-filtro').value = 'mes';
            cargarPedidos(1);
        });
        document.getElementById('atajo-pedidos-ventas')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('pedido-estado-filtro').value = 'facturado';
            document.getElementById('pedido-fecha-filtro').value = 'mes';
            cargarPedidos(1);
        });

        document.addEventListener('click', (e) => {
            const btnVer = e.target.closest('.btn-ver-pedido');
            if (btnVer) { irADetallePedido(btnVer.dataset.id); return; }

            const btnMas = e.target.closest('.btn-mas-pedido');
            if (btnMas) { e.stopPropagation(); abrirMenuAcciones(btnMas); return; }

            const opVer = e.target.closest('.op-ver-detalle');
            if (opVer) { irADetallePedido(opVer.dataset.id); return; }

            const opCopiar = e.target.closest('.op-copiar-numero');
            if (opCopiar) {
                navigator.clipboard?.writeText(opCopiar.dataset.numero);
                cerrarMenusAbiertos();
                return;
            }

            if (!e.target.closest('.menu-acciones-pedido')) cerrarMenusAbiertos();
        });

        cargarPedidos(1);
    }

    document.addEventListener('DOMContentLoaded', initPedidosWeb);
})();
