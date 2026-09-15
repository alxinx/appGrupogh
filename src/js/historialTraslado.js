import { escaparHtml as esc } from './escaparHtml.js';

// Historial de un traslado: arriba lo que pide atención —rechazos y faltantes, con su
// estado—; abajo, en gris, lo rutinario agrupado por evento. Llega agrupado del servidor
// (helpers/traslados.js#agruparInsidencias), y lo pintan igual el detalle de la tienda y el
// de /admin/traslados, junto con la tirilla: los tres cuentan la misma historia.

export const fmtFechaHora = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-CO', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
};

const EVENTOS = {
    'ENVIADO':            { texto: 'Enviado',                  icono: 'fi-rr-paper-plane',  tono: 'bg-slate-100 text-slate-500' },
    'RECIBIDO':           { texto: 'Recibido',                 icono: 'fi-rr-check-circle', tono: 'bg-emerald-50 text-emerald-600' },
    'DEVUELTO AL ORIGEN': { texto: 'Devuelto al origen',       icono: 'fi-rr-undo',         tono: 'bg-amber-50 text-amber-600' },
    'DEVUELTO':           { texto: 'Devuelto por vencimiento', icono: 'fi-rr-time-past',    tono: 'bg-amber-50 text-amber-600' }
};
const INTENTO = { texto: 'Intento bloqueado', icono: 'fi-rr-ban', tono: 'bg-pink-50 text-pink-600' };
const CODIGOS_VISIBLES = 12;

export const chipCodigo = (codigo) =>
    `<span class="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-slate-600">${esc(codigo)}</span>`;

// Con 100 packs la lista entera empuja todo lo demás fuera de la vista: los primeros van a la
// vista y el resto queda a un clic. El botón va después de la lista para no quedar atrapado
// entre los códigos al desplegarla.
const listaCodigos = (codigos) => {
    const visibles = codigos.slice(0, CODIGOS_VISIBLES).map(chipCodigo).join('');
    const resto = codigos.slice(CODIGOS_VISIBLES);
    if (!resto.length) return `<div class="mt-2 flex flex-wrap gap-1">${visibles}</div>`;
    return `
        <div class="mt-2 flex flex-wrap gap-1">
            ${visibles}
            <span class="codigos-resto contents" hidden>${resto.map(chipCodigo).join('')}</span>
        </div>
        <button type="button" class="btn-codigos-resto mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-md text-xs font-medium text-gh-primaryHover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gh-primary"
                aria-expanded="false" data-mas="Ver ${resto.length} más">
            <span>Ver ${resto.length} más</span>
            <i class="fi fi-rr-angle-small-down leading-none transition-transform"></i>
        </button>`;
};

const autorYFecha = (h) => [h.empleado && esc(h.empleado), fmtFechaHora(h.fecha)].filter(Boolean).join(' · ');

const filaIncidencia = (h) => {
    const pendiente = !h.resuelta;
    return `
        <li class="flex items-start gap-3 px-4 py-3">
            <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    ${h.etiqueta ? chipCodigo(h.etiqueta) : ''}
                    <span class="text-xs text-slate-500">
                        Recibido <strong class="font-semibold tabular-nums text-slate-800">${h.aceptada}</strong> de <span class="tabular-nums">${h.original}</span>
                    </span>
                </div>
                <p class="mt-1.5 text-sm leading-snug text-slate-800">${esc(h.razon) || 'Sin descripción'}</p>
                <p class="mt-1 text-xs text-slate-400">${autorYFecha(h)}</p>
            </div>
            <span class="table-badge ${pendiente ? 'table-badge-pending' : 'table-badge-active'} mt-0.5 shrink-0">
                <span class="table-badge-dot ${pendiente ? 'bg-amber-500' : 'bg-emerald-500'}"></span>${pendiente ? 'Pendiente' : 'Resuelta'}
            </span>
        </li>`;
};

