import { DataTypes,  } from "sequelize";
import db from "../config/bd.js"


const Categorias = db.define('CATEGORIAS', {
    idCategoria: {
        type: DataTypes.INTEGER, 
        primaryKey: true,
        allowNull: false,
        autoIncrement : true,
    },
    nombreCategoria: {
        type: DataTypes.STRING,
        allowNull: false
    },
    tipo: {
        type: DataTypes.ENUM('CATEGORIA', 'SUBCATEGORIA'),
        allowNull: false,
        defaultValue : 'CATEGORIA'
    },
    idPadre : {
        type: DataTypes.INTEGER,
        allowNull : true, 
        references : {
            model : 'CATEGORIAS',
            key : 'idCategoria'
        }
    }
},
{
    tableName : "CATEGORIAS",
    timestamps: false
}
);

Categorias.hasMany(Categorias, { as: 'Subcategorias', foreignKey: 'idPadre' });
Categorias.belongsTo(Categorias, { as: 'Padre', foreignKey: 'idPadre' });

export default Categorias;