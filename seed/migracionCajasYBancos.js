import dotenv from 'dotenv';
import db from '../config/bd.js';
import { CajasYBancos } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea la tabla CAJAS_Y_BANCOS: cajas de efectivo, cuentas bancarias y billeteras.
//
// Sustituye a la vieja tabla CAJAS, eliminada por no usarse nunca
// (seed/migracionEliminarCajas.js).
//
//   node ./seed/migracionCajasYBancos.js
//   node ./seed/migracionCajasYBancos.js --revertir
//
// Idempotente: `sync()` crea la tabla solo si no existe.

const TABLA = 'CAJAS_Y_BANCOS';
const REVERTIR = process.argv.includes('--revertir');

const existeTabla = async () => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tabla`,
        { replacements: { tabla: TABLA }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        if (!(await existeTabla())) {
            console.log(`· ${TABLA} no existe, nada que revertir`);
            process.exit(0);
        }
        // No se borra a ciegas una tabla financiera con datos adentro.
        const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA}`, { type: QueryTypes.SELECT });
        if (n > 0) {
            console.error(`✗ ABORTADO: ${TABLA} tiene ${n} registro(s). Vaciala a mano si de verdad querés eliminarla.`);
            process.exit(1);
        }
        await db.query(`DROP TABLE ${TABLA}`);
        console.log(`✓ ${TABLA} eliminada`);
        process.exit(0);
    }

    if (await existeTabla()) {
        console.log(`· ${TABLA} ya existe, se omite`);
    } else {
        await CajasYBancos.sync();
        console.log(`✓ ${TABLA} creada`);
    }

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    cols.forEach(c => console.log(`   ${c.Field.padEnd(18)}${String(c.Type).padEnd(40)}null:${c.Null}  key:${c.Key || '-'}  default:${c.Default ?? 'NULL'}`));

    console.log('\nMigración de CAJAS_Y_BANCOS completada.');
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
