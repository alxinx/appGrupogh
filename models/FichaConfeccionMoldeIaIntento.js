import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Un intento de generación de imagen con IA a partir de un molde (admin/procesos/
// fichas-confeccion/nueva) — uno por cada vez que se confirma el modal de Pattern/Colors,
// ya sea la primera vez o un "Repetir". UUID: es una entidad de negocio (un resultado que
// se puede aprobar), no una línea de detalle.
//
// El resultado generado vive en `objectKeyBorrador` (bucket PRIVADO, fuera de moldesIa/,
// el PNG tal como lo devuelve la IA) hasta que el usuario presiona "Aprobar" — recién ahí
// se convierte a WebP y se guarda en moldesIa/{timestamp}.webp (objectKeyFinal), y el
// borrador se borra. Mientras no se aprueba, no existe ningún archivo en moldesIa/ — eso lo
// exige el requerimiento tal cual (controller/fichaConfeccionMoldeController.js
// aprobarMoldeIa).
//
// `promptFinal` guarda el prompt YA armado (con fabric/pattern/colors sustituidos) por
// trazabilidad interna — nunca se devuelve en ninguna respuesta al navegador (ver el aviso
// en helpers/moldeIa.js): promptsIA.json es la plantilla, esto es una copia de auditoría de
// un solo intento, no la plantilla en sí.
const FichaConfeccionMoldeIaIntento = db.define('FICHAS_CONFECCION_MOLDES_IA_INTENTOS', {
    idIntento: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idMolde: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FICHAS_CONFECCION_MOLDES', key: 'idMolde' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    // El DXF de la misma ficha, para sacar el Fabric (MATERIAL.nombre vía idMaterialAsociado
    // — helpers/dxf.js ya lo resuelve en el paso anterior). Nullable: si todavía no se
    // terminó de analizar el DXF, o no se encontró el material, Fabric queda "not
    // specified" en el prompt en vez de bloquear la generación.
    idDxf: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'FICHAS_CONFECCION_DXF', key: 'idArchivoDxf' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    idUsuarioSolicita: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    numeroIntento: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    pattern: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    colors: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    // Snapshot del nombre del material al momento de este intento — si el DXF se
    // reanaliza después y cambia, los intentos viejos no se reescriben solos.
    fabricUsado: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    promptFinal: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    estado: {
        type: DataTypes.ENUM('procesando', 'listo', 'error'),
        allowNull: false,
        defaultValue: 'procesando'
    },
    objectKeyBorrador: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    errorMensaje: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    aprobado: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    objectKeyFinal: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    generadoEn: {
        type: DataTypes.DATE,
        allowNull: true
    },
    aprobadoEn: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'FICHAS_CONFECCION_MOLDES_IA_INTENTOS',
    timestamps: true
});

export default FichaConfeccionMoldeIaIntento;
