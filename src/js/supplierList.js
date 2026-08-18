import { tituloLista as tc } from '../../helpers/textoLista.js';

(function () {
    const inputBusqueda = document.getElementById('busquedaProvedor');
    const selectCategoria = document.getElementById('filtroCategoriaProvedor');
    const contenedor = document.getElementById('contenedor-provedores');

    let paginaActual = 1;

    // Función para mostrar los proveedores en la tabla
    const mostrarProvedores = (provedores) => {
        contenedor.innerHTML = '';

        if (provedores.length === 0) {
            contenedor.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500">No se encontraron proveedores 🥲.</td></tr>';
            return;
        }

        provedores.forEach(p => {
            // Generar pills de categorías
            let categoriasHtml = '';
            if (p.categorias && p.categorias.length > 0) {
                p.categorias.forEach(cat => {
                    categoriasHtml += `<span class="inline-block bg-purple-100 text-purple-700 text-[10px] px-2 py-0.5 rounded-full mr-1 mb-1 font-semibold">${cat.nombre}</span>`;
                });
            } else {
                categoriasHtml = '<span class="text-gray-400 text-xs italic">Sin categoría</span>';
            }

            contenedor.innerHTML += `
                <tr class="hover:bg-gray-50 transition-colors group">
                    <td class="p-4">
                        <div class="font-bold text-gray-800">${tc(p.razonSocial)}</div>
                        <div class="text-xs text-gray-400">${p.emailProvedor || 'Sin email'}</div>
                    </td>
                    <td class="p-4 text-sm text-gray-600">${tc(p.nombreContacto) || '--'}</td>
                    <td class="p-4 text-sm text-gray-600">${p.telefonoContacto || '--'}</td>
                    <td class="p-4 text-sm text-gray-600 font-mono">${p.taxIdSupplier}</td>
                    <td class="p-4">
                        <div class="flex flex-wrap max-w-[200px]">
                            ${categoriasHtml}
                        </div>
                    </td>
                    <td class="p-4 text-right">
                        <a href="/admin/provedores/ver/${p.idProveedor}" class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors" title="Ver Detalle">
                            <i class="fi-rr-eye"></i>
                        </a>
                    </td>
                </tr>
            `;
        });
    };

    // Función principal para obtener datos
    const obtenerProvedores = async () => {
        try {
            const params = new URLSearchParams({
                busqueda: inputBusqueda?.value || '',
                categoria: selectCategoria?.value || '',
                pagina: paginaActual
            });

            const url = `/admin/json/provedores/?${params.toString()}`;

            // Loading state simple (opcional)
            contenedor.style.opacity = '0.5';

            const response = await fetch(url);
            const data = await response.json();

            contenedor.style.opacity = '1';

            if (data.success) {
                mostrarProvedores(data.provedores);
                if (typeof generarPaginacion === 'function') {
                    generarPaginacion(
                        '#paginacionProvedores',
                        data.totalPaginas,
                        data.paginaActual,
                        (nuevaPagina) => {
                            paginaActual = nuevaPagina;
                            obtenerProvedores();
                        }
                    );
                }
            } else {
                console.error('Error del servidor:', data.mensaje);
            }

        } catch (error) {
            console.error('Error al obtener proveedores:', error);
            contenedor.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar datos.</td></tr>';
        }
    };

    // Filtros
    const filtrar = () => {
        paginaActual = 1;
        obtenerProvedores();
    };

    // Debounce para búsqueda
    let timer;
    if (inputBusqueda) {
        inputBusqueda.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(filtrar, 300);
        });
    }

    if (selectCategoria) {
        selectCategoria.addEventListener('change', filtrar);
    }

    // Cargar inicial
    document.addEventListener('DOMContentLoaded', obtenerProvedores);

})();

