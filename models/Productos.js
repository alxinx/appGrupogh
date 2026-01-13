import { DataTypes, UUIDV4 } from "sequelize";
import db from "../config/bd.js";

const Productos = db.define('PRODUCTOS', {
    idProducto: {
        type: DataTypes.UUID,
        defaultValue: UUIDV4,
        primaryKey: true,
        unique: true
    },
    nombreProducto: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    idCategoria: { // <--- VERIFICA QUE ESTÉ ASÍ
        type: DataTypes.STRING(50), 
        allowNull: true,
        defaultValue: "0"
    },
    precioVentaMayorista: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
    },
    precioVentaPublicoFinal: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
    },
    tax: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
    },
    sku: {
        type: DataTypes.STRING(50),
        unique: true,
        allowNull: false,
    },
    ean: {
        type: DataTypes.STRING(13),
        unique: true,
        allowNull: true,
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: "PRODUCTOS",
    timestamps: true,
    indexes: [
        {
            // EL NOMBRE AQUÍ DEBE SER EXACTAMENTE EL MISMO QUE EL DEL CAMPO ARRIBA
            fields: ['idCategoria'] 
        } 
    ]
});

export default Productos;