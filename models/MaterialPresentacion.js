import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Cuánto trae una presentación de compra de un material, en su unidad de consumo:
// "bolsa = 500 unidades", "kg = 92 m (9.200 cm)", "rollo = 50 m". Es la SUGERENCIA para la
// próxima recepción — el contenido real se confirma en cada una (un mismo insumo puede
// llegar en bolsas de distinto tamaño, PLAN_COSTEO_PRODUCCION.md D4). La escribe sola la
// recepción con el último contenido confirmado; no hay pantalla para editarla.
//
// Solo hace falta para las presentaciones sin conversión fija (bolsa, caja, rollo, o kg de
// algo que se gasta en cm): metro→cm y kg→g las resuelve helpers/unidadesInsumo.js.
const MaterialPresentacion = db.define('MATERIAL_PRESENTACIONES', {
    idDetalle: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idMaterial: {
        type: DataTypes.CHAR(36),
        allowNull: false,
        references: { model: 'MATERIAL', key: 'idMaterial' }
    },
    presentacion: {
        type: DataTypes.ENUM('kg', 'metro', 'rollo', 'unidad', 'bolsa', 'caja'),
        allowNull: false
    },
    contenidoSugerido: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    }
}, {
    tableName: 'MATERIAL_PRESENTACIONES',
    timestamps: true,
    indexes: [{ unique: true, fields: ['idMaterial', 'presentacion'], name: 'material_presentaciones_unica' }]
});

export default MaterialPresentacion;
