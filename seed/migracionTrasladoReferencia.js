import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// TRASLADO_EFECTIVO.referencia — número o referencia del traslado.
//
// Va aparte porque `db.sync()` crea tablas que faltan pero nunca agrega columnas a una
// que ya existe.
//
// Nullable: no todo traslado tiene referencia —de un cajón a otro no hay nada que
// referenciar— y los que ya están registrados no la tenían, así que quedan en NULL. Un
// default vacío sería peor: no distinguiría "no aplica" de "todavía no se anotó".
//
//   node ./seed/migracionTrasladoReferencia.js
//   node ./seed/migracionTrasladoReferencia.js --revertir
//
// Idempotente.

const TABLA = 'TRASLADO_EFECTIVO';
const COLUMNA = 'referencia';
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols[COLUMNA]) {
            console.log(`· ${COLUMNA} no existe, nada que revertir`);
            process.exit(0);
        }
        const [{ n }] = await db.query(
            `SELECT COUNT(*) n FROM \`${TABLA}\` WHERE ${COLUMNA} IS NOT NULL`,
            { type: QueryTypes.SELECT }
        );
        if (n > 0) {
            console.error(`✗ ABORTADO: ${n} traslado(s) tienen referencia anotada.`);
            console.error('  Borrar la columna perdería ese dato sin forma de recuperarlo.');
            process.exit(1);
        }
        await db.query(`ALTER TABLE \`${TABLA}\` DROP COLUMN ${COLUMNA}`);
        console.log(`✓ ${COLUMNA} eliminada`);
        process.exit(0);
    }

    if (cols[COLUMNA]) {
        console.log(`· ${COLUMNA} ya existe, se omite`);
    } else {
        // AFTER idMovimiento: la columna queda donde se pidió y no al final de la tabla.
        await db.query(
            `ALTER TABLE \`${TABLA}\` ADD COLUMN ${COLUMNA} VARCHAR(50) NULL AFTER idMovimiento`
        );
        console.log(`✓ ${COLUMNA} VARCHAR(50) NULL agregada después de idMovimiento`);
    }

    const orden = await db.query(`SHOW COLUMNS FROM \`${TABLA}\``, { type: QueryTypes.SELECT });
    console.log('\nColumnas de la tabla:');
    orden.forEach(c => console.log(`   ${c.Field.padEnd(22)}${String(c.Type).padEnd(38)}${c.Null === 'YES' ? 'NULL' : 'NOT NULL'}`));

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
