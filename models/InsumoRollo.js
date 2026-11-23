import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Un rollo (o pieza) de tela en bodega (helpers/rollosTela.js). La capa de inventario
// (INSUMOS_CAPAS) sigue siendo la fuente del costo; el rollo es el detalle físico de esa
// capa: cuántos rollos llegaron, cuánto mide cada uno y en qué estado está.
//
// Estado guardado:  sin_tender → tendido → en_corte → agotado
// "En reposo" y "Listo para cortar" son el mismo estado guardado (tendido): lo decide
// `listoDesde` (tendido + horas de reposo del material) contra la hora actual. Así no hace
// falta ningún proceso que lo cambie a las 48 horas: se calcula al consultarlo.
//
// `metrajeActualCm` es lo que le queda al rollo. La suma de los rollos vivos de una capa
// es lo que esa capa tiene (disponible + reservada + en proceso): todo lo que mueve tela
// pasa por helpers/rollosTela.js para que no se separen.
const InsumoRollo = db.define('INSUMOS_ROLLOS', {
    idRollo: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    codigoRollo: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    idCapa: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'INSUMOS_CAPAS', key: 'idCapa' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idMaterial: {
        type: DataTypes.CHAR(36),
        allowNull: false,
        references: { model: 'MATERIAL', key: 'idMaterial' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idAtributoColor: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'ATRIBUTOS', key: 'idAtributo' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    metrajeInicialCm: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    metrajeActualCm: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false
    },
    estado: {
        type: DataTypes.ENUM('sin_tender', 'tendido', 'en_corte', 'agotado'),
        allowNull: false,
        defaultValue: 'sin_tender'
    },
    tendidoEn: {
        type: DataTypes.DATE,
        allowNull: true
    },
    // Desde cuándo se puede cortar: tendidoEn + reposoHoras del material, o antes si un
    // operador lo adelantó con motivo.
    listoDesde: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'INSUMOS_ROLLOS',
    timestamps: true,
    indexes: [
        { fields: ['idMaterial', 'estado'], name: 'insumos_rollos_material_idx' },
        { fields: ['idCapa'], name: 'insumos_rollos_capa_idx' }
    ]
});

export default InsumoRollo;
