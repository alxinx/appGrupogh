import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// EGRESOS.idCajaBanco — a qué caja o cuenta propia se envió el efectivo.
//
// `idEntidad` apunta a ENTIDADES, que son los medios con los que la tienda COBRA
// (Bancolombia, Nequi, Visa…). Una transferencia de efectivo no va a un medio de cobro:
// va a una cuenta del negocio, que vive en CAJAS_Y_BANCOS. Son dos cosas distintas y por
// eso son dos columnas distintas: los egresos viejos conservan su entidad y los traslados
// nuevos apuntan a la cuenta destino.
//
//   node ./seed/migracionEgresoCajaBanco.js
//   node ./seed/migracionEgresoCajaBanco.js --revertir
//
// Idempotente.

const TABLA = 'EGRESOS';
const COLUMNA = 'idCajaBanco';
const FK = 'fk_egresos_caja_banco';
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    const fks = await db.query(
        `SELECT CONSTRAINT_NAME k FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND CONSTRAINT_NAME = :k`,
        { replacements: { t: TABLA, k: FK }, type: QueryTypes.SELECT }
    );

    if (REVERTIR) {
        if (fks.length) {
            await db.query(`ALTER TABLE \`${TABLA}\` DROP FOREIGN KEY \`${FK}\``);
            console.log(`✓ FK ${FK} eliminada`);
        }
        if (cols[COLUMNA]) {
            const [{ n }] = await db.query(
                `SELECT COUNT(*) n FROM \`${TABLA}\` WHERE ${COLUMNA} IS NOT NULL`, { type: QueryTypes.SELECT }
            );
            if (n > 0) {
                console.error(`✗ ABORTADO: ${n} egreso(s) apuntan a una cuenta. Borrar la columna perdería a dónde fue esa plata.`);
                process.exit(1);
            }
            await db.query(`ALTER TABLE \`${TABLA}\` DROP COLUMN ${COLUMNA}`);
            console.log(`✓ ${COLUMNA} eliminada`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    // La collation tiene que ser la misma que la de la columna referenciada o MySQL
    // rechaza la FK. Sequelize crea los UUID con utf8mb4_bin, mientras que el default de
    // la tabla es utf8mb4_0900_ai_ci: sin declararla explícitamente, el ALTER de la clave
    // foránea falla con ER_FK_INCOMPATIBLE_COLUMNS.
    const TIPO = 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL';

    if (cols[COLUMNA]) {
        // Puede existir con la collation equivocada de una corrida anterior fallida.
        await db.query(`ALTER TABLE \`${TABLA}\` MODIFY COLUMN ${COLUMNA} ${TIPO}`);
        console.log(`· ${TABLA}.${COLUMNA} ya existe, collation normalizada`);
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD COLUMN ${COLUMNA} ${TIPO} AFTER idEntidad`);
        console.log(`✓ ${COLUMNA} agregada`);
    }

    if (fks.length) {
        console.log(`· FK ${FK} ya existe, se omite`);
    } else {
        await db.query(
            `ALTER TABLE \`${TABLA}\` ADD CONSTRAINT \`${FK}\`
             FOREIGN KEY (${COLUMNA}) REFERENCES CAJAS_Y_BANCOS(idCajaBanco)`
        );
        console.log(`✓ FK ${FK} creada`);
    }

    const idx = await db.query(`SHOW INDEX FROM \`${TABLA}\``, { type: QueryTypes.SELECT });
    console.log('\nÍndices sobre la columna:',
        [...new Set(idx.filter(i => i.Column_name === COLUMNA).map(i => i.Key_name))].join(', ') || 'ninguno');

    const estructura = await db.query(`SHOW COLUMNS FROM \`${TABLA}\``, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    estructura.forEach(c => console.log(`   ${c.Field.padEnd(16)}${String(c.Type).padEnd(30)}null:${c.Null}  key:${c.Key || '-'}`));

    console.log('\nMigración completada.');
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
