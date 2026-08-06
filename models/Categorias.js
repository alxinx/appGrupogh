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
    },
    webActiva: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // URL publica en R2 de la imagen de portada de la categoria. La usa la seccion
    // "Compra por estilo" del home de la tienda web; si esta vacia, la web cae al
    // recuadro con degradado que ya tenia.
    imagen: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    // Key del objeto en R2, para poder borrar el archivo anterior al reemplazarlo
    // y no dejar huerfanos acumulandose en el bucket.
    imagenKey: {
        type: DataTypes.STRING(255),
        allowNull: true
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