import { DataTypes } from "sequelize";
import db from "../config/bd.js";

// Bitácora append-only de aumentos de cupo (CREDITO_DISPONIBLE_CLIENTE.valorCreditoCliente).
// Mismo criterio de auditoría que CLIENTES_CREDITO_HISTORIAL (que registra otorgar/suspender
// el permiso), pero para el monto del cupo en sí — otro cambio financiero que necesita
// quedar registrado con quién lo autorizó.
const CreditoDisponibleClienteHistorial = db.define('CREDITO_DISPONIBLE_CLIENTE_HISTORIAL', {
    idHistorial: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    idCreditoDisponible: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'CREDITO_DISPONIBLE_CLIENTE', key: 'idCreditoDisponible' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idCliente: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'CLIENTES', key: 'idCliente' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    valorAnterior: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    valorNuevo: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    nombreEmpleado: {
        type: DataTypes.STRING(120),
        allowNull: true
    },
    codigoEmpleado: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    }
}, {
    tableName: 'CREDITO_DISPONIBLE_CLIENTE_HISTORIAL',
    timestamps: true,
    updatedAt: false,
    // Nombres de índice explícitos y cortos: el autogenerado por Sequelize concatena el
    // nombre de tabla + columnas y con este nombre de tabla (largo, a propósito, sigue la
    // convención descriptiva del proyecto) pasa el límite de 64 caracteres de MySQL
    // (ER_TOO_LONG_IDENT).
    indexes: [
        { name: 'cdch_idx_credito_disponible', fields: ['idCreditoDisponible'] },
        { name: 'cdch_idx_cliente', fields: ['idCliente'] }
    ]
});

export default CreditoDisponibleClienteHistorial;
