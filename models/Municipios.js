import { DataTypes,  } from "sequelize";
import db from "../config/bd.js"


const Municipios = db.define('MUNICIPIOS', {
    id: {
        type: DataTypes.STRING(5), 
        primaryKey: true,
        allowNull: false
    },

    departamento_id: {
        type: DataTypes.STRING(5), 
        allowNull: false
    },
    nombre: {
        type: DataTypes.STRING,
        allowNull: false
    }
},
{
    tableName : "MUNICIPIOS"
}
);

export default Municipios;