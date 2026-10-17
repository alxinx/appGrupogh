import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Un archivo DXF subido desde el asistente "Nueva ficha de confección"
// (admin/procesos/fichas-confeccion/nueva) — UUID porque es una entidad de negocio, no una
// línea de detalle (CLAUDE.md §3). El análisis (helpers/dxf.js) corre en segundo plano
// después de responder la subida, así que la fila nace en 'procesando' y se completa sola.
//
// `idFicha` NO existe todavía: no hay tabla FICHAS_CONFECCION — el asistente solo tiene el
// paso de archivos resuelto, el resto de los campos (insumos, procesos, tallas...) sigue
// pendiente de definir (controller/produccionController.js homeFichaConfeccionNueva). Este
// archivo queda suelto hasta que esa tabla exista; en ese momento se agrega la columna con
// un ALTER (CLAUDE.md: toda columna nueva se avisa con su SQL).
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
    material: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    // Resolución automática contra el catálogo real (helpers/dxf.js asociarCamposDxf):
    // `material` (el código del DXF) cruzado contra MATERIAL.codigoMaterial, `estiloNombre`
    // cruzado contra FAMILIA.nombreFamilia. Las dos quedan en null si no hubo coincidencia —
    // no es un error, es "no se encontró".
    //
    // CHAR(36) plano (no DataTypes.UUID): Sequelize le agrega BINARY a un UUID en MySQL, que
    // termina en collation utf8mb4_bin — y MATERIAL.idMaterial NO tiene esa collation (quedó
    // en la default de su tabla, utf8mb4_0900_ai_ci, de una migración anterior a este
    // archivo). La migración (seed/migracionFichasConfeccionDxf.js) arma el ALTER leyendo la
    // collation real de cada tabla referenciada en vez de asumirla — ver el aviso ahí.
    idMaterialAsociado: {
        type: DataTypes.CHAR(36),
        allowNull: true,
        references: { model: 'MATERIAL', key: 'idMaterial' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
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
