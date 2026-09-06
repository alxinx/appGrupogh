// Convierte un entero no negativo a su forma en letras, en español. Escrito a mano y no
// con una librería —igual que helpers/uuidV7.js— después de probar `to-words` (la opción
// más mantenida en npm para esto) y encontrar reglas de español rotas en su locale es-CO:
// "Un Millon Pesos" en vez de "Un Millón de Pesos", "Veintiuno Millones" en vez de
// "Veintiún Millones", "Un Pesos" en vez de "Un Peso". Para un mensaje que un cliente va a
// leer ("vas a otorgar un crédito de..."), esas roturas no son aceptables, y las reglas de
// español acá (apócope de "uno", "cien" vs "ciento", el "de" antes del sustantivo) están
// completamente especificadas — no hay ambigüedad que justifique una dependencia externa.

const UNIDADES = [
    'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
    'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
    'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'
];
const DECENAS   = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS  = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

// "uno" apocopa a "un" (y "veintiuno" a "veintiún", con tilde por el cambio de sílaba
// tónica al perder la "o" final) cuando antecede a un sustantivo masculino — "un millón",
// "veintiún pesos". Solo se usa donde hace falta esa concordancia, nunca en el número suelto.
const apocopar = (palabra) => {
    if (palabra === 'uno') return 'un';
    if (palabra.endsWith('veintiuno')) return palabra.slice(0, -'veintiuno'.length) + 'veintiún';
    if (palabra.endsWith(' uno'))       return palabra.slice(0, -' uno'.length) + ' un';
    return palabra;
};

// 0-999, sin palabra de escala (mil/millón). Nunca antecede un sustantivo por sí sola —
// la apócope de la unidad final la decide quien llama, según lo que venga después.
const centenaEnLetras = (n) => {
    if (n === 0) return '';
    if (n === 100) return 'cien';

    const c = Math.floor(n / 100);
    const resto = n % 100;
    const partes = [];

    if (c > 0) partes.push(CENTENAS[c]);

    if (resto > 0) {
        if (resto < 30) {
            partes.push(UNIDADES[resto]);
        } else {
            const d = Math.floor(resto / 10);
            const u = resto % 10;
            partes.push(u > 0 ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d]);
        }
    }

    return partes.join(' ');
};

// Entero completo, hasta justo antes de "billón" (10^12 en español — no es lo mismo que el
// "billion" inglés — de sobra para DECIMAL(12,2), que no llega a 10^10). Recursivo y no por
// grupos fijos de a tres cifras: "millón" se cuenta con un número que puede a su vez pasar
// de mil (3.005.000.000 son "tres mil cinco millones", NO "tres mil millones cinco
// millones" — el conteo de millones es un solo número, 3005, no dos grupos independientes).
// La apócope antes de "mil"/"millón(es)" se aplica siempre acá, porque esas palabras son
// sustantivos masculinos inmediatos — no depende de contexto externo, a diferencia de la
// unidad final (esa la decide quien llama, ver valorEnLetras).
const construir = (n) => {
    if (n === 0) return '';
    if (n < 1000) return centenaEnLetras(n);

    if (n < 1_000_000) {
        const miles = Math.floor(n / 1000);
        const resto = n % 1000;
        const milesTexto = miles === 1 ? 'mil' : `${apocopar(construir(miles))} mil`;
        return resto > 0 ? `${milesTexto} ${centenaEnLetras(resto)}` : milesTexto;
    }

    const millones = Math.floor(n / 1_000_000);
    const resto     = n % 1_000_000;
    const millonesTexto = millones === 1 ? 'un millón' : `${apocopar(construir(millones))} millones`;
    return resto > 0 ? `${millonesTexto} ${construir(resto)}` : millonesTexto;
};

export const numeroCardinal = (valor) => {
    const n = Math.trunc(Math.abs(valor));
    return n === 0 ? 'cero' : construir(n);
};

// Valor en letras seguido del sustantivo moneda, con las dos reglas que `numeroCardinal`
// deja pendientes porque dependen de que hay un sustantivo después:
//   - apócope de la última palabra si termina en "...uno" ("veintiún pesos", no "veintiuno pesos")
//   - "de" antes del sustantivo cuando el número termina justo en "millón"/"millones"
//     ("cuatro millones DE pesos", "mil millones DE pesos" — pero "cuatro mil pesos", sin "de")
// Los centavos no se manejan a propósito: los montos de crédito en este proyecto son pesos
// enteros (ver CLIENTES.valorCredito, CREDITO_DISPONIBLE_CLIENTE — DECIMAL(12,2) pero
// siempre .00 en la práctica); si algún día hace falta un valor con centavos, hay que
// decidir cómo se lee esa fracción antes de agregarla acá.
export const valorEnLetras = (valor, { singular = 'peso', plural = 'pesos' } = {}) => {
    const n = Math.trunc(Math.abs(valor));
    if (n === 0) return `cero ${plural}`;
    if (n === 1) return `un ${singular}`;

    let palabras = numeroCardinal(n);
    const terminaEnMillones = /\bmill[oó]n(es)?$/.test(palabras);

    if (terminaEnMillones) {
        palabras += ' de';
    } else {
        palabras = apocopar(palabras);
    }

    return `${palabras} ${plural}`;
};

export default valorEnLetras;
