/**
 * La descripción de un egreso: obligatoria y con contenido real.
 *
 * Era opcional, y en la práctica se dejaba vacía. Un egreso sin descripción es una salida
 * de plata sin motivo: en el cuadre aparece el monto y nadie —ni el que cierra la caja, ni
 * el administrador que revisa después— sabe en qué se gastó. Ese es exactamente el hueco
 * por donde un faltante pasa por gasto legítimo.
 *
 * El mínimo de tres palabras existe porque un campo obligatorio sin mínimo se llena con
 * "gasto" o con un punto, y eso deja el registro igual de mudo que estarlo vacío. Tres
 * palabras es lo que cuesta escribir algo que se entienda: "pago servicio agua", "compra
 * bolsas empaque", "taxi llevar consignación".
 *
 * El mínimo de caracteres acompaña al de palabras y no lo reemplaza: sin él "a b c" son
 * tres palabras y no dice nada; sin el de palabras, "aaaaaaaaaa" pasa igual. Cada regla
 * tapa lo que la otra deja abierto.
 *
 * Esta es la ÚNICA implementación de la regla: el controlador la usa al recibir la
 * petición, el modelo la usa como validador de Sequelize, y el navegador la recibe por el
 * bundle de `src/js/storeEgresos.js`. Si cambia acá, cambia en los tres lados — que es el
 * punto: un formulario que exige tres palabras contra un servidor que acepta una es peor
 * que no validar en ningún lado, porque nadie sabe cuál de los dos manda.
 */

export const MINIMO_PALABRAS   = 3;
export const MINIMO_CARACTERES = 10;

/** Colapsa espacios y saltos de línea. Lo que se guarda es esto, no lo que llegó. */
export const normalizarDescripcion = (texto) =>
    String(texto ?? '').trim().replace(/\s+/g, ' ');

/**
 * Cuenta como palabra el fragmento que tenga al menos una letra o un dígito. Así "-" o
 * "..." entre dos palabras no inflan la cuenta, y a la vez "$50.000" sí cuenta: es un dato
 * del gasto, no relleno.
 *
 * `\p{L}` cubre las tildes y la ñ, que `\w` deja afuera: con `\w` la palabra "años" contaba
 * como dos.
 */
export const contarPalabras = (texto) =>
    normalizarDescripcion(texto).split(' ').filter(p => /[\p{L}\p{N}]/u.test(p)).length;

/**
 * @returns {{ok: boolean, valor: string, mensaje: string}} `valor` ya viene normalizado y
 * es lo que hay que persistir.
 */
export const validarDescripcionEgreso = (texto) => {
    const valor = normalizarDescripcion(texto);

    if (!valor)
        return { ok: false, valor, mensaje: 'Escribí en qué se usó la plata: la descripción es obligatoria.' };

    if (contarPalabras(valor) < MINIMO_PALABRAS)
        return { ok: false, valor, mensaje: `La descripción necesita al menos ${MINIMO_PALABRAS} palabras que expliquen el egreso.` };

    if (valor.length < MINIMO_CARACTERES)
        return { ok: false, valor, mensaje: `La descripción es demasiado corta: escribí al menos ${MINIMO_CARACTERES} caracteres.` };

    return { ok: true, valor, mensaje: '' };
};

export default validarDescripcionEgreso;
