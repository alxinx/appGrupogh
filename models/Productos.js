import { DataTypes, UUIDV4 } from "sequelize";
import db from "../config/bd.js";

const Productos = db.define('PRODUCTOS', {
    idProducto: {
        type: DataTypes.UUID,
        defaultValue: UUIDV4,
        primaryKey: true,
        unique: true,
        allowNull : false
    },
    nombreProducto: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    slug : {
        type : DataTypes.STRING(100),
        allowNull : true
    },

    idCategoria: { 
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
    validate: {
        len: [0, 13] // Valida que no exceda los 13 caracteres
    },
    set(val) {
        if (val === '' || (typeof val === 'string' && val.trim() === '')) {
            this.setDataValue('ean', null);
        } else {
            this.setDataValue('ean', val);
        }
    }
    },
    tags : {
        type : DataTypes.STRING(255),
        allowNull : true
    },
    descripcion : {
        type : DataTypes.TEXT,
        allowNull : true
    },

    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    web : {
        type: DataTypes.BOOLEAN,
        defaultValue: false
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