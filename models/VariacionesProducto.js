import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const VariacionesProducto = db.define('VARIACION_PRODUCTO', {
    idVariacion: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idProducto: {
        type: DataTypes.UUID, // Debe ser UUID igual que en Productos
        allowNull: false,
        references: { 
            model: 'PRODUCTOS', 
            key: 'idProducto' 
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idAtributos: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    valor: {
        type: DataTypes.STRING(100),
        allowNull: false
    }
}, {
    tableName: "VARIACION_PRODUCTO",
    timestamps: true,
    indexes : [
        {
            fields : ['idProducto', 'idAtributos']
        } 
    ]
});

export default VariacionesProducto;