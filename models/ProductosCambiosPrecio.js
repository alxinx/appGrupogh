import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Bitácora de cada cambio de precio hecho en bloque ("Editar precios masivamente" del
// listado de inventario). Una fila por producto y por cambio, con el precio de antes y el de
// después, y quién lo autorizó con su código de empleado (nombre y código congelados, como
// en PEDIDOS_WEB_HISTORIAL_ESTADO): si mañana un precio está mal, se sabe de dónde salió y
// cuánto valía.
//
// `lote` agrupa las filas de una misma operación: una edición de tres familias son cientos
// de filas con el mismo lote. Un precio que no se tocó queda con antes = después.
//
// Append-only (triggers de npm run db:migrar-cambios-precio): se agrega, nunca se edita.
const ProductosCambiosPrecio = db.define('PRODUCTOS_CAMBIOS_PRECIO', {
    idCambio: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    lote: {
        type: DataTypes.UUID,
        allowNull: false
    },
    idProducto: {
        type: DataTypes.UUID,
        allowNull: false
    },
    publicoAntes:    { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    publicoDespues:  { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    mayoristaAntes:  { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    mayoristaDespues:{ type: DataTypes.DECIMAL(10, 2), allowNull: true },
    surtidoAntes:    { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    surtidoDespues:  { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    // Por qué se eligieron estos productos: una familia entera o el producto suelto.
    alcance: {
        type: DataTypes.ENUM('familias', 'productos'),
        allowNull: false
    },
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: false
    },
    nombreEmpleado: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    codigoEmpleado: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: true
    }
}, {
    tableName: 'PRODUCTOS_CAMBIOS_PRECIO',
    updatedAt: false,
    indexes: [{ fields: ['idProducto', 'createdAt'] }, { fields: ['lote'] }]
});

export default ProductosCambiosPrecio;
