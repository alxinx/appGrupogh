import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Constancia de cada cliente que se registró solo, desde el formulario público de
// grupogh.co/formularios/registroClientes.
//
// Existe por la Ley 1581: la autorización de tratamiento de datos tiene que poder
// probarse —quién, cuándo, desde dónde y sobre qué texto—, y las de marketing son
// opcionales y hay que saber cuáles dio. Por eso guarda la versión del texto aceptado.
//
// Append-only: una fila por registro, nunca se edita ni se borra. Si el cliente retira
// una autorización más adelante, eso es un hecho nuevo, no una corrección de este.
const ClientesRegistroWeb = db.define('CLIENTES_REGISTRO_WEB', {
    idRegistro: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idCliente: {
        type: DataTypes.UUID,
        allowNull: false
    },
    aceptaTratamientoDatos: {
        type: DataTypes.BOOLEAN,
        allowNull: false
    },
    aceptaWhatsapp: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    aceptaEmail: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    versionAutorizacion: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: 'Versión del texto de autorización que el cliente aceptó'
    },
    ip: {
        type: DataTypes.STRING(45),
        allowNull: true
    },
    userAgent: {
        type: DataTypes.STRING(255),
        allowNull: true
    }
}, {
    tableName: 'CLIENTES_REGISTRO_WEB',
    updatedAt: false
});

export default ClientesRegistroWeb;
