import { DataTypes } from "sequelize";
import { uuidV7 } from "../helpers/uuidV7.js";
import db from "../config/bd.js";

// Cupo de crédito y saldo a favor disponibles de un cliente. Distinto de
// CLIENTES_CREDITO_HISTORIAL (esa es la bitácora de quién otorgó/suspendió el permiso de
// comprar a crédito); esta tabla es el saldo en plata que ese permiso deja disponible.
//
// PK en UUID v7 a pedido explícito — mismo generador propio que ya usan CAJAS_Y_BANCOS,
// MOVIMIENTOS_CAJAS_BANCOS y TRASLADO_EFECTIVO_HISTORIAL (helpers/uuidV7.js, no la
// librería `uuid`: ver el comentario de ese archivo). El resto de las tablas de negocio
// sigue en UUID v4 (CLAUDE.md §"Arquitectura de datos").
const CreditoDisponibleCliente = db.define('CREDITO_DISPONIBLE_CLIENTE', {
    idCreditoDisponible: {
        type: DataTypes.UUID,
        defaultValue: () => uuidV7(),
        primaryKey: true,
        allowNull: false
    },
    idCliente: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'CLIENTES', key: 'idCliente' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    // Cupo total autorizado en el momento de esta fila. Dinero, nunca FLOAT (CLAUDE.md
    // §"Datos financieros").
    valorCreditoCliente: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
            min: { args: [0], msg: 'El valor del crédito no puede ser negativo.' }
        }
    },
    // Lo que queda disponible para usar de ese cupo. Nunca puede superar valorCreditoCliente
    // (validado abajo a nivel de fila, porque compara dos columnas entre sí).
    creditoDisponible: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
            min: { args: [0], msg: 'El crédito disponible no puede ser negativo.' }
        }
    },

    // Días máximos que un desembolso de este cupo (una factura pagada con "Credito En
    // Tienda") puede quedar sin al menos un abono antes de contar como mora. No es "cuántos
    // días dura el crédito": cada desembolso corre su propio plazo desde su fecha, y se
    // evalúa contra abonoClienteCreditos (idFacturaCliente → esa factura puntual) — si el
    // desembolso más antiguo sigue con saldo > 0 pasado ese plazo, entra en mora aunque
    // desembolsos más nuevos sigan sin vencer. `null` en filas viejas = sin plazo definido,
    // no se evalúan hasta que se les asigne uno.
    tiempoCredito: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: { args: [0], msg: 'El tiempo de crédito no puede ser negativo.' }
        }
    },
    tipo: {
        type: DataTypes.ENUM('Credito', 'Saldo a Favor'),
        allowNull: false,
        defaultValue: 'Credito'
    },
    // Empleado que autorizó este cupo/saldo.
    autorizo: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    }
}, {
    tableName: 'CREDITO_DISPONIBLE_CLIENTE',
    timestamps: true,
    indexes: [{ fields: ['idCliente'] }, { fields: ['autorizo'] }],
    validate: {
        creditoDisponibleNoSuperaElValor() {
            if (parseFloat(this.creditoDisponible) > parseFloat(this.valorCreditoCliente)) {
                throw new Error('creditoDisponible no puede ser mayor que valorCreditoCliente.');
            }
        }
    }
});

export default CreditoDisponibleCliente;
