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
    // Presentación en que se COMPRA por lo general (la orden de compra la sugiere y se puede
    // cambiar por línea). bolsa/caja se agregaron con el inventario de insumos.
    unidadCompra: {
        type: DataTypes.ENUM('kg', 'metro', 'rollo', 'unidad', 'bolsa', 'caja'),
        allowNull: true
    },
    // En qué se GASTA y se mide en la ficha, el inventario y el costo ($/cm, $/g, $/unidad).
    // No se cambia si el material ya tiene inventario (las cantidades quedarían en otra unidad).
    unidadConsumo: {
        type: DataTypes.ENUM('cm', 'g', 'unidad'),
        allowNull: false,
        defaultValue: 'unidad'
    },
    // Solo telas: para estimar el consumo desde el DXF (ancho) y pasar metros↔kg (gramaje).
    anchoUtilCm: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true
    },
    gramajeGm2: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true
    },
    // Horas que una tela tiene que reposar tendida antes de cortarse (helpers/rollosTela.js).
    // 48 por defecto (decidido con el dueño el 2026-11-21); solo cuenta para telas.
    reposoHoras: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 48
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
