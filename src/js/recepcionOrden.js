import { escaparHtml as esc } from './escaparHtml.js';
import { UNIDAD_ETIQUETA } from './modalLineaInsumo.js';

// Ventana "Recibir orden" (views/components/modalRecepcionOrden.pug): cuánto llega de cada
// línea y, si su presentación no tiene conversión fija a la unidad de consumo (bolsa →
// unidades, kg → cm de resorte), cuánto trae cada una. La usan el detalle de una orden
// ("Recibir orden") y la creación de una orden con "La mercancía ya llegó" — una sola copia.
//
// `pedirRecepcion(lineas)` abre la ventana y resuelve con el arreglo para el servidor
// ([{ clave, cantidadLlega, contenido }], en el orden de `lineas`) o con null si se cancela.
// Cada línea trae: clave, nombreMaterial, colorNombre, cantidad, unidadCompra,
// cantidadRecibida, unidadConsumo, factorFijo (número o null), contenidoSugerido, valorUnitario.
// Lo que se muestra es solo una ayuda: el servidor recalcula todo con decimal.js
// (ordenesCompraController.js recibirEnTransaccion).

const CONSUMO = { cm: 'cm', g: 'g', unidad: 'uds' };
const PRESENTACION_SINGULAR = { kg: 'kg', metro: 'metro', rollo: 'rollo', unidad: 'unidad', bolsa: 'bolsa', caja: 'caja' };
const dinero = (n) => `$${window.mostrarDecimal(Math.round(n * 100) / 100)}`;

const pintarResumen = (fila, l) => {
    const llega = Number(window.leerDecimal(fila.querySelector('[data-cantidad-llega]').value));
    const contenido = l.factorFijo ?? Number(window.leerDecimal(fila.querySelector('[data-contenido]')?.value));
    const el = fila.querySelector('[data-resumen-entrada]');
    if (!llega || !contenido) { el.textContent = ''; return; }
    const u = CONSUMO[l.unidadConsumo] || 'uds';
    el.textContent = `Entran ${window.mostrarDecimal(llega * contenido)} ${u} al inventario · ${dinero(l.valorUnitario / contenido)} por ${u === 'uds' ? 'unidad' : u}`;
};

// Cuando la presentación no se convierte sola a la unidad en que se gasta (bolsa → unidades,
// kg de resorte → cm), se pregunta cuánto trae cada una. Si se compra por metro o kilo y se
// gasta "por unidad", casi seguro el insumo está mal configurado: se avisa en la fila.
const EJEMPLO_CONTENIDO = { bolsa: 'una bolsa de 500 argollas', caja: 'una caja de 1.000 botones', rollo: 'un rollo de 50 m = 5.000 cm', kg: 'un kilo de resorte que rinde 92 m = 9.200 cm' };
const filaContenido = (l) => {
    const presentacion = PRESENTACION_SINGULAR[l.unidadCompra] || 'unidad';
    const consumo = CONSUMO[l.unidadConsumo] || 'uds';
    const medida = ['metro', 'kg'].includes(l.unidadCompra) && l.unidadConsumo === 'unidad';
    const sugerido = l.contenidoSugerido !== null && l.contenidoSugerido !== undefined ? window.mostrarDecimal(l.contenidoSugerido) : '';
    return `
            <label class="flex items-center justify-end gap-2 text-xs text-slate-500">
                ¿Cuántas ${esc(consumo)} trae cada ${esc(presentacion)}?
                <input type="text" inputmode="decimal" autocomplete="off" class="field-text text-sm text-right w-28" data-contenido value="${sugerido}" placeholder="0">
                ${esc(consumo)}
            </label>
            <p class="text-[11px] text-right ${medida ? 'text-amber-600 font-semibold' : 'text-slate-400'}">${medida
                ? `Este insumo se compra por ${esc(presentacion)} pero está configurado para gastarse por unidades. Si se gasta en cm o g, corrígelo en su perfil (Editar → "Se gasta en") antes de recibir.`
                : `Ej.: ${esc(EJEMPLO_CONTENIDO[l.unidadCompra] || 'cuánto trae cada una')}. Se recuerda para la próxima.`}</p>`;
};

