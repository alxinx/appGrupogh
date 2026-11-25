import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';
import { OrdenProduccion, OrdenProduccionEstado } from '../models/index.js';
import { migrarTablaAppendOnly } from './tablaAppendOnly.js';

dotenv.config();

// Órdenes de producción (wiki "Proceso de confección"; CLAUDE.md §6.2). Todo ADITIVO:
// tablas nuevas y una fila nueva en SECUENCIAS. No toca ninguna fila existente.
//
//   ORDENES_PRODUCCION                   nueva (borrado lógico)
//   ORDENES_PRODUCCION_CANTIDADES        nueva — color × talla × cantidad
//   ORDENES_PRODUCCION_INSUMOS           nueva — receta efectiva, cantidad DECIMAL(15,4) por prenda
//   ORDENES_PRODUCCION_INSUMOS_COLORES   nueva — color del insumo por color de prenda
//   ORDENES_PRODUCCION_ESTADOS           nueva, append-only (triggers)
//   SECUENCIAS 'orden_produccion'        nueva fila, en 0 → la primera orden es OP-1
//
//   npm run db:migrar-ordenes-produccion
//   npm run db:migrar-ordenes-produccion -- --revertir     (solo si no hay órdenes)
//
// Idempotente: cada paso revisa si ya está hecho.

const REVERTIR = process.argv.includes('--revertir');
const TABLAS = [
    'ORDENES_PRODUCCION_ESTADOS',
    'ORDENES_PRODUCCION_INSUMOS_COLORES',
    'ORDENES_PRODUCCION_INSUMOS',
    'ORDENES_PRODUCCION_CANTIDADES',
    'ORDENES_PRODUCCION'
];

const uno = async (sql, replacements = {}) => (await db.query(sql, { replacements, type: QueryTypes.SELECT }))[0];

const existeTabla = async (t) => (await uno(
    `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`, { t })).n > 0;

const collation = async (t, c) => {
    const col = await uno(
        `SELECT COLLATION_NAME coll FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`, { t, c });
    if (!col?.coll) throw new Error(`No se pudo leer la collation de ${t}.${c}`);
    return col.coll;
};

const enumSql = (modelo, campo) => `ENUM(${modelo.getAttributes()[campo].values.map(v => `'${v}'`).join(',')})`;

const crear = async (tabla, sql) => {
    if (await existeTabla(tabla)) { console.log(`· ${tabla} ya existe`); return; }
    await db.query(sql);
    console.log(`✓ ${tabla} creada`);
};

