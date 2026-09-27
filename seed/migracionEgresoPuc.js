import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// `idPucEgreso` — la subcuenta de PUC_EGRESOS en la que se clasifica cada gasto. Va en
// las dos tablas donde se registra plata que sale:
//
//   · EGRESOS .................... los egresos de caja de las tiendas
//   · MOVIMIENTOS_CAJAS_BANCOS ... los egresos manuales de una caja o banco (admin)
//
// Admite NULL: lo registrado antes no tiene clasificación, y en MOVIMIENTOS los ingresos
// nunca la llevan. La obligatoriedad para los gastos nuevos la aplica el servidor al
// registrarlos (helpers/pucEgresos.js), no la base.
//
// Requiere que PUC_EGRESOS exista (npm run db:migrar-puc-egresos).
//
//   npm run db:migrar-egreso-puc
//   node ./seed/migracionEgresoPuc.js --revertir
//
// Idempotente: cada paso (columna, índice, llave foránea) se salta si ya está.

const COLUMNA = 'idPucEgreso';
const DESTINOS = [
    { tabla: 'EGRESOS',                  despuesDe: 'idTrasladoEfectivo', fk: 'fk_egresos_puc_egreso',      indice: 'idx_egresos_puc' },
    { tabla: 'MOVIMIENTOS_CAJAS_BANCOS', despuesDe: 'tipo',               fk: 'fk_movimientos_puc_egreso',  indice: 'idx_movimientos_puc' }
];

const REVERTIR = process.argv.includes('--revertir');

// INT igual que PUC_EGRESOS.id: la llave foránea exige el mismo tipo en las dos columnas.
const sqlColumna = ({ tabla, despuesDe }) =>
    `ALTER TABLE \`${tabla}\` ADD COLUMN \`${COLUMNA}\` INT NULL AFTER \`${despuesDe}\``;
const sqlIndice = ({ tabla, indice }) =>
    `CREATE INDEX \`${indice}\` ON \`${tabla}\` (\`${COLUMNA}\`)`;
// RESTRICT y no SET NULL: una cuenta con gastos clasificados no se borra, se desactiva
// (PUC_EGRESOS.activo). Con SET NULL, borrarla dejaría esos gastos sin clasificar sin que
// nadie se enterara.
const sqlFK = ({ tabla, fk }) =>
    `ALTER TABLE \`${tabla}\` ADD CONSTRAINT \`${fk}\`
  FOREIGN KEY (\`${COLUMNA}\`) REFERENCES \`PUC_EGRESOS\` (\`id\`)
  ON DELETE RESTRICT ON UPDATE CASCADE`;

const existeIndice = async (tabla, nombre) => {
    const filas = await db.query(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i LIMIT 1`,
        { replacements: { t: tabla, i: nombre }, type: QueryTypes.SELECT }
    );
    return filas.length > 0;
};

const existeFK = async (tabla, nombre) => {
    const filas = await db.query(
        `SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND CONSTRAINT_NAME = :k LIMIT 1`,
        { replacements: { t: tabla, k: nombre }, type: QueryTypes.SELECT }
    );
    return filas.length > 0;
};

const revertir = async (d) => {
    const cols = await db.getQueryInterface().describeTable(d.tabla);
    if (cols[COLUMNA]) {
        const [{ n }] = await db.query(
            `SELECT COUNT(*) n FROM \`${d.tabla}\` WHERE \`${COLUMNA}\` IS NOT NULL`, { type: QueryTypes.SELECT }
        );
        if (n > 0) {
            console.error(`✗ ${d.tabla}: ${n} fila(s) ya están clasificadas en el PUC; borrar la columna les quitaría esa clasificación. Se omite.`);
            return;
        }
    }
    if (await existeFK(d.tabla, d.fk)) {
        await db.query(`ALTER TABLE \`${d.tabla}\` DROP FOREIGN KEY \`${d.fk}\``);
        console.log(`✓ ${d.tabla}: FK ${d.fk} eliminada`);
    }
    if (await existeIndice(d.tabla, d.indice)) {
        await db.query(`DROP INDEX \`${d.indice}\` ON \`${d.tabla}\``);
        console.log(`✓ ${d.tabla}: ${d.indice} eliminado`);
    }
    if (cols[COLUMNA]) {
        await db.query(`ALTER TABLE \`${d.tabla}\` DROP COLUMN \`${COLUMNA}\``);
        console.log(`✓ ${d.tabla}: ${COLUMNA} eliminada`);
    }
};

const aplicar = async (d) => {
    const cols = await db.getQueryInterface().describeTable(d.tabla);
    if (cols[COLUMNA]) {
        console.log(`· ${d.tabla}: ${COLUMNA} ya existe, se omite`);
    } else {
        await db.query(sqlColumna(d));
        console.log(`✓ ${d.tabla}: ${COLUMNA} agregada después de ${d.despuesDe}`);
    }
    if (await existeIndice(d.tabla, d.indice)) {
        console.log(`· ${d.tabla}: ${d.indice} ya existe, se omite`);
    } else {
        await db.query(sqlIndice(d));
        console.log(`✓ ${d.tabla}: ${d.indice} creado`);
    }
    if (await existeFK(d.tabla, d.fk)) {
        console.log(`· ${d.tabla}: FK ${d.fk} ya existe, se omite`);
    } else {
        await db.query(sqlFK(d));
        console.log(`✓ ${d.tabla}: FK ${d.fk} creada`);
    }
};

const run = async () => {
    await db.authenticate();
    for (const d of DESTINOS) await (REVERTIR ? revertir(d) : aplicar(d));
    console.log(REVERTIR ? '\nReversión completada.' : `\nMigración de ${COLUMNA} completada.`);
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
