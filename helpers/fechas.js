// El negocio opera en Colombia: "hoy" siempre significa el día calendario en America/Bogota,
// sin importar en qué zona horaria corra el servidor.
//
// El patrón `new Date(); setHours(0,0,0,0)` que se usa en otras partes del código da el
// resultado correcto solo mientras el proceso corra en America/Bogota. Si algún día se
// despliega en un servidor en UTC, ese cálculo se corre 5 horas y los contadores de "hoy"
// empiezan a incluir o excluir pedidos que no corresponden.
//
// Colombia no aplica horario de verano, así que el desfase es fijo en -05:00 y no hace falta
// una librería de zonas horarias para resolverlo.
const OFFSET_BOGOTA_MS = 5 * 60 * 60 * 1000;

/**
 * Instante en que empezó el día actual en Bogotá (medianoche hora Colombia).
 * Sirve para comparar contra columnas DATETIME, que Sequelize maneja en UTC.
 *
 * @param {Date} [referencia] Momento desde el cual calcular; por defecto, ahora.
 * @returns {Date}
 */
export function inicioDelDiaBogota(referencia = new Date()) {
    // Se corren los campos del instante para que getUTC* devuelva la hora de pared en Bogotá.
    const enBogota = new Date(referencia.getTime() - OFFSET_BOGOTA_MS);
    // Se trunca a medianoche sobre esos campos...
    const medianoche = Date.UTC(enBogota.getUTCFullYear(), enBogota.getUTCMonth(), enBogota.getUTCDate());
    // ...y se devuelve el instante real que le corresponde.
    return new Date(medianoche + OFFSET_BOGOTA_MS);
}

/**
 * Instante en que empezó el mes actual en Bogotá.
 * @param {Date} [referencia]
 * @returns {Date}
 */
export function inicioDelMesBogota(referencia = new Date()) {
    const enBogota = new Date(referencia.getTime() - OFFSET_BOGOTA_MS);
    const primero = Date.UTC(enBogota.getUTCFullYear(), enBogota.getUTCMonth(), 1);
    return new Date(primero + OFFSET_BOGOTA_MS);
}
