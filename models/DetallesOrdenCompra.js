import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Línea de una orden de compra. INTEGER AUTOINCREMENT porque es detalle, no una entidad
// de negocio (mismo criterio que DETALLES_FACTURA, no UUID).
const DetallesOrdenCompra = db.define('DETALLES_ORDEN_COMPRA', {
    idDetalleOrdenCompra: {
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
    // NUNCA null (CLAUDE.md §6, igual que DetallesFactura.idProducto): una línea de orden
    // siempre es un material real del catálogo.
    //
    // CHAR(36), no DataTypes.UUID: el dialecto MySQL de Sequelize mapea UUID a
    // `CHAR(36) BINARY` (collation utf8mb4_bin), pero MATERIAL.idMaterial se creó con la
    // collation por defecto de la tabla (utf8mb4_0900_ai_ci) — MySQL exige que las dos
    // columnas de una FK compartan collation. CHAR(36) sin más hereda la del charset de
    // la tabla y sí calza. No es una limpieza de MATERIAL: ese es un problema aparte.
    idMaterial: {
        type: DataTypes.CHAR(36),
        allowNull: false,
        references: { model: 'MATERIAL', key: 'idMaterial' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    // Nombre y código DXF del material AL MOMENTO de la orden: si el material se renombra
    // o cambia de código después, esta línea sigue mostrando lo que de verdad se pidió
    // (mismo principio que el precio congelado de una factura).
    nombreMaterial: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    codigoMaterialDxf: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    cantidad: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    // Congelada, no la del catálogo hoy: el material pudo cambiar de unidad después.
    unidadCompra: {
        type: DataTypes.ENUM('kg', 'metro', 'rollo', 'unidad'),
        allowNull: true
    },
    valorUnitario: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    // cantidad × valorUnitario, guardado (igual que DetallesFactura.total): no se
    // recalcula leyendo la orden completa cada vez que se necesita.
    valorTotal: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    // El pedido explícito del usuario: SOLO colores simples de ATRIBUTOS
    // (tipo='COLOR' AND codigo2 IS NULL) — nunca uno combinado. Nullable: no todo
    // insumo necesita color (ver helpers/ordenesCompra.js, coloresSimplesDisponibles()).
    idAtributoColor: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'ATRIBUTOS', key: 'idAtributo' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    // El resto de "características" (Composición, Ancho, Uso...) no tiene columnas
    // propias en ningún lado del catálogo todavía — un JSON flexible evita inventar una
    // tabla EAV completa para algo que no se pidió. Ej:
    // {"composicion": "92% poliéster, 8% elastano", "ancho": "1.60 m"}
    caracteristicas: {
        type: DataTypes.JSON,
        allowNull: true
    },
    // Lo que de verdad llegó, al recibir la orden (admin/insumos/compra/:id, "Recibir
    // orden") — nunca se pisa `cantidad`, que es lo PEDIDO y es un hecho histórico. NULL
    // mientras nadie confirmó recepción de esta línea; puede ser menor, igual o mayor que
    // `cantidad` (entrega parcial, completa o con excedente son las tres reales).
    cantidadRecibida: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: true
    }
}, {
    tableName: 'DETALLES_ORDEN_COMPRA',
    timestamps: true
});

export default DetallesOrdenCompra;
