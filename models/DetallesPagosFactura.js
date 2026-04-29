import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const DetallesPagosFactura = db.define('DETALLES_PAGOS_FACTURA', {
    idDetallePago: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        unique: true,
        allowNull: false
    },
    idFacturaCliente: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'FACTURA_CLIENTES',
            key: 'idFacturaCliente'
        }
    },
    idEntidad: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'ENTIDADES',
            key: 'idEntidad'
        }
    },
    metodoPago: {
        type: DataTypes.ENUM('Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito', 'Efectivo'),
        allowNull: false
    },
    valor: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        validate: {
            min: 0.01
        }
    },
    nroReferencia: {
        type: DataTypes.STRING(50),
        allowNull: true
    }
}, {
    tableName: 'DETALLES_PAGOS_FACTURA',
    timestamps: true,
    createdAt: 'create_at',
    updatedAt: false
});

export default DetallesPagosFactura;
