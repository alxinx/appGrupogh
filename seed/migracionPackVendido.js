import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Un pack se puede vender entero en el POS: entra por su código de etiqueta, se explota
// en sus líneas a precio mayorista y se factura. Al facturarse queda VENDIDO.
//
// Estado nuevo y no un reuso de DESPACHADO —que está en el ENUM sin usarse— porque
// "despachado a otra sede" y "vendido a un cliente" no son lo mismo: mezclarlos deja un
// historial en el que no se puede distinguir una salida de la otra.
//
//   node ./seed/migracionPackVendido.js

const TABLA = 'PACKS';
const NUEVO = 'VENDIDO';

const run = async () => {
    await db.authenticate();

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    const estado = cols.find(c => c.Field === 'estado');
    if (!estado) throw new Error(`${TABLA} no tiene columna estado`);

    if (estado.Type.includes(`'${NUEVO}'`)) {
        console.log(`· ${TABLA}.estado ya admite '${NUEVO}', se omite`);
    } else {
        // Se reescribe el ENUM completo conservando los valores existentes y su orden: un
        // MODIFY parcial borraría los que no se nombren y dejaría en '' las filas que los
        // usaban. Default y NULL se repiten por lo mismo — MODIFY no los hereda.
        await db.query(`
            ALTER TABLE ${TABLA}
            MODIFY COLUMN estado
                ENUM('EMPACADO','SEPARADO','DESPACHADO','TRASLADADO','DESEMPACADO','ANULADO','VENDIDO')
                NULL DEFAULT 'EMPACADO'
        `);
        console.log(`✓ ${TABLA}.estado ampliado con '${NUEVO}'`);
    }

    const final = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nestado →', final.find(c => c.Field === 'estado').Type);

    const porEstado = await db.query(
        `SELECT estado, COUNT(*) n FROM ${TABLA} GROUP BY estado ORDER BY n DESC`,
        { type: QueryTypes.SELECT }
    );
    console.log('\nPacks por estado:');
    porEstado.forEach(r => console.log(`   ${String(r.estado).padEnd(13)}${r.n}`));

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
