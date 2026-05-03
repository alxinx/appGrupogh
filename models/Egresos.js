import { DataTypes } from "sequelize";
import db from "../config/bd.js"

const Egresos = db.define('EGRESOS', {
    idEgreso: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    idPuntoDeVenta: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PUNTO_DE_VENTA', key: 'idPuntoDeVenta' }
    },
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' }
    },
    valorEgreso: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    referencia: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    descripcion: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    estado: {
        type: DataTypes.ENUM('pendiente', 'liquidada'),
        allowNull: false,
        defaultValue: 'pendiente'
    }
}, {
    tableName: "EGRESOS",
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: false
});

export default Egresos
