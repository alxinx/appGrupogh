import { DataTypes } from "sequelize";
import db from "../config/bd.js";

// Ledger append-only de abonos a facturas de crédito de cliente — mismo patrón que
// CUENTAS_POR_PAGAR (proveedores, controller/adminControllers.js `registrarAbonoProveedor`):
// cada abono es una fila nueva que ya trae el saldo restante después de aplicarse
// (`valorPorPagar`), no una suma que hay que recalcular cada vez. La fila más reciente por
// factura (`createdAt` DESC) es la deuda actual de esa factura.
//
// Es la tabla que ya se anticipaba en el comentario de CreditoDisponibleCliente.js
// ("abonoClienteCreditos") y que nunca se había llegado a crear.
//
// `idCliente` va denormalizado a propósito, igual que otras bitácoras del proyecto — evita
// un join extra para listar o repartir un "abono global" por cliente sin pasar por
// FACTURA_CLIENTES en cada consulta.
const AbonoClienteCreditos = db.define('ABONO_CLIENTE_CREDITOS', {
    idAbonoClienteCredito: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    idFacturaCliente: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FACTURA_CLIENTES', key: 'idFacturaCliente' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idCliente: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'CLIENTES', key: 'idCliente' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    // Snapshot de FACTURA_CLIENTES.total al momento de este abono — para que la bitácora
    // sea legible aunque la factura cambiara (no debería, pero es dinero: no se confía en
    // un join futuro para saber contra qué se abonó).
    totalFactura: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    valorAbono: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        validate: { min: 0.01 }
    },
    // Saldo de la factura después de este abono. 0 (o menos, no debería pasar) = liquidada.
    valorPorPagar: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        validate: { min: { args: [0], msg: 'El saldo por pagar no puede quedar negativo.' } }
    },
    // Mismo set que DETALLES_PAGOS_FACTURA.metodoPago menos 'Credito En Tienda' — esa no
    // aplica a pagar una deuda ya existente (es la tienda misma financiando, no un cobro).
    // 'Entidad Crediticia' sí aplica: el cliente puede cancelar su deuda financiándose con
    // un tercero (Addi, Sistecrédito) que le paga a la tienda — ahí `idEntidad` es
    // obligatorio, igual que en DETALLES_PAGOS_FACTURA.
    metodoPago: {
        type: DataTypes.ENUM('Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito', 'Efectivo'),
        allowNull: false
    },
    idEntidad: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'ENTIDADES', key: 'idEntidad' }
    },
    // A qué caja, banco o billetera entró la plata de este abono. Es lo que conecta el
    // cobro con el libro de la cuenta: el abono genera además su fila de ingreso en
    // MOVIMIENTOS_CAJAS_BANCOS (ver helpers/abonosCredito.js `aplicarAbonoFIFO`).
    //
    // NULL solo en los abonos anteriores a que existiera esta columna y en el abono de
    // tienda, que todavía no elige cuenta. Un abono nuevo desde el panel siempre la trae.
    idCajaBanco: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'CAJAS_Y_BANCOS', key: 'idCajaBanco' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    nroReferencia: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    // Empleado que recibió/autorizó el abono, congelado igual que en
    // CLIENTES_CREDITO_HISTORIAL — si el empleado cambia de código o se da de baja, la
    // bitácora tiene que seguir diciendo quién fue.
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
    },
    // Agrupa las filas que un mismo "abono global" crea en varias facturas a la vez. Null
    // cuando el abono fue puntual, a una sola factura.
    loteAbonoGlobal: {
        type: DataTypes.UUID,
        allowNull: true
    },
    motivo: {
        type: DataTypes.STRING(255),
        allowNull: true
    }
}, {
    tableName: 'ABONO_CLIENTE_CREDITOS',
    timestamps: true,
    updatedAt: false,
    // Nombres de índice explícitos y cortos por el mismo motivo que
    // CreditoDisponibleClienteHistorial.js (ER_TOO_LONG_IDENT con el autogenerado).
    indexes: [
        { name: 'acc_idx_factura_cliente', fields: ['idFacturaCliente'] },
        { name: 'acc_idx_cliente', fields: ['idCliente'] },
        { name: 'acc_idx_lote_abono_global', fields: ['loteAbonoGlobal'] }
    ]
});

export default AbonoClienteCreditos;
