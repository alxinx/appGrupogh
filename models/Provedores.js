import { DataTypes,  } from "sequelize";
import db from "../config/bd.js"


const Provedores = db.define('PROVEDORES', {
    idProveedor: { // Simplificado para facilitar la relación
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    razonSocial: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: { msg: "La razón social es obligatoria." } }
    },
    nit: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: { msg: "Este NIT ya está registrado." }
    },
    nombreContacto : {
        type : DataTypes.STRING,
        allowNull : false
    },
    telefonoContacto : {
        type : DataTypes.STRING(10),
        allowNull : true
    },
    emailProvedor : {
        type : DataTypes.STRING,
        validate : {
            isEmail : true
        },
        allowNull : false
    },
    telefonoProvedor : DataTypes.STRING(20),
    ciudad : {
        type : DataTypes.CHAR(35),
        allowNull : false
    },
    departamento : {
        type : DataTypes.CHAR(35),
        allowNull : false
    },
    estado : {
        type : DataTypes.BOOLEAN,
        defaultValue : true
    }
},
{
    tableName : "PROVEDORES",
    timestamps: true,
    paranoid : true
}
);

export default Provedores;