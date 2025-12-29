import { DataTypes,  } from "sequelize";
import db from "../config/bd.js"


const Departamentos = db.define('DEPARTAMENTOS', {
    id: {
        type: DataTypes.STRING(5), 
        primaryKey: true,
        allowNull: false
    },
    nombre: {
        type: DataTypes.STRING,
        allowNull: false
    }
},
{
    tableName : "DEPARTAMENTOS"
}
);

export default Departamentos;