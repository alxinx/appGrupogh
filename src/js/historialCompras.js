import { escaparHtml as esc } from './escaparHtml.js';

// Historial de compras (admin/insumos/compra/historial). Mismo patrón que
// supplierList.js: busqueda + filtros + paginación de servidor (window.generarPaginacion,
// src/js/paginador.js) — nada se trae completo de una.
(function () {
    const tabla       = document.getElementById('tabla-historial');
    const paginacion  = document.getElementById('paginacion-historial');
    const contador     = document.getElementById('contador-historial');
    const inputBuscar = document.getElementById('busqueda-historial');
    const selectTipo  = document.getElementById('filtro-tipo-historial');
    const selectEstado = document.getElementById('filtro-estado-historial');
    if (!tabla) return;

    let paginaActual = 1;

    const money = (n) => `$ ${Math.round(n).toLocaleString('es-CO')}`;
    const fecha = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

    const TIPO_ETIQUETA = { orden_compra: 'Orden de compra', cotizacion: 'Cotización' };
    const ESTADO = {
        borrador:    ['Borrador',    'bg-slate-100 text-slate-500'],
        enviada:     ['Enviada',     'bg-blue-100 text-blue-600'],
        confirmada:  ['Confirmada',  'bg-indigo-100 text-indigo-600'],
        en_transito: ['En tránsito', 'bg-amber-100 text-amber-600'],
        recibida:    ['Recibida',    'bg-emerald-100 text-emerald-600'],
        cancelada:   ['Cancelada',   'bg-rose-100 text-rose-600']
    };

    const pintarFilas = (ordenes) => {
        if (!ordenes.length) {
            tabla.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-sm text-slate-400">Ninguna orden coincide con el filtro.</td></tr>`;
            return;
        }
        tabla.innerHTML = ordenes.map(o => {
            const [etiquetaEstado, claseEstado] = ESTADO[o.estado] || [o.estado, 'bg-slate-100 text-slate-500'];
            // Operador vs. sistema: hoy siempre operador (no hay todavía ningún proceso
            // automático que genere una orden), pero el dato ya es real — ver
            // models/OrdenesCompra.js y controller/ordenesCompraController.js insertarOrden.
            const origen = o.origen === 'sistema'
                ? `<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-600"><i class="fi fi-rr-robot text-[11px]"></i> Sistema</span>`
                : `<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600"><i class="fi fi-rr-user text-[11px]"></i> ${esc(o.autorizadoPor || 'Operador')}</span>`;

            return `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td class="py-3 pr-3">
                        <p class="font-semibold text-slate-800">${esc(o.numeroOrden)}</p>
                        ${o.esCotizacionGrupo ? '<p class="text-[11px] text-violet-500 font-semibold">Cotización agrupada</p>' : ''}
                    </td>
                    <td class="py-3 pr-3 text-slate-700">${esc(o.proveedor)}</td>
                    <td class="py-3 pr-3 text-slate-600">${esc(TIPO_ETIQUETA[o.tipo] || o.tipo)}</td>
                    <td class="py-3 pr-3"><span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${claseEstado}">${etiquetaEstado}</span></td>
                    <td class="py-3 pr-3 text-center tabular-nums text-slate-600">${o.nItems}</td>
                    <td class="py-3 pr-3 text-right font-semibold tabular-nums text-slate-800">${money(o.total)}</td>
                    <td class="py-3 pr-3">${origen}</td>
                    <td class="py-3 pr-3 text-slate-500 whitespace-nowrap">${fecha(o.fecha)}</td>
                    <td class="py-3 text-right">
                        <div class="flex items-center justify-end gap-3">
                            <a href="/admin/insumos/compra/${o.idOrdenCompra}/pdf" target="_blank" title="Ver PDF" class="text-slate-400 hover:text-gh-primaryHover transition-colors">
                                <i class="fi fi-rr-file-pdf"></i>
                            </a>
                            <a href="/admin/insumos/compra/${o.idOrdenCompra}" title="Ver / cambiar estado" class="text-slate-400 hover:text-gh-primaryHover transition-colors">
                                <i class="fi fi-rr-edit"></i>
                            </a>
                        </div>
                    </td>
                </tr>`;
        }).join('');
    };

    const cargar = async () => {
        tabla.style.opacity = '0.5';
        try {
            const params = new URLSearchParams({
                busqueda: inputBuscar?.value || '',
                tipo: selectTipo?.value || '',
                estado: selectEstado?.value || '',
                pagina: paginaActual
            });
            const r = await fetch(`/admin/insumos/compra/historial/json?${params}`);
            const data = await r.json();
            tabla.style.opacity = '1';
            if (!data.success) { console.error(data.mensaje); return; }

            pintarFilas(data.ordenes);
            contador.textContent = data.totalRegistros === 1 ? '1 orden' : `${data.totalRegistros.toLocaleString('es-CO')} órdenes`;

            window.generarPaginacion?.('#paginacion-historial', data.totalPaginas, data.paginaActual, (nuevaPagina) => {
                paginaActual = nuevaPagina;
                cargar();
            });
        } catch (e) {
            tabla.style.opacity = '1';
            tabla.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-sm text-rose-400">No se pudo cargar el historial.</td></tr>`;
        }
    };

    const filtrar = () => { paginaActual = 1; cargar(); };

    let timer;
    inputBuscar?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(filtrar, 300); });
    selectTipo?.addEventListener('change', filtrar);
    selectEstado?.addEventListener('change', filtrar);

    cargar();
})();
