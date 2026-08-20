import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// CAJA_TIENDA.cuadreDesde — desde cuándo esta caja está trabada en 'auditoria'.
//
// El estado 'auditoria' frena la facturación mientras el operador cuenta el cajón. Se
// suelta cuando esa pantalla se abandona, con un `sendBeacon`. Pero un candado que solo
// se abre si el cliente avisa no es un candado confiable: si el navegador se cierra de
// golpe, se corta la red o se apaga el equipo, el aviso nunca llega y la caja queda
// trabada para siempre — con el punto de venta sin poder facturar y sin nadie que sepa
// por qué. Pasó.
//
// Con esta marca el candado expira solo: si lleva más de CUADRE_TIMEOUT_MIN minutos sin
// dar señales, cualquier petición que se tope con él lo libera. La pantalla del cuadre la
// refresca mientras está viva, así que un cuadre largo de verdad nunca se corta.
//
// Se llena al entrar al cuadre y se limpia al salir o al cerrar la caja. Nulo significa
// "esta caja no está en cuadre", que es lo mismo que dice su estado.
//
// Las cajas que ya estén en 'auditoria' quedan con la marca en NOW(): les da una ventana
// completa desde la migración en vez de expirarlas de golpe, por si alguna está siendo
// cuadrada justo en este momento.
//
//   node ./seed/migracionCuadreDesde.js            (muestra qué haría)
//   node ./seed/migracionCuadreDesde.js --aplicar
//   node ./seed/migracionCuadreDesde.js --revertir
//
// Idempotente.

const TABLA   = 'CAJA_TIENDA';
const COLUMNA = 'cuadreDesde';
const APLICAR  = process.argv.includes('--aplicar');
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols[COLUMNA]) { console.log(`· ${COLUMNA} no existe, nada que revertir`); process.exit(0); }
        await db.query(`ALTER TABLE \`${TABLA}\` DROP COLUMN ${COLUMNA}`);
        console.log(`✓ ${COLUMNA} eliminada`);
        process.exit(0);
    }

    const enCuadre = await db.query(
        `SELECT c.codigo, p.nombreComercial, c.fechaApertura
         FROM \`${TABLA}\` c JOIN PUNTO_DE_VENTA p ON p.idPuntoDeVenta = c.idPuntoDeVenta
         WHERE c.estado = 'auditoria' AND c.fechaCierre IS NULL`,
        { type: QueryTypes.SELECT }
    );

    console.log(cols[COLUMNA] ? `· ${COLUMNA} ya existe` : `+ ${TABLA}.${COLUMNA} DATETIME NULL`);
    if (enCuadre.length) {
        console.log(`\n${enCuadre.length} caja(s) trabadas en 'auditoria' ahora mismo:`);
        enCuadre.forEach(c => console.log(`   ${c.nombreComercial} · ${c.codigo} · abrió ${new Date(c.fechaApertura).toLocaleString('es-CO')}`));
        console.log('   (se les pone la marca en NOW(): la ventana de expiración arranca desde acá)');
    } else {
        console.log('\n· Ninguna caja está en cuadre en este momento.');
    }

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/migracionCuadreDesde.js --aplicar');
        process.exit(0);
    }

    if (!cols[COLUMNA]) {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD COLUMN ${COLUMNA} DATETIME NULL AFTER estado`);
        console.log(`\n✓ ${COLUMNA} agregada`);
    }

    const [, meta] = await db.query(
        `UPDATE \`${TABLA}\` SET ${COLUMNA} = UTC_TIMESTAMP()
         WHERE estado = 'auditoria' AND fechaCierre IS NULL AND ${COLUMNA} IS NULL`
    );
    console.log(`✓ ${meta?.affectedRows ?? 0} caja(s) en cuadre marcadas`);

    // Coherencia: una caja que no está en 'auditoria' no puede tener marca de cuadre.
    const [, limpias] = await db.query(
        `UPDATE \`${TABLA}\` SET ${COLUMNA} = NULL WHERE estado <> 'auditoria' AND ${COLUMNA} IS NOT NULL`
    );
    if (limpias?.affectedRows) console.log(`✓ ${limpias.affectedRows} marca(s) huérfanas limpiadas`);

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
