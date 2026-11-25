import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Un rollo del tendido y cuántas capas salen de él. Cada capa gasta el largo del trazo. El
// color de las prendas de esas capas es el del rollo (se congela acá al armar el corte).
// `costo` se llena al registrar el corte, con el costo de la capa de inventario del rollo.
const OrdenCorteRollo = db.define('ORDENES_CORTE_ROLLOS', {
    idDetalle: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    idOrdenCorte: {
        type: DataTypes.UUID, allowNull: false,
        references: { model: 'ORDENES_CORTE', key: 'idOrdenCorte' }, onUpdate: 'CASCADE', onDelete: 'CASCADE'
    },
    idRollo: {
        type: DataTypes.UUID, allowNull: false,
        references: { model: 'INSUMOS_ROLLOS', key: 'idRollo' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'
    },
    idAtributoColor: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: 'ATRIBUTOS', key: 'idAtributo' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'
    },
    capas: { type: DataTypes.INTEGER, allowNull: false },
    cmUsados: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    costo: { type: DataTypes.DECIMAL(15, 2), allowNull: true }
}, {
    tableName: 'ORDENES_CORTE_ROLLOS',
    timestamps: true
});

export default OrdenCorteRollo;
