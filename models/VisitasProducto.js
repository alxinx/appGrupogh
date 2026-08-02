import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const VisitasProducto = db.define('VISITAS_PRODUCTO', {
    idVisita: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    idProducto: {
        type: DataTypes.UUID,
        allowNull: false
    },
    idVisitante: {
        type: DataTypes.UUID,
        allowNull: true
    }
}, {
    tableName: 'VISITAS_PRODUCTO',
    timestamps: true,
    createdAt: 'fecha',
    updatedAt: false,
    indexes: [
        { fields: ['idProducto'] },
        { fields: ['idVisitante'] }
    ]
});

export default VisitasProducto;
