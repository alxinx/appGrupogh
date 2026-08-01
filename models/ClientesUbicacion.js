import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const ClientesUbicacion = db.define('CLIENTES_UBICACION', {
    idUbicacion: {
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
    pais: {
        type: DataTypes.CHAR(2),
        defaultValue: 'CO'
    },
    idDepartamento: {
        type: DataTypes.STRING(5),
        allowNull: true,
        references: { model: 'DEPARTAMENTOS', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    nombreDepartamento: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    idMunicipio: {
        type: DataTypes.STRING(5),
        allowNull: true,
        references: { model: 'MUNICIPIOS', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    nombreMunicipio: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    direccion: {
        type: DataTypes.STRING(250),
        allowNull: true
    },
    codigo_postal: {
        type: DataTypes.STRING(10),
        allowNull: true
    },
    es_principal: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'CLIENTES_UBICACION',
    timestamps: true
});

export default ClientesUbicacion;
