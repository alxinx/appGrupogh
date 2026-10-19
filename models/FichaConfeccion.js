import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// La ficha de confección terminada (admin/procesos/fichas-confeccion/nueva, "Guardar
// ficha") — el registro que por fin junta lo que el DXF, el molde y los videos venían
// subiendo sueltos (ver sus modelos). Se crea UNA sola vez, al finalizar el asistente —no
// hay borrador en base, el asistente guarda su estado solo en el navegador hasta ese punto.
//
// `referencia` y `materialNombre` son una FOTO del nombre de FAMILIA y MATERIAL en ese
// momento (texto, no solo la FK) — mismo criterio que el nombre/código de empleado
// congelados en las tablas append-only (CLAUDE.md §6): si alguien renombra la familia o el
// material después, esta ficha ya emitida no debe cambiar de referencia retroactivamente.
//
// `idMolde`/`idMoldeIaIntento` son opcionales: el molde y la generación con IA son pasos
// del asistente, no un requisito duro para poder finalizar (CLAUDE.md — no inventar una
// restricción que el usuario no pidió). El PDF (helpers/fichaConfeccionPdf.js) simplemente
// omite esas imágenes si no hay nada que mostrar.
//
// `cantidadTotal` es la suma de FICHAS_CONFECCION_COLORES.cantidad — se guarda acá también
// (desnormalizado) porque la Biblioteca lista fichas sin tener que sumar el detalle de cada
// una por fila (CLAUDE.md §7, prevención de N+1).
//
// `objectKeyPdf` es la ruta del PDF ya generado en el bucket PRIVADO (carpeta
// `fichas-confeccion/`, helpers/almacenamientoDocumentos.js CARPETAS_PRIVADAS): el PDF trae
// el precio de confección, así que nunca es público.
//
// `paranoid: true` porque es una entidad de negocio real (CLAUDE.md §3) — anular una ficha
// es un cambio de estado, nunca un DELETE físico.
const FichaConfeccion = db.define('FICHAS_CONFECCION', {
    idFicha: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idUsuarioCreacion: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'USUARIOS', key: 'idUsuario' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idDxf: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'FICHAS_CONFECCION_DXF', key: 'idArchivoDxf' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idMolde: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'FICHAS_CONFECCION_MOLDES', key: 'idMolde' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idMoldeIaIntento: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'FICHAS_CONFECCION_MOLDES_IA_INTENTOS', key: 'idIntento' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    referencia: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    materialNombre: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    complementos: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    observaciones: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    precioConfeccion: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false
    },
    cantidadTotal: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    objectKeyPdf: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    estado: {
        type: DataTypes.ENUM('activa', 'anulada'),
        allowNull: false,
        defaultValue: 'activa'
    }
}, {
    tableName: 'FICHAS_CONFECCION',
    timestamps: true,
    paranoid: true
});

export default FichaConfeccion;
