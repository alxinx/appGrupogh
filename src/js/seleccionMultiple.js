// Selección de filas que sobrevive a repintar la tabla: al paginar, buscar o filtrar el tbody
// se reescribe entero, y con el estado guardado en los checkboxes del DOM se perdía todo lo
// marcado. Comparten esto la ficha de dosificación y el inventario de tienda.
export function crearSeleccionMultiple({ selectorCheckbox, selectAll, boton, botones }) {
    const seleccionados = new Set();

    // Cada botón declara desde cuántas filas tiene sentido: "Trasladar" aparece con una sola
    // (el menú de la fila abre el mismo modal), y "Desempacar los seleccionados" solo con dos
    // o más, porque para una está la acción de la fila. `boton` es el atajo de un solo botón.
    const acciones = (botones || (boton ? [{ el: boton }] : [])).map(b => ({ minimo: 1, ...b }));

    const marcar = (cb) => {
        if (cb.checked) seleccionados.add(cb.value);
        else seleccionados.delete(cb.value);
    };

    const actualizar = () => {
        const n = seleccionados.size;
        acciones.forEach(({ el, minimo }) => {
            el?.classList.toggle('hidden', n < minimo);
            // El total incluye lo elegido en otras páginas o escondido por un filtro, así que hay
            // que decirlo: si no, el botón parece contar de más.
            const etiqueta = el?.querySelector('[data-conteo]');
            if (etiqueta) etiqueta.textContent = n ? ` (${n})` : '';
        });

        if (!selectAll) return;
        // "Seleccionar todo" refleja solo lo visible en la tabla.
        const visibles = [...document.querySelectorAll(selectorCheckbox)];
        selectAll.disabled = visibles.length === 0;
        selectAll.checked = visibles.length > 0 && visibles.every(cb => cb.checked);
        selectAll.indeterminate = !selectAll.checked && visibles.some(cb => cb.checked);
    };

    selectAll?.addEventListener('change', () => {
        document.querySelectorAll(selectorCheckbox).forEach((cb) => {
            cb.checked = selectAll.checked;
            marcar(cb);
        });
        actualizar();
    });

    return {
        seleccionados,
        estaMarcado: (id) => seleccionados.has(String(id)),
        // Después de cada repintado: los checkboxes nuevos todavía no tienen listener.
        enlazar() {
            document.querySelectorAll(selectorCheckbox).forEach((cb) => {
                cb.addEventListener('change', () => { marcar(cb); actualizar(); });
            });
            actualizar();
        },
        quitar(ids) {
            ids.forEach(id => seleccionados.delete(String(id)));
            actualizar();
        },
        // Descarta lo que ya no existe en la lista completa (lo movió o vendió otra persona).
        conservarSolo(ids) {
            const vigentes = new Set(ids.map(String));
            [...seleccionados].forEach((id) => { if (!vigentes.has(id)) seleccionados.delete(id); });
            actualizar();
        }
    };
}
