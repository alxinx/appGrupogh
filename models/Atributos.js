import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Atributos = db.define('ATRIBUTOS', {
    idAtributo: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    tipo: {
        type: DataTypes.ENUM('COLOR', 'TALLA'),
        allowNull: false
    },
    codigo1: {
        type: DataTypes.STRING(10),
        allowNull: true
    },

    codigo2: {
        type: DataTypes.STRING(10),
        allowNull: true
    },
    valor: {
        type: DataTypes.STRING(100),
        allowNull: false
    }
}, {
    tableName: "ATRIBUTOS",
    timestamps: false
});

export default Atributos;