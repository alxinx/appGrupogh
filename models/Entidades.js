import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Entidades = db.define('ENTIDADES', {
    idEntidad: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        unique: true,
        allowNull: false
    },
    nombreEntidad: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    tipoEntidad: {
        type: DataTypes.ENUM('Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito'),
        allowNull: false
    },
    recibirPagosPos: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },

    // ── QR de pago web ────────────────────────────────────────────────────────
    // Solo se guarda la ruta del objeto en R2 (bucket privado). Nunca una URL
    // pública ni firmada: la URL se genera al vuelo y expira en minutos.
    qrObjectKey: {
        type: DataTypes.STRING(255),
        allowNull: true // null hasta que se suba el primer QR
    },
    qrHashSha256: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    qrEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false // explícito: nadie puede pagar hasta que el admin lo habilite a propósito
    },
    qrUploadedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    qrUploadedBy: {
        // FK a USUARIOS.idUsuario, que en este proyecto es UUID (no INTEGER).
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'USUARIOS',
            key: 'idUsuario'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    qrStatus: {
        type: DataTypes.ENUM('active', 'replaced', 'compromised'),
        allowNull: true
    }
}, {
    tableName: 'ENTIDADES',
    timestamps: true,
    createdAt: 'create_at',
    updatedAt: false,
    hooks: {
        afterSync: async () => {
            const count = await Entidades.count();
            if (count === 0) {
                await Entidades.bulkCreate([
                    { nombreEntidad: 'Bancolombia',  tipoEntidad: 'Banco' },
                    { nombreEntidad: 'Nequi',        tipoEntidad: 'Billetera Virtual' },
                    { nombreEntidad: 'Davivienda',   tipoEntidad: 'Banco' }
                ]);
            }
        }
    }
});

export default Entidades;
