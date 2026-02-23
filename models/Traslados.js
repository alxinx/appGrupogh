import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Traslados = db.define('TRASLADOS', {
    idTraslado: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    codigoTraslado: { // Ej: TR-1002
        type: DataTypes.STRING,
        unique: true,
        allowNull: false
    },
    idOrigen: { 
        type: DataTypes.UUID, 
        allowNull: false // Puede ser el ID de un Punto de Venta o el ID de la Bodega Virtual
    },
    idDestino: { 
        type: DataTypes.UUID, 
        allowNull: false //Al punto de venta o bodega
    },
    idUsuarioDespacha: { 
        type: DataTypes.UUID, 
        allowNull: false 
    },
    idUsuarioRecibe: { 
        type: DataTypes.UUID, 
        allowNull: true // Nulo hasta que el destino confirme recepción
    },
    fechaEnvio: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    fechaRecepcion: {
        type: DataTypes.DATE,
        allowNull: true
    },
    estado: {
        type: DataTypes.ENUM('PENDIENTE', 'EN_TRANSITO', 'RECIBIDO', 'ANULADO'),
        defaultValue: 'PENDIENTE'
    },
    notas: DataTypes.TEXT
}, {
    tableName: 'TRASLADOS',
    timestamps: true
});

export default Traslados;