import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const DetallesFactura = db.define('DETALLES_FACTURA', {
    idDetallesFactura: {
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
    idProducto: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'PRODUCTOS',
            key: 'idProducto'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    cantidad: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    valorUnidad: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    subTotal: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    total: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    }
}, {
    tableName: 'DETALLES_FACTURA',
    timestamps: true
});

export default DetallesFactura;
