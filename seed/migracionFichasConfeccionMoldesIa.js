import dotenv from 'dotenv';
import db from '../config/bd.js';
import { FichaConfeccionMolde, FichaConfeccionMoldeIaIntento } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea FICHAS_CONFECCION_MOLDES (el molde JPG/PDF subido) y FICHAS_CONFECCION_MOLDES_IA_
// INTENTOS (cada generación con IA sobre ese molde — admin/procesos/fichas-confeccion/
// nueva). Ver models/FichaConfeccionMolde.js y models/FichaConfeccionMoldeIaIntento.js.
//
//   node ./seed/migracionFichasConfeccionMoldesIa.js
//   node ./seed/migracionFichasConfeccionMoldesIa.js --revertir
//
// Idempotente.

const TABLA_MOLDES = 'FICHAS_CONFECCION_MOLDES';
const TABLA_INTENTOS = 'FICHAS_CONFECCION_MOLDES_IA_INTENTOS';
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
        // Los intentos primero: tienen FK hacia los moldes.
        if (await existeTabla(TABLA_INTENTOS)) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA_INTENTOS}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA_INTENTOS} tiene ${n} fila(s). No se elimina con datos adentro.`);
                process.exit(1);
            }
            await db.query(`DROP TABLE ${TABLA_INTENTOS}`);
            console.log(`✓ ${TABLA_INTENTOS} eliminada`);
        } else {
            console.log(`· ${TABLA_INTENTOS} no existe, nada que revertir`);
        }

        if (await existeTabla(TABLA_MOLDES)) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA_MOLDES}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA_MOLDES} tiene ${n} fila(s). No se elimina con datos adentro.`);
                process.exit(1);
            }
            await db.query(`DROP TABLE ${TABLA_MOLDES}`);
            console.log(`✓ ${TABLA_MOLDES} eliminada`);
        } else {
            console.log(`· ${TABLA_MOLDES} no existe, nada que revertir`);
        }

        console.log('\nReversión completada.');
        process.exit(0);
    }

    // Los moldes primero: los intentos referencian esta tabla por FK.
    if (await existeTabla(TABLA_MOLDES)) {
        console.log(`· ${TABLA_MOLDES} ya existe, se omite`);
    } else {
        await FichaConfeccionMolde.sync();
        console.log(`✓ ${TABLA_MOLDES} creada`);
    }

    if (await existeTabla(TABLA_INTENTOS)) {
        console.log(`· ${TABLA_INTENTOS} ya existe, se omite`);
    } else {
        await FichaConfeccionMoldeIaIntento.sync();
        console.log(`✓ ${TABLA_INTENTOS} creada`);
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
