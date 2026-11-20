// Cálculos de una orden de corte (pantalla Nuevo corte, src/js/corteNuevo.js). Funciones
// puras, sin DOM: las usa la guía en el navegador y las prueba tests/corteCalculos.test.js.
// Son conteos de piezas, todos enteros — nada de dinero, así que `Number` alcanza.
//
// Forma de la orden que reciben:
//   { referencias: [{ tallas: ['S','M'], veces: 3,
//                     materiales: [{ nombre, piezas: [{ nombre, cantidad, dimension }] }] }] }

const entero = (v, minimo = 0) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= minimo ? n : minimo;
};

/** Unidades de una referencia = tallas marcadas × veces por talla. ÚNICA cuenta como 1 talla. */
export const unidadesReferencia = (ref) =>
    new Set(ref?.tallas || []).size * entero(ref?.veces);

/** Piezas que lleva UNA prenda de ese material (cada pieza con su cantidad por prenda). */
export const piezasPorPrendaMaterial = (material) =>
    (material?.piezas || []).reduce((suma, p) => suma + entero(p.cantidad, 1), 0);

/**
 * Orden completa con todos los totales resueltos, lista para pintar la guía.
 * No muta la orden recibida.
 */
export const calcularOrden = (orden) => {
    const referencias = (orden?.referencias || []).map((ref) => {
        const unidades = unidadesReferencia(ref);
        const materiales = (ref.materiales || []).map((mat) => {
            const piezas = (mat.piezas || []).map((p) => {
                const cantidad = entero(p.cantidad, 1);
                return { ...p, cantidad, total: cantidad * unidades };
            });
            const porPrenda = piezasPorPrendaMaterial({ piezas });
            return { ...mat, piezas, piezasPorPrenda: porPrenda, totalPiezas: porPrenda * unidades };
        });
        const piezasPorPrenda = materiales.reduce((s, m) => s + m.piezasPorPrenda, 0);
        return {
            ...ref,
            unidades,
            materiales,
            piezasPorPrenda,
            totalPiezas: materiales.reduce((s, m) => s + m.totalPiezas, 0)
        };
    });

    return {
        ...orden,
        referencias,
        totalReferencias: referencias.length,
        totalPrendas: referencias.reduce((s, r) => s + r.unidades, 0),
        totalPiezas: referencias.reduce((s, r) => s + r.totalPiezas, 0)
    };
};
