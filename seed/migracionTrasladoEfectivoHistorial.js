import dotenv from 'dotenv';
import db from '../config/bd.js';
import { TrasladoEfectivoHistorial } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea TRASLADO_EFECTIVO_HISTORIAL y la sella como append-only.
//
// Los hooks del modelo solo protegen lo que pasa por Sequelize. Los triggers protegen
// la tabla frente a cualquier cliente. Una bitácora de dinero editable no es evidencia
// de nada.
//
//   node ./seed/migracionTrasladoEfectivoHistorial.js
//   node ./seed/migracionTrasladoEfectivoHistorial.js --revertir

const TABLA = 'TRASLADO_EFECTIVO_HISTORIAL';
const CHECK_VALOR = 'chk_tras_hist_valor_positivo';
const TRIGGERS = [`${TABLA}_sin_update`, `${TABLA}_sin_delete`];
const MENSAJE = 'TRASLADO_EFECTIVO_HISTORIAL es append-only: un paso no se edita ni se elimina.';
const REVERTIR = process.argv.includes('--revertir');

const existeTabla = async () => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT });
    return r.n > 0;
};

const triggersExistentes = async () => {
    const f = await db.query(
        `SELECT TRIGGER_NAME t FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = :t`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT });
    return f.map(x => x.t);
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        for (const tg of await triggersExistentes()) {
            await db.query(`DROP TRIGGER IF EXISTS \`${tg}\``);
            console.log(`✓ trigger ${tg} eliminado`);
        }
        if (await existeTabla()) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA} tiene ${n} paso(s) registrado(s). Es una bitácora contable.`);
                process.exit(1);
            }
            await db.query(`DROP TABLE ${TABLA}`);
            console.log(`✓ ${TABLA} eliminada`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (await existeTabla()) {
        console.log(`· ${TABLA} ya existe, se omite`);
    } else {
        await TrasladoEfectivoHistorial.sync();
        console.log(`✓ ${TABLA} creada`);
    }

    const [{ hay }] = await db.query(
        `SELECT COUNT(*) hay FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND CONSTRAINT_NAME = :c`,
        { replacements: { t: TABLA, c: CHECK_VALOR }, type: QueryTypes.SELECT });
    if (hay) {
        console.log(`· CHECK ${CHECK_VALOR} ya existe, se omite`);
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD CONSTRAINT \`${CHECK_VALOR}\` CHECK (valorTransaccion > 0)`);
        console.log(`✓ CHECK ${CHECK_VALOR} creado (valorTransaccion > 0)`);
    }

    const yaHay = await triggersExistentes();
    for (const [i, ev] of ['UPDATE', 'DELETE'].entries()) {
        if (yaHay.includes(TRIGGERS[i])) {
            console.log(`· trigger ${TRIGGERS[i]} ya existe, se omite`);
        } else {
            await db.query(`
                CREATE TRIGGER \`${TRIGGERS[i]}\`
                BEFORE ${ev} ON \`${TABLA}\`
                FOR EACH ROW
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${MENSAJE}'
            `);
            console.log(`✓ trigger ${TRIGGERS[i]} creado (bloquea ${ev})`);
        }
    }

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    cols.forEach(c => console.log(`   ${c.Field.padEnd(22)}${String(c.Type).padEnd(56)}null:${c.Null}  key:${c.Key || '-'}`));

    const fks = await db.query(
        `SELECT COLUMN_NAME c, REFERENCED_TABLE_NAME rt FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND REFERENCED_TABLE_NAME IS NOT NULL`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT });
    console.log('\nClaves foráneas:');
    fks.forEach(f => console.log(`   ${f.c.padEnd(22)}→ ${f.rt}`));

    console.log('\nMigración completada. La bitácora es append-only a nivel de base de datos.');
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
