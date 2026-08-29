import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// CLIENTES.tipo_documento (snake_case, VARCHAR(5)) → tipoDocumento (camelCase, ENUM).
//
// EMPLEADOS ya usa TipoDocumento ENUM('CC','CE','TI','NIT','PP','PPT') — CLIENTES tenía
// su propio vocabulario (snake_case + VARCHAR sin restricción), lo que permitía valores
// que no calzan con ningún tipo de documento real. Mismo set de valores que EMPLEADOS,
// nombre en camelCase (la convención real del proyecto — ver CLAUDE.md §"Convenciones de
// modelado" — no la del legado PascalCase de EMPLEADOS).
//
// El valor 'DE' que ofrecía el formulario del POS no existe en ningún lado más y no lo
// usa ningún cliente real (verificado contra la data antes de escribir esto) — se cae en
// favor de PPT, que sí es un tipo de documento colombiano real (Permiso por Protección
// Temporal) y ya está en el ENUM de EMPLEADOS.
//
//   node ./seed/migracionClientesTipoDocumento.js
//   node ./seed/migracionClientesTipoDocumento.js --revertir

const TABLA = 'CLIENTES';
const VALORES_VALIDOS = ['CC', 'CE', 'TI', 'NIT', 'PP', 'PPT'];
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols.tipoDocumento) { console.log('· tipoDocumento no existe, nada que revertir'); process.exit(0); }
        await db.query(`ALTER TABLE \`${TABLA}\` ADD COLUMN tipo_documento VARCHAR(5) NULL AFTER tipo_persona`);
        await db.query(`UPDATE \`${TABLA}\` SET tipo_documento = tipoDocumento`);
        await db.query(`ALTER TABLE \`${TABLA}\` MODIFY COLUMN tipo_documento VARCHAR(5) NOT NULL`);
        await db.getQueryInterface().removeColumn(TABLA, 'tipoDocumento');
        console.log('✓ tipo_documento restaurada, tipoDocumento eliminada');
        process.exit(0);
    }

    if (cols.tipoDocumento) {
        console.log('· tipoDocumento ya existe, se omite');
        process.exit(0);
    }

    // Distribución real antes de tocar nada — para dejar constancia de qué se remapeó.
    const distribucion = await db.query(
        `SELECT tipo_documento AS valor, COUNT(*) AS n FROM \`${TABLA}\` GROUP BY tipo_documento`,
        { type: QueryTypes.SELECT }
    );
    console.log('Distribución actual de tipo_documento:', distribucion);

    const fueraDeEnum = distribucion.filter(d => !VALORES_VALIDOS.includes(d.valor));
    if (fueraDeEnum.length) {
        console.log(`⚠ ${fueraDeEnum.length} valor(es) fuera del ENUM se van a mapear a 'CC':`, fueraDeEnum);
    }

    await db.query(
        `ALTER TABLE \`${TABLA}\` ADD COLUMN tipoDocumento ENUM('CC','CE','TI','NIT','PP','PPT') NOT NULL DEFAULT 'CC' AFTER tipo_persona`
    );

    await db.query(`
        UPDATE \`${TABLA}\`
        SET tipoDocumento = CASE
            WHEN tipo_documento IN ('CC','CE','TI','NIT','PP','PPT') THEN tipo_documento
            ELSE 'CC'
        END
    `);

    await db.getQueryInterface().removeColumn(TABLA, 'tipo_documento');

    console.log('✓ tipoDocumento agregada (ENUM) después de tipo_persona, tipo_documento eliminada');

    const conteoFinal = await db.query(
        `SELECT tipoDocumento AS valor, COUNT(*) AS n FROM \`${TABLA}\` GROUP BY tipoDocumento`,
        { type: QueryTypes.SELECT }
    );
    console.log('Distribución final:', conteoFinal);

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
