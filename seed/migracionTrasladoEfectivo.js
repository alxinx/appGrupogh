import dotenv from 'dotenv';
import db from '../config/bd.js';
import { TrasladoEfectivo } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea TRASLADO_EFECTIVO: el documento de un envío de efectivo desde la caja de un
// punto de venta hacia una caja o cuenta de la empresa.
//
//   node ./seed/migracionTrasladoEfectivo.js
//   node ./seed/migracionTrasladoEfectivo.js --revertir
//
// Idempotente.

const TABLA = 'TRASLADO_EFECTIVO';
const CHECK_VALOR = 'chk_traslado_efectivo_valor_positivo';
const REVERTIR = process.argv.includes('--revertir');

const existeTabla = async () => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT }
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
        const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA}`, { type: QueryTypes.SELECT });
        if (n > 0) {
            console.error(`✗ ABORTADO: ${TABLA} tiene ${n} traslado(s) registrado(s). Son movimientos de dinero: no se eliminan con datos adentro.`);
            process.exit(1);
        }
        await db.query(`DROP TABLE ${TABLA}`);
        console.log(`✓ ${TABLA} eliminada`);
        process.exit(0);
    }

    if (await existeTabla()) {
        console.log(`· ${TABLA} ya existe, se omite`);
    } else {
        await TrasladoEfectivo.sync();
        console.log(`✓ ${TABLA} creada`);
    }

    // Igual que en los movimientos: el validador de Sequelize no protege un INSERT
    // hecho desde fuera de la aplicación. La garantía va en la base.
    const [{ hay }] = await db.query(
        `SELECT COUNT(*) hay FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND CONSTRAINT_NAME = :c`,
        { replacements: { t: TABLA, c: CHECK_VALOR }, type: QueryTypes.SELECT }
    );
    if (hay) {
        console.log(`· CHECK ${CHECK_VALOR} ya existe, se omite`);
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD CONSTRAINT \`${CHECK_VALOR}\` CHECK (valorTraslado > 0)`);
        console.log(`✓ CHECK ${CHECK_VALOR} creado (valorTraslado > 0)`);
    }

    // Normaliza `estado` si la tabla venía de la primera versión (permitía NULL y tenía
    // dos valores en minúscula). Con la tabla vacía es un ALTER directo; si tuviera
    // datos habría que mapear los valores viejos antes.
    const [col] = await db.query(
        `SELECT COLUMN_TYPE ct, IS_NULLABLE nu FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = 'estado'`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT }
    );
    const ESTADO_OK = "enum('Recibido','En Transito','Controversia','Rechazado')";
    if (col && (col.ct !== ESTADO_OK || col.nu === 'YES')) {
        const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA} WHERE estado IS NULL`, { type: QueryTypes.SELECT });
        if (n > 0) await db.query(`UPDATE ${TABLA} SET estado = 'En Transito' WHERE estado IS NULL`);
        await db.query(
            `ALTER TABLE \`${TABLA}\` MODIFY COLUMN estado
             ENUM('Recibido','En Transito','Controversia','Rechazado') NOT NULL DEFAULT 'En Transito'`
        );
        console.log(`✓ estado normalizado: NOT NULL, default 'En Transito', valores capitalizados${n ? ` (${n} fila(s) sin estado corregida(s))` : ''}`);
    } else {
        console.log('· estado ya está normalizado, se omite');
    }

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    cols.forEach(c => console.log(`   ${c.Field.padEnd(22)}${String(c.Type).padEnd(52)}null:${c.Null}  key:${c.Key || '-'}`));

    const fks = await db.query(
        `SELECT COLUMN_NAME c, REFERENCED_TABLE_NAME rt, REFERENCED_COLUMN_NAME rc
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND REFERENCED_TABLE_NAME IS NOT NULL`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT }
    );
    console.log('\nClaves foráneas:');
    fks.forEach(f => console.log(`   ${f.c.padEnd(22)}→ ${f.rt}.${f.rc}`));

    const idx = await db.query(`SHOW INDEX FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nÍndices:');
    [...new Set(idx.map(i => i.Key_name))].forEach(n =>
        console.log(`   ${n.padEnd(34)}(${idx.filter(i => i.Key_name === n).map(i => i.Column_name).join(', ')})${idx.find(i => i.Key_name === n).Non_unique === 0 ? '  UNIQUE' : ''}`));

    console.log('\nMigración completada.');
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
