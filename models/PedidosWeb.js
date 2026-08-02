import { DataTypes, UUIDV4 } from "sequelize";
import db from "../config/bd.js";

const PedidosWeb = db.define('PEDIDOS_WEB', {
    idPedido: {
        type: DataTypes.UUID,
        defaultValue: UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    numeroPedido: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    idVisitante: {
        type: DataTypes.UUID,
        allowNull: true
    },

    // ── Entrega ──────────────────────────────────────────────────────────
    tipoEntrega: {
        type: DataTypes.ENUM('domicilio', 'tienda'),
        allowNull: false
    },
    idPuntoVentaRecogida: {
        type: DataTypes.UUID,
        allowNull: true // solo si tipoEntrega = 'tienda'
    },

    // ── Contacto (siempre) ───────────────────────────────────────────────
    nombreCliente: { type: DataTypes.STRING(100), allowNull: false },
    apellidoCliente: { type: DataTypes.STRING(100), allowNull: false },
    email: { type: DataTypes.STRING(150), allowNull: false, validate: { isEmail: true } },
    telefono: { type: DataTypes.STRING(20), allowNull: false },
    cedula: { type: DataTypes.STRING(20), allowNull: true }, // obligatoria para recoger en tienda; se completa después si es domicilio

    // ── Envío a domicilio (solo si tipoEntrega = 'domicilio') ───────────
    direccion: { type: DataTypes.STRING(200), allowNull: true },
    apto: { type: DataTypes.STRING(50), allowNull: true },
    ciudad: { type: DataTypes.STRING(100), allowNull: true },
    departamento: { type: DataTypes.STRING(100), allowNull: true },
    notasEntrega: { type: DataTypes.STRING(255), allowNull: true },

    // ── Pago ─────────────────────────────────────────────────────────────
    metodoPago: {
        type: DataTypes.ENUM('contraentrega', 'tarjeta', 'pse', 'nequi'),
        allowNull: false
    },

    // ── Montos ───────────────────────────────────────────────────────────
    subtotal: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    envio: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    descuento: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    total: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },

    // ── Estado del pedido (no confundir con el estado del pago, ver PAGOS_PEDIDO_WEB) ──
    estado: {
        type: DataTypes.ENUM('pendiente_pago', 'en_revision', 'facturado', 'cancelado'),
        defaultValue: 'pendiente_pago'
    },

    // ── Revisión operativa (capa humana anti-fraude) ────────────────────
    idOperadorRevisor: { type: DataTypes.UUID, allowNull: true },
    fechaRevision: { type: DataTypes.DATE, allowNull: true },
    razonRechazo: { type: DataTypes.TEXT, allowNull: true },
    idTiendaFacturacion: { type: DataTypes.UUID, allowNull: true },
    idFacturaCliente: { type: DataTypes.UUID, allowNull: true }
}, {
    tableName: 'PEDIDOS_WEB',
    timestamps: true
});

export default PedidosWeb;
