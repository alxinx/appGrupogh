import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Cuántas veces viene cada pieza (nombre × talla) de una referencia en UNA capa del trazo, y
// cuántas lleva una prenda. Con las capas del corte da las piezas que salieron.
const OrdenCortePieza = db.define('ORDENES_CORTE_PIEZAS', {
    idDetalle: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    idReferencia: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: 'ORDENES_CORTE_REFERENCIAS', key: 'idReferencia' }, onUpdate: 'CASCADE', onDelete: 'CASCADE'
    },
    nombrePieza: { type: DataTypes.STRING(120), allowNull: false },
    talla: { type: DataTypes.STRING(20), allowNull: false },
    colocadas: { type: DataTypes.INTEGER, allowNull: false },
    porPrenda: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    areaCm2: { type: DataTypes.DECIMAL(15, 2), allowNull: false }
}, {
    tableName: 'ORDENES_CORTE_PIEZAS',
    timestamps: true
});

export default OrdenCortePieza;
