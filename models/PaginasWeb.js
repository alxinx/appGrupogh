import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const PaginasWeb = db.define('PAGINAS_WEB', {
    idPagina: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    nombrePagina: {
        type: DataTypes.STRING(200),
        allowNull: false
    },
    slug: {
        type: DataTypes.STRING(200),
        allowNull: false,
        unique: true
    },
    contenido: {
        type: DataTypes.TEXT('long'),
        allowNull: true
    },
    tags: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    activa: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'PAGINAS_WEB',
    timestamps: true
});

export default PaginasWeb;
