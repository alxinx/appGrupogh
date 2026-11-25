import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Orden de producción (wiki "Proceso de confección", decidido con el dueño el 2026-11-20).
// La ficha dice QUÉ se hace; la orden dice CUÁNTO, EN QUÉ COLORES Y TALLAS y PARA CUÁNDO.
//
//   borrador  → se edita libremente (cantidades, receta, fecha, notas)
//   en_curso  → confirmada: ya no se edita (el corte la va a leer)
//   cerrada   → terminó la confección (lo pondrá la entrega de corte/talleres)
//   cancelada → con motivo; desde borrador o en curso
//
// La orden SOLO AVISA si alcanza el material (decidido 2026-11-21): no reserva inventario.
// La revisión vive en helpers/ordenesProduccion.js (revisarMaterial).
//
// `numeroProduccion` ("OP-12") sale de SECUENCIAS ('orden_produccion') con crearConCodigo.
// `referencia` es una foto del nombre de la ficha al crear la orden, igual que la ficha
// congela el de la familia: renombrar después no cambia una orden ya emitida.
const OrdenProduccion = db.define('ORDENES_PRODUCCION', {
    idOrdenProduccion: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    numeroProduccion: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    idFicha: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FICHAS_CONFECCION', key: 'idFicha' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    referencia: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    estado: {
        type: DataTypes.ENUM('borrador', 'en_curso', 'cerrada', 'cancelada'),
        allowNull: false,
        defaultValue: 'borrador'
    },
    // Día calendario en Bogotá para el que se necesita la producción.
    fechaRequerida: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    notas: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    // La orden de corte de la que nació (orden de confección con las cantidades que de
    // verdad se cortaron). Null = orden armada a mano, sin trazo.
    idOrdenCorte: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'ORDENES_CORTE', key: 'idOrdenCorte' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idUsuarioCreacion: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    }
}, {
    tableName: 'ORDENES_PRODUCCION',
    timestamps: true,
    paranoid: true,
    indexes: [
        { fields: ['idFicha'], name: 'ordenes_produccion_ficha_idx' },
        { fields: ['estado', 'fechaRequerida'], name: 'ordenes_produccion_estado_idx' }
    ]
});

export default OrdenProduccion;
