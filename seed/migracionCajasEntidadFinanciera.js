import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// CAJAS_Y_BANCOS.codigoEntidadFinanciera: de qué banco o billetera es una cuenta.
//
// Código del catálogo src/json/entidadesFinancieras.json (helpers/catalogos.js). Nullable:
// una caja de efectivo no lleva, y las cuentas creadas antes del catálogo quedan en NULL
// hasta que se les asigne desde la edición de la cuenta (el servidor lo permite aunque ya
// tengan movimientos, justamente para completar ese dato).
//
//   npm run db:migrar-cajas-entidad-financiera
//   npm run db:migrar-cajas-entidad-financiera -- --revertir

const TABLA = 'CAJAS_Y_BANCOS';
const COLUMNA = 'codigoEntidadFinanciera';
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols[COLUMNA]) { console.log(`· ${COLUMNA} no existe, nada que revertir`); process.exit(0); }
        await db.getQueryInterface().removeColumn(TABLA, COLUMNA);
        console.log(`✓ ${COLUMNA} eliminada de ${TABLA}`);
        process.exit(0);
    }

    if (cols[COLUMNA]) {
        console.log(`· ${COLUMNA} ya existe, se omite`);
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD COLUMN \`${COLUMNA}\` VARCHAR(40) NULL AFTER \`tipo\``);
        console.log(`✓ ${COLUMNA} agregada a ${TABLA} (VARCHAR(40) NULL) después de tipo`);
    }

    const sinBanco = await db.query(
        `SELECT nombreCajaBanco, tipo FROM \`${TABLA}\` WHERE tipo IN ('banco','billetera') AND ${COLUMNA} IS NULL`,
        { type: QueryTypes.SELECT }
    );
    if (sinBanco.length) {
        console.log(`\nCuentas de banco o billetera sin banco asignado (${sinBanco.length}): asígnalo desde "Editar cuenta".`);
        sinBanco.forEach(c => console.log(`   · ${c.nombreCajaBanco} (${c.tipo})`));
    }
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
