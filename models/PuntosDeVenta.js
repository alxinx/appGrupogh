import { DataTypes  } from "sequelize";
import db from "../config/bd.js"

const PuntosDeVenta = db.define('PUNTO_DE_VENTA', {
    idPuntoDeVenta: {
        type : DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    tipo: {
       type:  DataTypes.ENUM('Punto de venta', 'Bodega', 'Transito'),
       allowNull : false
    },
    razonSocial : {
        type : DataTypes.STRING(100),
        allowNull : false,
        validate : {
            notEmpty : { msg : "La razón social no puede ir vacia."}
        }
    },
    nombreComercial : {
        type : DataTypes.STRING(100),
        allowNull : false,
        validate : {
            notEmpty : { msg : "El nombre comercial no puede ir vacio."}
        }
    },
    direccionPrincipal : {
        type : DataTypes.STRING,
        allowNull : false,
        validate : {
            notEmpty : { msg : "La dirección comercial no puede ir vacia."}
        }
    },
    departamento : {
        type: DataTypes.STRING(5), 
        allowNull : false,
        references : {
            model : 'DEPARTAMENTOS',
            key : 'id'
        },
        onUpdate :'CASCADE',
        onUpdate : 'RESTRICT'
    },
    ciudad : {
        type: DataTypes.STRING(5), 
        allowNull : false,
        references : {
            model : 'MUNICIPIOS',
            key : 'id'
        },
        onUpdate : 'CASCADE',
        onDelete : 'RESTRICT'
    },
    telefono : DataTypes.STRING,
    activa : {
        type : DataTypes.BOOLEAN,
        defaultValue : true
    },
    taxId : {
        type: DataTypes.STRING(20),
        allowNull : false,
        unique : true
    },
    DV : {
        type : DataTypes.STRING(1),
        allowNull : false,
        validate : {
            isNumeric : true,
            len : [1,1]
        }
    },
    prefijo : DataTypes.STRING,
    resolucionFacturacion : {
        type : DataTypes.STRING,   
   
    },
    emailRut : {
        type : DataTypes.STRING,
        validate : {
            isEmail : true
        }
    },
    footerBill : DataTypes.TEXT
},
{
    tableName : "PUNTO_DE_VENTA",
    timestamps : true,
    hooks : {
        beforeSave : (punto) =>{
            if(punto.razonSocial) punto.razonSocial =punto.razonSocial.trim();
            if(punto.nombreComercial) punto.nombreComercial = punto.nombreComercial.trim();
        }
    }
}
);

export default PuntosDeVenta;