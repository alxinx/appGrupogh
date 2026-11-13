import dotenv from 'dotenv';
import db from '../config/bd.js';
import { FichaConfeccionProceso, FichaConfeccionProcesoHistorial, FichaConfeccionProcesoBitacora } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea el seguimiento de producción por taller (admin/procesos — "Nuevo proceso" pasa de
// pantalla vacía a listar esto): FICHAS_CONFECCION_PROCESOS (uno por taller asignado a una
// ficha), su historial de etapas y su bitácora de novedades. Ver models/FichaConfeccionProceso.js,
// FichaConfeccionProcesoHistorial.js, FichaConfeccionProcesoBitacora.js.
//
// Las tres FK nuevas son UUID/INTEGER de Sequelize en ambos lados (idTaller → FICHAS_
// CONFECCION_TALLERES.idDetalle, idProceso → FICHAS_CONFECCION_PROCESOS.idProceso, idUsuario
// → USUARIOS.idUsuario) — mismo caso sin fricción de collation que FichaConfeccionTaller
// (seed/migracionFichaConfeccionTalleres.js), así que `.sync()` alcanza.
//
//   node ./seed/migracionFichaConfeccionProcesos.js
//   node ./seed/migracionFichaConfeccionProcesos.js --revertir
//
// Idempotente.

const TABLA_PROCESOS = 'FICHAS_CONFECCION_PROCESOS';
const TABLA_HISTORIAL = 'FICHAS_CONFECCION_PROCESOS_HISTORIAL';
const TABLA_BITACORA = 'FICHAS_CONFECCION_PROCESOS_BITACORA';
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
        // Bitácora e historial primero: tienen FK hacia Procesos.
        for (const tabla of [TABLA_BITACORA, TABLA_HISTORIAL, TABLA_PROCESOS]) {
            if (!(await existeTabla(tabla))) { console.log(`· ${tabla} no existe, nada que revertir`); continue; }
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${tabla}`, { type: QueryTypes.SELECT });
            if (n > 0) { console.error(`✗ ABORTADO: ${tabla} tiene ${n} fila(s).`); process.exit(1); }
            await db.query(`DROP TABLE ${tabla}`);
            console.log(`✓ ${tabla} eliminada`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (await existeTabla(TABLA_PROCESOS)) {
        console.log(`· ${TABLA_PROCESOS} ya existe, se omite`);
    } else {
        await FichaConfeccionProceso.sync();
        console.log(`✓ ${TABLA_PROCESOS} creada`);
    }

    if (await existeTabla(TABLA_HISTORIAL)) {
        console.log(`· ${TABLA_HISTORIAL} ya existe, se omite`);
    } else {
        await FichaConfeccionProcesoHistorial.sync();
        console.log(`✓ ${TABLA_HISTORIAL} creada`);
    }

    if (await existeTabla(TABLA_BITACORA)) {
        console.log(`· ${TABLA_BITACORA} ya existe, se omite`);
    } else {
        await FichaConfeccionProcesoBitacora.sync();
        console.log(`✓ ${TABLA_BITACORA} creada`);
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