// ─── FACTURAS PENDIENTES ───────────────────────────────────────────────────────
(function () {
    const fmt = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v);

    const listaEl  = document.getElementById('lista-facturas-pendientes');
    const fpPrev   = document.getElementById('fpPrev');
    const fpNext   = document.getElementById('fpNext');
    const fpInfo   = document.getElementById('fpInfo');
    const modalEl  = document.getElementById('modalFacturaPendiente');

    let fpPagina       = 1;
    let fpTotalPaginas = 1;
    let fpIdActual     = null;

    // ── Lista paginada ────────────────────────────────────────
    const cargarFacturasPendientes = async () => {
        listaEl.innerHTML = '<p class="text-xs text-gray-400 py-4 text-center">Cargando...</p>';
        try {
            const resp = await fetch(`/admin/api/provedores/facturas-pendientes?page=${fpPagina}`);
            const data = await resp.json();

            if (!data.success || data.facturas.length === 0) {
                listaEl.innerHTML = '<p class="text-xs text-gray-400 py-4 text-center italic">Sin facturas pendientes</p>';
                fpInfo.textContent = '';
                fpPrev.disabled = true;
                fpNext.disabled = true;
                return;
            }

            fpTotalPaginas  = data.totalPaginas;
            fpInfo.textContent = `${fpPagina} / ${fpTotalPaginas}`;
            fpPrev.disabled = fpPagina === 1;
            fpNext.disabled = fpPagina === fpTotalPaginas;

            const hoy     = new Date(); hoy.setHours(0, 0, 0, 0);
            const en3dias = new Date(hoy); en3dias.setDate(en3dias.getDate() + 3);

            const estadoVenc = (fv) => {
                if (!fv) return 'normal';
                const d = new Date(fv); d.setHours(0, 0, 0, 0);
                if (d < hoy)     return 'vencida';
                if (d <= en3dias) return 'proxima';
                return 'normal';
            };

            const estilos = {
                vencida: {
                    card:   'background:#ef4444;border:1px solid #dc2626;',
                    hover:  '',
                    texto:  'color:#fff;',
                    sub:    'color:rgba(255,255,255,0.75);',
                    monto:  'color:#fff;',
                    icono:  '<i class="fi fi-rr-exclamation" style="color:#fff;font-size:11px;"></i> ',
                    badge:  '<span style="font-size:9px;background:rgba(0,0,0,0.2);color:#fff;padding:1px 5px;border-radius:999px;font-weight:700;">VENCIDA</span>'
                },
                proxima: {
                    card:   'background:#fff7ed;border:1px solid #fed7aa;',
                    texto:  'color:#92400e;',
                    sub:    'color:#b45309;',
                    monto:  'color:#c2410c;',
                    icono:  '<i class="fi fi-rr-triangle-warning" style="color:#f97316;font-size:11px;"></i> ',
                    badge:  '<span style="font-size:9px;background:#fed7aa;color:#92400e;padding:1px 5px;border-radius:999px;font-weight:700;">POR VENCER</span>'
                },
                normal: {
                    card:   'background:#f9fafb;border:1px solid transparent;',
                    texto:  'color:#1f2937;',
                    sub:    'color:#9ca3af;',
                    monto:  'color:#ef4444;',
                    icono:  '',
                    badge:  ''
                }
            };

            listaEl.innerHTML = data.facturas.map(f => {
                const est = estadoVenc(f.fechaVencimiento);
                const s   = estilos[est];
                return `
                <div class="rounded-xl p-3 cursor-pointer transition-colors fp-item"
                     style="${s.card}" data-id="${f.idFacturaPro}">
                    <div class="flex items-center justify-between gap-1 mb-0.5">
                        <div class="font-semibold text-xs truncate" style="${s.texto}">${s.icono}${f.proveedor}</div>
                        ${s.badge}
                    </div>
                    <div class="text-[10px] mt-0.5" style="${s.sub}">Fac: ${f.nroFactura}${f.fechaVencimiento ? ' · Vence: ' + f.fechaVencimiento : ''}</div>
                    <div class="text-sm font-bold mt-1" style="${s.monto}">${fmt(f.valorPorPagar)}</div>
                </div>`;
            }).join('');

            listaEl.querySelectorAll('.fp-item').forEach(el => {
                el.addEventListener('click', () => abrirModal(el.dataset.id));
            });
        } catch {
            listaEl.innerHTML = '<p class="text-xs text-red-400 py-2 text-center">Error al cargar</p>';
        }
    };

    fpPrev?.addEventListener('click', () => { if (fpPagina > 1) { fpPagina--; cargarFacturasPendientes(); } });
    fpNext?.addEventListener('click', () => { if (fpPagina < fpTotalPaginas) { fpPagina++; cargarFacturasPendientes(); } });

    // ── Modal detalle ─────────────────────────────────────────
    const abrirModal = async (idFacturaPro) => {
        fpIdActual = idFacturaPro;
        modalEl.classList.remove('hidden');
        modalEl.classList.add('flex');

        document.getElementById('modalFacturaResumen').innerHTML = '<p class="text-xs text-gray-400 col-span-2">Cargando...</p>';
        document.getElementById('modalFacturaAbonos').innerHTML  = '';

        try {
            const resp = await fetch(`/admin/api/provedores/factura/${idFacturaPro}/detalle`);
            const data = await resp.json();
            if (!data.success) { cerrarModal(); return; }

            const f = data.factura;
            document.getElementById('modalFacturaTitulo').textContent = `Factura ${f.nroFactura}`;

            document.getElementById('modalFacturaResumen').innerHTML = `
                <div><span class="text-xs text-gray-400 uppercase font-bold block mb-0.5">Proveedor</span><strong class="text-sm">${f.proveedor}</strong>${f.nit ? `<div class="text-xs text-gray-400">NIT: ${f.nit}</div>` : ''}</div>
                <div><span class="text-xs text-gray-400 uppercase font-bold block mb-0.5">Nro. Factura</span><strong class="text-sm font-mono">${f.nroFactura}</strong></div>
                <div><span class="text-xs text-gray-400 uppercase font-bold block mb-0.5">Fecha Factura</span><span class="text-sm">${f.fechaFactura}</span></div>
                <div><span class="text-xs text-gray-400 uppercase font-bold block mb-0.5">Fecha Vencimiento</span><span class="text-sm">${f.fechaVencimiento || '—'}</span></div>
                <div><span class="text-xs text-gray-400 uppercase font-bold block mb-0.5">Total Factura</span><strong class="text-sm">${fmt(f.valorTotal)}</strong></div>
                <div><span class="text-xs text-gray-400 uppercase font-bold block mb-0.5">Saldo Pendiente</span><strong class="text-base text-red-500">${fmt(f.valorPorPagar)}</strong></div>`;

            const abonosEl = document.getElementById('modalFacturaAbonos');
            if (data.abonos.length === 0) {
                abonosEl.innerHTML = '<p class="text-xs text-gray-400 italic">Sin abonos registrados</p>';
            } else {
                abonosEl.innerHTML = `
                    <table class="w-full text-xs">
                        <thead><tr class="text-gray-400 border-b border-gray-100 text-left">
                            <th class="py-2">Fecha</th>
                            <th class="py-2 text-right">Abono</th>
                            <th class="py-2 text-right">Saldo</th>
                        </tr></thead>
                        <tbody>
                            ${data.abonos.map(a => `
                                <tr class="border-b border-gray-50">
                                    <td class="py-1.5">${new Date(a.fechaAbono).toLocaleDateString('es-CO')}</td>
                                    <td class="py-1.5 text-right text-green-600 font-semibold">${fmt(a.valorAbono)}</td>
                                    <td class="py-1.5 text-right text-red-500 font-semibold">${fmt(a.valorPorPagar)}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>`;
            }

            const inputAbono = document.getElementById('inputAbonoFactura');
            inputAbono.value = '0';
            if (window.initMoneyInput) window.initMoneyInput(inputAbono);

        } catch { cerrarModal(); }
    };

    const cerrarModal = () => {
        modalEl.classList.add('hidden');
        modalEl.classList.remove('flex');
        fpIdActual = null;
    };

    document.getElementById('btnCerrarModalFactura')?.addEventListener('click', cerrarModal);
    modalEl?.addEventListener('click', e => { if (e.target === modalEl) cerrarModal(); });

    // ── Registrar abono ───────────────────────────────────────
    document.getElementById('btnRegistrarAbono')?.addEventListener('click', async () => {
        if (!fpIdActual) return;
        const inputAbono = document.getElementById('inputAbonoFactura');
        const valor = window.parseMoney ? window.parseMoney(inputAbono.value) : parseFloat(inputAbono.value.replace(/\D/g, ''));

        if (!valor || valor <= 0) {
            Swal.fire({ icon: 'warning', title: 'Valor inválido', text: 'Ingresa un valor de abono mayor a 0.' }); return;
        }

        const btn = document.getElementById('btnRegistrarAbono');
        btn.disabled = true;
        btn.innerHTML = '<i class="fi fi-rr-spinner"></i>';

        try {
            const resp = await fetch(`/admin/api/provedores/factura/${fpIdActual}/abonar`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ valorAbono: valor })
            });
            const data = await resp.json();
            if (data.success) {
                cerrarModal();
                fpPagina = 1;
                cargarFacturasPendientes();
                Swal.fire({ icon: 'success', title: data.mensaje, timer: 2000, showConfirmButton: false });
                if (data.idCuentaPorPagar) {
                    window.open(`/admin/api/provedores/abono/${data.idCuentaPorPagar}/tirilla`, '_blank');
                }
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: data.mensaje });
            }
        } catch {
            Swal.fire({ icon: 'error', title: 'Error de red', text: 'No se pudo registrar el abono.' });
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fi fi-rr-check"></i>  Abonar';
        }
    });

    cargarFacturasPendientes();
})();
