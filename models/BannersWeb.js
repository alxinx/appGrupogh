import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const BannersWeb = db.define('BANNERS_WEB', {
    idBanner: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    titulo: {
        type: DataTypes.STRING(120),
        allowNull: true
    },
    subtitulo: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    textoBoton: {
        type: DataTypes.STRING(60),
        allowNull: true
    },
    linkBoton: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    imagenUrl: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    imagenKey: {
        type: DataTypes.STRING(255),
        allowNull: true
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
    tableName: 'BANNERS_WEB',
    timestamps: true
});

export default BannersWeb;
