import { DataTypes, UUIDV4 } from "sequelize";
import db from "../config/bd.js";
import { normalizarFamilia } from "../helpers/helpers.js";

// Una familia agrupa las variantes del mismo artículo: "Blusa Greicy - Rojo" y
// "Blusa Greicy - Negro" pertenecen a BLUSA GREICY. El nombre vive acá una sola vez;
// PRODUCTOS solo guarda la FK. Renombrar una familia es un UPDATE de una fila.
const Familia = db.define('FAMILIA', {
    idFamilia: {
        type: DataTypes.UUID,
        defaultValue: UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    nombreFamilia: {
        // 100 como nombreProducto: la familia se propone a partir del nombre del producto,
        // así que tiene que poder contener cualquier nombre válido.
        type: DataTypes.STRING(100),
        allowNull: false,
        // Único de verdad: acá sí corresponde. Es la tabla de nombres, una fila por familia.
        unique: true,
        // Normalizar en el modelo y no en cada controlador es lo que garantiza que
        // "  blusa  greicy " y "Blusa Greicy" resuelvan a la MISMA fila.
        set(val) {
            this.setDataValue('nombreFamilia', normalizarFamilia(val));
        },
        validate: {
            notEmpty: { msg: 'La familia necesita un nombre' }
        }
    }
}, {
    tableName: "FAMILIA",
    timestamps: true
});

export default Familia;
