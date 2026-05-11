import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const SeccionesWeb = db.define('SECCIONES_WEB', {
    idSeccion: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    titulo: {
        type: DataTypes.STRING(120),
        allowNull: false
    },
    imagenUrl: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    imagenKey: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    idCategoria: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'CATEGORIAS',
            key: 'idCategoria'
        }
    },
    orden: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'SECCIONES_WEB',
    timestamps: true
});

export default SeccionesWeb;
