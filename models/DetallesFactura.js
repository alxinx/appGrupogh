import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const DetallesFactura = db.define('DETALLES_FACTURA', {
    idDetallesFactura: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    idFacturaCliente: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'FACTURA_CLIENTES',
            key: 'idFacturaCliente'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idProducto: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'PRODUCTOS',
            key: 'idProducto'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    cantidad: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    valorUnidad: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    // Base gravable de la línea (precio × cantidad SIN IVA). Antes de la migración
    // migracionImpuestosFactura.js este campo era un duplicado exacto de `total`; ahora
    // es la base real, y `total` sigue siendo el valor con IVA incluido.
    subTotal: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    // % de IVA vigente al momento de la venta (se congela acá — si el IVA cambia
    // después, las facturas ya emitidas no se mueven).
    porcentajeIva: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0
    },
    // Valor de IVA de esta línea: total - subTotal. Se llama `valorImpuesto` y no
    // `impuestos` porque ese nombre ya lo usa la asociación hasMany hacia
    // DETALLES_IMPUESTOS_FACTURA_CLIENTE (models/index.js) — Sequelize no deja que un
    // atributo y un alias de asociación se llamen igual en el mismo modelo.
    valorImpuesto: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0
    },
    // Valor de la línea CON IVA incluido (lo que realmente se cobró: precio × cantidad).
    total: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    }
}, {
    tableName: 'DETALLES_FACTURA',
    timestamps: true
});

export default DetallesFactura;