const migrar = async () => {
    // Cada id que apunta a otra tabla lleva la collation de esa columna: si no coincide,
    // MySQL rechaza la FK.
    const cFicha    = await collation('FICHAS_CONFECCION', 'idFicha');
    const cMaterial = await collation('MATERIAL', 'idMaterial');
    const cUsuario  = await collation('USUARIOS', 'idUsuario');
    const uuid = (coll) => `CHAR(36) CHARACTER SET utf8mb4 COLLATE ${coll}`;
    const estados = enumSql(OrdenProduccion, 'estado');

    await crear('ORDENES_PRODUCCION', `
        CREATE TABLE ORDENES_PRODUCCION (
            idOrdenProduccion ${uuid(cFicha)} NOT NULL,
            numeroProduccion VARCHAR(20) NOT NULL,
            idFicha ${uuid(cFicha)} NOT NULL,
            referencia VARCHAR(150) NOT NULL,
            estado ${estados} NOT NULL DEFAULT 'borrador',
            fechaRequerida DATE NOT NULL,
            notas TEXT NULL,
            idUsuarioCreacion ${uuid(cUsuario)} NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            deletedAt DATETIME NULL,
            PRIMARY KEY (idOrdenProduccion),
            UNIQUE KEY ordenes_produccion_numero_uk (numeroProduccion),
            INDEX ordenes_produccion_ficha_idx (idFicha),
            INDEX ordenes_produccion_estado_idx (estado, fechaRequerida),
            CONSTRAINT ordenes_produccion_ficha_fk FOREIGN KEY (idFicha) REFERENCES FICHAS_CONFECCION(idFicha) ON DELETE RESTRICT ON UPDATE CASCADE,
            CONSTRAINT ordenes_produccion_usuario_fk FOREIGN KEY (idUsuarioCreacion) REFERENCES USUARIOS(idUsuario) ON DELETE RESTRICT ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await crear('ORDENES_PRODUCCION_CANTIDADES', `
        CREATE TABLE ORDENES_PRODUCCION_CANTIDADES (
            idDetalle INT NOT NULL AUTO_INCREMENT,
            idOrdenProduccion ${uuid(cFicha)} NOT NULL,
            idAtributoColor INT NOT NULL,
            talla VARCHAR(20) NOT NULL,
            cantidad INT NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            PRIMARY KEY (idDetalle),
            UNIQUE KEY ordenes_produccion_cantidades_uk (idOrdenProduccion, idAtributoColor, talla),
            CONSTRAINT ordenes_produccion_cantidades_orden_fk FOREIGN KEY (idOrdenProduccion) REFERENCES ORDENES_PRODUCCION(idOrdenProduccion) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT ordenes_produccion_cantidades_color_fk FOREIGN KEY (idAtributoColor) REFERENCES ATRIBUTOS(idAtributo) ON DELETE RESTRICT ON UPDATE CASCADE,
            CONSTRAINT ordenes_produccion_cantidades_positiva CHECK (cantidad > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await crear('ORDENES_PRODUCCION_INSUMOS', `
        CREATE TABLE ORDENES_PRODUCCION_INSUMOS (
            idDetalle INT NOT NULL AUTO_INCREMENT,
            idOrdenProduccion ${uuid(cFicha)} NOT NULL,
            idMaterial ${uuid(cMaterial)} NOT NULL,
            nombreMaterial VARCHAR(100) NOT NULL,
            cantidadPorPrenda DECIMAL(15,4) NOT NULL,
            orden INT NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            PRIMARY KEY (idDetalle),
            INDEX ordenes_produccion_insumos_orden_idx (idOrdenProduccion),
            INDEX ordenes_produccion_insumos_material_idx (idMaterial),
            CONSTRAINT ordenes_produccion_insumos_orden_fk FOREIGN KEY (idOrdenProduccion) REFERENCES ORDENES_PRODUCCION(idOrdenProduccion) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT ordenes_produccion_insumos_material_fk FOREIGN KEY (idMaterial) REFERENCES MATERIAL(idMaterial) ON DELETE RESTRICT ON UPDATE CASCADE,
            CONSTRAINT ordenes_produccion_insumos_positiva CHECK (cantidadPorPrenda > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await crear('ORDENES_PRODUCCION_INSUMOS_COLORES', `
        CREATE TABLE ORDENES_PRODUCCION_INSUMOS_COLORES (
            idDetalle INT NOT NULL AUTO_INCREMENT,
            idInsumoOrden INT NOT NULL,
            idAtributoColorPrenda INT NOT NULL,
            idAtributoColorInsumo INT NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            PRIMARY KEY (idDetalle),
            UNIQUE KEY ordenes_produccion_insumos_colores_uk (idInsumoOrden, idAtributoColorPrenda),
            CONSTRAINT ordenes_produccion_insumos_colores_insumo_fk FOREIGN KEY (idInsumoOrden) REFERENCES ORDENES_PRODUCCION_INSUMOS(idDetalle) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT ordenes_produccion_insumos_colores_prenda_fk FOREIGN KEY (idAtributoColorPrenda) REFERENCES ATRIBUTOS(idAtributo) ON DELETE RESTRICT ON UPDATE CASCADE,
            CONSTRAINT ordenes_produccion_insumos_colores_insumo_color_fk FOREIGN KEY (idAtributoColorInsumo) REFERENCES ATRIBUTOS(idAtributo) ON DELETE RESTRICT ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await crear('ORDENES_PRODUCCION_ESTADOS', `
        CREATE TABLE ORDENES_PRODUCCION_ESTADOS (
            idRegistro INT NOT NULL AUTO_INCREMENT,
            idOrdenProduccion ${uuid(cFicha)} NOT NULL,
            accion ${enumSql(OrdenProduccionEstado, 'accion')} NOT NULL,
            estadoAnterior ${estados} NULL,
            estadoNuevo ${estados} NOT NULL,
            motivo TEXT NULL,
            idUsuario ${uuid(cUsuario)} NOT NULL,
            nombreUsuario VARCHAR(150) NULL,
            createdAt DATETIME NOT NULL,
            PRIMARY KEY (idRegistro),
            INDEX ordenes_produccion_estados_orden_idx (idOrdenProduccion, createdAt),
            CONSTRAINT ordenes_produccion_estados_orden_fk FOREIGN KEY (idOrdenProduccion) REFERENCES ORDENES_PRODUCCION(idOrdenProduccion) ON DELETE RESTRICT ON UPDATE CASCADE,
            CONSTRAINT ordenes_produccion_estados_usuario_fk FOREIGN KEY (idUsuario) REFERENCES USUARIOS(idUsuario) ON DELETE RESTRICT ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // La tabla ya existe: el helper compartido de constancias solo pone los triggers.
    const r = await migrarTablaAppendOnly({
        modelo: OrdenProduccionEstado,
        tabla: 'ORDENES_PRODUCCION_ESTADOS',
        mensaje: 'ORDENES_PRODUCCION_ESTADOS es append-only: no se edita ni se borra'
    });
    if (r) throw new Error('No se pudieron crear los triggers de ORDENES_PRODUCCION_ESTADOS');

    // Contador del número de orden. En 0: no hay órdenes anteriores con las que chocar.
    const [ins] = await db.query(`INSERT IGNORE INTO SECUENCIAS (nombre, valor) VALUES ('orden_produccion', 0)`);
    console.log((ins?.affectedRows ?? 0) > 0 ? "✓ SECUENCIAS 'orden_produccion' sembrada en 0" : "· SECUENCIAS 'orden_produccion' ya existe");
};

const revertir = async () => {
    // Nada se revierte si ya hay órdenes: serían datos reales.
    if (await existeTabla('ORDENES_PRODUCCION')) {
        const { n } = await uno('SELECT COUNT(*) n FROM ORDENES_PRODUCCION');
        if (n > 0) { console.error(`✗ ABORTADO: ORDENES_PRODUCCION tiene ${n} orden(es). No se revierte con datos.`); return 1; }
    }
    for (const tg of ['ORDENES_PRODUCCION_ESTADOS_sin_update', 'ORDENES_PRODUCCION_ESTADOS_sin_delete']) {
        await db.query(`DROP TRIGGER IF EXISTS \`${tg}\``);
    }
    for (const t of TABLAS) {
        if (await existeTabla(t)) { await db.query(`DROP TABLE ${t}`); console.log(`✓ ${t} eliminada`); }
    }
    await db.query(`DELETE FROM SECUENCIAS WHERE nombre = 'orden_produccion'`);
    console.log('\nReversión completada.');
    return 0;
};

export const migrarOrdenesProduccion = async () => { await db.authenticate(); await migrar(); };

// Corre sola solo cuando se llama como script (los tests la importan).
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        await db.authenticate();
        if (REVERTIR) process.exit(await revertir());
        await migrar();
        console.log('\nMigración completada.');
        process.exit(0);
    })().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
}
