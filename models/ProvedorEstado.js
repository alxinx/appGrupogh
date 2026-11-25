import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Constancia de cada suspensión o reactivación de un proveedor: qué se hizo, quién, cuándo y
// por qué (decidido con el dueño el 2026-11-23). Append-only con triggers
// (seed/migracionProveedorEstados.js): el estado actual vive en PROVEDORES.estado; esto es
// cómo se llegó ahí. El nombre de quien lo hizo queda congelado.
const ProvedorEstado = db.define('PROVEDORES_ESTADOS', {
    idRegistro: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    idProveedor: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PROVEDORES', key: 'idProveedor' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    accion: { type: DataTypes.ENUM('suspendido', 'reactivado'), allowNull: false },
    motivo: { type: DataTypes.TEXT, allowNull: false },
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    nombreUsuario: { type: DataTypes.STRING(150), allowNull: true }
}, {
    tableName: 'PROVEDORES_ESTADOS',
    timestamps: true,
    updatedAt: false
});

export default ProvedorEstado;
