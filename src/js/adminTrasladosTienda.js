(function () {
    'use strict';

    const fmtFecha = window.fmtFecha;

    const estadoBadge = (estado) => {
        const mapa = {
            'PENDIENTE':       { cls: 'bg-amber-100 text-amber-700',     label: 'Pendiente' },
            'EN_TRANSITO':     { cls: 'bg-blue-100 text-blue-700',       label: 'En tránsito' },
            'RECIBIDO':        { cls: 'bg-emerald-100 text-emerald-700', label: 'Recibido' },
            'ANULADO':         { cls: 'bg-red-100 text-red-600',         label: 'Anulado' },
            'EN_CONTROVERSIA': { cls: 'bg-orange-100 text-orange-700',   label: 'Controversia' },
            'DEVUELTO':        { cls: 'bg-slate-100 text-slate-600',     label: 'Devuelto' }
        };
        const s = mapa[estado] || { cls: 'bg-slate-100 text-slate-500', label: estado };
        return `<span class="px-2 py-0.5 rounded-full text-xs font-bold ${s.cls}">${s.label}</span>`;
    };

    let pdvId = null;

    const cargarTraslados = async (pagina = 1) => {
        const tbody = document.getElementById('traslados-tbody');
        if (!tbody) return;

        const estado = document.getElementById('traslado-estado-filtro')?.value || '';

        tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400 text-sm">
            <i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando traslados...</td></tr>`;

        try {
            const params = new URLSearchParams({ pagina });
            if (estado) params.append('estado', estado);

            const res  = await fetch(`/admin/api/tiendas/${pdvId}/traslados?${params}`);
            const json = await res.json();

            if (!json.success || !json.traslados.length) {
                tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-slate-400 text-sm">
                    <i class="fi fi-rr-truck mr-2"></i>Sin traslados encontrados.</td></tr>`;
                document.getElementById('traslados-paginacion').innerHTML = '';
                return;
            }

            tbody.innerHTML = json.traslados.map(t => {
                const dirBadge = t.esOrigen
                    ? '<span class="ml-1 px-1.5 py-0.5 bg-rose-100 text-rose-600 text-[10px] font-bold rounded">SALIDA</span>'
                    : '<span class="ml-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">ENTRADA</span>';
                return `
                    <tr class="border-b border-slate-100 hover:bg-pink-50/30 transition-colors">
                        <td class="px-4 py-3 font-mono text-xs font-bold text-gh-primary whitespace-nowrap">
                            ${t.codigoTraslado}${dirBadge}
                        </td>
                        <td class="px-4 py-3 text-sm text-slate-700">${t.origen}</td>
                        <td class="px-4 py-3 text-sm text-slate-700">${t.destino}</td>
                        <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${fmtFecha(t.fechaEnvio)}</td>
                        <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${fmtFecha(t.fechaRecepcion)}</td>
                        <td class="px-4 py-3 text-center">${estadoBadge(t.estado)}</td>
                        <td class="px-4 py-3 text-center text-sm font-bold text-slate-600">${t.nroItems}</td>
                        <td class="px-4 py-3 text-center">
                            <a href="/admin/dosificaciones/comprobante/${t.idTraslado}"
                               target="_blank"
                               class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-pink-100 hover:bg-pink-200 text-gh-primary transition-colors"
                               title="Ver comprobante PDF">
                                <i class="fi fi-rr-file-pdf text-sm"></i>
                            </a>
                        </td>
                    </tr>`;
            }).join('');

            generarPaginacion('#traslados-paginacion', json.totalPaginas, json.paginaActual, cargarTraslados);
        } catch (_) {
            tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-red-400 text-sm">Error al cargar traslados.</td></tr>`;
        }
    };

    const initTrasladosTienda = () => {
        pdvId = document.getElementById('traslados-pdv-id')?.value;
        if (!pdvId) return;

        document.getElementById('traslado-estado-filtro')
            ?.addEventListener('change', () => cargarTraslados(1));

        cargarTraslados(1);
    };

    document.addEventListener('tabLoaded', ({ detail }) => {
        if (detail.tabId === 'traslados') initTrasladosTienda();
    });
})();
