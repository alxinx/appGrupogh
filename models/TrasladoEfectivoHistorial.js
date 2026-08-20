import { DataTypes } from "sequelize";
import db from "../config/bd.js";
import { uuidV7 } from "../helpers/uuidV7.js";

/**
 * Bitácora de un traslado de efectivo: cada paso que dio, quién lo dio y por cuánto.
 *
 * Un traslado genera VARIAS filas acá — la salida cuando se despacha, y después el
 * ingreso, el rechazo o la controversia cuando alguien lo recibe. Por eso
 * `idTrasladosEfectivo` se repite: es la clave foránea que agrupa los pasos de un mismo
 * envío, no un identificador único.
 *
 * ES APPEND-ONLY, como el resto de las bitácoras del sistema. Una bitácora de dinero que
 * se puede editar no sirve para auditar nada: si el paso registrado se puede cambiar
 * después, deja de ser evidencia. Un paso equivocado se corrige agregando otro paso.
 *
 * La protección va en dos capas, igual que en MOVIMIENTOS_CAJAS_BANCOS:
 *   1. Hooks de Sequelize (acá abajo), que cubren la aplicación.
 *   2. Triggers de MySQL (seed/migracionTrasladoEfectivoHistorial.js), que cubren
 *      cualquier otro cliente: consola, cliente gráfico, otro proceso.
 */

const INMUTABLE = 'TRASLADO_EFECTIVO_HISTORIAL es una bitácora append-only: un paso no se edita ni se elimina. Para corregir, registrá un paso nuevo.';

const bloquear = () => { throw new Error(INMUTABLE); };

const TrasladoEfectivoHistorial = db.define('TRASLADO_EFECTIVO_HISTORIAL', {
    // UUID v7: los pasos de un traslado se leen en orden cronológico, y el id ya ordena
    // por fecha de creación sin depender de createdAt.
    idTransaccion: {
        type: DataTypes.UUID,
        defaultValue: () => uuidV7(),
        primaryKey: true,
        allowNull: false
    },

    // El traslado al que pertenece este paso. NO es único: un mismo traslado tiene una
    // fila de salida y al menos una de recepción.
    idTrasladosEfectivo: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'TRASLADO_EFECTIVO', key: 'idTrasladosEfectivo' }
    },

    // Quién ejecutó este paso. EMPLEADOS es paranoid: un empleado despedido sigue
    // apareciendo como autor del paso que hizo.
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' }
    },

    // 'Excedente' es su propio paso y no un segundo 'Ingreso': un traslado que llega con
    // sobrante queda 'Recibido' —lo que la tienda mandó sí llegó completo— y el sobrante
    // es un hecho aparte. Con dos 'Ingreso' en la bitácora, cualquier suma de lo asentado
    // daría el total mezclado y nadie podría separar una cosa de la otra.
    tipoTransaccion: {
        type: DataTypes.ENUM('Ingreso', 'Salida', 'Controversia', 'Rechazado', 'Excedente'),
        allowNull: false,
        validate: {
            isIn: {
                args: [['Ingreso', 'Salida', 'Controversia', 'Rechazado', 'Excedente']],
                msg: 'Tipo de transacción inválido.'
            }
        }
    },

    // DECIMAL, nunca FLOAT: es dinero. El sentido lo da `tipoTransaccion`, así que el
    // valor siempre es positivo.
    valorTransaccion: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        validate: {
            min: { args: [0.01], msg: 'El valor de la transacción debe ser mayor que cero.' }
        }
    },

    // Lo que escriba el empleado, o el texto que arma el sistema cuando no escribe nada
    // (por ejemplo, el cambio de caja destino, que se anota siempre).
    observacion: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: "TRASLADO_EFECTIVO_HISTORIAL",
    timestamps: true,
    updatedAt: false,   // no existe: la fila nunca se actualiza
    indexes: [
        // La consulta natural: "mostrame el recorrido de este traslado, en orden".
        { name: 'idx_tras_hist_traslado', fields: ['idTrasladosEfectivo', 'idTransaccion'] },
        { name: 'idx_tras_hist_empleado', fields: ['idEmpleado'] }
    ],
    hooks: {
        beforeUpdate:      bloquear,
        beforeBulkUpdate:  bloquear,
        beforeDestroy:     bloquear,
        beforeBulkDestroy: bloquear,
        beforeUpsert:      bloquear
    }
});

// `save()` sobre una fila ya persistida es un UPDATE. El hook lo frena igual, pero
// cortarlo acá deja el error más cerca de quien lo provocó.
const guardarOriginal = TrasladoEfectivoHistorial.prototype.save;
TrasladoEfectivoHistorial.prototype.save = function (...args) {
    if (!this.isNewRecord) bloquear();
    return guardarOriginal.apply(this, args);
};

TrasladoEfectivoHistorial.MENSAJE_INMUTABLE = INMUTABLE;

export default TrasladoEfectivoHistorial;
