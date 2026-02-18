import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const CategoriasDeProvedores = db.define('CATEGORIAS_DE_PROVEDORES', {
    idCategoria: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    nombre: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: { msg: "Esta categoría ya existe." },
        validate: {
            notEmpty: { msg: "El nombre de la categoría no puede estar vacío." }
        }
    }
}, {
    tableName: 'CATEGORIAS_DE_PROVEDORES',
    timestamps: false // O true, según prefieras
});

export default CategoriasDeProvedores;