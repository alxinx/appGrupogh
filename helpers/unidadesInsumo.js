import Decimal from 'decimal.js';

// Unidades de un insumo: en qué se COMPRA (presentación: kg, metro, rollo, bolsa…) y en qué
// se GASTA (unidad de consumo: cm, g, unidad). PLAN_COSTEO_PRODUCCION.md §1.
//
// Este es el ÚNICO lugar que convierte entre las dos — nadie multiplica por 100 por su
// cuenta. La lista de presentaciones es UNIDADES_COMPRA de helpers/insumos.js (el ENUM de
// MATERIAL.unidadCompra); acá solo vive lo de consumo y la conversión.
//
// Cantidades con decimal.js, nunca Number encadenado (CLAUDE.md §3): 3 cm de resorte a
// $20,1234/cm no puede arrastrar error de punto flotante a un costo.

export const UNIDADES_CONSUMO = [
    { valor: 'cm',     etiqueta: 'Centímetro (cm)', corta: 'cm'  },
    { valor: 'g',      etiqueta: 'Gramo (g)',       corta: 'g'   },
    { valor: 'unidad', etiqueta: 'Unidad',          corta: 'uds' }
];
export const UNIDAD_CONSUMO_CORTA = Object.fromEntries(UNIDADES_CONSUMO.map(u => [u.valor, u.corta]));

// Conversión fija: misma magnitud, no hay nada que preguntar.
// Exportada para que el navegador use la MISMA tabla (viaja como JSON a la orden de compra).
export const CONVERSIONES_FIJAS = { metro: { cm: 100 }, kg: { g: 1000 }, unidad: { unidad: 1 } };

/** Cuánto trae una presentación en la unidad de consumo, si es fijo (metro→cm = 100), o null. */
export const factorFijo = (presentacion, unidadConsumo) => CONVERSIONES_FIJAS[presentacion]?.[unidadConsumo] ?? null;

/** Unidad de consumo que se sugiere según cómo se compra (la usa la migración y el formulario). */
export const unidadConsumoSugerida = (presentacion) =>
    ({ metro: 'cm', rollo: 'cm', kg: 'g' })[presentacion] || 'unidad';

/** Decimal a partir de lo que devuelve MySQL (DECIMAL llega como string) o de un número. */
export const dec = (v) => new Decimal(v === null || v === undefined || v === '' ? 0 : String(v));

/** String con 4 decimales para escribir en una columna DECIMAL(15,4). */
export const a4 = (d) => dec(d).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

// Una cantidad que llega del navegador. El navegador manda el número ya normalizado
// ("2.5", "18400"): el formato de miles de la pantalla se lo quita src/js antes de enviar.
// Hasta 4 decimales — los que guarda la columna.
const NUMERO_RE = /^\d{1,11}(\.\d{1,4})?$/;

/** Decimal > 0 (o ≥ 0 con `permitirCero`), o null si no es un número válido. */
export const cantidadValida = (crudo, { permitirCero = false } = {}) => {
    const texto = String(crudo ?? '').trim();
    if (!NUMERO_RE.test(texto)) return null;
    const d = new Decimal(texto);
    return d.gt(0) || (permitirCero && d.eq(0)) ? d : null;
};

/**
 * Lo que entra al inventario por una recepción: `cantidad` presentaciones de `contenido`
 * unidades de consumo cada una, y el costo de cada unidad de consumo.
 *   2 kg a $23.000 el kg, 9.200 cm por kg → 18.400 cm a $2,5 el cm.
 */
export const convertirRecepcion = ({ cantidad, contenido, valorUnitario }) => {
    const total = dec(cantidad).times(dec(contenido));
    return {
        cantidadConsumo: total,
        costoUnitario: dec(valorUnitario).div(dec(contenido))
    };
};

/**
 * El contenido de una presentación para esta recepción: el fijo si la conversión es de la
 * misma magnitud (lo que mande el navegador se ignora), o el que confirmó el operador.
 * Devuelve `{ contenido }` o `{ error }`.
 */
export const resolverContenido = ({ presentacion, unidadConsumo, contenidoCrudo }) => {
    const fijo = factorFijo(presentacion, unidadConsumo);
    if (fijo !== null) return { contenido: new Decimal(fijo), fijo: true };
    const contenido = cantidadValida(contenidoCrudo);
    if (!contenido) return { error: `Indica cuánto trae cada ${presentacion} (en ${UNIDAD_CONSUMO_CORTA[unidadConsumo] || unidadConsumo}).` };
    return { contenido, fijo: false };
};
