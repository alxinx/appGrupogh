import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Material del catálogo de producción. `codigoMaterial` es el código que trae cada capa del
// DXF: un número simple ("1") o un código compuesto familia.material ("1.23") — es la llave
// con la que se cruza el archivo de corte contra este catálogo, por eso es único.
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
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
        validate: {
            isValidCodigo(val) {
                if (!/^\d{1,10}(\.\d{1,10})?$/.test(String(val))) {
                    throw new Error('El código del material debe ser un número (ej: 1) o un código compuesto (ej: 1.23).');
                }
            }
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
    }, 
    imagen: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
},
{
    tableName: 'MATERIAL',
    timestamps: true
});

export default Material;
