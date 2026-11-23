import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Bitácora de cada rollo de tela: cuándo entró, quién lo tendió, quién adelantó su reposo o
// deshizo un tendido y por qué, y cada salida por ajuste. Append-only con triggers
// (seed/migracionRollosTela.js). Quién actuó va congelado, con el mismo actor genérico que
// INSUMOS_MOVIMIENTOS (origen panel/portal, usuario y empleado).
const InsumoRolloEstado = db.define('INSUMOS_ROLLOS_ESTADOS', {
    idRegistro: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idRollo: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'INSUMOS_ROLLOS', key: 'idRollo' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    accion: {
        type: DataTypes.ENUM('recibido', 'tendido', 'listo_adelantado', 'tendido_deshecho', 'ajuste_salida', 'corte'),
        allowNull: false
    },
    estadoAnterior: {
        type: DataTypes.ENUM('sin_tender', 'tendido', 'en_corte', 'agotado'),
        allowNull: true
    },
    estadoNuevo: {
        type: DataTypes.ENUM('sin_tender', 'tendido', 'en_corte', 'agotado'),
        allowNull: false
    },
    cantidadCm: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: true
    },
    motivo: {
        type: DataTypes.STRING(300),
        allowNull: true
    },
    origen: {
        type: DataTypes.ENUM('panel', 'portal'),
        allowNull: false,
        defaultValue: 'panel'
    },
    idUsuario: { type: DataTypes.CHAR(36), allowNull: true },
    nombreUsuario: { type: DataTypes.STRING(150), allowNull: true },
    idEmpleado: { type: DataTypes.CHAR(36), allowNull: true },
    nombreEmpleado: { type: DataTypes.STRING(150), allowNull: true },
    codigoEmpleado: { type: DataTypes.STRING(20), allowNull: true }
}, {
    tableName: 'INSUMOS_ROLLOS_ESTADOS',
    timestamps: true,
    updatedAt: false
});

export default InsumoRolloEstado;
