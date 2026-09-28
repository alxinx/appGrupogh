import { readFileSync } from 'fs';

// Catálogo CIIU (actividades económicas de la DIAN): una sola fuente para todo el
// proyecto. Es el mismo src/json/ciiu.json que el POS empaqueta en su JS para autocompletar;
// acá lo lee el servidor para el endpoint público y para validar el registro web.
// Se carga una vez al arrancar: son ~500 entradas y no cambian en runtime.
const CATALOGO = new Map(
    JSON.parse(readFileSync(new URL('../src/json/ciiu.json', import.meta.url), 'utf8'))
        .map(c => [c.codigo, c.descripcion])
);

/** Descripción oficial de un código CIIU de 4 dígitos, o null si no existe. */
export const descripcionCiiu = (codigo) => {
    const c = String(codigo ?? '').trim();
    return /^\d{4}$/.test(c) ? (CATALOGO.get(c) ?? null) : null;
};
