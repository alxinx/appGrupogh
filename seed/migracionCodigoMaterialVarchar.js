import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// node ./seed/migracionCodigoMaterialVarchar.js
// node ./seed/migracionCodigoMaterialVarchar.js --revertir
//
// Cambia MATERIAL.codigoMaterial de INT a VARCHAR(20) para soportar códigos compuestos
// del formato "familia.material" (ej: "1.23") en los archivos DXF. Los códigos enteros
// existentes (1, 2, 3…) se convierten automáticamente a su representación en cadena sin
// pérdida de datos.
//
// --revertir: vuelve a INT solo si NO hay filas con código compuesto (con punto). Si las
// hay, aborta para no perder esos datos.

const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();

    const [{ tipo }] = await db.query(
        `SELECT DATA_TYPE tipo
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'MATERIAL'
           AND COLUMN_NAME  = 'codigoMaterial'`,
        { type: QueryTypes.SELECT }
    );

    if (REVERTIR) {
        if (tipo === 'int') {
            console.log('· ya es INT, nada que hacer.');
            process.exit(0);
        }
        const [{ n }] = await db.query(
            `SELECT COUNT(*) n FROM MATERIAL WHERE codigoMaterial LIKE '%.%'`,
            { type: QueryTypes.SELECT }
        );
        if (Number(n) > 0) {
            console.error(`✗ ABORTADO: hay ${n} material(es) con código compuesto (ej: "1.23"). Elimínalos primero antes de revertir a INT.`);
            process.exit(1);
        }
        await db.query(`ALTER TABLE MATERIAL MODIFY COLUMN codigoMaterial INT NOT NULL`);
        console.log('✓ codigoMaterial revertido a INT.');
        process.exit(0);
    }

    if (tipo === 'varchar') {
        console.log('· ya es VARCHAR(20), nada que hacer.');
        process.exit(0);
    }

    await db.query(`ALTER TABLE MATERIAL MODIFY COLUMN codigoMaterial VARCHAR(20) NOT NULL`);
    console.log('✓ codigoMaterial cambiado a VARCHAR(20). Los valores enteros existentes se conservan como cadenas.');
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e.message || e);
    process.exit(1);
});
