import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const CajaTienda = db.define('CAJA_TIENDA', {
    idCajaTienda: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        unique: true,
        allowNull: false
    },
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'EMPLEADOS',
            key: 'idEmpleado'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idPuntoDeVenta: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'PUNTO_DE_VENTA',
            key: 'idPuntoDeVenta'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    fechaApertura: {
        type: DataTypes.DATE,
        allowNull: true
    },
    fechaCierre: {
        type: DataTypes.DATE,
        allowNull: true
    },
    cajaMenor: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasTotales: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasTotalesRegistradas: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    egresosTotales: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    egresosTotalesRegistrados: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasCredito: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasCreditoRegistradas: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasEfectivo: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasEfectivoRegistradas: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasMediosElectronicos: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasMediosElectronicosRegistradas: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    estado: {
        type: DataTypes.ENUM('abierto', 'cerrado', 'auditoria'),
        allowNull: false,
        defaultValue: 'abierto'
    },
    nota: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'CAJA_TIENDA',
    timestamps: true
});

export default CajaTienda;
