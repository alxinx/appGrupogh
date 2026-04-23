import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const InsidenciaTraslado = db.define('INSIDENCIAS_TRASLADOS', {
    idInsidencia: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idTraslado: {
        type: DataTypes.UUID,
        allowNull: false
    },
    idDetalleTraslado: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    fechaInsidencia: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: false
    },
    razonInsidencia: {
        type: DataTypes.STRING(500),
        allowNull: false
    },
    cantidadOriginal: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    cantidadAceptada: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    resuelta: {
        type: DataTypes.ENUM('si', 'no'),
        defaultValue: 'no'
    }
}, {
    tableName: 'INSIDENCIAS_TRASLADOS',
    timestamps: false
});

export default InsidenciaTraslado;
