import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const CenefasWeb = db.define('CENEFAS_WEB', {
    idCenefa: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    texto: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    link: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    colorFondo: {
        type: DataTypes.STRING(20),
        defaultValue: '#EC5FA3'
    },
    colorTexto: {
        type: DataTypes.STRING(20),
        defaultValue: '#FFFFFF'
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'CENEFAS_WEB',
    timestamps: true
});

export default CenefasWeb;
