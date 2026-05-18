import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const EtiquetasWeb = db.define('ETIQUETAS_WEB', {
    idEtiqueta: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    nombre: {
        type: DataTypes.STRING(120),
        allowNull: false
    },
    tipo: {
        type: DataTypes.ENUM('google', 'meta', 'otro'),
        allowNull: false,
        defaultValue: 'otro'
    },
    script: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    posicion: {
        type: DataTypes.ENUM('header', 'body', 'footer'),
        allowNull: false,
        defaultValue: 'body'
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'ETIQUETAS_WEB',
    timestamps: true
});

export default EtiquetasWeb;
