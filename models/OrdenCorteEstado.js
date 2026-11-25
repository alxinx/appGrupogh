import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Bitácora de una orden de corte: creada, cortada (con el empleado que autorizó mover la
// tela) y cancelada. Append-only con triggers (seed/migracionOrdenesCorte.js). Mismo actor
// genérico que INSUMOS_MOVIMIENTOS, congelado.
const ESTADOS = ['borrador', 'cortada', 'cancelada'];
const OrdenCorteEstado = db.define('ORDENES_CORTE_ESTADOS', {
    idRegistro: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    idOrdenCorte: {
        type: DataTypes.UUID, allowNull: false,
        references: { model: 'ORDENES_CORTE', key: 'idOrdenCorte' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'
    },
    accion: { type: DataTypes.ENUM('creada', 'cortada', 'cancelada'), allowNull: false },
    estadoAnterior: { type: DataTypes.ENUM(...ESTADOS), allowNull: true },
    estadoNuevo: { type: DataTypes.ENUM(...ESTADOS), allowNull: false },
    motivo: { type: DataTypes.TEXT, allowNull: true },
    origen: { type: DataTypes.ENUM('panel', 'portal'), allowNull: false, defaultValue: 'panel' },
    idUsuario: { type: DataTypes.UUID, allowNull: true },
    nombreUsuario: { type: DataTypes.STRING(150), allowNull: true },
    idEmpleado: { type: DataTypes.UUID, allowNull: true },
    nombreEmpleado: { type: DataTypes.STRING(150), allowNull: true },
    codigoEmpleado: { type: DataTypes.STRING(20), allowNull: true }
}, {
    tableName: 'ORDENES_CORTE_ESTADOS',
    timestamps: true,
    updatedAt: false
});

export default OrdenCorteEstado;
