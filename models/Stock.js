import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Stock = db.define('STOCKS', {
    idStock: { 
        type: DataTypes.UUID, 
        defaultValue: 
        DataTypes.UUIDV4, 
        primaryKey: true 
    },
    idPuntoVenta: { 
        type: DataTypes.UUID, 
        allowNull: false 

    },
    idPack: { 
        type: DataTypes.UUID, 
        allowNull: true 

    }, 
    idFacturaPro: { 
        type: DataTypes.UUID, 
        allowNull: true 

    },
    idProducto: { 
        type: DataTypes.UUID, 
        allowNull: false 
        
    }, 
    cantidadExistente: { 
        type: DataTypes.INTEGER.UNSIGNED, 
        allowNull: false,
        validate: {
            min: {
                args: [0],
                msg: "La cantidad existente no puede ser menor a cero"
            }
        }
    },
    
    cantidadOriginal: { 
        type: DataTypes.INTEGER.UNSIGNED, 
        allowNull: false,
        validate: {
            min: 0
        }
    },
    
    valorUnidad: {
        type: DataTypes.DOUBLE(10,2),
        allowNull: true,
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    
    estadoInterno: { 
        type: DataTypes.ENUM('CERRADO', 'SUELTO'), 
        defaultValue: 'SUELTO' 
    }
},
{
    tableName: 'STOCKS',
    timestamps: true
});

export default Stock;