import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Imagenes = db.define('IMAGENES', {
    idMultimedia: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idProducto: {
        type: DataTypes.UUID, // CAMBIAR de INTEGER a UUID
        allowNull: true
    },
    nombreImagen: {
        type: DataTypes.STRING(100),
        allowNull: false
    },

    tipo: {
        type: DataTypes.ENUM('principal', 'galeria'),
        defaultValue : 'galeria'
    },
    idAtributoColor: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'ATRIBUTOS',
            key: 'idAtributo'
        }
    },

}, {
    tableName: "IMAGENES",
    timestamps: true
});

export default Imagenes;