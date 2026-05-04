import { DataTypes } from "sequelize";
import db from "../config/bd.js"

const PermisosAcciones = db.define('PERMISOS_ACCIONES', {
    idAccion: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    nombreAccion: {
        type: DataTypes.STRING(50),
        allowNull: false,
    },
},
{
    timestamps: true,
    updatedAt: false,
    tableName: 'PERMISOS_ACCIONES',
})

export default PermisosAcciones;
