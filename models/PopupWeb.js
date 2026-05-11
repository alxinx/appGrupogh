import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const PopupWeb = db.define('POPUP_WEB', {
    idPopup: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    titulo: {
        type: DataTypes.STRING(120),
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
    link: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    delaySegundos: {
        type: DataTypes.INTEGER,
        defaultValue: 3
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    tableName: 'POPUP_WEB',
    timestamps: true
});

export default PopupWeb;
