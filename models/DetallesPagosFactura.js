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
    // 'Credito En Tienda' es distinto de 'Entidad Crediticia': esa es una financiera de
    // terceros que ya le pagó al negocio (Addi, Sistecredito), esto es la tienda misma
    // financiando al cliente — no entra plata, es un derecho de cobro futuro. idEntidad
    // se queda null en este caso, igual que en 'Efectivo': no hay una ENTIDADES de por
    // medio. Ver CLAUDE.md antes de tratarla como si fuera la misma cosa que "Créditos"
    // en cualquier reporte — el cuadre de caja (storeControllers._calcularTransaccionesCaja)
    // ya la separa en su propio bucket.
    metodoPago: {
        type: DataTypes.ENUM('Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito', 'Efectivo', 'Credito En Tienda'),
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
