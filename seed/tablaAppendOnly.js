import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

// Crea una tabla de constancias y la sella como append-only con dos triggers que bloquean
// UPDATE y DELETE para cualquier cliente de la base, no solo para Sequelize. Una constancia
// editable no prueba nada.
//
// La comparten las constancias de los registros web (clientes y proveedores). Cada
// migración solo dice qué tabla y con qué mensaje; las banderas son las mismas:
//   --sin-sellar   solo la tabla, sin triggers (nunca en producción)
//   --revertir     borra triggers y tabla, solo si la tabla está vacía
export async function migrarTablaAppendOnly({ modelo, tabla, mensaje, argv = process.argv }) {
    const revertir  = argv.includes('--revertir');
    const sinSellar = argv.includes('--sin-sellar');
    const triggers  = [`${tabla}_sin_update`, `${tabla}_sin_delete`];

    const existeTabla = async () => {
        const [r] = await db.query(
            `SELECT COUNT(*) n FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
            { replacements: { t: tabla }, type: QueryTypes.SELECT });
        return r.n > 0;
    };
    const triggersExistentes = async () => {
        const f = await db.query(
            `SELECT TRIGGER_NAME t FROM information_schema.TRIGGERS
             WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = :t`,
            { replacements: { t: tabla }, type: QueryTypes.SELECT });
        return f.map(x => x.t);
    };

    await db.authenticate();

    if (revertir) {
        if (await existeTabla()) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${tabla}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${tabla} tiene ${n} constancia(s). Son evidencia de autorizaciones de datos.`);
                return 1;
            }
        }
        for (const tg of await triggersExistentes()) {
            await db.query(`DROP TRIGGER IF EXISTS \`${tg}\``);
            console.log(`✓ trigger ${tg} eliminado`);
        }
        if (await existeTabla()) {
            await db.query(`DROP TABLE ${tabla}`);
            console.log(`✓ ${tabla} eliminada`);
        }
        console.log('\nReversión completada.');
        return 0;
    }

    if (await existeTabla()) {
        console.log(`· ${tabla} ya existe, se omite`);
    } else {
        await modelo.sync();
        console.log(`✓ ${tabla} creada`);
    }

    if (sinSellar) {
        console.log('\n--sin-sellar: la tabla queda SIN triggers. No usar así en producción.');
        return 0;
    }

    const yaHay = await triggersExistentes();
    for (const [i, ev] of ['UPDATE', 'DELETE'].entries()) {
        if (yaHay.includes(triggers[i])) {
            console.log(`· trigger ${triggers[i]} ya existe, se omite`);
        } else {
            await db.query(`
                CREATE TRIGGER \`${triggers[i]}\`
                BEFORE ${ev} ON \`${tabla}\`
                FOR EACH ROW
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${mensaje}'
            `);
            console.log(`✓ trigger ${triggers[i]} creado (bloquea ${ev})`);
        }
    }

    const cols = await db.query(`SHOW COLUMNS FROM ${tabla}`, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    cols.forEach(c => console.log(`   ${c.Field.padEnd(24)}${String(c.Type).padEnd(20)}null:${c.Null}  key:${c.Key || '-'}`));
    console.log('\nMigración completada. La constancia es append-only a nivel de base de datos.');
    return 0;
}

/** Corre la migración y termina el proceso con su código. */
export const correrMigracion = (opciones) =>
    migrarTablaAppendOnly(opciones)
        .then(codigo => process.exit(codigo))
        .catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
