import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Índices de EGRESOS para la paginación por cursor del listado de la tienda, y
// reclasificación de los traslados que quedaron marcados como gasto.
//
// `db.sync()` no agrega índices a una tabla que ya existe, así que esto va aparte.
//
// El listado pide "los egresos de esta tienda, desde tal registro hacia atrás, en orden
// (createdAt, idEgreso)". Sin un índice que cubra las tres columnas en ese orden, MySQL
// resuelve el rango de fechas por la clave foránea de idPuntoDeVenta y después ordena en
// memoria toda la tienda: la paginación por cursor deja de ser barata justo en la tabla
// que más crece.
//
// La reclasificación es aparte y explícita: solo toca las filas que tienen una cuenta
// destino en CAJAS_Y_BANCOS, que son inequívocamente traslados de efectivo —esa columna
// solo la escribe el flujo de transferencia—. Los egresos viejos, anteriores a que
// existiera la columna `tipo`, se quedan como están: el sistema los creó como gasto y
// reinterpretarlos hacia atrás cambiaría el significado de reportes ya emitidos.
//
//   node ./seed/migracionIndicesEgresos.js
//   node ./seed/migracionIndicesEgresos.js --reclasificar
//   node ./seed/migracionIndicesEgresos.js --revertir
//
// Idempotente.

const TABLA = 'EGRESOS';
const REVERTIR      = process.argv.includes('--revertir');
const RECLASIFICAR  = process.argv.includes('--reclasificar');

const INDICES = [
    {
        nombre: 'idx_egresos_pdv_orden',
        columnas: '(idPuntoDeVenta, createdAt, idEgreso)',
        para: 'listado paginado por cursor y filtro por rango de fechas'
    },
    {
        nombre: 'idx_egresos_pdv_estado',
        columnas: '(idPuntoDeVenta, estado)',
        para: 'cuadre de caja y total del día'
    }
];

const existe = async (nombre) => {
    const filas = await db.query(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i LIMIT 1`,
        { replacements: { t: TABLA, i: nombre }, type: QueryTypes.SELECT }
    );
    return filas.length > 0;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        for (const { nombre } of INDICES) {
            if (await existe(nombre)) {
                await db.query(`DROP INDEX \`${nombre}\` ON \`${TABLA}\``);
                console.log(`✓ ${nombre} eliminado`);
            } else {
                console.log(`· ${nombre} no existe`);
            }
        }
        console.log('\nReversión completada. La clasificación de los traslados no se revierte:');
        console.log('sería volver a contar como gasto plata que no se gastó.');
        process.exit(0);
    }

    for (const { nombre, columnas, para } of INDICES) {
        if (await existe(nombre)) {
            console.log(`· ${nombre} ya existe, se omite`);
            continue;
        }
        await db.query(`CREATE INDEX \`${nombre}\` ON \`${TABLA}\` ${columnas}`);
        console.log(`✓ ${nombre} ${columnas} — ${para}`);
    }

    // Traslados registrados antes de que crearEgreso escribiera el tipo: tienen cuenta
    // destino pero quedaron como 'Egreso' por el default de la columna.
    const [{ n }] = await db.query(
        `SELECT COUNT(*) n FROM \`${TABLA}\` WHERE idCajaBanco IS NOT NULL AND tipo = 'Egreso'`,
        { type: QueryTypes.SELECT }
    );

    if (!n) {
        console.log('\n· No hay traslados mal clasificados.');
    } else if (RECLASIFICAR) {
        const [, meta] = await db.query(
            `UPDATE \`${TABLA}\` SET tipo = 'Traslado' WHERE idCajaBanco IS NOT NULL AND tipo = 'Egreso'`
        );
        console.log(`\n✓ ${meta?.affectedRows ?? n} registro(s) reclasificados como Traslado.`);
    } else {
        console.log(`\n⚠ ${n} registro(s) tienen cuenta destino pero figuran como gasto.`);
        console.log('  Esa plata no se gastó, se consignó en una cuenta del negocio.');
        console.log('  Para corregirlos: node ./seed/migracionIndicesEgresos.js --reclasificar');
    }

    const indices = await db.query(`SHOW INDEX FROM \`${TABLA}\``, { type: QueryTypes.SELECT });
    console.log('\nÍndices de la tabla:');
    [...new Set(indices.map(i => i.Key_name))].forEach(k => {
        const cols = indices.filter(i => i.Key_name === k).map(i => i.Column_name).join(', ');
        console.log(`   ${k.padEnd(28)}(${cols})`);
    });

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
