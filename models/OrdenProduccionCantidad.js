import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Cuántas prendas de cada color y talla pide una orden de producción. Una fila por celda de
// la grilla con cantidad > 0. `talla` es el código del catálogo (src/json/tallasCorte.json:
// 'S', 'M', 'UNICA'…), tomado de las tallas del DXF de la ficha.
const OrdenProduccionCantidad = db.define('ORDENES_PRODUCCION_CANTIDADES', {
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
    idAtributoColor: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'ATRIBUTOS', key: 'idAtributo' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    talla: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: { args: [1], msg: 'La cantidad debe ser mayor a 0.' } }
    }
}, {
    tableName: 'ORDENES_PRODUCCION_CANTIDADES',
    timestamps: true,
    indexes: [{ unique: true, fields: ['idOrdenProduccion', 'idAtributoColor', 'talla'], name: 'ordenes_produccion_cantidades_uk' }]
});

export default OrdenProduccionCantidad;
