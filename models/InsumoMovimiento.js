import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Libro del inventario de insumos: una fila por cada cantidad que cambia de estado en una
// capa (InsumoCapa). Append-only con triggers (npm run db:migrar-inventario-insumos): el
// estado actual vive en la capa; esto es cómo se llegó ahí, con quién y por qué.
//
// `costoUnitario` se congela al escribir la fila: es el costo de la capa movida, y con eso
// el costo REAL de lo que consumió una producción se lee de acá sin recalcular nada.
//
// Quién actuó se guarda como actor genérico (`idUsuario` + `origen`): hoy siempre 'panel';
// el portal del confeccionista (PLAN_COSTEO_PRODUCCION.md §7) escribirá 'portal' sin migrar
// nada. Nombre y código del empleado congelados, como PRODUCTOS_CAMBIOS_PRECIO.
//
// Línea de registro → INTEGER autoincrement (CLAUDE.md §3).
export const TIPOS_MOVIMIENTO_INSUMO = [
    'entrada', 'ajuste_entrada', 'ajuste_salida',
    // De la orden de producción (entrega 2):
    'reserva', 'liberar_reserva', 'entrega_taller', 'devolucion', 'consumo', 'merma', 'cobro_taller'
];

const InsumoMovimiento = db.define('INSUMOS_MOVIMIENTOS', {
    idMovimiento: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idCapa: {
        type: DataTypes.CHAR(36),
        allowNull: false,
        references: { model: 'INSUMOS_CAPAS', key: 'idCapa' }
    },
    // Repetido de la capa para listar el libro de un material sin un JOIN.
    idMaterial: {
        type: DataTypes.CHAR(36),
        allowNull: false,
        references: { model: 'MATERIAL', key: 'idMaterial' }
    },
    tipo: {
        type: DataTypes.ENUM(...TIPOS_MOVIMIENTO_INSUMO),
        allowNull: false
    },
    // Siempre positiva, en unidad de consumo: el tipo dice la dirección.
    cantidad: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    costoUnitario: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    idDetalleOrdenCompra: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    motivo: {
        type: DataTypes.STRING(300),
        allowNull: true
    },
    origen: {
        type: DataTypes.ENUM('panel', 'portal'),
        allowNull: false,
        defaultValue: 'panel'
    },
    idUsuario: {
        type: DataTypes.CHAR(36),
        allowNull: true
    },
    nombreUsuario: {
        type: DataTypes.STRING(150),
        allowNull: true
    },
    idEmpleado: {
        type: DataTypes.CHAR(36),
        allowNull: true
    },
    nombreEmpleado: {
        type: DataTypes.STRING(150),
        allowNull: true
    },
    codigoEmpleado: {
        type: DataTypes.STRING(20),
        allowNull: true
    }
}, {
    tableName: 'INSUMOS_MOVIMIENTOS',
    timestamps: true,
    updatedAt: false
});

export default InsumoMovimiento;
