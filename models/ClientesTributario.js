import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const ClientesTributario = db.define('CLIENTES_TRIBUTARIO', {
    idClienteTributario: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    idCliente: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'CLIENTES', key: 'idCliente' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    regimen_fiscal: {
        type: DataTypes.STRING(2),
        allowNull: false,
        comment: '48=Responsable IVA, 49=No responsable IVA'
    },
    gran_contribuyente: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    autorretenedor: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    agente_retencion: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    obligado_aduanero: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    ciiu: {
        type: DataTypes.STRING(10),
        allowNull: true
    },
    descripcion_ciiu: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    fecha_rut: {
        type: DataTypes.DATEONLY,
        allowNull: true
    }
}, {
    tableName: 'CLIENTES_TRIBUTARIO',
    timestamps: true
});

export default ClientesTributario;
