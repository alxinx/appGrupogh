import dotenv from 'dotenv';
import db from '../config/bd.js';
import { OrdenesCompra, DetallesOrdenCompra, OrdenesCompraHistorial } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea ORDENES_COMPRA, DETALLES_ORDEN_COMPRA y ORDENES_COMPRA_HISTORIAL (admin/insumos/
// compra), agrega DETALLES_ORDEN_COMPRA.cantidadRecibida ("Recibir orden") y siembra el
// contador 'orden_compra_insumo' en SECUENCIAS — el mismo mecanismo que ya numera
// traslados (TR-) y pedidos web, no un AUTO_INCREMENT ni un MAX()+1 (helpers/secuencias.js).
//
//   node ./seed/migracionOrdenesCompra.js
//   node ./seed/migracionOrdenesCompra.js --revertir
//
// Idempotente.

const TABLA_ORDEN = 'ORDENES_COMPRA';
const TABLA_DETALLE = 'DETALLES_ORDEN_COMPRA';
const TABLA_HISTORIAL = 'ORDENES_COMPRA_HISTORIAL';
const SECUENCIA = 'orden_compra_insumo';
const REVERTIR = process.argv.includes('--revertir');

const existeTabla = async (tabla) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t: tabla }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

const existeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        if (await existeTabla(TABLA_ORDEN)) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA_ORDEN}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA_ORDEN} tiene ${n} orden(es) registrada(s). No se elimina con datos adentro.`);
                process.exit(1);
            }
        }
        // El historial y el detalle primero: los dos tienen FK hacia la cabecera.
        if (await existeTabla(TABLA_HISTORIAL)) {
            await db.query(`DROP TABLE ${TABLA_HISTORIAL}`);
            console.log(`✓ ${TABLA_HISTORIAL} eliminada`);
        }
        if (await existeTabla(TABLA_DETALLE)) {
            await db.query(`DROP TABLE ${TABLA_DETALLE}`);
            console.log(`✓ ${TABLA_DETALLE} eliminada`);
        }
        if (await existeTabla(TABLA_ORDEN)) {
            await db.query(`DROP TABLE ${TABLA_ORDEN}`);
            console.log(`✓ ${TABLA_ORDEN} eliminada`);
        }
        const [fila] = await db.query('SELECT valor FROM SECUENCIAS WHERE nombre = :n', {
            replacements: { n: SECUENCIA }, type: QueryTypes.SELECT
        });
        if (fila && Number(fila.valor) === 0) {
            await db.query('DELETE FROM SECUENCIAS WHERE nombre = :n', { replacements: { n: SECUENCIA } });
            console.log(`✓ contador '${SECUENCIA}' eliminado`);
        } else if (fila) {
            console.error(`✗ El contador '${SECUENCIA}' ya entregó números (valor=${fila.valor}). Se deja para no reutilizarlos si esto se vuelve a crear.`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    // La cabecera primero: el detalle referencia ORDENES_COMPRA por FK.
    if (await existeTabla(TABLA_ORDEN)) {
        console.log(`· ${TABLA_ORDEN} ya existe, se omite`);
    } else {
        await OrdenesCompra.sync();
        console.log(`✓ ${TABLA_ORDEN} creada`);
    }

    if (await existeTabla(TABLA_DETALLE)) {
        console.log(`· ${TABLA_DETALLE} ya existe, se omite`);
    } else {
        await DetallesOrdenCompra.sync();
        console.log(`✓ ${TABLA_DETALLE} creada`);
    }

    // Columnas agregadas después de la primera versión de la tabla (cotización a varios
    // proveedores + origen operador/sistema) — ALTER idempotente, no DROP/CREATE, para no
    // perder nada si esto ya corrió con otras columnas encima.
    if (await existeColumna(TABLA_ORDEN, 'idGrupoCotizacion')) {
        console.log(`· ${TABLA_ORDEN}.idGrupoCotizacion ya existe, se omite`);
    } else {
        await db.query(`ALTER TABLE ${TABLA_ORDEN} ADD COLUMN idGrupoCotizacion CHAR(36) NULL AFTER idProveedor`);
        console.log(`✓ ${TABLA_ORDEN}.idGrupoCotizacion agregada`);
    }
    if (await existeColumna(TABLA_ORDEN, 'origen')) {
        console.log(`· ${TABLA_ORDEN}.origen ya existe, se omite`);
    } else {
        await db.query(`ALTER TABLE ${TABLA_ORDEN} ADD COLUMN origen ENUM('operador','sistema') NOT NULL DEFAULT 'operador' AFTER idGrupoCotizacion`);
        console.log(`✓ ${TABLA_ORDEN}.origen agregada`);
    }

    // "Recibir orden": lo que de verdad llegó de cada línea, aparte de `cantidad` (lo
    // pedido) — ver el comentario en models/DetallesOrdenCompra.js.
    if (await existeColumna(TABLA_DETALLE, 'cantidadRecibida')) {
        console.log(`· ${TABLA_DETALLE}.cantidadRecibida ya existe, se omite`);
    } else {
        await db.query(`ALTER TABLE ${TABLA_DETALLE} ADD COLUMN cantidadRecibida DECIMAL(15,4) NULL AFTER caracteristicas`);
        console.log(`✓ ${TABLA_DETALLE}.cantidadRecibida agregada`);
    }

    // Bitácora de movimientos (quién hizo qué y cuándo) — ver models/OrdenesCompraHistorial.js.
    if (await existeTabla(TABLA_HISTORIAL)) {
        console.log(`· ${TABLA_HISTORIAL} ya existe, se omite`);
    } else {
        await OrdenesCompraHistorial.sync();
        console.log(`✓ ${TABLA_HISTORIAL} creada`);
    }

    const [fila] = await db.query('SELECT valor FROM SECUENCIAS WHERE nombre = :n', {
        replacements: { n: SECUENCIA }, type: QueryTypes.SELECT
    });
    if (fila) {
        console.log(`· contador '${SECUENCIA}' ya existía (valor=${fila.valor}), se omite`);
    } else {
        await db.query('INSERT INTO SECUENCIAS (nombre, valor) VALUES (:n, 0)', { replacements: { n: SECUENCIA } });
        console.log(`✓ contador '${SECUENCIA}' creado en 0`);
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
