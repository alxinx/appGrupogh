import { DataTypes } from "sequelize";
import db from "../config/bd.js";

// Bitácora append-only de los cambios de estado de un pedido web hechos a mano desde el
// panel. `PEDIDOS_WEB.idOperadorRevisor` solo guarda al último que tocó el pedido; acá
// queda la secuencia completa — quién lo dio por pagado, quién lo canceló después y por qué.
// Es dinero: nunca se borra ni se edita.
const PedidosWebHistorialEstado = db.define('PEDIDOS_WEB_HISTORIAL_ESTADO', {
    idHistorial: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    idPedido: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PEDIDOS_WEB', key: 'idPedido' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    estadoAnterior: {
        type: DataTypes.ENUM('pendiente_pago', 'en_revision', 'trasladado', 'facturado', 'cancelado'),
        allowNull: false
    },
    estadoNuevo: {
        type: DataTypes.ENUM('pendiente_pago', 'en_revision', 'trasladado', 'facturado', 'cancelado'),
        allowNull: false
    },
    // Empleado que autorizó el cambio con su código. Es el "quién" que pidió el operador.
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
    tableName: 'PEDIDOS_WEB_HISTORIAL_ESTADO',
    timestamps: true,
    updatedAt: false,
    indexes: [{ fields: ['idPedido'] }]
});

export default PedidosWebHistorialEstado;
