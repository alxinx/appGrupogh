import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// PROVEDORES.tipoDocumento: tipo del documento que va en taxIdSupplier.
//
// Mismo vocabulario que CLIENTES.tipoDocumento (con PEP) MENOS la tarjeta de identidad: un
// menor de edad no puede contratar, así que un proveedor menor se registra a nombre de su
// padre, madre o tutor legal. Si la columna ya existía con TI (la primera versión de esta
// migración la incluía), se quita del ENUM, siempre que ningún proveedor la esté usando.
//
// NOT NULL con DEFAULT 'CC': las filas que ya existen quedan en 'CC'
// —aunque su taxIdSupplier sea un NIT— hasta que se corrijan a mano; la migración no adivina
// el tipo a partir del número.
//
//   npm run db:migrar-provedores-tipo-doc
//   npm run db:migrar-provedores-tipo-doc -- --revertir

const TABLA = 'PROVEDORES';
const ENUM_SQL = "ENUM('CC','CE','NIT','PP','PPT','PEP') NOT NULL DEFAULT 'CC'";
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols.tipoDocumento) { console.log('· tipoDocumento no existe, nada que revertir'); process.exit(0); }
        await db.getQueryInterface().removeColumn(TABLA, 'tipoDocumento');
        console.log('✓ tipoDocumento eliminada de PROVEDORES');
        process.exit(0);
    }

    if (!cols.tipoDocumento) {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD COLUMN tipoDocumento ${ENUM_SQL} AFTER razonSocial`);
        console.log('✓ tipoDocumento agregada a PROVEDORES (ENUM sin TI, NOT NULL, DEFAULT CC) después de razonSocial');
    } else if (String(cols.tipoDocumento.type).includes("'TI'")) {
        const [{ n }] = await db.query(`SELECT COUNT(*) n FROM \`${TABLA}\` WHERE tipoDocumento = 'TI'`, { type: QueryTypes.SELECT });
        if (n > 0) {
            console.error(`✗ ABORTADO: ${n} proveedor(es) tienen tarjeta de identidad. Corrígelos (cédula del padre, madre o tutor) y vuelve a correr.`);
            process.exit(1);
        }
        await db.query(`ALTER TABLE \`${TABLA}\` MODIFY COLUMN tipoDocumento ${ENUM_SQL}`);
        console.log('✓ TI quitada del ENUM de tipoDocumento');
    } else {
        console.log('· tipoDocumento ya existe sin TI, se omite');
    }

    const distribucion = await db.query(
        `SELECT tipoDocumento AS valor, COUNT(*) AS n FROM \`${TABLA}\` GROUP BY tipoDocumento`,
        { type: QueryTypes.SELECT }
    );
    console.log('Distribución de tipoDocumento:', distribucion);
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
