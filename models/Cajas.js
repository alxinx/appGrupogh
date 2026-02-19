import { DataTypes,  } from "sequelize";
import db from "../config/bd.js"

const Cajas = db.define('CAJAS', {
    idCaja: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    nombre: {
        type: DataTypes.STRING(100), // Ejemplo: "Caja Menor San Diego", "Bancolombia Principal", "Nequi Grupo GH"
        allowNull: false
    },
    tipo: {
        type: DataTypes.ENUM('Efectivo', 'Banco', 'Billetera Virtual', 'Caja Menor'),
        allowNull: false
    },
    numeroCuenta: {
        type: DataTypes.STRING(20), // Los últimos 4 dígitos o la cuenta completa
        allowNull: true // Opcional para efectivo, obligatorio para bancos
    },
    idPuntoDeVenta: { // Para saber a qué sede pertenece la caja de efectivo
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'PUNTO_DE_VENTA', key: 'idPuntoDeVenta' }
    },
    saldoActual: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0
    },
    moneda: {
        type: DataTypes.STRING(3),
        defaultValue: 'COP'
    }
}, {
    tableName: "CAJAS",
    timestamps: true
});


export default Cajas