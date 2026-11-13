import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Un archivo DXF subido desde el asistente "Nueva ficha de confección"
// (admin/procesos/fichas-confeccion/nueva) — UUID porque es una entidad de negocio, no una
// línea de detalle (CLAUDE.md §3). El análisis (helpers/dxf.js) corre en segundo plano
// después de responder la subida, así que la fila nace en 'procesando' y se completa sola.
//
// No lleva `idFicha`: la relación con FICHAS_CONFECCION va al revés acá — una ficha apunta
// a UN solo DXF (`FichaConfeccion.idDxf`, models/FichaConfeccion.js), así que la FK vive en
// esa tabla, no en esta. Esta fila existe desde el paso 1 del asistente, antes de que la
// ficha exista; al finalizar, `finalizarFicha` (controller/fichaConfeccionController.js)
// simplemente la referencia, no la modifica.
const FichaConfeccionDxf = db.define('FICHAS_CONFECCION_DXF', {
    idArchivoDxf: {
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
    // Ruta real en R2 (bucket PRIVADO gh-pay-assets, carpeta dxf/ — helpers/
    // almacenamientoDocumentos.js CARPETAS_PRIVADAS). Null mientras está 'procesando'.
    objectKey: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    shaHash: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    // 'procesando' → 'listo' | 'error'. 'listo' con los tres campos en null es válido: el
    // archivo se subió bien, pero el heurístico no encontró las etiquetas (helpers/dxf.js).
    estado: {
        type: DataTypes.ENUM('procesando', 'listo', 'error'),
        allowNull: false,
        defaultValue: 'procesando'
    },
    estiloNombre: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    // Lista de tallas, no una sola (helpers/dxf.js normalizarTallas): un DXF graduado para
    // varias tallas nesteadas ("Size: S/M") da ["Talla S", "Talla M"]; sin graduación —nada
    // detectado, o un solo valor— da ["Talla Única"]. JSON en vez de un VARCHAR con comas
    // (mismo criterio que DetallesOrdenCompra.caracteristicas: una lista chica y variable,
    // no vale la pena una tabla aparte para esto todavía).
    talla: {
        type: DataTypes.JSON,
        allowNull: true
    },
    // Los materiales detectados (uno por código DISTINTO de "Material: X" en el DXF — una
    // prenda puede cortarse en más de una tela) ya NO viven en esta fila: son
    // FICHAS_CONFECCION_DXF_MATERIALES (models/FichaConfeccionDxfMaterial.js, as
    // 'materialesDetalle'), una fila por código con su propia resolución contra MATERIAL.
    // Antes esta tabla tenía `material` (STRING) + `idMaterialAsociado` (CHAR(36), FK) para
    // un solo código — se reemplazaron por esa tabla de detalle cuando se vio que un mismo
    // DXF puede traer más de un código de material (seed/migracionFichasConfeccionDxfMateriales.js).
    //
    // `idFamiliaAsociada` sigue acá porque la referencia (Style Name) sí es una sola por
    // archivo — no hay el mismo caso de "más de un valor" que con material.
    idFamiliaAsociada: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'FAMILIA', key: 'idFamilia' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    errorMensaje: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    analizadoEn: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'FICHAS_CONFECCION_DXF',
    timestamps: true
});

export default FichaConfeccionDxf;
