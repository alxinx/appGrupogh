import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// CAJA_TIENDA.idEmpleadoCierre pasa a admitir NULL.
//
// El campo era NOT NULL y la apertura lo llenaba con el mismo empleado que abría, como
// relleno hasta el cierre real. Con eso el campo no distinguía "todavía no cerró" de
// "cerró esta persona": toda caja abierta aparecía con un responsable de cierre que no
// había cerrado nada. Mismo criterio que `idEmpleadoRecibe` en un traslado en tránsito,
// que es nulo mientras viaja.
//
// La migración hace dos cosas:
//   1. Afloja la columna a NULL (`db.sync()` no altera tablas existentes).
//   2. Limpia el relleno de las cajas que siguen ABIERTAS. Ese valor no es un dato, es
//      ruido que se puso para satisfacer la restricción.
//
// Las cajas CERRADAS no se tocan: ahí el valor lo escribió `cerrarCajaAPI` y es real.
//
//   node ./seed/migracionCajaCierreNullable.js            (muestra qué haría)
//   node ./seed/migracionCajaCierreNullable.js --aplicar
//   node ./seed/migracionCajaCierreNullable.js --revertir
//
// Idempotente.

const TABLA = 'CAJA_TIENDA';
const COLUMNA = 'idEmpleadoCierre';
const APLICAR  = process.argv.includes('--aplicar');
const REVERTIR = process.argv.includes('--revertir');

// La collation tiene que declararse igual que la de la columna referenciada o MySQL
// rechaza el ALTER: Sequelize crea los UUID con utf8mb4_bin.
const TIPO = 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin';

const abiertasConRelleno = () => db.query(
    `SELECT idCajaTienda, codigo, estado FROM \`${TABLA}\`
     WHERE fechaCierre IS NULL AND ${COLUMNA} IS NOT NULL
     ORDER BY fechaApertura DESC`,
    { type: QueryTypes.SELECT }
);

const run = async () => {
    await db.authenticate();

    const [col] = await db.query(
        `SELECT IS_NULLABLE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: TABLA, c: COLUMNA }, type: QueryTypes.SELECT }
    );
    if (!col) { console.error(`✗ ${TABLA}.${COLUMNA} no existe.`); process.exit(1); }

    if (REVERTIR) {
        const [{ n }] = await db.query(
            `SELECT COUNT(*) n FROM \`${TABLA}\` WHERE ${COLUMNA} IS NULL`, { type: QueryTypes.SELECT }
        );
        if (n > 0) {
            console.error(`✗ ABORTADO: ${n} caja(s) tienen ${COLUMNA} en NULL.`);
            console.error('  Volver a NOT NULL exige inventarles un responsable de cierre que no existe.');
            process.exit(1);
        }
        await db.query(`ALTER TABLE \`${TABLA}\` MODIFY ${COLUMNA} ${TIPO} NOT NULL`);
        console.log(`✓ ${COLUMNA} vuelve a NOT NULL`);
        process.exit(0);
    }

    const pendientes = await abiertasConRelleno();

    console.log(`Columna ${TABLA}.${COLUMNA}: hoy es ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}`);
    if (pendientes.length) {
        console.log(`\n${pendientes.length} caja(s) abiertas con relleno por limpiar:`);
        pendientes.forEach(c => console.log(`   ${c.codigo} (${c.estado})`));
    } else {
        console.log('\n· Ninguna caja abierta tiene relleno por limpiar.');
    }

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/migracionCajaCierreNullable.js --aplicar');
        process.exit(0);
    }

    if (col.IS_NULLABLE === 'YES') {
        console.log(`\n· ${COLUMNA} ya admite NULL, se omite el ALTER`);
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` MODIFY ${COLUMNA} ${TIPO} NULL`);
        console.log(`\n✓ ${COLUMNA} ahora admite NULL`);
    }

    if (pendientes.length) {
        const [, meta] = await db.query(
            `UPDATE \`${TABLA}\` SET ${COLUMNA} = NULL WHERE fechaCierre IS NULL AND ${COLUMNA} IS NOT NULL`
        );
        console.log(`✓ ${meta?.affectedRows ?? pendientes.length} caja(s) abiertas quedaron sin responsable de cierre.`);
    }

    const [resumen] = await db.query(
        `SELECT SUM(fechaCierre IS NULL) abiertas,
                SUM(fechaCierre IS NULL AND ${COLUMNA} IS NULL) abiertasLimpias,
                SUM(fechaCierre IS NOT NULL AND ${COLUMNA} IS NOT NULL) cerradasConResponsable
         FROM \`${TABLA}\``,
        { type: QueryTypes.SELECT }
    );
    console.log(`\nAbiertas: ${resumen.abiertas} (sin responsable de cierre: ${resumen.abiertasLimpias})`);
    console.log(`Cerradas con responsable registrado: ${resumen.cerradasConResponsable}`);

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
