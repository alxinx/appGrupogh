import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const AbonosProveedores = db.define('ABONOS_PROVEEDORES', {
    idAbonoPro: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idFacturaPro: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FACTURA_PROVEEDORES', key: 'idFacturaPro' }
    },
    idCaja: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'CAJAS', key: 'idCaja' }
    },
    fechaAbono: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    monto: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        validate: { min: 0.01 }
    },
    referenciaTransaccion: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    notas: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: "ABONOS_PROVEEDORES",
    timestamps: true // Esto es lo que nos permite identificar cuál fue el primero
});

export default AbonosProveedores;