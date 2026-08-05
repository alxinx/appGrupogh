import db from '../config/bd.js';

// Códigos correlativos con prefijo ("GH-10005", "TR-1023") sobre columnas con índice único.
//
// El patrón anterior —leer el último registro con ORDER BY createdAt DESC y sumarle 1— fallaba
// de dos formas: createdAt es DATETIME sin fracción de segundo, así que no desempata registros
// creados en el mismo segundo; y entre la lectura y el INSERT otro proceso podía tomar el mismo
// número. Pasaba, por ejemplo, cuando la tienda facturaba en el POS justo cuando entraba un pago
// web, porque ambos flujos crean traslados.
//
// La reserva del número se hace con un UPDATE sobre una sola fila de SECUENCIAS: InnoDB la
// bloquea hasta el commit, así que las transacciones concurrentes se serializan en vez de
// chocar. Reintentar con MAX+1 no sirve acá: en cada ronda solo gana una transacción, así que
// N operaciones simultáneas necesitarían N rondas.
//
// El número se entrega dentro de la transacción que lo usa. Si esa transacción se revierte, el
// contador vuelve atrás con ella y el número queda libre — no se saltan correlativos.

/**
 * Reserva el siguiente número de una secuencia. Requiere transacción: el número y el registro
 * que lo usa tienen que confirmarse juntos.
 *
 * @param {string} nombre       Contador, ej. 'pedido_web' | 'traslado'
 * @param {object} transaction  Transacción en curso
 * @returns {Promise<number>}   Número reservado
 */
export async function siguienteNumero(nombre, transaction) {
    if (!transaction) throw new Error(`siguienteNumero('${nombre}') requiere una transacción.`);

    const [afectadas] = await db.query(
        'UPDATE SECUENCIAS SET valor = valor + 1 WHERE nombre = :nombre',
        { replacements: { nombre }, transaction }
    );
    if (!afectadas) {
        // La secuencia tiene que existir y estar sembrada con el máximo actual de la tabla;
        // crearla al vuelo arrancaría desde cero y chocaría contra los registros existentes.
        throw new Error(`La secuencia '${nombre}' no existe en SECUENCIAS. Hay que sembrarla antes de usarla.`);
    }

    const [filas] = await db.query(
        'SELECT valor FROM SECUENCIAS WHERE nombre = :nombre',
        { replacements: { nombre }, transaction }
    );
    return Number(filas[0].valor);
}

/**
 * Inserta un registro asignándole el siguiente código correlativo de una secuencia.
 *
 * @param {object} modelo       Modelo Sequelize (ej. Traslados)
 * @param {string} campo        Columna del código único (ej. 'codigoTraslado')
 * @param {string} prefijo      Prefijo incluyendo el guion (ej. 'TR-')
 * @param {string} secuencia    Nombre del contador en SECUENCIAS (ej. 'traslado')
 * @param {object} datos        Resto de campos del registro
 * @param {object} transaction  Transacción en curso
 * @returns {Promise<object>}   La instancia creada
 */
export async function crearConCodigo(modelo, campo, prefijo, secuencia, datos, transaction) {
    const numero = await siguienteNumero(secuencia, transaction);
    return modelo.create({ ...datos, [campo]: `${prefijo}${numero}` }, { transaction });
}
