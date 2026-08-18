import { randomBytes } from 'node:crypto';

/**
 * Genera un UUID versión 7 (RFC 9562).
 *
 * Por qué escrito a mano y no con la librería `uuid`: la que está en node_modules es la
 * 8.3.2, y viene arrastrada por otra dependencia — no está declarada en package.json.
 * Además `uuidv7()` recién aparece en la versión 10, así que igual habría que sumar una
 * dependencia directa. Son veinte líneas y el formato está completamente especificado.
 *
 * Layout (128 bits):
 *   48 bits  unix_ts_ms   — milisegundos desde epoch, big endian
 *    4 bits  versión      — 0111 (7)
 *   12 bits  rand_a       — acá se usa como contador dentro del mismo milisegundo
 *    2 bits  variante     — 10
 *   62 bits  rand_b       — aleatorio de crypto
 *
 * La gracia frente a v4: el timestamp va adelante, así que el id ordena por fecha de
 * creación tanto en texto como en el índice de MySQL. Eso evita que las inserciones caigan
 * en páginas al azar del índice primario, que es lo que hace lento a v4 cuando la tabla
 * crece.
 *
 * Los 12 bits de contador mantienen el orden entre ids creados en el mismo milisegundo
 * (hasta 4096; pasado ese punto se espera al milisegundo siguiente en vez de repetir).
 */

let ultimoMs = 0;
let contador = 0;

export function uuidV7() {
    let ahora = Date.now();

    if (ahora === ultimoMs) {
        contador++;
        // 4096 ids en un mismo milisegundo es inalcanzable acá, pero si pasara hay que
        // ceder el milisegundo: repetir el contador rompería el orden y arriesgaría choque.
        if (contador > 0xfff) {
            while (Date.now() === ultimoMs) { /* espera al siguiente ms */ }
            ahora = Date.now();
            ultimoMs = ahora;
            contador = 0;
        }
    } else {
        // Si el reloj retrocede (ajuste de NTP), se mantiene el último ms conocido para no
        // emitir ids que ordenen hacia atrás.
        if (ahora < ultimoMs) ahora = ultimoMs;
        ultimoMs = ahora;
        contador = 0;
    }

    const b = randomBytes(16);
    const ts = BigInt(ahora);

    b[0] = Number((ts >> 40n) & 0xffn);
    b[1] = Number((ts >> 32n) & 0xffn);
    b[2] = Number((ts >> 24n) & 0xffn);
    b[3] = Number((ts >> 16n) & 0xffn);
    b[4] = Number((ts >> 8n)  & 0xffn);
    b[5] = Number( ts         & 0xffn);

    b[6] = 0x70 | ((contador >> 8) & 0x0f);   // versión 7 + 4 bits altos del contador
    b[7] = contador & 0xff;                   // 8 bits bajos del contador
    b[8] = (b[8] & 0x3f) | 0x80;              // variante RFC 4122 (10xx)

    const hex = b.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default uuidV7;
