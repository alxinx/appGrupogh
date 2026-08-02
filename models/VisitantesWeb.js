import { DataTypes, UUIDV4 } from "sequelize";
import db from "../config/bd.js";

const VisitantesWeb = db.define('VISITANTES_WEB', {
    idVisitante: {
        type: DataTypes.UUID,
        defaultValue: UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    cookieId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true
    },
    nombre: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    email: {
        type: DataTypes.STRING(150),
        allowNull: true,
        validate: { isEmail: true }
    },
    telefono: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    consentimiento: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    consentimientoFecha: {
        type: DataTypes.DATE,
        allowNull: true
    },
    utmSource: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    utmMedium: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    utmCampaign: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    referrer: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    primeraVisita: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    ultimaVisita: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'VISITANTES_WEB',
    timestamps: true
});

export default VisitantesWeb;
