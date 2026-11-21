import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Insumo adicional de una ficha de confección — botones, cierres, elástico, marquilla…
// que SÍ se identifican contra el catálogo de MATERIAL (a diferencia de "Complementos",
// el texto libre de FichaConfeccion, para lo que no vale la pena catalogar). Opcional: una
// ficha puede no llevar ninguno (no todo lo que se confecciona necesita insumos aparte de
// la tela). Línea de detalle, no entidad de negocio — INTEGER autoincrement, mismo patrón
// que FICHAS_CONFECCION_COLORES y DETALLES_ORDEN_COMPRA (CLAUDE.md §3).
const FichaConfeccionInsumo = db.define('FICHAS_CONFECCION_INSUMOS', {
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
    // CHAR(36) plano, no DataTypes.UUID — mismo motivo que DetallesOrdenCompra.idMaterial:
    // MySQL exige collation idéntica entre las dos columnas de un FK y MATERIAL.idMaterial
    // se quedó en la default de su tabla (utf8mb4_0900_ai_ci), no en utf8mb4_bin.
    idMaterial: {
        type: DataTypes.CHAR(36),
        allowNull: false,
        references: { model: 'MATERIAL', key: 'idMaterial' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    // Nombre del insumo AL MOMENTO de agregarlo a la ficha — mismo criterio que
    // DetallesOrdenCompra.nombreMaterial: si el insumo se renombra después, esta línea no
    // cambia retroactivamente.
    nombreMaterial: {
        type: DataTypes.STRING(100),
        allowNull: false
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
    tableName: 'FICHAS_CONFECCION_INSUMOS',
    timestamps: true
});

export default FichaConfeccionInsumo;
