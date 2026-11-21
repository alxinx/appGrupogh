import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Un video del proceso de confección (admin/procesos/fichas-confeccion/nueva, paso "Carga
// el video del proceso") — hasta 3 por ficha, cada uno subido DIRECTO del navegador a
// Cloudflare Stream (helpers/cloudflareStream.js), nunca pasa por este servidor. UUID: es
// una entidad de negocio, no una línea de detalle (CLAUDE.md §3).
//
// `idFicha` es NULLABLE a propósito: el video se sube en el paso 1 del asistente, ANTES de
// que exista la ficha (que recién se crea al finalizar, controller/
// fichaConfeccionController.js finalizarFicha) — mismo motivo por el que FichaConfeccionDxf
// y FichaConfeccionMolde tampoco llevan esta FK: ahí la relación va al revés (la ficha
// apunta a UN dxf y UN molde), pero el video es varios-por-ficha, así que acá sí hace falta
// la columna. Se completa recién al finalizar (UPDATE, no en la subida).
const FichaConfeccionVideo = db.define('FICHAS_CONFECCION_VIDEOS', {
    idVideo: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idFicha: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'FICHAS_CONFECCION', key: 'idFicha' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idUsuarioCarga: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    nombreOriginal: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    // El navegador nunca manda el archivo a este servidor (sube directo a Cloudflare), así
    // que el peso es el que informa el propio navegador (`file.size`) al pedir la URL de
    // subida — no uno medido acá. Por eso es opcional: no vale la pena bloquear la subida
    // si por lo que sea no llegó.
    pesoBytes: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    // 1, 2 o 3 — el orden en que se agregó dentro del asistente. Sin `idFicha` no hay
    // unicidad real que exigir todavía (CLAUDE.md §3: eso es cuando exista esa tabla).
    orden: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 3 }
    },
    cloudflareVideoUid: {
        type: DataTypes.STRING(64),
        allowNull: false
    },
    // 'uploading' cubre tanto "todavía subiendo bytes" como "Cloudflare transcodeando" — el
    // requerimiento no pide distinguirlas y permite guardar la ficha con un video en este
    // estado indefinidamente (helpers/cloudflareStream.js).
    estado: {
        type: DataTypes.ENUM('uploading', 'ready', 'error'),
        allowNull: false,
        defaultValue: 'uploading'
    },
    errorMensaje: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    listoEn: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'FICHAS_CONFECCION_VIDEOS',
    timestamps: true
});

export default FichaConfeccionVideo;
