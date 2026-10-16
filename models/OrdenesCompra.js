import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Orden de compra de insumos/materias primas a un proveedor (admin/insumos/compra).
// Nunca se borra: un `estado` la reemplaza, igual que FacturaClientes.estado o
// Material.activo — la fila es la prueba de lo que se pidió, aunque luego se cancele.
//
// `numeroOrden` ("OC-23") sale de SECUENCIAS vía helpers/secuencias.js (crearConCodigo),
// nunca de un AUTO_INCREMENT ni de MAX()+1: es el mismo mecanismo que ya numera
// traslados (TR-) y pedidos web, pensado para que dos compras simultáneas no choquen.
const OrdenesCompra = db.define('ORDENES_COMPRA', {
    idOrdenCompra: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    numeroOrden: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    // Cotización (sin compromiso) vs. orden de compra formal.
    tipo: {
        type: DataTypes.ENUM('cotizacion', 'orden_compra'),
        allowNull: false,
        defaultValue: 'orden_compra'
    },
    // borrador: se sigue editando, no pide código de empleado (igual que el alta de un
    //           insumo). enviada: ya se "creó" — pide código de un empleado con permiso
    //           de CREATE sobre Insumos (igual que editar/suspender un insumo). El resto
    //           del flujo (confirmada/en_transito/recibida) llega con el seguimiento real
    //           cuando exista. cancelada: nunca se borra la fila, se marca así.
    estado: {
        type: DataTypes.ENUM('borrador', 'enviada', 'confirmada', 'en_transito', 'recibida', 'cancelada'),
        allowNull: false,
        defaultValue: 'borrador'
    },
    idProveedor: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PROVEDORES', key: 'idProveedor' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    // Una cotización puede pedirse a VARIOS proveedores a la vez: cada uno queda en su
    // propia fila (sigue habiendo un idProveedor por fila, nunca una orden con dos
    // proveedores), y las filas que nacieron del mismo pedido comparten este UUID para
    // poder mostrarlas agrupadas (admin/insumos/compra/historial). Null en una orden de
    // compra normal, que siempre es de un solo proveedor.
    idGrupoCotizacion: {
        type: DataTypes.UUID,
        allowNull: true
    },
    // Quién la generó: hoy SIEMPRE 'operador' — no existe todavía ningún proceso
    // automático que cree órdenes de compra (ej. reorden por stock bajo). La columna ya
    // existe para que el día que exista, el historial pueda distinguir una de otra sin
    // una migración nueva.
    origen: {
        type: DataTypes.ENUM('operador', 'sistema'),
        allowNull: false,
        defaultValue: 'operador'
    },
    fechaOrden: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    // "El proveedor confirmará la fecha de entrega y el tiempo de producción" — por eso
    // es solo estimada hasta que haya seguimiento real.
    fechaEntregaEstimada: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    fechaEntregaReal: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    subtotal: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0
    },
    // % de IVA vigente al momento de la orden — se congela acá (mismo criterio que
    // DetallesFactura.porcentajeIva): si el IVA cambia después, esta orden no se mueve.
    porcentajeIva: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 19.00
    },
    valorIva: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0
    },
    total: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0
    },
    notas: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    // Quién la creó (la sesión) vs. quién la AUTORIZÓ a pasar de borrador a enviada — dos
    // cosas distintas, igual criterio que PRODUCTOS_CAMBIOS_PRECIO: nombre y código del
    // empleado quedan CONGELADOS en el momento de autorizar, no se leen de Empleados cada
    // vez, para que un cambio de código después no reescriba quién autorizó esta orden.
    idUsuarioCrea: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idEmpleadoAutoriza: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    empleadoAutorizaNombre: {
        type: DataTypes.STRING(150),
        allowNull: true
    },
    empleadoAutorizaCodigo: {
        type: DataTypes.STRING(5),
        allowNull: true
    }
}, {
    tableName: 'ORDENES_COMPRA',
    timestamps: true
});

export default OrdenesCompra;
