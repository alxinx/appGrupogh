import dotenv from 'dotenv';
import db from '../config/bd.js';
import { FichaConfeccionTaller, FichaConfeccionTallerColor } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea FICHAS_CONFECCION_TALLERES (taller de confección + su propio precio) y
// FICHAS_CONFECCION_TALLERES_COLORES (qué color le toca a cada taller). Ver
// models/FichaConfeccionTaller.js y models/FichaConfeccionTallerColor.js.
//
// A diferencia de FICHAS_CONFECCION_DXF_MATERIALES/COLORES (que referencian MATERIAL y
// necesitan la danza de collation), acá las dos FK nuevas (idFicha → FICHAS_CONFECCION.
// idFicha, idProveedor → PROVEDORES.idProveedor) son UUID de Sequelize en ambos lados —
// mismo caso que FichaConfeccionColor.idFicha, que ya sincroniza sin problema — así que
// `.sync()` alcanza, sin ALTER manual.
//
//   node ./seed/migracionFichaConfeccionTalleres.js
//   node ./seed/migracionFichaConfeccionTalleres.js --revertir
//
// Idempotente.

const TABLA_TALLERES = 'FICHAS_CONFECCION_TALLERES';
const TABLA_TALLERES_COLORES = 'FICHAS_CONFECCION_TALLERES_COLORES';
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
        // Los colores de taller primero: tienen FK hacia FICHAS_CONFECCION_TALLERES.
        if (await existeTabla(TABLA_TALLERES_COLORES)) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA_TALLERES_COLORES}`, { type: QueryTypes.SELECT });
            if (n > 0) { console.error(`✗ ABORTADO: ${TABLA_TALLERES_COLORES} tiene ${n} fila(s).`); process.exit(1); }
            await db.query(`DROP TABLE ${TABLA_TALLERES_COLORES}`);
            console.log(`✓ ${TABLA_TALLERES_COLORES} eliminada`);
        } else {
            console.log(`· ${TABLA_TALLERES_COLORES} no existe, nada que revertir`);
        }

        if (await existeTabla(TABLA_TALLERES)) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA_TALLERES}`, { type: QueryTypes.SELECT });
            if (n > 0) { console.error(`✗ ABORTADO: ${TABLA_TALLERES} tiene ${n} fila(s).`); process.exit(1); }
            await db.query(`DROP TABLE ${TABLA_TALLERES}`);
            console.log(`✓ ${TABLA_TALLERES} eliminada`);
        } else {
            console.log(`· ${TABLA_TALLERES} no existe, nada que revertir`);
        }

        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (await existeTabla(TABLA_TALLERES)) {
        console.log(`· ${TABLA_TALLERES} ya existe, se omite`);
    } else {
        await FichaConfeccionTaller.sync();
        console.log(`✓ ${TABLA_TALLERES} creada`);
    }

    if (await existeTabla(TABLA_TALLERES_COLORES)) {
        console.log(`· ${TABLA_TALLERES_COLORES} ya existe, se omite`);
    } else {
        await FichaConfeccionTallerColor.sync();
        console.log(`✓ ${TABLA_TALLERES_COLORES} creada`);
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
