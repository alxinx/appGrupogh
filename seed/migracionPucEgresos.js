import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea la tabla PUC_EGRESOS: el plan de cuentas (cuentas y subcuentas) para clasificar
// los egresos. Modelo en models/PucEgresos.js.
//
//   npm run db:migrar-puc-egresos
//   node ./seed/migracionPucEgresos.js --revertir
//
// Va con SQL explícito y no con `sync()` para que el script diga exactamente qué se
// ejecutó. Idempotente: si la tabla ya existe no hace nada.
//
// `padre` no tiene llave foránea: vale 0 en una cuenta raíz y no existe la fila 0. Sí
// lleva índice, porque listar las subcuentas de una cuenta filtra por esa columna.
//
// `codigo` (el código del PUC) y el cambio de `nombre` de único a índice simple se
// hicieron a mano en la base el 2026-09-26, junto con la carga de las 323 cuentas. Este
// CREATE ya los refleja para una base nueva; una tabla creada con la versión anterior de
// este script no se corrige sola, porque `codigo` es obligatorio y habría que inventarle
// un valor a cada fila existente.

const TABLA = 'PUC_EGRESOS';
const REVERTIR = process.argv.includes('--revertir');

const SQL_CREAR = `
CREATE TABLE IF NOT EXISTS \`PUC_EGRESOS\` (
  \`id\`         INT NOT NULL AUTO_INCREMENT,
  \`codigo\`     VARCHAR(6) NOT NULL,
  \`nombre\`     VARCHAR(100) NOT NULL,
  \`tipo\`       ENUM('cuenta','subcuenta') NOT NULL,
  \`padre\`      INT NOT NULL DEFAULT 0,
  \`naturaleza\` ENUM('debito','credito') NOT NULL,
  \`activo\`     BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_puc_egresos_codigo\` (\`codigo\`),
  KEY \`idx_puc_egresos_padre\` (\`padre\`),
  KEY \`idx_puc_egresos_nombre\` (\`nombre\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

// La tabla se creó primero sin `activo` (2026-09-26). Donde ya exista así, se le agrega.
// BOOLEAN y no TINYINT(1): es el mismo tipo (MySQL lo guarda como tinyint(1)), pero
// escribir el ancho entre paréntesis está obsoleto en MySQL 8 y dispara la advertencia 1681.
const SQL_AGREGAR_ACTIVO = `
ALTER TABLE \`PUC_EGRESOS\`
  ADD COLUMN \`activo\` BOOLEAN NOT NULL DEFAULT TRUE AFTER \`naturaleza\``;

const existeColumna = async (columna) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tabla AND COLUMN_NAME = :columna`,
        { replacements: { tabla: TABLA, columna }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

const existeTabla = async () => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tabla`,
        { replacements: { tabla: TABLA }, type: QueryTypes.SELECT }
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
        // No se borra a ciegas una tabla con datos adentro.
        const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA}`, { type: QueryTypes.SELECT });
        if (n > 0) {
            console.error(`✗ ABORTADO: ${TABLA} tiene ${n} registro(s). Vaciala a mano si de verdad querés eliminarla.`);
            process.exit(1);
        }
        await db.query(`DROP TABLE ${TABLA}`);
        console.log(`✓ ${TABLA} eliminada`);
        process.exit(0);
    }

    if (await existeTabla()) {
        console.log(`· ${TABLA} ya existe, se omite`);
        if (await existeColumna('activo')) {
            console.log('· columna activo ya existe, se omite');
        } else {
            await db.query(SQL_AGREGAR_ACTIVO);
            console.log('✓ columna activo agregada');
        }
    } else {
        await db.query(SQL_CREAR);
        console.log(`✓ ${TABLA} creada`);
    }

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    cols.forEach(c => console.log(`   ${c.Field.padEnd(12)}${String(c.Type).padEnd(30)}null:${c.Null}  key:${c.Key || '-'}  default:${c.Default ?? 'NULL'}`));

    console.log(`\nMigración de ${TABLA} completada.`);
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
