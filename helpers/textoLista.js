/**
 * Normaliza un texto para MOSTRARLO en un listado: "NEQUI" → "Nequi",
 * "bancolombia principal" → "Bancolombia Principal".
 *
 * Es solo presentación. Lo que está guardado en la base no se toca: el operador escribió
 * "NEQUI" y así quedó registrado; acá únicamente se decide cómo se ve en la tabla.
 *
 * Por qué no alcanza con CSS: `text-transform: capitalize` sube la primera letra de cada
 * palabra pero NO baja las demás, así que "NEQUI" se sigue viendo "NEQUI". La única forma
 * de arreglarlo es transformando el texto.
 *
 * Esta es la única implementación: el servidor la usa vía `app.locals.tc` (disponible en
 * todas las vistas Pug) y el navegador la recibe como `window.tc` a través del bundle
 * src/js/textoLista.js. Si cambia acá, cambia en los dos lados.
 */

// Conectores que van en minúscula salvo cuando abren el texto.
const CONECTORES = new Set([
    'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'a', 'al', 'para', 'con', 'por'
]);

// Siglas que se destruirían al pasarlas a "Título": BBVA no es "Bbva".
// Se comparan en mayúscula. Agregar acá cualquier sigla nueva del negocio.
const SIGLAS = new Set([
    'BBVA', 'PSE', 'ATH', 'NIT', 'DIAN', 'IVA', 'POS', 'QR', 'SAS', 'S.A.S', 'S.A.S.',
    'LTDA', 'SA', 'S.A', 'S.A.', 'GH', 'CC', 'CE', 'NIU', 'RUT', 'XS', 'S', 'M', 'L', 'XL', 'XXL'
]);

const capitalizarPalabra = (p) => p.charAt(0).toLocaleUpperCase('es-CO') + p.slice(1);

/**
 * @param {*} texto  Cualquier valor; si no es string se devuelve tal cual.
 * @returns {string} El texto listo para mostrar en una lista.
 */
export function tituloLista(texto) {
    if (typeof texto !== 'string') return texto;

    const limpio = texto.trim().replace(/\s+/g, ' ');
    if (!limpio) return limpio;

    return limpio
        .split(' ')
        .map((palabra, i) => {
            // Las siglas conocidas quedan intactas.
            if (SIGLAS.has(palabra.toLocaleUpperCase('es-CO'))) return palabra.toLocaleUpperCase('es-CO');

            // Un "token" con dígitos suele ser un código, una referencia o una talla
            // ("CAJA-01", "4821", "M2"): tocarlo sería alterar un dato, no darle formato.
            if (/\d/.test(palabra)) return palabra;

            const baja = palabra.toLocaleLowerCase('es-CO');

            // Conectores en minúscula, salvo el primero: "Caja de la Fábrica".
            if (i > 0 && CONECTORES.has(baja)) return baja;

            // Compuestos con guion o punto se capitalizan por tramo: "maria-jose" →
            // "Maria-Jose", "j.p morgan" → "J.P Morgan".
            if (/[-.]/.test(baja)) {
                return baja.split(/([-.])/).map(t => (t === '-' || t === '.') ? t : capitalizarPalabra(t)).join('');
            }

            return capitalizarPalabra(baja);
        })
        .join(' ');
}

export default tituloLista;