const filaMovimiento = (h, esUltima) => {
    const esIntento = h.tipo === 'intento';
    const ev = esIntento ? INTENTO : (EVENTOS[h.evento] || { texto: h.evento || 'Movimiento', icono: 'fi-rr-circle-small', tono: 'bg-slate-100 text-slate-500' });
    let resumen = '';
    if (esIntento) {
        resumen = esc((h.razon || '').replace(/^RECHAZADO \([^)]*\):\s*/, ''));
    } else if (h.codigos.length) {
        resumen = `${h.codigos.length} pack${h.codigos.length === 1 ? '' : 's'}`;
    } else if (h.etiqueta) {
        resumen = `${esc(h.etiqueta)} · <span class="tabular-nums">${h.aceptada}</span> uds`;
    }
    return `
        <li class="relative flex gap-3 ${esUltima ? '' : 'pb-4'}">
            ${esUltima ? '' : '<span aria-hidden="true" class="absolute left-[13px] top-7 bottom-0 w-px bg-slate-200"></span>'}
            <span class="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ev.tono}">
                <i class="fi ${ev.icono} text-xs leading-none"></i>
            </span>
            <div class="min-w-0 flex-1 pt-0.5">
                <p class="text-sm text-slate-700">
                    <span class="font-semibold text-slate-800">${ev.texto}</span>${resumen ? ` <span class="text-slate-400">·</span> ${resumen}` : ''}
                </p>
                <p class="mt-0.5 text-xs text-slate-400">${autorYFecha(h)}</p>
                ${h.codigos.length ? listaCodigos(h.codigos) : ''}
            </div>
        </li>`;
};

/**
 * Engancha el historial a un contenedor y devuelve la función que lo pinta. El listener del
 * "Ver más" va una sola vez en el contenedor: el contenido se reescribe entero en cada
 * traslado que se abre.
 */
export function montarHistorialTraslado(contenedor) {
    contenedor?.addEventListener('click', (e) => {
        const boton = e.target.closest('.btn-codigos-resto');
        if (!boton) return;
        const resto = boton.previousElementSibling?.querySelector('.codigos-resto');
        if (!resto) return;
        const abrir = resto.hidden;
        resto.hidden = !abrir;
        boton.setAttribute('aria-expanded', String(abrir));
        boton.querySelector('span').textContent = abrir ? 'Ver menos' : boton.dataset.mas;
        boton.querySelector('i').classList.toggle('rotate-180', abrir);
    });

    return (historial) => {
        if (!contenedor) return;
        const incidencias = historial.filter(h => h.tipo === 'incidencia');
        const movimientos = historial.filter(h => h.tipo !== 'incidencia');
        const pendientes  = incidencias.filter(h => !h.resuelta).length;

        const seccionIncidencias = !incidencias.length ? '' : `
            <section aria-label="Incidencias" class="overflow-hidden rounded-2xl border border-slate-200">
                <header class="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                    <h4 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                        <i class="fi fi-rr-triangle-warning text-sm leading-none ${pendientes ? 'text-amber-500' : 'text-slate-400'}"></i>
                        Incidencias
                        <span class="tabular-nums font-semibold text-slate-400">${incidencias.length}</span>
                    </h4>
                    <span class="text-xs font-medium ${pendientes ? 'text-amber-700' : 'text-emerald-700'}">
                        ${pendientes ? `${pendientes} por resolver` : 'Todas resueltas'}
                    </span>
                </header>
                <ul class="divide-y divide-slate-100">${incidencias.map(filaIncidencia).join('')}</ul>
            </section>`;

        const seccionMovimientos = !movimientos.length ? '' : `
            <section aria-label="Movimientos" class="rounded-2xl border border-slate-200">
                <header class="border-b border-slate-200 bg-slate-50 px-4 py-2.5 rounded-t-2xl">
                    <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">Movimientos</h4>
                </header>
                <ol class="px-4 py-4">${movimientos.map((h, i) => filaMovimiento(h, i === movimientos.length - 1)).join('')}</ol>
            </section>`;

        contenedor.innerHTML = seccionIncidencias + seccionMovimientos;
    };
}
