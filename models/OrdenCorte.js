import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Orden de corte (decidido con el dueño el 2026-11-21). Nace de subir el TRAZO que el
// operador armó en Optitex: el sistema lee sus referencias, las cruza con las fichas (o crea
// fichas base), y el operador elige los rollos listos y las capas de cada uno.
//
//   borrador  → armada: rollos y capas elegidos, nada movido todavía
//   cortada   → se registró el corte: la tela salió de los rollos elegidos y nacieron las
//               órdenes de confección (ORDENES_PRODUCCION con idOrdenCorte), en borrador
//   cancelada → con motivo, solo desde borrador
//
// Un trazo, una tela: `idMaterial`. El largo y el ancho salen del DXF (helpers/trazo.js), en
// cm; la tela de una capa es el largo del trazo. `numeroCorte` ("CT-3") sale de SECUENCIAS
// ('orden_corte'). El DXF queda en el bucket privado (carpeta dxf/).
const OrdenCorte = db.define('ORDENES_CORTE', {
    idOrdenCorte: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    numeroCorte: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    estado: { type: DataTypes.ENUM('borrador', 'cortada', 'cancelada'), allowNull: false, defaultValue: 'borrador' },
    idMaterial: {
        type: DataTypes.UUID, allowNull: false,
        references: { model: 'MATERIAL', key: 'idMaterial' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'
    },
    nombreArchivo: { type: DataTypes.STRING(255), allowNull: false },
    objectKey: { type: DataTypes.STRING(500), allowNull: false },
    shaHash: { type: DataTypes.STRING(64), allowNull: false },
    largoCm: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    anchoCm: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    areaPiezasCm2: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    // Para cuándo se necesitan las prendas: pasa a las órdenes de confección que nacen del corte.
    fechaRequerida: { type: DataTypes.DATEONLY, allowNull: false },
    notas: { type: DataTypes.TEXT, allowNull: true },
    // Lo que gastó el corte, al registrarlo: cm de tela y su costo (sin IVA, de las capas).
    cmTela: { type: DataTypes.DECIMAL(15, 4), allowNull: true },
    costoTela: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    cortadaEn: { type: DataTypes.DATE, allowNull: true },
    idUsuarioCreacion: {
        type: DataTypes.UUID, allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'
    }
}, {
    tableName: 'ORDENES_CORTE',
    timestamps: true,
    paranoid: true
});

export default OrdenCorte;
