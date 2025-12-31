import { DataTypes  } from "sequelize";
import db from "../config/bd.js"

const RegimenFacturacion = db.define('REGIMEN_FACTURACION', {
    idRegimenFacturacion: {
        type : DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    idPuntoDeVenta: {
        type : DataTypes.UUID,
        allowNull: false
    },
    resolucionFacturacion : {
        type : DataTypes.STRING, 
        allowNull : false,  
        unique : true
    },
    responsabilidades: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'R-99-PN' // Código estándar para "No responsable" o "Otros"
    },
    tipo_organizacion: {
        type: DataTypes.ENUM('1', '2'), // 1 = Persona Jurídica, 2 = Persona Natural
        allowNull: false
    },
    tipoFactura: {
       type:  DataTypes.ENUM('FACTURA_ELECTRONICA', 'POS_ELECTRONICO', 'CONTINGENCIA', 'NOTA_CREDITO', 'NOTA_DEBITO'),
       allowNull : false
    },
    fechaEmision : {
        type : DataTypes.DATE,
        allowNull : false,
    },
    fechaVencimiento : {
        type : DataTypes.DATE,
        allowNull : false,
    },
    nroInicio : {
        type :  DataTypes.BIGINT,
        allowNull : false
    },
    nroFin :  {
        type :  DataTypes.BIGINT,
        allowNull : false
    },
    nroActual : {
        type : DataTypes.BIGINT,
        defaultValue : 0, // Inicia en 0 para que la primera factura sea (0 + 1) = 1
        allowNull : false
    } ,
    razonSocial : {
        type : DataTypes.STRING(100),
        allowNull : false,
        validate : {
            notEmpty : { msg : "La razón social no puede ir vacia."}
        }
    },
    activa : {
        type : DataTypes.BOOLEAN,
        defaultValue : true
    },
    taxId : { // EL NIT.
        type: DataTypes.STRING(20),
        allowNull : false,
    },
    DV : {//Digito de verificación de la DIAN.
        type : DataTypes.STRING(1),
        allowNull : false,
        validate : {
            isNumeric : true,
            len : [1,1]
        }
    },
    prefijo : DataTypes.STRING, // EL AUTORIZADO POR LA DIAN
    
},
{
    tableName : "REGIMEN_FACTURACION",
    timestamps : true,
    hooks : {
        beforeSave : (punto) =>{
            if(punto.razonSocial) punto.razonSocial =punto.razonSocial.trim();  
        }
    }
}
);

export default RegimenFacturacion;