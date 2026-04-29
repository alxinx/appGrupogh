import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const DetallesImpuestosFacturaCliente = db.define('DETALLES_IMPUESTOS_FACTURA_CLIENTE', {
    idDetalleImpuestosCliente: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    idFacturaCliente: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'FACTURA_CLIENTES',
            key: 'idFacturaCliente'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idDetallesFactura: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'DETALLES_FACTURA',
            key: 'idDetallesFactura'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    tipoImpuesto: {
        type: DataTypes.STRING(10),
        allowNull: false,
        comment: 'IVA, INC, RET_FTE, RET_IVA, etc.'
    },
    nombreImpuesto: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    porcentaje: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0
    },
    baseGravable: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    valorImpuesto: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    retencion: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    }
}, {
    tableName: 'DETALLES_IMPUESTOS_FACTURA_CLIENTE',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
});

export default DetallesImpuestosFacturaCliente;
