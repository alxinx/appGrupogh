import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Una línea "color + cantidad" de una ficha de confección — "mayatext verde 200, mayatext
// azul 140": cada fila es un color de ATRIBUTOS (tipo='COLOR') y cuántas prendas de ese
// color entran en la ficha. Es línea de detalle, no entidad de negocio — INTEGER
// autoincrement, mismo patrón que DETALLES_FACTURA (CLAUDE.md §3).
//
// `idMaterial` dice de QUÉ TELA es esa línea — hace falta cuando el DXF trae más de un
// material (helpers/dxf.js, FichaConfeccionDxfMaterial): "verde" puede ser 200 unidades en
// Mayatext y otras 80 en Polilicra, dos líneas distintas con el mismo color. Con un solo
// material en la ficha no hace falta elegirlo en el formulario — igual se guarda (el único
// resuelto), para que la fila nunca quede ambigua. Nullable porque las fichas creadas antes
// de esta columna no lo tienen (seed/migracionFichaConfeccionColorMaterial.js).
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
    // CHAR(36) plano, no DataTypes.UUID — mismo motivo que FichaConfeccionDxfMaterial.
    // idMaterial: la migración lee la collation real de MATERIAL.idMaterial en vez de
    // asumirla (CLAUDE.md, Error 3780 de MySQL si no calzan exacto).
    idMaterial: {
        type: DataTypes.CHAR(36),
        allowNull: true,
        references: { model: 'MATERIAL', key: 'idMaterial' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
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
