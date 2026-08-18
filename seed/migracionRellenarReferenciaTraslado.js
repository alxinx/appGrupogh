import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Rellena TRASLADO_EFECTIVO.referencia con la del egreso que lo respalda.
//
// La columna se agregó después de que ya existieran traslados, y `crearTrasladoEfectivo`
// empezó a escribirla todavía más tarde. Los traslados de ese intervalo quedaron en NULL
// aunque el operador SÍ había escrito la referencia: el egreso la venía guardando desde
// siempre, así que el dato está, solo que en la otra tabla.
//
// Solo toca las filas donde el traslado no tiene referencia y su egreso sí. Nunca pisa
// una referencia ya escrita —si las dos difieren, la del traslado es la buena, porque es
// la que se escribió con el traslado en mente— y nunca inventa una donde no había.
//
//   node ./seed/migracionRellenarReferenciaTraslado.js            (muestra qué haría)
//   node ./seed/migracionRellenarReferenciaTraslado.js --aplicar
//
// Idempotente: correrla dos veces no cambia nada la segunda vez.

const APLICAR = process.argv.includes('--aplicar');

const run = async () => {
    await db.authenticate();

    const cols = await db.getQueryInterface().describeTable('TRASLADO_EFECTIVO');
    if (!cols.referencia) {
        console.error('✗ TRASLADO_EFECTIVO.referencia no existe todavía.');
        console.error('  Corré antes: npm run db:migrar-traslado-referencia');
        process.exit(1);
    }

    const pendientes = await db.query(
        `SELECT t.idTrasladosEfectivo AS id, t.codigoTraslado AS codigo, e.referencia AS ref
         FROM TRASLADO_EFECTIVO t
         JOIN EGRESOS e ON e.idTrasladoEfectivo = t.idTrasladosEfectivo
         WHERE t.referencia IS NULL AND e.referencia IS NOT NULL AND e.referencia <> ''
         ORDER BY t.createdAt ASC`,
        { type: QueryTypes.SELECT }
    );

    if (!pendientes.length) {
        console.log('· No hay traslados con referencia recuperable. Nada que hacer.');
        process.exit(0);
    }

    console.log(`${pendientes.length} traslado(s) con referencia recuperable desde su egreso:\n`);
    pendientes.forEach(p => console.log(`   ${String(p.codigo).padEnd(22)} → "${p.ref}"`));

    if (!APLICAR) {
        console.log('\n(simulación) Para escribirlos:');
        console.log('   node ./seed/migracionRellenarReferenciaTraslado.js --aplicar');
        process.exit(0);
    }

    // Una transacción para las tres: o quedan todas o ninguna. Son pocas filas, pero es
    // el mismo criterio que el resto de las escrituras sobre datos de dinero.
    await db.transaction(async (t) => {
        for (const p of pendientes) {
            await db.query(
                `UPDATE TRASLADO_EFECTIVO SET referencia = :ref
                 WHERE idTrasladosEfectivo = :id AND referencia IS NULL`,
                { replacements: { ref: String(p.ref).slice(0, 50), id: p.id }, transaction: t }
            );
        }
    });

    console.log(`\n✓ ${pendientes.length} referencia(s) copiadas al traslado.`);

    const quedan = await db.query(
        `SELECT COUNT(*) n FROM TRASLADO_EFECTIVO WHERE referencia IS NULL`,
        { type: QueryTypes.SELECT }
    );
    console.log(`· Traslados que siguen sin referencia: ${quedan[0].n} (los de caja a caja no llevan).`);

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
