import { DataTypes } from "sequelize";
import db from "../config/bd.js";
import { uuidV7 } from "../helpers/uuidV7.js";

/**
 * Libro de movimientos de cajas, bancos y billeteras: cada entrada y cada salida de
 * dinero de una cuenta propia del negocio.
 *
 * ES UNA TABLA APPEND-ONLY. Un movimiento se registra y no se toca nunca más. Si un
 * registro salió mal, se corrige con un movimiento contrario (una contrapartida), igual
 * que en contabilidad — jamás editando o borrando el original. Sin esa regla el saldo de
 * una cuenta deja de ser auditable: cualquiera podría cuadrar la caja cambiando el pasado.
 *
 * La inmutabilidad está en DOS capas, y las dos son necesarias:
 *
 *   1. Hooks de Sequelize (acá abajo). Cubren todo lo que pase por la aplicación,
 *      incluidos los bulk (`update`/`destroy` masivos) e `individualHooks`.
 *   2. Triggers de MySQL (seed/migracionMovimientosCaja.js). Ésta es la garantía real:
 *      los hooks solo existen dentro de Node. Un UPDATE desde la consola de MySQL, desde
 *      un cliente gráfico o desde cualquier otro proceso se salta los hooks pero NO se
 *      salta el trigger.
 *
 * No lleva `updatedAt` a propósito: una fila que nunca se actualiza no tiene por qué
 * llevar una columna que diga cuándo se actualizó.
 */

const INMUTABLE = 'MOVIMIENTOS_CAJAS_BANCOS es un libro append-only: un movimiento no se edita ni se elimina. Para corregir, registrá un movimiento en sentido contrario.';

const bloquear = () => { throw new Error(INMUTABLE); };

const MovimientosCajasBancos = db.define('MOVIMIENTOS_CAJAS_BANCOS', {
    // UUID v7: ordena por fecha de creación, que es justo como se lee un libro de
    // movimientos, y mantiene las inserciones al final del índice primario.
    idMovimiento: {
        type: DataTypes.UUID,
        defaultValue: () => uuidV7(),
        primaryKey: true,
        allowNull: false
    },

    // A qué caja, banco o billetera pertenece el movimiento.
    idCajaBanco: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'CAJAS_Y_BANCOS', key: 'idCajaBanco' }
    },

    // Quién lo registró. EMPLEADOS usa UUID v4 y borrado lógico: el empleado puede quedar
    // despedido y el movimiento debe seguir mostrando quién lo hizo.
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' }
    },

    // Cuándo ocurrió el movimiento, que no siempre es cuándo se asentó: un depósito del
    // viernes puede registrarse el lunes. Es el dato que elige quien registra y por el que
    // se ordena y se filtra el libro.
    //
    // `createdAt` sigue existiendo y NO se toca: es el momento del asiento, un dato de
    // auditoría que nadie escribe a mano. Los dos juntos responden "cuándo pasó" y
    // "cuándo se anotó", que en un libro contable son preguntas distintas.
    fecha: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },

    tipo: {
        type: DataTypes.ENUM('ingreso', 'egreso'),
        allowNull: false,
        validate: {
            isIn: { args: [['ingreso', 'egreso']], msg: 'El tipo debe ser ingreso o egreso.' }
        }
    },

    // DECIMAL, nunca FLOAT: es dinero. El signo lo da `tipo`, así que el valor siempre
    // es positivo — un "egreso de -5000" sería un ingreso disfrazado y rompería
    // cualquier suma por tipo.
    valor: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        validate: {
            min: { args: [0.01], msg: 'El valor debe ser mayor que cero.' }
        }
    },

    // El documento que respalda el movimiento: número de factura, voucher, código de
    // traslado. No es único — un mismo documento puede originar más de un movimiento.
    referencia: {
        type: DataTypes.STRING(50),
        allowNull: true,
        set(valor) {
            const limpio = typeof valor === 'string' ? valor.trim() : valor;
            this.setDataValue('referencia', limpio === '' || limpio === undefined ? null : limpio);
        }
    },

    // Lo que escriba quien registra, o el texto que arma el sistema cuando el
    // movimiento lo genera un flujo automático (por ejemplo, la aceptación de un
    // traslado). Como la fila no se puede editar, esto queda como quedó.
    descripcion: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: "MOVIMIENTOS_CAJAS_BANCOS",
    timestamps: true,
    updatedAt: false,      // no existe: la fila nunca se actualiza
    indexes: [
        { name: 'idx_movimientos_caja_banco', fields: ['idCajaBanco'] },
        // El listado y el saldo corrido recorren los movimientos de una cuenta en orden
        // (fecha, idMovimiento). El id va en el índice porque es el desempate del orden:
        // dos movimientos pueden compartir fecha y sin él la paginación por cursor
        // repetiría o saltearía filas.
        { name: 'idx_movimientos_caja_orden', fields: ['idCajaBanco', 'fecha', 'idMovimiento'] },
        // Auditoría: en qué momento se asentó cada cosa, sin importar cómo esté fechada.
        { name: 'idx_movimientos_caja_asiento', fields: ['idCajaBanco', 'createdAt'] },
        { name: 'idx_movimientos_empleado',   fields: ['idEmpleado'] }
    ],
    hooks: {
        beforeUpdate:      bloquear,
        beforeBulkUpdate:  bloquear,
        beforeDestroy:     bloquear,
        beforeBulkDestroy: bloquear,
        // `upsert` puede terminar en UPDATE sin pasar por beforeUpdate.
        beforeUpsert:      bloquear
    }
});

// `save()` sobre una instancia ya persistida es un UPDATE. El hook beforeUpdate ya lo
// frena, pero cortarlo acá deja el error más cerca de quien lo provocó y no depende de
// que la configuración de hooks siga intacta. Se guarda el original antes de pisarlo:
// `save` vive en el prototipo de Model, no en el objeto sequelize.
const guardarOriginal = MovimientosCajasBancos.prototype.save;
MovimientosCajasBancos.prototype.save = function (...args) {
    if (!this.isNewRecord) bloquear();
    return guardarOriginal.apply(this, args);
};

MovimientosCajasBancos.MENSAJE_INMUTABLE = INMUTABLE;

export default MovimientosCajasBancos;
