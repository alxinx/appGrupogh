import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Interesados = db.define('INTERESADOS', {
    idInteres: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    nombreCliente: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    canalContacto: {
        type: DataTypes.ENUM('whatsapp', 'email'),
        allowNull: false,
    },
    canal: {
        type: DataTypes.STRING(200),
        allowNull: false,
    },
    producto: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    // Se apaga cuando la persona hace clic en "dar de baja" del correo de "producto
    // disponible" — encolarNotificacionesProducto() no debe volver a avisarle por este
    // interés puntual. No se borra la fila: sigue sirviendo como registro de que alguien
    // pidió el producto, solo que ya no quiere el aviso.
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
}, {
    tableName: 'INTERESADOS',
    timestamps: true,
    createdAt: 'fechaCreacion',
    updatedAt: false,
});

export default Interesados;
