import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// La receta EFECTIVA de una orden de producción: al crearla se copian los insumos de la
// ficha y desde ahí se editan solo en la orden (cambiar un herraje en esta producción no
// cambia la ficha). La cantidad es POR PRENDA, en la unidad de consumo del material, con
// decimales (DECIMAL(15,4), CLAUDE.md §3).
//
// Si el material tiene colores (helpers/ordenesProduccion.js materialesConColor), cada color
// de la prenda elige de qué color va este insumo: ORDENES_PRODUCCION_INSUMOS_COLORES. Sin
// colores se cuenta junto y esa tabla queda vacía para la línea.
const OrdenProduccionInsumo = db.define('ORDENES_PRODUCCION_INSUMOS', {
    idDetalle: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idOrdenProduccion: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'ORDENES_PRODUCCION', key: 'idOrdenProduccion' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idMaterial: {
        type: DataTypes.CHAR(36),
        allowNull: false,
        references: { model: 'MATERIAL', key: 'idMaterial' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    nombreMaterial: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    cantidadPorPrenda: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    orden: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
    tableName: 'ORDENES_PRODUCCION_INSUMOS',
    timestamps: true
});

export default OrdenProduccionInsumo;
