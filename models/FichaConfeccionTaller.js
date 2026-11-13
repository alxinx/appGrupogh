import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Un taller de confección asignado a una ficha, con SU PROPIO precio — dos talleres pueden
// cobrar distinto por la misma prenda, así que esto no reusa FichaConfeccion.precioConfeccion
// (ese queda como el precio general/de referencia de la ficha). El taller es un PROVEDORES
// de categoría 'Confeccionista' (CATEGORIAS_DE_PROVEDORES, helpers/proveedores.js
// CATEGORIAS_CON_FOTOS) — se valida esa categoría al asignar, nunca cualquier proveedor.
//
// Línea de detalle, no entidad de negocio — INTEGER autoincrement, mismo patrón que
// FICHAS_CONFECCION_COLORES (CLAUDE.md §3).
const FichaConfeccionTaller = db.define('FICHAS_CONFECCION_TALLERES', {
    idDetalle: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    idFicha: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FICHAS_CONFECCION', key: 'idFicha' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    idProveedor: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PROVEDORES', key: 'idProveedor' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    precioConfeccion: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    orden: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
    tableName: 'FICHAS_CONFECCION_TALLERES',
    timestamps: true,
    // Nombre explícito: el que Sequelize autogenera a partir de tableName+columnas pasa
    // los 64 caracteres que MySQL permite para un identificador (Error 1059).
    indexes: [{ unique: true, fields: ['idFicha', 'idProveedor'], name: 'fichas_confeccion_talleres_ficha_proveedor_uk' }]
});

export default FichaConfeccionTaller;
