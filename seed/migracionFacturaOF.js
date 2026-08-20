import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// FACTURA_CLIENTES.OF — la factura fue marcada como OF por el punto de venta.
//
// Las facturas marcadas salen en su propia hoja del informe de facturación de la tienda,
// con los datos tributarios del cliente abiertos en columnas: régimen, condiciones DIAN,
// CIIU, RUT y ubicación. Esa hoja es la que se entrega a quien la pide, así que necesita
// el dato completo y no el resumen de una línea.
//
// Booleano y no un ENUM: la factura está marcada o no está. Un tercer estado no existe.
//
// Todas las facturas anteriores quedan en 0, que es lo que fueron: nunca se marcaron.
//
//   node ./seed/migracionFacturaOF.js            (muestra qué haría)
//   node ./seed/migracionFacturaOF.js --aplicar
//   node ./seed/migracionFacturaOF.js --revertir
//
// Idempotente.

const TABLA   = 'FACTURA_CLIENTES';
const COLUMNA = 'OF';
const APLICAR  = process.argv.includes('--aplicar');
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols[COLUMNA]) { console.log(`· ${COLUMNA} no existe, nada que revertir`); process.exit(0); }
        const [{ n }] = await db.query(
            `SELECT COUNT(*) n FROM \`${TABLA}\` WHERE \`${COLUMNA}\` = 1`, { type: QueryTypes.SELECT }
        );
        if (n > 0) {
            console.error(`✗ ABORTADO: ${n} factura(s) están marcadas como OF.`);
            console.error('  Eliminar la columna borraría esa marca sin dejar rastro de cuáles eran.');
            process.exit(1);
        }
        await db.query(`ALTER TABLE \`${TABLA}\` DROP COLUMN \`${COLUMNA}\``);
        console.log(`✓ ${COLUMNA} eliminada`);
        process.exit(0);
    }

    const [{ total }] = await db.query(`SELECT COUNT(*) total FROM \`${TABLA}\``, { type: QueryTypes.SELECT });

    if (cols[COLUMNA]) {
        const [{ marcadas }] = await db.query(
            `SELECT COUNT(*) marcadas FROM \`${TABLA}\` WHERE \`${COLUMNA}\` = 1`, { type: QueryTypes.SELECT }
        );
        console.log(`· ${TABLA}.${COLUMNA} ya existe · ${marcadas} de ${total} facturas marcadas`);
        process.exit(0);
    }

    console.log(`+ ${TABLA}.${COLUMNA} TINYINT(1) NOT NULL DEFAULT 0, después de 'estado'`);
    console.log(`  ${total} factura(s) existentes quedan en 0`);

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/migracionFacturaOF.js --aplicar');
        process.exit(0);
    }

    // TINYINT(1) es lo que Sequelize entiende como BOOLEAN en MySQL. NOT NULL con default
    // 0: una factura sin marcar es 0, no un nulo que después hay que interpretar en cada
    // consulta.
    await db.query(
        `ALTER TABLE \`${TABLA}\` ADD COLUMN \`${COLUMNA}\` TINYINT(1) NOT NULL DEFAULT 0 AFTER estado`
    );
    console.log(`\n✓ ${COLUMNA} agregada`);

    // Índice para la hoja del informe: filtra por tienda, fecha y esta marca. Sin él, la
    // consulta de la hoja OF recorre todas las facturas de la tienda.
    const idx = 'idx_factura_of';
    const [ya] = await db.query(
        `SELECT INDEX_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i LIMIT 1`,
        { replacements: { t: TABLA, i: idx }, type: QueryTypes.SELECT }
    );
    if (!ya) {
        await db.query(`CREATE INDEX ${idx} ON \`${TABLA}\` (idPuntoDeVenta, \`${COLUMNA}\`, fechaEmision)`);
        console.log(`✓ índice ${idx} (idPuntoDeVenta, ${COLUMNA}, fechaEmision)`);
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
