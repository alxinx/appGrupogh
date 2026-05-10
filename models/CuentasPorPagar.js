import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const CuentasPorPagar = db.define('CUENTAS_POR_PAGAR', {
    idCuentaPorPagar: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    idFacturaPro: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FACTURA_PROVEEDORES', key: 'idFacturaPro' }
    },
    fechaAbono: {
        type: DataTypes.DATE,
        allowNull: true
    },
    totalFactura: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    valorAbono: {
        type: DataTypes.DECIMAL(15, 4),
        defaultValue: 0
    },
    valorPorPagar: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    }
}, {
    tableName: 'CUENTAS_POR_PAGAR',
    timestamps: true
});

export default CuentasPorPagar;
