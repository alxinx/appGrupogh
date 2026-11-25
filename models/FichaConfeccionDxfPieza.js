import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Las piezas que lleva UNA prenda según el DXF de su ficha: nombre, talla y cuántas por
// prenda (la "Calidad" 2XT de Optitex) y en qué material. Es lo que deja saber, en un corte, si con las
// piezas de un trazo salen prendas completas o falta alguna (helpers/trazo.js
// prendasPorCapa). Se llena al analizar el DXF de la ficha (asistente o ficha base creada
// desde un corte); las fichas anteriores las tomó seed/migracionOrdenesCorte.js de su DXF.
const FichaConfeccionDxfPieza = db.define('FICHAS_CONFECCION_DXF_PIEZAS', {
    idDetalle: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    idArchivoDxf: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FICHAS_CONFECCION_DXF', key: 'idArchivoDxf' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    nombrePieza: { type: DataTypes.STRING(120), allowNull: false },
    talla: { type: DataTypes.STRING(20), allowNull: false },         // código de src/json/tallasCorte.json
    porPrenda: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    // El "Material:" del DXF (código del catálogo, canónico): un trazo es de una tela y solo
    // compara las piezas de esa tela. null = ficha leída antes de guardarlo (va en cualquiera).
    codigoMaterial: { type: DataTypes.STRING(25), allowNull: true }
}, {
    tableName: 'FICHAS_CONFECCION_DXF_PIEZAS',
    timestamps: true
});

export default FichaConfeccionDxfPieza;
