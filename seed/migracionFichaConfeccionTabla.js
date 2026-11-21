import dotenv from 'dotenv';
import db from '../config/bd.js';
import { FichaConfeccion, FichaConfeccionColor } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea FICHAS_CONFECCION (la entidad final del asistente) y FICHAS_CONFECCION_COLORES (el
// detalle color+cantidad), y agrega FICHAS_CONFECCION_VIDEOS.idFicha — la columna que
// quedó pendiente desde que se creó esa tabla (ver el comentario en
// models/FichaConfeccionVideo.js). Ver models/FichaConfeccion.js y
// models/FichaConfeccionColor.js.
//
//   node ./seed/migracionFichaConfeccionTabla.js
//   node ./seed/migracionFichaConfeccionTabla.js --revertir
//
// Idempotente.

const TABLA_FICHA = 'FICHAS_CONFECCION';
const TABLA_COLORES = 'FICHAS_CONFECCION_COLORES';
const TABLA_VIDEOS = 'FICHAS_CONFECCION_VIDEOS';
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

const collationDeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT COLLATION_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    if (!r?.COLLATION_NAME) throw new Error(`No se pudo leer la collation de ${tabla}.${columna}`);
    return r.COLLATION_NAME;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        if (await existeColumna(TABLA_VIDEOS, 'idFicha')) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA_VIDEOS} WHERE idFicha IS NOT NULL`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${n} video(s) ya tienen idFicha asignado. No se quita la columna con datos adentro.`);
                process.exit(1);
            }
            const [fk] = await db.query(
                `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = 'idFicha' AND REFERENCED_TABLE_NAME IS NOT NULL`,
                { replacements: { t: TABLA_VIDEOS }, type: QueryTypes.SELECT }
            );
            if (fk?.CONSTRAINT_NAME) await db.query(`ALTER TABLE ${TABLA_VIDEOS} DROP FOREIGN KEY ${fk.CONSTRAINT_NAME}`);
            await db.query(`ALTER TABLE ${TABLA_VIDEOS} DROP COLUMN idFicha`);
            console.log(`✓ ${TABLA_VIDEOS}.idFicha eliminada`);
        } else {
            console.log(`· ${TABLA_VIDEOS}.idFicha no existe, nada que revertir`);
        }

        // Los colores primero: tienen FK hacia la ficha.
        if (await existeTabla(TABLA_COLORES)) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA_COLORES}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA_COLORES} tiene ${n} fila(s). No se elimina con datos adentro.`);
                process.exit(1);
            }
            await db.query(`DROP TABLE ${TABLA_COLORES}`);
            console.log(`✓ ${TABLA_COLORES} eliminada`);
        } else {
            console.log(`· ${TABLA_COLORES} no existe, nada que revertir`);
        }

        if (await existeTabla(TABLA_FICHA)) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA_FICHA}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA_FICHA} tiene ${n} fila(s). No se elimina con datos adentro.`);
                process.exit(1);
            }
            await db.query(`DROP TABLE ${TABLA_FICHA}`);
            console.log(`✓ ${TABLA_FICHA} eliminada`);
        } else {
            console.log(`· ${TABLA_FICHA} no existe, nada que revertir`);
        }

        console.log('\nReversión completada.');
        process.exit(0);
    }

    // La ficha primero: colores y el ALTER de videos la referencian.
    if (await existeTabla(TABLA_FICHA)) {
        console.log(`· ${TABLA_FICHA} ya existe, se omite`);
    } else {
        await FichaConfeccion.sync();
        console.log(`✓ ${TABLA_FICHA} creada`);
    }

    if (await existeTabla(TABLA_COLORES)) {
        console.log(`· ${TABLA_COLORES} ya existe, se omite`);
    } else {
        await FichaConfeccionColor.sync();
        console.log(`✓ ${TABLA_COLORES} creada`);
    }

    if (await existeColumna(TABLA_VIDEOS, 'idFicha')) {
        console.log(`· ${TABLA_VIDEOS}.idFicha ya existe, se omite`);
    } else {
        const collation = await collationDeColumna(TABLA_FICHA, 'idFicha');
        await db.query(`ALTER TABLE ${TABLA_VIDEOS} ADD COLUMN idFicha CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collation} NULL AFTER idVideo`);
        await db.query(`ALTER TABLE ${TABLA_VIDEOS} ADD CONSTRAINT fichas_confeccion_videos_ficha_fk FOREIGN KEY (idFicha) REFERENCES ${TABLA_FICHA}(idFicha) ON DELETE RESTRICT ON UPDATE CASCADE`);
        console.log(`✓ ${TABLA_VIDEOS}.idFicha agregada (collation ${collation}, igual a ${TABLA_FICHA}.idFicha)`);
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
