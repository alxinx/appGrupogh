import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Cada cambio de etapa de un proceso (FichaConfeccionProceso) — append-only, mismo patrón
// que PEDIDOS_WEB_HISTORIAL_ESTADO: fecha, cantidad y quién lo marcó, uno por transición.
// No se edita ni se borra una fila ya escrita; el estado "actual" vive en
// FichaConfeccionProceso.estado, esto es la bitácora de cómo se llegó hasta ahí. INTEGER
// autoincrement — línea de detalle, no entidad de negocio (CLAUDE.md §3).
const FichaConfeccionProcesoHistorial = db.define('FICHAS_CONFECCION_PROCESOS_HISTORIAL', {
    idHistorial: {
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
    estado: {
        type: DataTypes.ENUM('asignado', 'entregado_taller', 'en_revision', 'entregada'),
        allowNull: false
    },
    // Cuántas unidades pasaron a esta etapa — puede ser parcial (un taller puede entregar de
    // a tandas). Nullable: no todas las transiciones necesariamente tienen una cantidad
    // propia (ej. pasar a "en_revision" es un cambio de estado, no de cuánto hay).
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: { args: [1], msg: 'La cantidad debe ser mayor a 0.' } }
    },
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    notas: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'FICHAS_CONFECCION_PROCESOS_HISTORIAL',
    timestamps: true
});

export default FichaConfeccionProcesoHistorial;
