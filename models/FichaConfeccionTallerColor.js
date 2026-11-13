import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Qué color(es) de la ficha le tocan a un taller (FichaConfeccionTaller) — "Taller Ana hace
// el Negro y el Rojo, Confecciones Luz el Azul". Tag informativo, no reparte cantidades: la
// cantidad de cada color sigue viviendo solo en FICHAS_CONFECCION_COLORES. Línea de detalle,
// no entidad de negocio — INTEGER autoincrement, mismo patrón que FICHAS_CONFECCION_COLORES.
const FichaConfeccionTallerColor = db.define('FICHAS_CONFECCION_TALLERES_COLORES', {
    idDetalle: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idTaller: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'FICHAS_CONFECCION_TALLERES', key: 'idDetalle' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idAtributoColor: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'ATRIBUTOS', key: 'idAtributo' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    }
}, {
    tableName: 'FICHAS_CONFECCION_TALLERES_COLORES',
    timestamps: true,
    // Nombre explícito — el autogenerado por Sequelize pasa los 64 caracteres de MySQL
    // (Error 1059, visto primero en FichaConfeccionTaller).
    indexes: [{ unique: true, fields: ['idTaller', 'idAtributoColor'], name: 'fichas_confeccion_talleres_colores_uk' }]
});

export default FichaConfeccionTallerColor;
