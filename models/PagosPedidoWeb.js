import { DataTypes, UUIDV4 } from "sequelize";
import db from "../config/bd.js";

const PagosPedidoWeb = db.define('PAGOS_PEDIDO_WEB', {
    idPago: {
        type: DataTypes.UUID,
        defaultValue: UUIDV4,
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
    referenciaWompi: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    idTransaccionWompi: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: true
    },
    estado: {
        // Mismos nombres que usa Wompi — no se traducen, para no perder información al auditar.
        type: DataTypes.ENUM('PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'),
        allowNull: false,
        defaultValue: 'PENDING'
    },
    monto: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    metodoPago: {
        type: DataTypes.STRING(30),
        allowNull: true // payment_method_type que reporta Wompi (CARD, PSE, NEQUI, etc.)
    },
    payloadWebhook: {
        type: DataTypes.TEXT,
        allowNull: true // JSON crudo del último evento recibido, para auditoría
    },
    fechaConfirmacion: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'PAGOS_PEDIDO_WEB',
    timestamps: true
});

export default PagosPedidoWeb;
