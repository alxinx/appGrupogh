import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Deja el egreso de cada traslado en el valor que el negocio REALMENTE recibió.
//
// Cuando un traslado queda en controversia, a destino llegó menos de lo que el punto de
// venta reportó haber enviado. Esa diferencia vuelve a ser responsabilidad del punto de
// venta, así que el egreso —lo que salió del negocio— tiene que valer lo aceptado, no lo
// despachado. El faltante que eso produce en el cuadre de esa caja es intencional: es la
// plata por la que el punto de venta tiene que responder.
//
// El valor aceptado se toma del MOVIMIENTO que se asentó en la cuenta destino, que es el
// único registro de cuánto entró de verdad. Un traslado rechazado no tiene movimiento y
// su egreso debe quedar en cero.
//
// Solo toca traslados en 'Controversia' o 'Rechazado' cuyo egreso no coincide. Los
// 'Recibido' ya coinciden por definición y no se tocan.
//
//   node ./seed/migracionSincronizarEgresoControversia.js            (muestra qué haría)
//   node ./seed/migracionSincronizarEgresoControversia.js --aplicar
//
// Idempotente.

const APLICAR = process.argv.includes('--aplicar');
const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;

const run = async () => {
    await db.authenticate();

    const filas = await db.query(
        `SELECT e.idEgreso, e.valorEgreso, e.estado AS estadoEgreso,
                t.codigoTraslado, t.valorTraslado, t.estado AS estadoTraslado,
                COALESCE(m.valor, 0) AS recibido,
                c.codigo AS codigoCaja, c.estado AS estadoCaja
         FROM EGRESOS e
         JOIN TRASLADO_EFECTIVO t ON t.idTrasladosEfectivo = e.idTrasladoEfectivo
         LEFT JOIN MOVIMIENTOS_CAJAS_BANCOS m ON m.idMovimiento = t.idMovimiento
         LEFT JOIN CAJA_TIENDA c ON c.idCajaTienda = e.idCajaTienda
         WHERE t.estado IN ('Controversia', 'Rechazado')
           AND e.valorEgreso <> COALESCE(m.valor, 0)
         ORDER BY e.idEgreso`,
        { type: QueryTypes.SELECT }
    );

    if (!filas.length) {
        console.log('· Todos los egresos ya coinciden con lo recibido. Nada que hacer.');
        process.exit(0);
    }

    console.log(`${filas.length} egreso(s) fuera de sincronía:\n`);
    let totalACargoDelPV = 0;
    for (const f of filas) {
        const aCargo = Number(f.valorTraslado) - Number(f.recibido);
        totalACargoDelPV += aCargo;
        console.log(`   egreso ${String(f.idEgreso).padStart(3)} · ${f.codigoTraslado} (${f.estadoTraslado})`);
        console.log(`      caja ${f.codigoCaja || '—'} (${f.estadoCaja || '—'}) · egreso ${f.estadoEgreso}`);
        console.log(`      despachado ${pesos(f.valorTraslado)} · recibido ${pesos(f.recibido)}`);
        console.log(`      egreso ${pesos(f.valorEgreso)} → ${pesos(f.recibido)}   (deja ${pesos(aCargo)} a cargo del punto de venta)`);
    }
    console.log(`\nEl efectivo esperado de esas cajas sube en ${pesos(totalACargoDelPV)}: ese es el faltante que el punto de venta debe responder.`);

    const cerrados = filas.filter(f => f.estadoEgreso === 'liquidada');
    if (cerrados.length) {
        console.log(`\n⚠ ${cerrados.length} de ellos están en cuadres YA CERRADOS. Corregirlos cambia el efectivo esperado de esos cierres.`);
    }

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/migracionSincronizarEgresoControversia.js --aplicar');
        process.exit(0);
    }

    await db.transaction(async (t) => {
        for (const f of filas) {
            await db.query(
                `UPDATE EGRESOS SET valorEgreso = :v WHERE idEgreso = :id`,
                { replacements: { v: f.recibido, id: f.idEgreso }, transaction: t }
            );
        }
    });

    console.log(`\n✓ ${filas.length} egreso(s) sincronizados con lo recibido.`);
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
