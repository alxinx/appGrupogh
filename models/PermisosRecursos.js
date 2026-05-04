import { DataTypes } from "sequelize";
import db from "../config/bd.js"

const PermisosRecursos = db.define('PERMISOS_RECURSOS', {
    idRecurso: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    nombreRecurso: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    tipo: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'general',
    },
},
{
    timestamps: true,
    updatedAt: false,
    tableName: 'PERMISOS_RECURSOS',
})

export default PermisosRecursos;
