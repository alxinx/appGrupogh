import { DataTypes } from "sequelize";
import db from "../config/bd.js";

// Bitácora append-only de otorgar/suspender el crédito de un cliente — mismo patrón que
// PEDIDOS_WEB_HISTORIAL_ESTADO. CLIENTES.credito solo refleja el estado actual; acá queda
// la secuencia completa de quién autorizó cada cambio y con qué código de empleado.
const ClientesCreditoHistorial = db.define('CLIENTES_CREDITO_HISTORIAL', {
    idHistorial: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
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
    accion: {
        type: DataTypes.ENUM('otorgado', 'suspendido'),
        allowNull: false
    },
    // Empleado que autorizó el cambio con su código. Es el "quién" que pidió el usuario.
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    // Nombre y código congelados al momento del cambio: si el empleado cambia de código
    // o se da de baja, la bitácora tiene que seguir diciendo quién fue.
    nombreEmpleado: {
        type: DataTypes.STRING(120),
        allowNull: true
    },
    codigoEmpleado: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    // Usuario del panel que tenía la sesión abierta. No siempre es el mismo que el empleado
    // que puso el código, y para auditar hace falta saber desde qué cuenta se hizo.
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    motivo: {
        type: DataTypes.STRING(255),
        allowNull: true
    }
}, {
    tableName: 'CLIENTES_CREDITO_HISTORIAL',
    timestamps: true,
    updatedAt: false,
    indexes: [{ fields: ['idCliente'] }]
});

export default ClientesCreditoHistorial;
