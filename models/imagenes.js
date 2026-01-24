import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Imagenes = db.define('IMAGENES', {
    idMultimedia: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idProducto: {
        type: DataTypes.INTEGER,
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
   
}, {
    tableName: "IMAGENES",
    timestamps: true
});

export default Imagenes;