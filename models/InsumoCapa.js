import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Una "capa" del inventario de insumos: lo que entró en UNA recepción de compra (o en un
// ajuste de entrada), con SU costo. El inventario de un material es la suma de sus capas, y
// se gasta de la más vieja a la más nueva (FIFO). El costo de un insumo para la ficha es el
// promedio ponderado de lo que sigue DISPONIBLE en las capas vivas (PLAN_COSTEO_PRODUCCION.md
// D1) — así las compras ya gastadas dejan de pesar.
//
// Cada cantidad está en la UNIDAD DE CONSUMO del material (cm, g o unidad), nunca en la
// presentación de compra: "2 kg que resultaron 184 m" entra como 18.400 cm.
//
// Una capa reparte su cantidad inicial en cinco estados, y la suma siempre cuadra:
//   cantidadInicial = disponible + reservada + enProceso + consumida + baja
// reservada/enProceso/consumida los usa la orden de producción (entrega 2); baja es lo que
// sale por ajuste de conteo, merma o cobro al taller. Ningún controlador escribe estas
// columnas: todo pasa por helpers/inventarioInsumos.js.
//
// Entidad de negocio → UUID (CLAUDE.md §3). Las FK a MATERIAL van como CHAR(36) plano por la
// collation de MATERIAL.idMaterial (mismo motivo que DetallesOrdenCompra.idMaterial).
// Función y no un objeto compartido: Sequelize escribe el nombre de la columna dentro de la
// definición de cada atributo, y un mismo objeto para seis columnas las mapea a todas a una.
const cantidad = () => ({ type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 });

const InsumoCapa = db.define('INSUMOS_CAPAS', {
    idCapa: {
        type: DataTypes.CHAR(36),
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idMaterial: {
        type: DataTypes.CHAR(36),
        allowNull: false,
        references: { model: 'MATERIAL', key: 'idMaterial' }
    },
    // El color importa: resorte negro y resorte blanco no son intercambiables.
    idAtributoColor: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'ATRIBUTOS', key: 'idAtributo' }
    },
    origen: {
        type: DataTypes.ENUM('compra', 'ajuste'),
        allowNull: false
    },
    // La línea de compra de la que salió (NULL en un ajuste de entrada).
    idDetalleOrdenCompra: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'DETALLES_ORDEN_COMPRA', key: 'idDetalleOrdenCompra' }
    },
    // Orden FIFO: fechaEntrada (con milisegundos) y, para dos entradas del mismo instante,
    // la columna `secuencia` (BIGINT AUTO_INCREMENT de la tabla, no declarada acá para que
    // Sequelize no la trate como el id). Orden total, CLAUDE.md §8 — idCapa es un UUID al
    // azar y no sirve para desempatar.
    fechaEntrada: {
        type: DataTypes.DATE(3),
        allowNull: false
    },
    cantidadInicial:    cantidad(),
    cantidadDisponible: cantidad(),
    cantidadReservada:  cantidad(),
    cantidadEnProceso:  cantidad(),
    cantidadConsumida:  cantidad(),
    cantidadBaja:       cantidad(),
    // Por unidad de consumo, SIN IVA. El IVA va aparte: si el contador decide que el IVA es
    // costo, se cambia una regla del cálculo, no los datos (PLAN_COSTEO_PRODUCCION.md).
    costoUnitario: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    ivaUnitario: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0
    }
}, {
    tableName: 'INSUMOS_CAPAS',
    timestamps: true
});

export default InsumoCapa;
