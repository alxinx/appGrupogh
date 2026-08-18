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
    // Columna huérfana: apuntaba a CAJAS, que se eliminó por no usarse (ver
    // seed/migracionEliminarCajas.js). Se conserva porque esta tabla tampoco tiene
    // datos ni código todavía; cuando se implemente el módulo de abonos a proveedores
    // hay que decidir contra qué cuenta se registra el pago. Sin `references`: si se
    // dejara, db.sync() intentaría crear una FK contra una tabla inexistente.
    idCaja: {
        type: DataTypes.UUID,
        allowNull: false
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