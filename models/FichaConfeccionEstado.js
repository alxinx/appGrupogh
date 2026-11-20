import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Constancia de cada anulación, reactivación o borrado de una ficha de confección: qué se
// hizo, quién, cuándo y por qué. Append-only con triggers (seed/migracionFichaConfeccionEstados.js):
// el estado actual vive en FichaConfeccion.estado (y su deletedAt), esto es cómo se llegó ahí.
const FichaConfeccionEstado = db.define('FICHAS_CONFECCION_ESTADOS', {
    idRegistro: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idFicha: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FICHAS_CONFECCION', key: 'idFicha' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    accion: {
        type: DataTypes.ENUM('anulada', 'reactivada', 'borrada'),
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
    }
}, {
    tableName: 'FICHAS_CONFECCION_ESTADOS',
    timestamps: true,
    updatedAt: false
});

export default FichaConfeccionEstado;
