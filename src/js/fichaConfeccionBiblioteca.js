import { escaparHtml as esc } from './escaparHtml.js';

// Biblioteca de fichas de confección (admin/procesos/fichas-confeccion/biblioteca) —
// listado filtrado y paginado por GET /admin/json/fichas-confeccion, mismo contrato y
// mismo paginador global (window.generarPaginacion, src/js/paginador.js) que el listado de
// inventario (src/js/productList.js, CLAUDE.md DRY — "mismos principios de paginación").
// Cada fila ya llega armada por helpers/bibliotecaFichas.js (presentarFichaBiblioteca).
(function () {
    const inputBusqueda = document.querySelector('#busquedaFichas');
    const selectFamilia = document.querySelector('#familiaFichas');
    const selectTela = document.querySelector('#telaFichas');
    const contenedor = document.querySelector('#contenedor-fichas');
    const conteo = document.querySelector('#conteo-fichas');
    if (!inputBusqueda || !contenedor) return;

    let paginaActual = 1;

    // Igual que productList.js: una respuesta lenta de una búsqueda vieja no debe pisar
    // una más nueva que ya llegó.
    let ultimaConsultaId = 0;

    const pesos = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
    const fecha = (d) => new Date(d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

    // Mismos tonos que la mesa de trabajo de admin/confeccionistas.
    const TONO_ETAPA = {
        asignado: 'bg-violet-500',
        entregado_taller: 'bg-gh-primaryHover',
        en_revision: 'bg-amber-500',
        entregada: 'bg-emerald-500'
    };

    const MAX_TALLERES = 2;

    const celdaPrenda = (f) => {
        const iniciales = esc((f.referencia || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase());
        const imagen = f.tieneImagen
            ? `<img src="/admin/procesos/fichas-confeccion/${esc(f.idFicha)}/imagen" alt="" loading="lazy" data-imagen-ficha class="absolute inset-0 w-full h-full object-cover">`
            : '';
        const autor = f.creadaPor ? ` · ${esc(f.creadaPor)}` : '';
        return `
            <a href="/admin/procesos/fichas-confeccion/${esc(f.idFicha)}" class="flex items-center gap-3 min-w-0 group/ficha">
                <span class="relative w-14 h-14 shrink-0 rounded-xl overflow-hidden bg-gh-primarySoft ring-1 ring-pink-100 flex items-center justify-center">
                    <span class="text-sm font-bold text-gh-primaryHover">${iniciales}</span>
                    ${imagen}
                </span>
                <span class="min-w-0">
                    <span class="block font-semibold text-slate-800 truncate group-hover/ficha:text-gh-primaryHover">${esc(f.referencia)}</span>
                    <span class="block text-xs text-slate-400 mt-0.5">${fecha(f.createdAt)}${autor}</span>
                </span>
            </a>`;
    };

    const celdaTelas = (f) => {
        const telas = f.telas.map(t => `<span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">${esc(t)}</span>`).join('');
        return `<div class="flex flex-wrap gap-1">${telas || '<span class="text-xs text-slate-400">Sin tela</span>'}</div>`;
    };

    // Precio de confección por prenda: lo único de plata que es de la ficha (cuántas y el
    // total los pone la orden de producción).
    const celdaPrecio = (f) => `
        <div class="flex flex-col items-end">
            <span class="text-base font-bold text-slate-800 tabular-nums leading-tight">${pesos(f.precioConfeccion)}</span>
            <span class="text-[11px] text-slate-400">por prenda</span>
        </div>`;

    const celdaTalleres = (f) => {
        if (!f.talleres.length) {
            return `<span class="table-badge table-badge-pending"><span class="table-badge-dot"></span>Sin taller asignado</span>`;
        }
        // Una barra por taller: de un vistazo cuántos ya entregaron.
        const barra = f.talleres.map(t => `<span class="h-1.5 flex-1 rounded-full ${TONO_ETAPA[t.estado] || 'bg-slate-200'}" title="${esc(t.nombre)}: ${esc(t.estadoEtiqueta || 'Sin proceso')}"></span>`).join('');
        const filas = f.talleres.slice(0, MAX_TALLERES).map(t => {
            const nombre = t.idProceso
                ? `<a href="/admin/procesos/${esc(t.idProceso)}" class="truncate text-slate-700 hover:text-gh-primaryHover hover:underline">${esc(t.nombre)}</a>`
                : `<span class="truncate text-slate-700">${esc(t.nombre)}</span>`;
            return `
                <li class="flex items-center gap-2 text-xs min-w-0">
                    <span class="w-1.5 h-1.5 shrink-0 rounded-full ${TONO_ETAPA[t.estado] || 'bg-slate-300'}"></span>
                    ${nombre}
                    <span class="ml-auto shrink-0 text-[11px] text-slate-400">${esc(t.estadoEtiqueta || 'Sin proceso')}</span>
                </li>`;
        }).join('');
        const mas = f.talleres.length > MAX_TALLERES ? `<li class="text-[11px] text-slate-400">+${f.talleres.length - MAX_TALLERES} más</li>` : '';
        return `
            <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-2">
                    <div class="flex flex-1 gap-0.5">${barra}</div>
                    <span class="text-[11px] font-semibold text-slate-500 tabular-nums">${f.entregados}/${f.talleres.length} entregados</span>
                </div>
                <ul class="flex flex-col gap-1">${filas}${mas}</ul>
            </div>`;
    };

    const celdaAcciones = (f) => `
        <div class="flex items-center justify-end gap-1">
            <a href="/admin/procesos/fichas-confeccion/${esc(f.idFicha)}/pdf" target="_blank" rel="noopener" aria-label="Ver PDF de ${esc(f.referencia)}"
                class="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold text-slate-500 hover:text-gh-primaryHover hover:bg-gh-primarySoft transition-colors">
                <i class="fi fi-rr-document text-sm"></i>
                PDF
            </a>
            <a href="/admin/procesos/fichas-confeccion/${esc(f.idFicha)}" class="btn btn-secondary whitespace-nowrap">
                <i class="fi fi-rr-arrow-right text-xs"></i>
                Abrir
            </a>
        </div>`;

    const mostrarFichas = (fichas, hayFiltro) => {
        if (fichas.length === 0) {
            contenedor.innerHTML = `
                <tr><td colspan="5" class="py-14 text-center">
                    <i class="fi fi-rr-books text-2xl text-slate-300"></i>
                    <p class="mt-2 text-sm font-semibold text-slate-500">${hayFiltro ? 'Ninguna ficha coincide con el filtro.' : 'Todavía no hay fichas.'}</p>
                    <p class="text-xs text-slate-400">${hayFiltro ? 'Prueba con otra referencia o quita un filtro.' : 'Aparecen acá apenas se guarda la primera.'}</p>
                </td></tr>`;
            return;
        }
        contenedor.innerHTML = fichas.map(f => `
            <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                <td class="py-3.5 px-5 max-w-[16rem]">${celdaPrenda(f)}</td>
                <td class="py-3.5 px-5">${celdaTelas(f)}</td>
                <td class="py-3.5 px-5">${celdaPrecio(f)}</td>
                <td class="py-3.5 px-5">${celdaTalleres(f)}</td>
                <td class="py-3.5 px-5">${celdaAcciones(f)}</td>
            </tr>`).join('');
        // Imagen que no carga (borrada del bucket, firma vencida): quedan las iniciales.
        contenedor.querySelectorAll('img[data-imagen-ficha]').forEach(img => {
            if (img.complete && img.naturalWidth === 0) img.remove();
            else img.addEventListener('error', () => img.remove(), { once: true });
        });
    };

    const leerFiltros = () => ({
        busqueda: inputBusqueda.value,
        familia: selectFamilia?.value || '',
        tela: selectTela?.value || ''
    });

    const obtenerFichas = async () => {
        const consultaId = ++ultimaConsultaId;
        const filtros = leerFiltros();
        try {
            const params = new URLSearchParams({ ...filtros, pagina: paginaActual }).toString();
            const r = await fetch(`/admin/json/fichas-confeccion?${params}`);
            const d = await r.json();
            if (consultaId !== ultimaConsultaId) return; // ya salió otra consulta más nueva

            if (d.success) {
                const hayFiltro = Boolean(filtros.busqueda.trim() || filtros.familia || filtros.tela);
                mostrarFichas(d.fichas, hayFiltro);
                if (conteo) conteo.textContent = d.totalRegistros === 1 ? '1 ficha' : `${(d.totalRegistros || 0).toLocaleString('es-CO')} fichas`;
                generarPaginacion('#paginacionFichas', d.totalPaginas, d.paginaActual, (nuevaPagina) => {
                    paginaActual = nuevaPagina;
                    obtenerFichas();
                });
            }
        } catch (e) {
            console.error('fichaConfeccionBiblioteca:', e);
        }
    };

    const filtrar = () => {
        paginaActual = 1;
        obtenerFichas();
    };

    let timer;
    inputBusqueda.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(filtrar, 300);
    });
    [selectFamilia, selectTela].filter(Boolean).forEach((el) => el.addEventListener('change', filtrar));

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', filtrar);
    else filtrar();
})();
