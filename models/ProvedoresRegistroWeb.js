import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Constancia de cada proveedor que se registró solo, desde el formulario público de
// grupogh.co/formularios/registroProvedores. Mismo criterio que CLIENTES_REGISTRO_WEB:
// la autorización de tratamiento de datos (Ley 1581) tiene que poder probarse —quién,
// cuándo, desde dónde y sobre qué texto—.
//
// Sin casillas de marketing: a un proveedor no se le ofrecen promociones.
//
// Append-only (triggers de npm run db:migrar-registro-web-proveedores): una fila por
// registro, nunca se edita ni se borra.
const ProvedoresRegistroWeb = db.define('PROVEDORES_REGISTRO_WEB', {
    idRegistro: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idProveedor: {
        type: DataTypes.UUID,
        allowNull: false
    },
    aceptaTratamientoDatos: {
        type: DataTypes.BOOLEAN,
        allowNull: false
    },
    versionAutorizacion: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: 'Versión del texto de autorización que el proveedor aceptó'
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
    tableName: 'PROVEDORES_REGISTRO_WEB',
    updatedAt: false
});

export default ProvedoresRegistroWeb;
