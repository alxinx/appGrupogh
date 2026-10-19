import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Una línea "color + cantidad" de una ficha de confección — "mayatext verde 200, mayatext
// azul 140": cada fila es un color de ATRIBUTOS (tipo='COLOR') y cuántas prendas de ese
// color entran en la ficha. Es línea de detalle, no entidad de negocio — INTEGER
// autoincrement, mismo patrón que DETALLES_FACTURA (CLAUDE.md §3).
const FichaConfeccionColor = db.define('FICHAS_CONFECCION_COLORES', {
    idDetalle: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idFicha: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FICHAS_CONFECCION', key: 'idFicha' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idAtributoColor: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'ATRIBUTOS', key: 'idAtributo' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: { args: [1], msg: 'La cantidad debe ser mayor a 0.' } }
    },
    orden: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
    tableName: 'FICHAS_CONFECCION_COLORES',
    timestamps: true
});

export default FichaConfeccionColor;
