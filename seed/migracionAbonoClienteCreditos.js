import dotenv from 'dotenv';
import db from '../config/bd.js';
import { AbonoClienteCreditos } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea ABONO_CLIENTE_CREDITOS — ledger append-only de abonos a facturas de crédito de
// cliente (base del panel de estado de crédito en admin/clientes). Cada abono es una fila
// nueva con el saldo restante ya calculado (valorPorPagar), mismo criterio que
// CUENTAS_POR_PAGAR del lado de proveedores.
//
//   node ./seed/migracionAbonoClienteCreditos.js
//   node ./seed/migracionAbonoClienteCreditos.js --revertir

const TABLA = 'ABONO_CLIENTE_CREDITOS';
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
            console.error(`✗ ABORTADO: ${TABLA} tiene ${n} registro(s). Es un ledger financiero.`);
            process.exit(1);
        }
        await db.query(`DROP TABLE ${TABLA}`);
        console.log(`✓ ${TABLA} eliminada`);
        process.exit(0);
    }

    if (await existeTabla()) {
        console.log(`· ${TABLA} ya existe, se omite`);
    } else {
        await AbonoClienteCreditos.sync();
        console.log(`✓ ${TABLA} creada`);
    }

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    cols.forEach(c => console.log(`   ${c.Field.padEnd(18)}${String(c.Type).padEnd(40)}null:${c.Null}`));

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