const pintarFilas = (cont, lineas) => {
    cont.innerHTML = '';
    lineas.forEach((l, i) => {
        const unidad = UNIDAD_ETIQUETA[l.unidadCompra] || '';
        const recibido = l.cantidadRecibida || 0;
        const pendiente = Math.max(l.cantidad - recibido, 0);
        const color = l.colorNombre ? `Color: ${l.colorNombre} · ` : '';
        const fila = document.createElement('div');
        fila.className = 'flex flex-col gap-2 p-3 rounded-xl bg-slate-50';
        fila.dataset.filaRecibir = i;
        fila.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-slate-800 truncate">${esc(l.nombreMaterial)}</p>
                    <p class="text-xs text-slate-400">${esc(color)}Pedido: ${window.mostrarDecimal(l.cantidad)} ${esc(unidad)}${recibido ? ` · Ya recibido: ${window.mostrarDecimal(recibido)} ${esc(unidad)}` : ''}</p>
                </div>
                <label class="flex flex-col items-end gap-0.5 flex-shrink-0">
                    <span class="text-[10px] font-bold text-slate-400 uppercase">Llega ahora</span>
                    <span class="relative w-36">
                        <input type="text" inputmode="decimal" autocomplete="off" class="field-text text-sm text-right pr-14" data-cantidad-llega value="${window.mostrarDecimal(pendiente)}">
                        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400">${esc(unidad)}</span>
                    </span>
                </label>
            </div>
            ${l.factorFijo === null ? filaContenido(l) : ''}
            <p class="text-[11px] font-semibold text-emerald-600 text-right" data-resumen-entrada></p>`;
        cont.appendChild(fila);
        fila.addEventListener('input', () => pintarResumen(fila, l));
        pintarResumen(fila, l);
    });
};

// Lee y valida las filas; marca en rojo lo que falta. null si hay algo mal.
const leerFilas = (cont, lineas) => {
    let huboError = false;
    const datos = [...cont.querySelectorAll('[data-fila-recibir]')].map(fila => {
        const l = lineas[Number(fila.dataset.filaRecibir)];
        const inpLlega = fila.querySelector('[data-cantidad-llega]');
        const inpContenido = fila.querySelector('[data-contenido]');
        const cantidadLlega = window.leerDecimal(inpLlega.value);
        const contenido = inpContenido ? window.leerDecimal(inpContenido.value) : null;
        const llegaMal = cantidadLlega === null;
        // El contenido solo hace falta si de esa línea llega algo.
        const contenidoMal = Boolean(inpContenido) && Number(cantidadLlega) > 0 && !(Number(contenido) > 0);
        inpLlega.classList.toggle('field-text-error', llegaMal);
        inpContenido?.classList.toggle('field-text-error', contenidoMal);
        if (llegaMal || contenidoMal) huboError = true;
        return { clave: l.clave, cantidadLlega, contenido };
    });
    if (!huboError && !datos.some(d => Number(d.cantidadLlega) > 0)) {
        cont.querySelectorAll('[data-cantidad-llega]').forEach(i => i.classList.add('field-text-error'));
        huboError = true;
    }
    return huboError ? null : datos;
};

export function pedirRecepcion(lineas) {
    const modal = document.getElementById('modal-recibir-orden');
    const cont = document.getElementById('filas-recibir-orden');
    if (!modal || !cont) return Promise.resolve(null);

    pintarFilas(cont, lineas);
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    return new Promise((resolve) => {
        const ctrl = new AbortController();
        const terminar = (valor) => {
            ctrl.abort();
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            resolve(valor);
        };
        const opts = { signal: ctrl.signal };
        document.getElementById('modal-recibir-orden-cerrar')?.addEventListener('click', () => terminar(null), opts);
        document.getElementById('btn-cancelar-recibir')?.addEventListener('click', () => terminar(null), opts);
        modal.addEventListener('click', (e) => { if (e.target === modal) terminar(null); }, opts);
        document.getElementById('btn-confirmar-recibir')?.addEventListener('click', () => {
            const datos = leerFilas(cont, lineas);
            if (datos) terminar(datos);
        }, opts);
    });
}

/** Contenido fijo de una presentación en esa unidad de consumo (tabla del servidor), o null. */
export const factorFijoDe = (factores, presentacion, unidadConsumo) => factores?.[presentacion]?.[unidadConsumo] ?? null;
