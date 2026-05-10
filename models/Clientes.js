import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Clientes = db.define('CLIENTES', {
    idCliente: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    tipo_persona: {
        type: DataTypes.CHAR(1),
        allowNull: false,
        comment: 'N=Natural, J=Jurídica'
    },
    tipo_documento: {
        type: DataTypes.STRING(5),
        allowNull: false,
        comment: 'CC, CE, TI, NIT, PP, etc.'
    },
    numero_doc: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    digito_verif: {
        type: DataTypes.CHAR(1),
        allowNull: true
    },
    razon_social: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    primer_nombre: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    segundo_nombre: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    primer_apellido: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    segundo_apellido: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    email: {
        type: DataTypes.STRING(150),
        allowNull: true,
        validate: {
            isEmail: { msg: "Debe ser un correo electrónico válido" }
        }
    },
    telefono: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    genero: {
        type: DataTypes.CHAR(1),
        allowNull: true,
        comment: 'M=Masculino, F=Femenino, O=Otro'
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    credito: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull : false
    }
}, {
    tableName: 'CLIENTES',
    timestamps: true
});

export default Clientes;
