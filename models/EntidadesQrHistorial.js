import { DataTypes } from "sequelize";
import db from "../config/bd.js";

// Bitácora append-only del QR de pago de cada entidad. Cada fila es una versión del
// archivo: cuál era el object key, su hash, quién lo subió y en qué estado terminó.
// Nunca se borra ni se edita retroactivamente — es la evidencia de quién cambió el QR
// por el que un cliente termina transfiriendo dinero real.
const EntidadesQrHistorial = db.define('ENTIDADES_QR_HISTORIAL', {
    idQrHistorial: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    idEntidad: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'ENTIDADES',
            key: 'idEntidad'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    qrObjectKey: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    qrHashSha256: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    qrStatus: {
        type: DataTypes.ENUM('active', 'replaced', 'compromised'),
        allowNull: false
    },
    // Qué provocó esta entrada: 'subida', 'reemplazo', 'hash_no_coincide', 'deshabilitado'
    motivo: {
        type: DataTypes.STRING(60),
        allowNull: false
    },
    // Autor del cambio. Null cuando lo marca el sistema (ej. verificación de integridad fallida).
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'USUARIOS',
            key: 'idUsuario'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    detalle: {
        type: DataTypes.STRING(255),
        allowNull: true
    }
}, {
    tableName: 'ENTIDADES_QR_HISTORIAL',
    timestamps: true,
    updatedAt: false,
    indexes: [
        { fields: ['idEntidad'] }
    ]
});

export default EntidadesQrHistorial;
