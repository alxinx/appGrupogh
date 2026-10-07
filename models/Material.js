import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Material del catálogo de producción. `codigoMaterial` es el número que trae cada capa del
// DXF ("Material: 1, 2, 3..."): es la llave con la que se cruza el archivo de corte contra
// este catálogo, por eso es único.
//
// Nombre en mayúscula como el resto de tablas del proyecto (SNAKE_CASE_MAYÚSCULA). El RDS
// de producción falla con el nombre en minúscula, así que el modelo y la tabla van en
// mayúscula.
const Material = db.define('MATERIAL', {
    idMaterial: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    codigoMaterial: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        validate: {
            isInt: { msg: 'El código del material debe ser un número entero.' },
            min:   { args: [1], msg: 'El código del material debe ser mayor a 0.' }
        }
    },
    nombre: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: { msg: 'Escribe el nombre del material.' },
            len:      { args: [1, 100], msg: 'El nombre no puede pasar de 100 caracteres.' }
        }
    },
    tipo: {
        type: DataTypes.ENUM('materia_prima', 'insumo'),
        allowNull: false
    },
    unidadCompra: {
        type: DataTypes.ENUM('kg', 'metro', 'rollo', 'unidad'),
        allowNull: true
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
},
{
    tableName: 'MATERIAL',
    timestamps: true
});

export default Material;
