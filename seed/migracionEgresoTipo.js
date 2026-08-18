import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// EGRESOS.tipo — separa un gasto real de un traslado de efectivo a caja o banco.
//
// Todo lo que ya existe queda como 'Egreso': es lo que el sistema asumía cuando esos
// registros se crearon, así que la historia no cambia de significado.
//
//   node ./seed/migracionEgresoTipo.js
//   node ./seed/migracionEgresoTipo.js --revertir

const TABLA = 'EGRESOS';
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols.tipo) { console.log('· tipo no existe, nada que revertir'); process.exit(0); }
        const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA} WHERE tipo = 'Traslado'`, { type: QueryTypes.SELECT });
        await db.getQueryInterface().removeColumn(TABLA, 'tipo');
        console.log(`✓ tipo eliminada (${n} traslado(s) vuelven a contarse como gasto)`);
        process.exit(0);
    }

    if (cols.tipo) {
        console.log('· tipo ya existe, se omite');
    } else {
        // AFTER estado: la columna queda donde se pidió, no al final de la tabla.
        await db.query(
            `ALTER TABLE \`${TABLA}\` ADD COLUMN tipo ENUM('Egreso','Traslado') NOT NULL DEFAULT 'Egreso' AFTER estado`
        );
        console.log("✓ tipo agregada después de estado (los egresos existentes quedan como 'Egreso')");
    }

    const orden = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nOrden de columnas:');
    orden.forEach(c => console.log(`   ${c.Field.padEnd(16)}${c.Type}`));
    const [{ eg }] = await db.query(`SELECT COUNT(*) eg FROM ${TABLA} WHERE tipo = 'Egreso'`, { type: QueryTypes.SELECT });
    console.log(`\n${eg} registro(s) marcados como Egreso.`);
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
