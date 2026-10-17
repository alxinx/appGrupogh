import dotenv from 'dotenv';
import db from '../config/bd.js';
import { FichaConfeccionDxf } from '../models/index.js';
import { normalizarTallas } from '../helpers/dxf.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea FICHAS_CONFECCION_DXF (admin/procesos/fichas-confeccion/nueva, paso 1: subida y
// análisis del DXF) y agrega las columnas de asociación automática (idMaterialAsociado,
// idFamiliaAsociada — ver models/FichaConfeccionDxf.js y helpers/dxf.js
// asociarCamposDxf). No tiene `idFicha` todavía porque no existe tabla FICHAS_CONFECCION;
// se agrega con un ALTER cuando el resto del asistente esté definido.
//
//   node ./seed/migracionFichasConfeccionDxf.js
//   node ./seed/migracionFichasConfeccionDxf.js --revertir
//
// Idempotente.

const TABLA = 'FICHAS_CONFECCION_DXF';
const REVERTIR = process.argv.includes('--revertir');

const existeTabla = async (tabla) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t: tabla }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

const existeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

// La collation real de una columna CHAR/VARCHAR — nunca asumida. MATERIAL.idMaterial y
// FAMILIA.idFamilia NO tienen la misma collation entre sí (quedó así de migraciones
// anteriores a este archivo: FAMILIA la fuerza a utf8mb4_bin, MATERIAL se quedó en la
// default de su tabla, utf8mb4_0900_ai_ci) — un FK que no calce exacto con la columna que
// referencia falla con el Error 3780 de MySQL. Leerla acá, en vez de escribirla a mano,
// es lo que evita repetir ese error si esto corre contra un ambiente con otra collation.
const collationDeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT COLLATION_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    if (!r?.COLLATION_NAME) throw new Error(`No se pudo leer la collation de ${tabla}.${columna}`);
    return r.COLLATION_NAME;
};

const tipoDeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT DATA_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    return r?.DATA_TYPE || null;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        if (await existeTabla(TABLA)) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA} tiene ${n} fila(s). No se elimina con datos adentro.`);
                process.exit(1);
            }
            await db.query(`DROP TABLE ${TABLA}`);
            console.log(`✓ ${TABLA} eliminada`);
        } else {
            console.log(`· ${TABLA} no existe, nada que revertir`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (await existeTabla(TABLA)) {
        console.log(`· ${TABLA} ya existe, se omite`);
    } else {
        await FichaConfeccionDxf.sync();
        console.log(`✓ ${TABLA} creada`);
    }

    if (await existeColumna(TABLA, 'idMaterialAsociado')) {
        console.log(`· ${TABLA}.idMaterialAsociado ya existe, se omite`);
    } else {
        const collation = await collationDeColumna('MATERIAL', 'idMaterial');
        await db.query(`ALTER TABLE ${TABLA} ADD COLUMN idMaterialAsociado CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collation} NULL AFTER material`);
        await db.query(`ALTER TABLE ${TABLA} ADD CONSTRAINT fichas_confeccion_dxf_material_fk FOREIGN KEY (idMaterialAsociado) REFERENCES MATERIAL(idMaterial) ON DELETE SET NULL ON UPDATE CASCADE`);
        console.log(`✓ ${TABLA}.idMaterialAsociado agregada (collation ${collation}, igual a MATERIAL.idMaterial)`);
    }

    if (await existeColumna(TABLA, 'idFamiliaAsociada')) {
        console.log(`· ${TABLA}.idFamiliaAsociada ya existe, se omite`);
    } else {
        const collation = await collationDeColumna('FAMILIA', 'idFamilia');
        await db.query(`ALTER TABLE ${TABLA} ADD COLUMN idFamiliaAsociada CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collation} NULL AFTER idMaterialAsociado`);
        await db.query(`ALTER TABLE ${TABLA} ADD CONSTRAINT fichas_confeccion_dxf_familia_fk FOREIGN KEY (idFamiliaAsociada) REFERENCES FAMILIA(idFamilia) ON DELETE SET NULL ON UPDATE CASCADE`);
        console.log(`✓ ${TABLA}.idFamiliaAsociada agregada (collation ${collation}, igual a FAMILIA.idFamilia)`);
    }

    // `talla` nació STRING(50) (un solo valor); ahora es una lista — "Size: S/M" se reparte
    // en ["Talla S", "Talla M"] (helpers/dxf.js normalizarTallas) — así que necesita JSON.
    // Las filas que ya tengan un texto viejo ahí (STRING, no JSON) se pasan por el mismo
    // normalizarTallas ANTES del MODIFY COLUMN — si no, MySQL rechaza la conversión entera
    // con "Invalid JSON text" apenas encuentra la primera fila que no sea JSON válido.
    if (await tipoDeColumna(TABLA, 'talla') === 'json') {
        console.log(`· ${TABLA}.talla ya es JSON, se omite`);
    } else {
        const filas = await db.query(
            `SELECT idArchivoDxf, talla FROM ${TABLA} WHERE talla IS NOT NULL`,
            { type: QueryTypes.SELECT }
        );
        for (const fila of filas) {
            await db.query(
                `UPDATE ${TABLA} SET talla = :talla WHERE idArchivoDxf = :id`,
                { replacements: { talla: JSON.stringify(normalizarTallas(fila.talla)), id: fila.idArchivoDxf } }
            );
        }
        if (filas.length) console.log(`· ${filas.length} fila(s) con talla vieja, convertida(s) antes del MODIFY COLUMN`);

        await db.query(`ALTER TABLE ${TABLA} MODIFY COLUMN talla JSON NULL`);
        console.log(`✓ ${TABLA}.talla convertida de VARCHAR a JSON`);
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
