import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// CLIENTES_TRIBUTARIO.responsabilidad_fiscal — los códigos de responsabilidad de la DIAN.
//
// La factura electrónica exige declarar la responsabilidad fiscal del adquiriente con los
// códigos del anexo técnico: O-13 gran contribuyente, O-15 autorretenedor, O-23 agente de
// retención de IVA, O-47 régimen simple de tributación, R-99-PN "no aplica".
//
// No se derivan de los booleanos que ya existen aunque se parezcan. `gran_contribuyente` y
// O-13 no son lo mismo: uno es una casilla del formulario de la tienda y el otro es una
// afirmación tributaria que la DIAN valida contra el RUT. Deducir un código fiscal de una
// casilla sería inventar un dato que después se factura.
//
// Varias responsabilidades pueden aplicar a la vez, así que se guardan separadas por coma:
// "O-13,O-15". El campo admite nulo — un cliente cargado antes de esto no declaró ninguna,
// y eso es distinto de haber declarado que no aplica.
//
//   node ./seed/migracionResponsabilidadFiscal.js            (muestra qué haría)
//   node ./seed/migracionResponsabilidadFiscal.js --aplicar
//   node ./seed/migracionResponsabilidadFiscal.js --revertir
//
// Idempotente.

const TABLA   = 'CLIENTES_TRIBUTARIO';
const COLUMNA = 'responsabilidad_fiscal';
const APLICAR  = process.argv.includes('--aplicar');
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols[COLUMNA]) { console.log(`· ${COLUMNA} no existe, nada que revertir`); process.exit(0); }
        const [{ n }] = await db.query(
            `SELECT COUNT(*) n FROM \`${TABLA}\` WHERE ${COLUMNA} IS NOT NULL AND ${COLUMNA} <> ''`,
            { type: QueryTypes.SELECT }
        );
        if (n > 0) {
            console.error(`✗ ABORTADO: ${n} cliente(s) tienen responsabilidades declaradas.`);
            console.error('  Eliminar la columna borraría un dato que se usa para facturar.');
            process.exit(1);
        }
        await db.query(`ALTER TABLE \`${TABLA}\` DROP COLUMN ${COLUMNA}`);
        console.log(`✓ ${COLUMNA} eliminada`);
        process.exit(0);
    }

    const [{ total }] = await db.query(`SELECT COUNT(*) total FROM \`${TABLA}\``, { type: QueryTypes.SELECT });

    if (cols[COLUMNA]) {
        const [{ conDato }] = await db.query(
            `SELECT COUNT(*) conDato FROM \`${TABLA}\` WHERE ${COLUMNA} IS NOT NULL AND ${COLUMNA} <> ''`,
            { type: QueryTypes.SELECT }
        );
        console.log(`· ${TABLA}.${COLUMNA} ya existe · ${conDato} de ${total} con responsabilidades declaradas`);
        process.exit(0);
    }

    console.log(`+ ${TABLA}.${COLUMNA} VARCHAR(60) NULL, después de regimen_fiscal`);
    console.log(`  ${total} registro(s) tributarios quedan en NULL (nadie declaró todavía)`);

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/migracionResponsabilidadFiscal.js --aplicar');
        process.exit(0);
    }

    // 60 caracteres alcanzan para las cinco separadas por coma con margen. Cadena y no un
    // SET de MySQL: si la DIAN agrega un código, un SET obliga a un ALTER de la tabla.
    await db.query(
        `ALTER TABLE \`${TABLA}\` ADD COLUMN ${COLUMNA} VARCHAR(60) NULL AFTER regimen_fiscal`
    );
    console.log(`\n✓ ${COLUMNA} agregada`);
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
