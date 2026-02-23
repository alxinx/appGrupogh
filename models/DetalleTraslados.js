import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const DetalleTraslados = db.define('DETALLE_TRASLADOS', {
    idDetalleTraslado: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idTraslado: {
        type: DataTypes.UUID,
        allowNull: false
    },
    // Si se mueve un bulto completo
    idPack: { 
        type: DataTypes.UUID, 
        allowNull: true 
    },
    // Si se mueven unidades sueltas
    idProducto: { 
        type: DataTypes.UUID, 
        allowNull: true 
    },
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: false // 1 si es pack, N si es producto suelto
    }
}, {
    tableName: 'DETALLE_TRASLADOS',
    timestamps: false
});

export default DetalleTraslados;