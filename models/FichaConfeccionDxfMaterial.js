import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Una línea "material detectado" de un DXF de ficha de confección — una prenda puede
// cortarse en más de una tela dentro del mismo archivo ("Material: 1" en unas piezas,
// "Material: 2" en otras: cuerpo en una tela, puño/elástico en otra, ver el comentario de
// MATERIAL.codigoMaterial). Cada código DISTINTO que aparece en el DXF (helpers/dxf.js
// extraerCamposDxf) es una fila acá, en el orden en que apareció por primera vez — línea de
// detalle, no entidad de negocio (INTEGER autoincrement, mismo patrón que
// FICHAS_CONFECCION_COLORES, CLAUDE.md §3).
//
// `idMaterial` queda en null si ese código no tiene fila en MATERIAL.codigoMaterial — no es
// un error del archivo, es "no se encontró" (mismo criterio que FichaConfeccionDxf.
// idFamiliaAsociada). `codigoMaterial` guarda el texto crudo del DXF para poder mostrar el
// código exacto en ese caso.
const FichaConfeccionDxfMaterial = db.define('FICHAS_CONFECCION_DXF_MATERIALES', {
    idDetalle: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idArchivoDxf: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FICHAS_CONFECCION_DXF', key: 'idArchivoDxf' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    codigoMaterial: {
        type: DataTypes.STRING(50),
        allowNull: false
    },
    // CHAR(36) plano, no DataTypes.UUID — mismo motivo que FichaConfeccionDxf.
    // idMaterialAsociado tenía (ver su historial en seed/migracionFichasConfeccionDxf.js):
    // Sequelize le agrega BINARY a un UUID en MySQL y MATERIAL.idMaterial no tiene esa
    // collation. La migración de esta tabla lee la collation real en vez de asumirla.
    idMaterial: {
        type: DataTypes.CHAR(36),
        allowNull: true,
        references: { model: 'MATERIAL', key: 'idMaterial' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    orden: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
    tableName: 'FICHAS_CONFECCION_DXF_MATERIALES',
    timestamps: true
});

export default FichaConfeccionDxfMaterial;
