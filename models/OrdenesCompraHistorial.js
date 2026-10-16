import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Bitácora de TODO movimiento sobre una orden de compra/cotización ya creada: qué se hizo,
// quién lo hizo y cuándo. Append-only — nunca se edita ni se borra una fila, mismo criterio
// que PEDIDOS_WEB_HISTORIAL_ESTADO o ENTIDADES_QR_HISTORIAL (CLAUDE.md §5.8/§5.11).
// INTEGER AUTOINCREMENT porque es tabla de detalle/log, no una entidad de negocio (§3).
const OrdenesCompraHistorial = db.define('ORDENES_COMPRA_HISTORIAL', {
    idHistorial: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    idOrdenCompra: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'ORDENES_COMPRA', key: 'idOrdenCompra' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    // Para el ícono/color de cada fila en la pantalla — el texto real va en `resumen`.
    accion: {
        type: DataTypes.ENUM('creacion', 'edicion', 'conversion', 'recepcion'),
        allowNull: false
    },
    // Texto ya armado en español, listo para mostrarse tal cual (controller/
    // ordenesCompraController.js lo arma) — no JSON crudo que cada vista tendría que
    // interpretar distinto.
    resumen: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    // Quién tenía la sesión — congelado (nombre), igual criterio que
    // ORDENES_COMPRA.empleadoAutorizaNombre: si el usuario cambia de nombre después, esta
    // fila no se reescribe sola.
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    usuarioNombre: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    // El empleado que autorizó con su código — nullable: "Guardar borrador" no lo pide
    // (mismo criterio que ORDENES_COMPRA.idEmpleadoAutoriza). El código queda guardado para
    // trazabilidad interna, pero NUNCA se imprime en ninguna vista (CLAUDE.md §6, es una
    // credencial) — solo el nombre llega a la pantalla.
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    empleadoNombre: {
        type: DataTypes.STRING(150),
        allowNull: true
    },
    empleadoCodigo: {
        type: DataTypes.STRING(5),
        allowNull: true
    }
}, {
    tableName: 'ORDENES_COMPRA_HISTORIAL',
    timestamps: true,
    updatedAt: false
});

export default OrdenesCompraHistorial;
