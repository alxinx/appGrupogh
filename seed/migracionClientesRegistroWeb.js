import dotenv from 'dotenv';
import db from '../config/bd.js';
import { ClientesRegistroWeb } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea CLIENTES_REGISTRO_WEB —la constancia de cada cliente que se registró solo desde
// grupogh.co/formularios/registroClientes— y la sella como append-only.
//
// Es la prueba de la autorización de tratamiento de datos (Ley 1581): quién, cuándo,
// desde qué IP y sobre qué versión del texto. Una constancia editable no prueba nada, así
// que los triggers bloquean UPDATE y DELETE para cualquier cliente de la base, no solo
// para Sequelize.
//
//   npm run db:migrar-registro-web
//   npm run db:migrar-registro-web -- --sin-sellar   (solo la tabla, sin triggers)
//   npm run db:migrar-registro-web -- --revertir     (solo si la tabla está vacía)

const TABLA = 'CLIENTES_REGISTRO_WEB';
const TRIGGERS = [`${TABLA}_sin_update`, `${TABLA}_sin_delete`];
const MENSAJE = 'CLIENTES_REGISTRO_WEB es append-only: una constancia de autorización no se edita ni se elimina.';
const REVERTIR = process.argv.includes('--revertir');
const SIN_SELLAR = process.argv.includes('--sin-sellar');

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
        if (await existeTabla()) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA} tiene ${n} constancia(s). Son evidencia de autorizaciones de datos.`);
                process.exit(1);
            }
        }
        for (const tg of await triggersExistentes()) {
            await db.query(`DROP TRIGGER IF EXISTS \`${tg}\``);
            console.log(`✓ trigger ${tg} eliminado`);
        }
        if (await existeTabla()) {
            await db.query(`DROP TABLE ${TABLA}`);
            console.log(`✓ ${TABLA} eliminada`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (await existeTabla()) {
        console.log(`· ${TABLA} ya existe, se omite`);
    } else {
        await ClientesRegistroWeb.sync();
        console.log(`✓ ${TABLA} creada`);
    }

    if (SIN_SELLAR) {
        console.log('\n--sin-sellar: la tabla queda SIN triggers. No usar así en producción.');
        process.exit(0);
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
    cols.forEach(c => console.log(`   ${c.Field.padEnd(24)}${String(c.Type).padEnd(20)}null:${c.Null}  key:${c.Key || '-'}`));

    console.log('\nMigración completada. La constancia es append-only a nivel de base de datos.');
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
