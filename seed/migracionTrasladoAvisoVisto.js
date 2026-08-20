import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// TRASLADO_EFECTIVO.avisoVistoEn — cuándo el punto de venta se enteró de que su traslado
// no entró completo.
//
// El aviso viaja por SSE y un evento SSE se pierde si el navegador no está abierto. Con
// esta marca el aviso deja de depender de que alguien esté mirando: nulo significa
// "todavía no lo vio" y se le muestra al entrar.
//
// Los traslados que YA estaban resueltos cuando se agregó la columna quedan en nulo, o
// sea pendientes de ver. Es lo correcto: nadie los avisó nunca, porque el aviso no
// existía. Si preferís no molestar con lo viejo, `--marcar-vistos` los da por vistos.
//
//   node ./seed/migracionTrasladoAvisoVisto.js
//   node ./seed/migracionTrasladoAvisoVisto.js --marcar-vistos
//   node ./seed/migracionTrasladoAvisoVisto.js --revertir
//
// Idempotente.

const TABLA = 'TRASLADO_EFECTIVO';
const COLUMNA = 'avisoVistoEn';
const REVERTIR = process.argv.includes('--revertir');
const MARCAR   = process.argv.includes('--marcar-vistos');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols[COLUMNA]) { console.log(`· ${COLUMNA} no existe, nada que revertir`); process.exit(0); }
        await db.query(`ALTER TABLE \`${TABLA}\` DROP COLUMN ${COLUMNA}`);
        console.log(`✓ ${COLUMNA} eliminada`);
        process.exit(0);
    }

    if (cols[COLUMNA]) {
        console.log(`· ${COLUMNA} ya existe, se omite`);
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD COLUMN ${COLUMNA} DATETIME NULL AFTER estado`);
        console.log(`✓ ${COLUMNA} DATETIME NULL agregada después de estado`);
    }

    const [{ n }] = await db.query(
        `SELECT COUNT(*) n FROM \`${TABLA}\`
         WHERE estado IN ('Rechazado', 'Controversia') AND ${COLUMNA} IS NULL`,
        { type: QueryTypes.SELECT }
    );

    if (!n) {
        console.log('\n· No hay avisos pendientes de ver.');
    } else if (MARCAR) {
        const [, meta] = await db.query(
            `UPDATE \`${TABLA}\` SET ${COLUMNA} = NOW()
             WHERE estado IN ('Rechazado', 'Controversia') AND ${COLUMNA} IS NULL`
        );
        console.log(`\n✓ ${meta?.affectedRows ?? n} aviso(s) anteriores marcados como vistos.`);
    } else {
        console.log(`\n⚠ ${n} traslado(s) resueltos quedan como aviso PENDIENTE: se le mostrarán al operador la próxima vez que entre.`);
        console.log('  Para darlos por vistos: node ./seed/migracionTrasladoAvisoVisto.js --marcar-vistos');
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
