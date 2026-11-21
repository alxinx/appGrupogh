import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// El archivo de molde (JPG o PDF) subido desde el asistente "Nueva ficha de confección"
// (admin/procesos/fichas-confeccion/nueva, paso "Carga el molde") — la imagen de referencia
// que la IA usa para generar la vista previa de la prenda (helpers/moldeIa.js). Mismo
// patrón que FichaConfeccionDxf: UUID, se sube al bucket PRIVADO (carpeta `moldes/`,
// helpers/almacenamientoDocumentos.js CARPETAS_PRIVADAS). No lleva `idFicha`: la FK va al
// revés, desde `FichaConfeccion.idMolde`/`.idMoldeIaIntento` (models/FichaConfeccion.js).
//
// La generación con IA solo corre hoy si `tipoArchivo` es 'jpg': el endpoint de edición de
// imágenes de OpenAI no acepta PDF, y este proyecto no tiene cómo rasterizar un PDF a
// imagen (sharp, ya instalado, no trae soporte de PDF en este build — ver el aviso en
// controller/fichaConfeccionMoldeController.js). Un PDF se puede subir igual, por si sirve
// guardarlo, pero "Generar con IA" lo rechaza con un mensaje claro.
const FichaConfeccionMolde = db.define('FICHAS_CONFECCION_MOLDES', {
    idMolde: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idUsuarioCarga: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    nombreOriginal: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    pesoBytes: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    tipoArchivo: {
        type: DataTypes.ENUM('jpg', 'pdf'),
        allowNull: false
    },
    objectKey: {
        type: DataTypes.STRING(500),
        allowNull: false
    },
    shaHash: {
        type: DataTypes.STRING(64),
        allowNull: false
    }
}, {
    tableName: 'FICHAS_CONFECCION_MOLDES',
    timestamps: true
});

export default FichaConfeccionMolde;
