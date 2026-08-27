import dotenv from 'dotenv';
import db from '../config/bd.js';

dotenv.config();

// INTERESADOS.activo — se apaga cuando alguien hace clic en "dar de baja" del correo de
// "producto disponible" (helpers/emailSes.js / helpers/colaEmailProducto.js). No se borra
// la fila: sigue siendo el registro de que pidió el producto, solo deja de recibir avisos.
//
//   node ./seed/migracionInteresadosActivo.js
//   node ./seed/migracionInteresadosActivo.js --revertir

const TABLA = 'INTERESADOS';
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols.activo) { console.log('· activo no existe, nada que revertir'); process.exit(0); }
        await db.getQueryInterface().removeColumn(TABLA, 'activo');
        console.log('✓ activo eliminada');
        process.exit(0);
    }

    if (cols.activo) {
        console.log('· activo ya existe, se omite');
    } else {
        await db.query(
            `ALTER TABLE \`${TABLA}\` ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER producto`
        );
        console.log('✓ activo agregada después de producto (todos los existentes quedan en 1 = activos)');
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
