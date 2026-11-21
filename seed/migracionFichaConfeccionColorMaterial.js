import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Agrega FICHAS_CONFECCION_COLORES.idMaterial — de qué tela es esa línea de color, cuando
// el DXF trae más de un material (ver models/FichaConfeccionColor.js y helpers/dxf.js).
//
//   node ./seed/migracionFichaConfeccionColorMaterial.js
//   node ./seed/migracionFichaConfeccionColorMaterial.js --revertir
//
// Idempotente.

const TABLA = 'FICHAS_CONFECCION_COLORES';
const REVERTIR = process.argv.includes('--revertir');

const existeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

// La collation real de MATERIAL.idMaterial — nunca asumida (mismo motivo que
// seed/migracionFichasConfeccionDxfMateriales.js: un FK que no calce exacto falla con el
// Error 3780 de MySQL).
const collationDeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT COLLATION_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    if (!r?.COLLATION_NAME) throw new Error(`No se pudo leer la collation de ${tabla}.${columna}`);
    return r.COLLATION_NAME;
};

const nombreFk = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c AND REFERENCED_TABLE_NAME IS NOT NULL`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    return r?.CONSTRAINT_NAME || null;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        if (!(await existeColumna(TABLA, 'idMaterial'))) {
            console.log(`· ${TABLA}.idMaterial no existe, nada que revertir`);
        } else {
            const fk = await nombreFk(TABLA, 'idMaterial');
            if (fk) await db.query(`ALTER TABLE ${TABLA} DROP FOREIGN KEY ${fk}`);
            await db.query(`ALTER TABLE ${TABLA} DROP COLUMN idMaterial`);
            console.log(`✓ ${TABLA}.idMaterial eliminada`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (await existeColumna(TABLA, 'idMaterial')) {
        console.log(`· ${TABLA}.idMaterial ya existe, se omite`);
    } else {
        const collation = await collationDeColumna('MATERIAL', 'idMaterial');
        await db.query(`ALTER TABLE ${TABLA} ADD COLUMN idMaterial CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collation} NULL AFTER idAtributoColor`);
        await db.query(`ALTER TABLE ${TABLA} ADD CONSTRAINT fichas_confeccion_colores_material_fk FOREIGN KEY (idMaterial) REFERENCES MATERIAL(idMaterial) ON DELETE SET NULL ON UPDATE CASCADE`);
        console.log(`✓ ${TABLA}.idMaterial agregada (collation ${collation}, igual a MATERIAL.idMaterial)`);
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
