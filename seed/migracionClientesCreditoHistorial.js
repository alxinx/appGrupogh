import dotenv from 'dotenv';
import db from '../config/bd.js';
import { ClientesCreditoHistorial } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea CLIENTES_CREDITO_HISTORIAL — bitácora de quién otorgó o suspendió el crédito de
// cada cliente y con qué código de empleado. Mismo criterio que
// PEDIDOS_WEB_HISTORIAL_ESTADO (append-only por convención, sin triggers de base de
// datos): es una bitácora de autorización, no un libro de movimientos de efectivo como
// TRASLADO_EFECTIVO_HISTORIAL, que sí los lleva.
//
//   node ./seed/migracionClientesCreditoHistorial.js
//   node ./seed/migracionClientesCreditoHistorial.js --revertir

const TABLA = 'CLIENTES_CREDITO_HISTORIAL';
const REVERTIR = process.argv.includes('--revertir');

const existeTabla = async () => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT });
    return r.n > 0;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        if (!(await existeTabla())) { console.log(`· ${TABLA} no existe, nada que revertir`); process.exit(0); }
        const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA}`, { type: QueryTypes.SELECT });
        if (n > 0) {
            console.error(`✗ ABORTADO: ${TABLA} tiene ${n} registro(s). Es una bitácora de autorización.`);
            process.exit(1);
        }
        await db.query(`DROP TABLE ${TABLA}`);
        console.log(`✓ ${TABLA} eliminada`);
        process.exit(0);
    }

    if (await existeTabla()) {
        console.log(`· ${TABLA} ya existe, se omite`);
    } else {
        await ClientesCreditoHistorial.sync();
        console.log(`✓ ${TABLA} creada`);
    }

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    cols.forEach(c => console.log(`   ${c.Field.padEnd(18)}${String(c.Type).padEnd(40)}null:${c.Null}`));

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
