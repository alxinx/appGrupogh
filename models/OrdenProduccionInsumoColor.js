import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// De qué color va un insumo con colores para cada color de prenda de la orden ("resorte
// negro para el body negro, blanco para el blanco"). Solo existe para los insumos cuyo
// material tiene colores; los demás se cuentan juntos (models/OrdenProduccionInsumo.js).
const OrdenProduccionInsumoColor = db.define('ORDENES_PRODUCCION_INSUMOS_COLORES', {
    idDetalle: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idInsumoOrden: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'ORDENES_PRODUCCION_INSUMOS', key: 'idDetalle' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idAtributoColorPrenda: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'ATRIBUTOS', key: 'idAtributo' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idAtributoColorInsumo: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'ATRIBUTOS', key: 'idAtributo' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    }
}, {
    tableName: 'ORDENES_PRODUCCION_INSUMOS_COLORES',
    timestamps: true,
    indexes: [{ unique: true, fields: ['idInsumoOrden', 'idAtributoColorPrenda'], name: 'ordenes_produccion_insumos_colores_uk' }]
});

export default OrdenProduccionInsumoColor;
