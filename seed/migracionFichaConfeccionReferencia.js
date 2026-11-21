import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Agrega FICHAS_CONFECCION.idMoldeReferencia — foto de referencia adicional que el operador
// puede subir después de cargar el molde técnico. Es opcional: el molde siempre va en el
// PDF; la referencia (si existe) va como segunda imagen junto al molde o la vista IA.
//
//   node ./seed/migracionFichaConfeccionReferencia.js
//   node ./seed/migracionFichaConfeccionReferencia.js --revertir
//
// Idempotente.

const TABLA = 'FICHAS_CONFECCION';
const REVERTIR = process.argv.includes('--revertir');

const existeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

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
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c
           AND REFERENCED_TABLE_NAME IS NOT NULL`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    return r?.CONSTRAINT_NAME || null;
};

const main = async () => {
    if (REVERTIR) {
        if (!(await existeColumna(TABLA, 'idMoldeReferencia'))) {
            console.log(`· ${TABLA}.idMoldeReferencia no existe, nada que revertir`);
        } else {
            const fk = await nombreFk(TABLA, 'idMoldeReferencia');
            if (fk) await db.query(`ALTER TABLE ${TABLA} DROP FOREIGN KEY ${fk}`);
            await db.query(`ALTER TABLE ${TABLA} DROP COLUMN idMoldeReferencia`);
            console.log(`✓ ${TABLA}.idMoldeReferencia eliminada`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (await existeColumna(TABLA, 'idMoldeReferencia')) {
        console.log(`· ${TABLA}.idMoldeReferencia ya existe, se omite`);
    } else {
        const collation = await collationDeColumna('FICHAS_CONFECCION_MOLDES', 'idMolde');
        await db.query(
            `ALTER TABLE ${TABLA}
             ADD COLUMN idMoldeReferencia CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collation} NULL AFTER idMoldeIaIntento`
        );
        await db.query(
            `ALTER TABLE ${TABLA}
             ADD CONSTRAINT fichas_confeccion_molde_referencia_fk
             FOREIGN KEY (idMoldeReferencia) REFERENCES FICHAS_CONFECCION_MOLDES(idMolde)
             ON UPDATE CASCADE ON DELETE RESTRICT`
        );
        console.log(`✓ ${TABLA}.idMoldeReferencia agregada (collation ${collation})`);
    }

    console.log('\nMigración completada.');
    process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
