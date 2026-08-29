import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Agrega 'PEP' (Permiso Especial de Permanencia) al ENUM de CLIENTES.tipoDocumento.
//
// A propósito SOLO en CLIENTES: EMPLEADOS.TipoDocumento no lleva este valor — son dos
// ENUM independientes desde la migración anterior (migracionClientesTipoDocumento.js),
// y este pedido es explícito sobre no tocar EMPLEADOS.
//
//   node ./seed/migracionClientesPep.js
//   node ./seed/migracionClientesPep.js --revertir

const TABLA = 'CLIENTES';
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        const [{ n }] = await db.query(`SELECT COUNT(*) n FROM \`${TABLA}\` WHERE tipoDocumento = 'PEP'`, { type: QueryTypes.SELECT });
        if (n > 0) {
            console.log(`⚠ Hay ${n} cliente(s) con tipoDocumento='PEP' — no se puede revertir sin decidir a qué valor migrarlos. Abortado.`);
            process.exit(1);
        }
        await db.query(`ALTER TABLE \`${TABLA}\` MODIFY COLUMN tipoDocumento ENUM('CC','CE','TI','NIT','PP','PPT') NOT NULL DEFAULT 'CC'`);
        console.log('✓ PEP eliminado del ENUM de tipoDocumento');
        process.exit(0);
    }

    await db.query(`ALTER TABLE \`${TABLA}\` MODIFY COLUMN tipoDocumento ENUM('CC','CE','TI','NIT','PP','PPT','PEP') NOT NULL DEFAULT 'CC'`);
    console.log('✓ PEP agregado al ENUM de tipoDocumento (CLIENTES)');

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
