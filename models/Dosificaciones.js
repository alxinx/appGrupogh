import { DataTypes,  } from "sequelize";
import db from "../config/bd.js"
const Dosificacion = db.define('DOSIFICACIONES', {
    idDosificacion: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true // Llave primaria clara
    },
    fecha: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    capacidadBolsa: {
        type: DataTypes.INTEGER,
        allowNull: false // Ej: 12
    },
    totalUnidades: {
        type: DataTypes.INTEGER,
        allowNull: false // Ej: 1843
    },
    estado: {
        type: DataTypes.ENUM('PENDIENTE', 'COMPLETADA', 'ANULADA'),
        defaultValue: 'PENDIENTE'
    },
    idUsuario: {
        type : DataTypes.UUID,
        allowNull: false
    },
    
},
    {
        tableName : 'DOSIFICACIONES'
    });


export default Dosificacion