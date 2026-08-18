import { DataTypes } from 'sequelize';
import dotenv from 'dotenv';
import db from '../config/bd.js';

dotenv.config();

// Agrega PRODUCTOS.costo — el costo de adquisición/confección de la prenda.
//
// Es un campo TEMPORAL: por eso la migración trae su reversión. Si se decide retirarlo,
// correr con --revertir y quitar el campo del modelo, del formulario y de la whitelist
// de adminControllers.
//
//   node ./seed/migracionCostoProducto.js
//   node ./seed/migracionCostoProducto.js --revertir
//
// Es idempotente: se puede correr varias veces sin romper nada.

const TABLA = 'PRODUCTOS';
const COLUMNA = 'costo';
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    const qi = db.getQueryInterface();
    await db.authenticate();

    const actuales = await qi.describeTable(TABLA);

    if (REVERTIR) {
        if (!actuales[COLUMNA]) {
            console.log(`· ${COLUMNA} no existe, nada que revertir`);
        } else {
            // Se avisa qué se va a perder: los costos no se recuperan.
            const [[{ n }]] = await db.query(
                `SELECT COUNT(*) n FROM ${TABLA} WHERE ${COLUMNA} IS NOT NULL AND ${COLUMNA} > 0`
            );
            await qi.removeColumn(TABLA, COLUMNA);
            console.log(`✓ ${COLUMNA} eliminada (se perdieron ${n} costo(s) cargado(s))`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (actuales[COLUMNA]) {
        console.log(`· ${COLUMNA} ya existe, se omite`);
    } else {
        // Nullable con default 0: los productos que ya están en la tabla no tienen costo
        // cargado, y una columna NOT NULL sin default no se puede agregar sobre filas
        // existentes.
        await qi.addColumn(TABLA, COLUMNA, {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: 0
        });
        console.log(`✓ ${COLUMNA} agregada como DECIMAL(10,2)`);
    }

    console.log('\nMigración de PRODUCTOS.costo completada.');
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
