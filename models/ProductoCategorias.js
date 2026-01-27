import { DataTypes } from 'sequelize';
import db from '../config/db.js';

const ProductoCategorias = db.define('PRODUCTO_CATEGORIAS', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    }
}, { timestamps: false });

export default ProductoCategorias;