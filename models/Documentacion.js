import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Documentacion = db.define('DOCUMENTACION', {
    idDocumento: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idPropietario: {
        type: DataTypes.UUID, // ME INDICA A QUE TIENDA, CLIENTE O PROVEDOR PERTENECE 
        allowNull: true,
        onDelete: 'CASCADE',
        references: {
            model: 'PROVEDORES', // Nombre de la tabla
            key: 'idProveedor'
        }
    },
    nombreDocumento: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    keyName: {
        type: DataTypes.STRING(255), //El nombre en el R2
        allowNull: false,
    },
    formato: {
        type: DataTypes.STRING(10), //JPG, PDF, WORD, EXCEL .... 
        allowNull: false
    },
    pertenece: {
        type: DataTypes.ENUM('cliente', 'punto_venta', 'provedor', 'general', 'orden_compra','empleado'),
        defaultValue: 'general'
    },



}, {
    tableName: "DOCUMENTACION",
    timestamps: true
});

export default Documentacion;