import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Constancia de cada paso de una orden de producción: creada, editada, confirmada, cancelada
// (y cerrada, cuando exista). Append-only con triggers
// (seed/migracionOrdenesProduccion.js). El estado actual vive en OrdenProduccion.estado;
// esto es cómo se llegó ahí. El nombre del usuario va congelado, igual que en
// INSUMOS_MOVIMIENTOS.
const OrdenProduccionEstado = db.define('ORDENES_PRODUCCION_ESTADOS', {
    idRegistro: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idOrdenProduccion: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'ORDENES_PRODUCCION', key: 'idOrdenProduccion' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    accion: {
        type: DataTypes.ENUM('creada', 'editada', 'confirmada', 'cancelada', 'cerrada'),
        allowNull: false
    },
    estadoAnterior: {
        type: DataTypes.ENUM('borrador', 'en_curso', 'cerrada', 'cancelada'),
        allowNull: true
    },
    estadoNuevo: {
        type: DataTypes.ENUM('borrador', 'en_curso', 'cerrada', 'cancelada'),
        allowNull: false
    },
    motivo: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    nombreUsuario: {
        type: DataTypes.STRING(150),
        allowNull: true
    }
}, {
    tableName: 'ORDENES_PRODUCCION_ESTADOS',
    timestamps: true,
    updatedAt: false
});

export default OrdenProduccionEstado;
