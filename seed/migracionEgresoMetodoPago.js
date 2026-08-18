import { DataTypes } from 'sequelize';
import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// EGRESOS.metodoPago + EGRESOS.idEntidad
//
// Hasta ahora todo egreso se descontaba del efectivo de la tienda. Si un egreso se pagó
// por transferencia, el efectivo esperado del cuadre quedaba mal por ese monto.
//
// Los registros existentes quedan como 'Efectivo': es exactamente lo que el sistema
// asumía cuando se crearon, así que la historia no cambia de significado.
//
//   node ./seed/migracionEgresoMetodoPago.js
//   node ./seed/migracionEgresoMetodoPago.js --revertir

const TABLA = 'EGRESOS';
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    const qi = db.getQueryInterface();
    await db.authenticate();
    const cols = await qi.describeTable(TABLA);

    if (REVERTIR) {
        if (cols.idEntidad) {
            // La FK hay que soltarla antes de poder quitar la columna.
            const fks = await db.query(
                `SELECT CONSTRAINT_NAME k FROM information_schema.KEY_COLUMN_USAGE
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = 'idEntidad'
                   AND REFERENCED_TABLE_NAME IS NOT NULL`,
                { replacements: { t: TABLA }, type: QueryTypes.SELECT }
            );
            for (const f of fks) await db.query(`ALTER TABLE ${TABLA} DROP FOREIGN KEY \`${f.k}\``);
            await qi.removeColumn(TABLA, 'idEntidad');
            console.log('✓ idEntidad eliminada');
        }
        if (cols.metodoPago) {
            const [{ n }] = await db.query(
                `SELECT COUNT(*) n FROM ${TABLA} WHERE metodoPago <> 'Efectivo'`, { type: QueryTypes.SELECT });
            await qi.removeColumn(TABLA, 'metodoPago');
            console.log(`✓ metodoPago eliminada (${n} egreso(s) electrónico(s) vuelven a contarse como efectivo)`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (cols.metodoPago) {
        console.log('· metodoPago ya existe, se omite');
    } else {
        await qi.addColumn(TABLA, 'metodoPago', {
            type: DataTypes.ENUM('Efectivo', 'Electronico'),
            allowNull: false,
            defaultValue: 'Efectivo'
        });
        console.log('✓ metodoPago agregada (los egresos existentes quedan como Efectivo)');
    }

    if (cols.idEntidad) {
        console.log('· idEntidad ya existe, se omite');
    } else {
        // INTEGER, no UUID: ENTIDADES.idEntidad es un autoincremental, igual que en
        // DETALLES_PAGOS_FACTURA. Con UUID la FK falla por tipos incompatibles.
        await qi.addColumn(TABLA, 'idEntidad', {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'ENTIDADES', key: 'idEntidad' }
        });
        console.log('✓ idEntidad agregada (FK a ENTIDADES)');
    }

    const [{ efectivo }] = await db.query(
        `SELECT COUNT(*) efectivo FROM ${TABLA} WHERE metodoPago = 'Efectivo'`, { type: QueryTypes.SELECT });
    console.log(`\nEgresos marcados como efectivo: ${efectivo}`);
    console.log('Migración completada.');
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
