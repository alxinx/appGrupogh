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
    // FK a FAMILIA. El nombre de la familia NO se guarda acá: vive una sola vez en su
    // tabla, así renombrarla no obliga a tocar todos sus productos.
    idFamilia: {
        type: DataTypes.UUID,
        allowNull: true // un producto puede no pertenecer a ninguna familia
    },
    precioVentaMayorista: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
    },
    precioVentaMayoristaSurtido: {
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
    // TEMPORAL — costo de adquisición/confección de la prenda.
    // DECIMAL como el resto de los campos de dinero: nunca FLOAT, que redondea mal
    // al sumar. Mismo (10,2) que los precios de esta tabla para poder compararlos
    // sin conversiones.
    // Para retirarlo: quitar este bloque, el campo del formulario, la whitelist de
    // adminControllers y correr la migración con --revertir.
    costo: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
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
        },
        {
            // No único: varios productos comparten familia. El índice es para listar los
            // productos de una familia sin recorrer la tabla entera.
            name: 'productos_familia_idx',
            fields: ['idFamilia']
        }
    ]
});

export default Productos;