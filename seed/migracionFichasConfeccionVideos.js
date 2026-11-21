import dotenv from 'dotenv';
import db from '../config/bd.js';
import { FichaConfeccionVideo } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea FICHAS_CONFECCION_VIDEOS (cada video del proceso subido vía Cloudflare Stream Direct
// Creator Upload — admin/procesos/fichas-confeccion/nueva). Ver models/FichaConfeccionVideo.js.
//
//   node ./seed/migracionFichasConfeccionVideos.js
//   node ./seed/migracionFichasConfeccionVideos.js --revertir
//
// Idempotente.

const TABLA = 'FICHAS_CONFECCION_VIDEOS';
const REVERTIR = process.argv.includes('--revertir');

const existeTabla = async (tabla) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t: tabla }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
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
        await FichaConfeccionVideo.sync();
        console.log(`✓ ${TABLA} creada`);
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
