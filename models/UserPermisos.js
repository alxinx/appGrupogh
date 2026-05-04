import { DataTypes } from "sequelize";
import db from "../config/bd.js"

const UserPermisos = db.define('USER_PERMISOS', {
    idPermiso: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    idRecurso: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    idAccion: {
        type: DataTypes.UUID,
        allowNull: false,
    },
},
{
    timestamps: true,
    updatedAt: false,
    tableName: 'USER_PERMISOS',
})

export default UserPermisos;
