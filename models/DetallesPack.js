import { DataTypes,  } from "sequelize";
import db from "../config/bd.js"
const DetallesPack = db.define('DETALLES_PACK', {
    idPackDetail: {
        type: DataTypes.INTEGER, // Este puede seguir siendo Serial/Auto-incremental para orden interno
        primaryKey: true,
        autoIncrement: true 
    },
    idPack: {
        type: DataTypes.UUID, 
        allowNull: false
    },
    idProducto: {
        type: DataTypes.UUID, // <--- CAMBIO CLAVE: Sincronizado con tabla Productos
        allowNull: false
    },
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    valorUnidad : {
        type : DataTypes.DOUBLE(10,2),
        allowNull : true,
        defaultValue : 0,
    }
},
{
    tableName: 'DETALLES_PACK'
});

export default DetallesPack;