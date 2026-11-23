import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Una referencia del trazo ("REF 0213 BODY ROMA", el Style Name) con la ficha que le tocó:
// una existente o una ficha base creada desde el corte. `prendasPorCapa` es { talla: n }
// (helpers/trazo.js prendasPorCapa, con las respuestas del operador ya aplicadas).
//
// `piezasSueltas` es lo que decidió el operador cuando el trazo no da prendas completas con
// todas sus piezas (falta alguna o sobran): 'pendientes' = se cortan y quedan esperando otro
// corte; 'excluir' = esa referencia no se corta en este trazo. Null si no hizo falta.
// `faltanPiezas` = el operador dijo que la prenda lleva piezas que este trazo no trae (solo
// se pregunta en las referencias sin ficha: con ficha, lo dice su DXF).
const OrdenCorteReferencia = db.define('ORDENES_CORTE_REFERENCIAS', {
    idReferencia: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    idOrdenCorte: {
        type: DataTypes.UUID, allowNull: false,
        references: { model: 'ORDENES_CORTE', key: 'idOrdenCorte' }, onUpdate: 'CASCADE', onDelete: 'CASCADE'
    },
    estilo: { type: DataTypes.STRING(150), allowNull: false },
    idFicha: {
        type: DataTypes.UUID, allowNull: false,
        references: { model: 'FICHAS_CONFECCION', key: 'idFicha' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'
    },
    fichaCreadaEnCorte: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    areaCm2: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    prendasPorCapa: { type: DataTypes.JSON, allowNull: false },
    faltanPiezas: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    piezasSueltas: { type: DataTypes.ENUM('pendientes', 'excluir'), allowNull: true },
    // Al registrar el corte: su parte de la tela, repartida por el área de sus piezas.
    cmTela: { type: DataTypes.DECIMAL(15, 4), allowNull: true },
    costoTela: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    orden: { type: DataTypes.INTEGER, allowNull: false }
}, {
    tableName: 'ORDENES_CORTE_REFERENCIAS',
    timestamps: true
});

export default OrdenCorteReferencia;
