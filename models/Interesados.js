import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Interesados = db.define('INTERESADOS', {
    idInteres: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    nombreCliente: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    canalContacto: {
        type: DataTypes.ENUM('whatsapp', 'email'),
        allowNull: false,
    },
    canal: {
        type: DataTypes.STRING(200),
        allowNull: false,
    },
    producto: {
        type: DataTypes.UUID,
        allowNull: false,
    },
}, {
    tableName: 'INTERESADOS',
    timestamps: true,
    createdAt: 'fechaCreacion',
    updatedAt: false,
});

export default Interesados;
