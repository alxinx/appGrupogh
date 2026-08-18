import { tituloLista as tc } from '../../helpers/textoLista.js';
(function () {
    'use strict';

    const fmtCOP = (n) => `$${Math.round(parseFloat(n) || 0).toLocaleString('es-CO')}`;
    const fmtFecha = (iso) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('es-CO', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    const ESTADO_MAP = {
        pendiente_pago: { cls: 'bg-amber-100 text-amber-700', label: 'Pendiente de pago' },
        en_revision:    { cls: 'bg-blue-100 text-blue-700',   label: 'En revisión' },
        trasladado:     { cls: 'bg-indigo-100 text-indigo-700', label: 'Por despachar' },
        facturado:      { cls: 'bg-emerald-100 text-emerald-700', label: 'Facturado / Despachado' },
        cancelado:      { cls: 'bg-red-100 text-red-600',     label: 'Cancelado' }
    };
    const ETIQUETA_METODO_PAGO = { tarjeta: 'Tarjeta', pse: 'PSE', nequi: 'Nequi', contraentrega: 'Contraentrega' };
    const ETIQUETA_ENTREGA = { domicilio: 'Domicilio', tienda: 'Punto de venta' };

    const estadoBadge = (estado) => {
        const s = ESTADO_MAP[estado] || { cls: 'bg-slate-100 text-slate-500', label: estado };
        return `<span class="px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${s.cls}">${s.label}</span>`;
    };

    const accionesPedido = (p) => {
        if (p.estado === 'trasladado') {
            return `<a href="/store/?cargarPedido=${p.idPedido}" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors" style="background:#EC5FA3">
                <i class="fi fi-rr-shopping-bag"></i> Cargar en el carrito
            </a>`;
        }
        if (p.estado === 'facturado' && p.idFacturaCliente) {
            return `<a href="/store/facturas/${p.idFacturaCliente}/tirilla" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-gh-primaryHover border border-gh-primaryHover/30 hover:bg-gh-primarySoft transition-colors">
                <i class="fi fi-rr-file-invoice"></i> Ver factura
            </a>`;
        }
        return '<span class="text-xs text-slate-300">—</span>';
    };

    const filaPedido = (p) => `
        <tr class="hover:bg-pink-50/30 transition-colors">
            <td class="px-4 py-3 font-mono text-xs font-bold text-gh-primaryHover whitespace-nowrap">${p.numeroPedido}</td>
            <td class="px-4 py-3 text-sm text-slate-700">${tc(p.nombreCliente)}</td>
            <td class="px-4 py-3 text-xs text-slate-500">
                <p>${p.email || '—'}</p>
                <p>${p.telefono || ''}</p>
            </td>
            <td class="px-4 py-3 text-xs text-slate-600">${ETIQUETA_METODO_PAGO[p.metodoPago] || p.metodoPago}</td>
            <td class="px-4 py-3 text-xs text-slate-600">${ETIQUETA_ENTREGA[p.tipoEntrega] || p.tipoEntrega}</td>
            <td class="px-4 py-3 text-sm font-bold text-slate-800 text-right whitespace-nowrap">${fmtCOP(p.total)}</td>
            <td class="px-4 py-3 text-center">${estadoBadge(p.estado)}</td>
            <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${fmtFecha(p.createdAt)}</td>
            <td class="px-4 py-3">${accionesPedido(p)}</td>
        </tr>`;

    const cargarPedidos = async (pagina = 1) => {
        const tbody = document.getElementById('pw-tbody');
        if (!tbody) return;

        const estado = document.getElementById('pw-estado-filtro')?.value || '';

        tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-10 text-center text-slate-400 text-sm">
            <i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando pedidos...</td></tr>`;

        try {
            const params = new URLSearchParams({ pagina });
            if (estado) params.set('estado', estado);

            const res  = await fetch(`/store/json/pedidos-web/lista?${params}`);
            const json = await res.json();

            const resumen = document.getElementById('pw-resumen');

            if (!json.success || !json.pedidos.length) {
                tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-12 text-center text-slate-400 text-sm">
                    <i class="fi fi-rr-shopping-bag mr-2"></i>Sin pedidos encontrados.</td></tr>`;
                document.getElementById('pw-paginacion').innerHTML = '';
                if (resumen) resumen.textContent = '0 pedidos';
                return;
            }

            tbody.innerHTML = json.pedidos.map(filaPedido).join('');
            if (resumen) resumen.textContent = `${json.total} pedido${json.total === 1 ? '' : 's'} en total`;
            generarPaginacion('#pw-paginacion', json.totalPaginas, json.paginaActual, cargarPedidos);
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-8 text-center text-red-400 text-sm">Error al cargar los pedidos.</td></tr>`;
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (!document.getElementById('pw-tbody')) return;
        document.getElementById('pw-estado-filtro')?.addEventListener('change', () => cargarPedidos(1));
        cargarPedidos(1);
    });
})();
