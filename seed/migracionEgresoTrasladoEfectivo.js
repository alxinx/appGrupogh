import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// EGRESOS.idTrasladoEfectivo — une el egreso que descuenta el cajón con el documento
// del traslado que viaja hasta que alguien lo acepta.
//
// Son dos hechos distintos sobre la misma plata: el egreso es lo que el cuadre de caja
// resta del cajón hoy; TRASLADO_EFECTIVO es el documento con su código, su estado y su
// bitácora. Sin esta columna no hay forma de saber qué egreso corresponde a qué traslado
// cuando el responsable de la cuenta destino lo rechaza.
//
// La migración además reporta los traslados viejos que quedaron guardados como
// `metodoPago = 'Electronico'`. Ésos NO descuentan el efectivo del cajón —el cuadre solo
// resta los egresos en efectivo—, así que la misma plata se podía consignar varias
// veces. Se corrigen solo si se pide con --corregir-metodo, porque cambia el efectivo
// esperado de cuadres que quizá ya se cerraron.
//
//   node ./seed/migracionEgresoTrasladoEfectivo.js
//   node ./seed/migracionEgresoTrasladoEfectivo.js --corregir-metodo
//   node ./seed/migracionEgresoTrasladoEfectivo.js --revertir
//
// Idempotente.

const TABLA = 'EGRESOS';
const COLUMNA = 'idTrasladoEfectivo';
const FK = 'fk_egresos_traslado_efectivo';
const INDICE = 'idx_egresos_traslado';

const REVERTIR = process.argv.includes('--revertir');
const CORREGIR = process.argv.includes('--corregir-metodo');

const existeIndice = async (nombre) => {
    const filas = await db.query(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i LIMIT 1`,
        { replacements: { t: TABLA, i: nombre }, type: QueryTypes.SELECT }
    );
    return filas.length > 0;
};

const existeFK = async (nombre) => {
    const filas = await db.query(
        `SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND CONSTRAINT_NAME = :k LIMIT 1`,
        { replacements: { t: TABLA, k: nombre }, type: QueryTypes.SELECT }
    );
    return filas.length > 0;
};

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (await existeFK(FK)) {
            await db.query(`ALTER TABLE \`${TABLA}\` DROP FOREIGN KEY \`${FK}\``);
            console.log(`✓ FK ${FK} eliminada`);
        }
        if (await existeIndice(INDICE)) {
            await db.query(`DROP INDEX \`${INDICE}\` ON \`${TABLA}\``);
            console.log(`✓ ${INDICE} eliminado`);
        }
        if (cols[COLUMNA]) {
            const [{ n }] = await db.query(
                `SELECT COUNT(*) n FROM \`${TABLA}\` WHERE ${COLUMNA} IS NOT NULL`, { type: QueryTypes.SELECT }
            );
            if (n > 0) {
                console.error(`✗ ABORTADO: ${n} egreso(s) están unidos a un traslado.`);
                console.error('  Borrar la columna dejaría esos traslados sin saber qué egreso los respalda.');
                process.exit(1);
            }
            await db.query(`ALTER TABLE \`${TABLA}\` DROP COLUMN ${COLUMNA}`);
            console.log(`✓ ${COLUMNA} eliminada`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    // La collation tiene que declararse igual que la de la columna referenciada o MySQL
    // rechaza la FK: Sequelize crea los UUID con utf8mb4_bin y el default de la tabla es
    // utf8mb4_0900_ai_ci.
    const TIPO = 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL';

    if (cols[COLUMNA]) {
        console.log(`· ${COLUMNA} ya existe, se omite`);
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD COLUMN ${COLUMNA} ${TIPO} AFTER idCajaBanco`);
        console.log(`✓ ${COLUMNA} agregada después de idCajaBanco`);
    }

    if (await existeIndice(INDICE)) {
        console.log(`· ${INDICE} ya existe, se omite`);
    } else {
        await db.query(`CREATE INDEX \`${INDICE}\` ON \`${TABLA}\` (${COLUMNA})`);
        console.log(`✓ ${INDICE} creado`);
    }

    if (await existeFK(FK)) {
        console.log(`· FK ${FK} ya existe, se omite`);
    } else {
        // RESTRICT y no CASCADE: borrar el documento del traslado no puede llevarse por
        // delante el egreso, que es lo que respalda el cuadre de una caja ya cerrada.
        await db.query(
            `ALTER TABLE \`${TABLA}\` ADD CONSTRAINT \`${FK}\`
             FOREIGN KEY (${COLUMNA}) REFERENCES \`TRASLADO_EFECTIVO\`(idTrasladosEfectivo)
             ON DELETE RESTRICT ON UPDATE CASCADE`
        );
        console.log(`✓ FK ${FK} creada`);
    }

    // ── Traslados viejos guardados como electrónicos ─────────────────────────
    const [{ n }] = await db.query(
        `SELECT COUNT(*) n FROM \`${TABLA}\`
         WHERE tipo = 'Traslado' AND metodoPago = 'Electronico'`,
        { type: QueryTypes.SELECT }
    );

    if (!n) {
        console.log('\n· No hay traslados guardados como electrónicos.');
    } else if (CORREGIR) {
        const [, meta] = await db.query(
            `UPDATE \`${TABLA}\` SET metodoPago = 'Efectivo'
             WHERE tipo = 'Traslado' AND metodoPago = 'Electronico'`
        );
        console.log(`\n✓ ${meta?.affectedRows ?? n} traslado(s) pasados a 'Efectivo'.`);
        console.log('  El efectivo esperado de los cuadres que los incluyan baja por ese monto.');
    } else {
        console.log(`\n⚠ ${n} traslado(s) figuran como 'Electronico'.`);
        console.log('  El cuadre solo resta del cajón los egresos en efectivo, así que esa plata');
        console.log('  sigue contando como presente aunque ya se haya consignado.');
        console.log('  Para corregirlos: node ./seed/migracionEgresoTrasladoEfectivo.js --corregir-metodo');
        console.log('  (revisá antes si los cuadres afectados ya se cerraron.)');
    }

    const orden = await db.query(`SHOW COLUMNS FROM \`${TABLA}\``, { type: QueryTypes.SELECT });
    console.log('\nColumnas de la tabla:');
    orden.forEach(c => console.log(`   ${c.Field.padEnd(22)}${c.Type}`));

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
