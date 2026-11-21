import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Novedades de un taller mientras tiene trabajo en curso — "le hizo falta tela", "le hizo
// falta herrajes" (pedido explícito del usuario). A diferencia de
// FichaConfeccionProcesoHistorial (un cambio de ETAPA), una nota de bitácora no mueve el
// estado del proceso: puede haber varias en cualquier momento, independientes de en qué
// etapa esté. Append-only — INTEGER autoincrement, línea de detalle (CLAUDE.md §3).
const FichaConfeccionProcesoBitacora = db.define('FICHAS_CONFECCION_PROCESOS_BITACORA', {
    idBitacora: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idProceso: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FICHAS_CONFECCION_PROCESOS', key: 'idProceso' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    nota: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { notEmpty: { msg: 'Escribe la novedad.' } }
    }
}, {
    tableName: 'FICHAS_CONFECCION_PROCESOS_BITACORA',
    timestamps: true
});

export default FichaConfeccionProcesoBitacora;
