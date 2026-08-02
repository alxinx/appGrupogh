import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const DetallesPedidoWeb = db.define('DETALLES_PEDIDO_WEB', {
    idDetallePedido: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    idPedido: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PEDIDOS_WEB', key: 'idPedido' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idProducto: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PRODUCTOS', key: 'idProducto' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    talla: { type: DataTypes.STRING(20), allowNull: true },
    color: { type: DataTypes.STRING(50), allowNull: true },
    cantidad: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    valorUnidad: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    subTotal: { type: DataTypes.DECIMAL(15, 2), allowNull: false }
}, {
    tableName: 'DETALLES_PEDIDO_WEB',
    timestamps: true
});

export default DetallesPedidoWeb;
