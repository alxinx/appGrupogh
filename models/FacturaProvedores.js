import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const FacturaProveedores = db.define('FACTURA_PROVEEDORES', {
    idFacturaPro: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idProveedor: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PROVEDORES', key: 'idProveedor' }
    },
    nroFactura: { // El número físico de la factura que entrega el proveedor
        type: DataTypes.STRING(50),
        allowNull: false
    },
    nroCompra: { // Tu número interno de orden de compra
        type: DataTypes.STRING(50),
        allowNull: true
    },
    fechaFactura: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    fechaVencimiento: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    // Lógica de Destino
    idPuntoVentaDestino: {
        type: DataTypes.UUID,
        allowNull: false
    },
    // Lógica de Crédito y Pago
    esCredito: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
   
    // Totales
    valorNeto: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    valorImpuestos: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0
    },
    valorTotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    estado: {
        type: DataTypes.ENUM('Pendiente', 'Pagada', 'Anulada'),
        defaultValue: 'Pendiente'
    },
    notas: DataTypes.TEXT
}, {
    tableName: "FACTURA_PROVEEDORES",
    timestamps: true
});

export default FacturaProveedores;