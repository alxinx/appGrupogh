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
    // Obligatoria en el checkout (se valida en crearPedidoWeb) — se necesita para poder facturar el
    // pedido cuando la tienda lo despache. Sigue siendo allowNull a nivel de columna porque hay
    // pedidos históricos creados antes de que esto fuera obligatorio.
    // Guarda el número de documento sea cual sea el tipo (CC, CE, TI, PP o NIT).
    cedula: { type: DataTypes.STRING(20), allowNull: true },

    // ── Identificación para facturación ──────────────────────────────────
    // Mismo vocabulario que CLIENTES (tipo_persona / tipo_documento), para poder resolver
    // o crear el cliente sin traducir valores. allowNull por los pedidos históricos.
    tipoPersona: {
        type: DataTypes.CHAR(1),
        allowNull: true,
        defaultValue: 'N',
        comment: 'N=Natural, J=Jurídica'
    },
    tipoDocumento: {
        type: DataTypes.STRING(5),
        allowNull: true,
        comment: 'CC, CE, TI, PP (natural) o NIT (jurídica)'
    },
    digitoVerif: { type: DataTypes.CHAR(1), allowNull: true },
    razonSocial: { type: DataTypes.STRING(200), allowNull: true },
    // Dirección con la que se factura. En 'domicilio' se copia de la dirección de envío;
    // en 'tienda' se pide aparte, porque ahí no hay dirección de envío.
    direccionFacturacion: { type: DataTypes.STRING(200), allowNull: true },

    // Cliente de CLIENTES asociado. Se resuelve/crea SOLO cuando la pasarela confirma el pago
    // (procesarPagoAprobado) — nunca en 'pendiente_pago' ni en contraentrega.
    idCliente: { type: DataTypes.UUID, allowNull: true },

    // El documento ya existía en CLIENTES con un email o teléfono distinto al que digitó el
    // comprador. Los datos de la base mandan; esto solo sirve para avisarle al final del proceso.
    datosClienteDifieren: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

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
        type: DataTypes.ENUM('pendiente_pago', 'en_revision', 'trasladado', 'facturado', 'cancelado'),
        defaultValue: 'pendiente_pago'
    },
    // Momento del último cambio de `estado`. No sirve `updatedAt`: ese se mueve con cualquier
    // edición (asignar tienda, vincular cliente) aunque el estado no haya cambiado.
    // Alimenta el contador de tiempo en estado actual del detalle del pedido en el admin.
    fechaCambioEstado: { type: DataTypes.DATE, allowNull: true },

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
