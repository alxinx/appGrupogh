import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const DetallesFacturaProvedores = db.define('DETALLES_FACTURA_PROVEEDORES', {
    idDetalleFacturaProvedor: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    idFacturaPro: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FACTURA_PROVEEDORES', key: 'idFacturaPro' }
    },
    idProducto: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PRODUCTOS', key: 'idProducto' }
    },
    cantidad: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    valorUnidad: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    impuestos: {
        type: DataTypes.DECIMAL(15, 4),
        defaultValue: 0
    },
    tipoImpuesto: {
        type: DataTypes.ENUM('porcentaje', 'valor'),
        defaultValue: 'valor'
    },
    subtotal: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    total: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    }
}, {
    tableName: 'DETALLES_FACTURA_PROVEEDORES',
    timestamps: true
});

export default DetallesFacturaProvedores;
