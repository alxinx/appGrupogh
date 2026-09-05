import dotenv from 'dotenv';
import db from '../config/bd.js';

dotenv.config();

// Hasta ahora la factura de cliente no calculaba IVA real: cada línea salía con
// DETALLES_FACTURA.subTotal === total (sin descomponer base/impuesto) y
// FACTURA_CLIENTES.totalImpuestos quedaba fijo en 0. Tampoco existía forma de guardar
// cuánto se descontó por precio mayorista en una venta — la UI lo mostraba pero nunca
// se calculaba ni se persistía.
//
// Esta migración agrega:
//   1. DETALLES_FACTURA.porcentajeIva  — el % de IVA aplicado a esa línea (congela el
//      valor vigente al momento de la venta; si el IVA cambia después, las facturas
//      viejas no se mueven).
//   2. DETALLES_FACTURA.valorImpuesto      — el valor de IVA de esa línea.
//      A partir de esta migración, DETALLES_FACTURA.subTotal cambia de significado:
//      pasa de ser un duplicado de `total` a ser la BASE gravable (antes de IVA) de la
//      línea. `total` sigue siendo el valor con IVA incluido, sin cambios.
//   3. FACTURA_CLIENTES.descuentoMayorista — cuánto se descontó en toda la factura por
//      vender a precio mayorista en vez de detal. Informativo: no participa en la
//      suma subtotal + totalImpuestos = total (el descuento ya está incluido en el
//      precio unitario que se cobró).
//
// Aditiva y retroactivamente inerte: las facturas ya emitidas quedan con estos tres
// campos en 0 — es lo correcto, porque nunca se calculó impuesto real para ellas y no
// hay forma de reconstruirlo sin inventar un dato que no existió en el momento de la
// venta.
//
//   node ./seed/migracionImpuestosFactura.js            (muestra qué haría)
//   node ./seed/migracionImpuestosFactura.js --aplicar
//   node ./seed/migracionImpuestosFactura.js --revertir
//
// Idempotente.

const T_DETALLE  = 'DETALLES_FACTURA';
const T_FACTURA   = 'FACTURA_CLIENTES';
const APLICAR  = process.argv.includes('--aplicar');
const REVERTIR = process.argv.includes('--revertir');

const columnas = (tabla) => db.getQueryInterface().describeTable(tabla);

const run = async () => {
    await db.authenticate();

    const colsDetalle = await columnas(T_DETALLE);
    const colsFactura  = await columnas(T_FACTURA);

    if (REVERTIR) {
        // Revertir con datos adentro perdería el desglose de IVA/descuento ya calculado
        // en facturas emitidas después de aplicar esta migración.
        const [{ n }] = await db.query(
            `SELECT COUNT(*) n FROM \`${T_DETALLE}\` WHERE valorImpuesto <> 0 OR porcentajeIva <> 0`
        ).then(([rows]) => rows).catch(() => [{ n: 0 }]);

        if (n > 0) {
            console.error(`✗ ABORTADO: ${n} línea(s) de factura ya tienen IVA calculado.`);
            console.error('  Revertir perdería ese desglose sin forma de recuperarlo.');
            process.exit(1);
        }

        if (colsDetalle.valorImpuesto)      await db.query(`ALTER TABLE \`${T_DETALLE}\` DROP COLUMN valorImpuesto`);
        if (colsDetalle.porcentajeIva)  await db.query(`ALTER TABLE \`${T_DETALLE}\` DROP COLUMN porcentajeIva`);
        if (colsFactura.descuentoMayorista) await db.query(`ALTER TABLE \`${T_FACTURA}\` DROP COLUMN descuentoMayorista`);
        console.log('✓ Revertido.');
        process.exit(0);
    }

    const pasos = [];
    if (!colsDetalle.porcentajeIva)      pasos.push(`${T_DETALLE}.porcentajeIva DECIMAL(5,2) NOT NULL DEFAULT 0`);
    if (!colsDetalle.valorImpuesto)          pasos.push(`${T_DETALLE}.valorImpuesto DECIMAL(15,2) NOT NULL DEFAULT 0`);
    if (!colsFactura.descuentoMayorista) pasos.push(`${T_FACTURA}.descuentoMayorista DECIMAL(12,2) NOT NULL DEFAULT 0`);

    if (!pasos.length) {
        console.log('· Todo aplicado, nada que hacer.');
        process.exit(0);
    }

    console.log('Por aplicar:');
    pasos.forEach(p => console.log(`   + ${p}`));

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/migracionImpuestosFactura.js --aplicar');
        process.exit(0);
    }

    if (!colsDetalle.porcentajeIva) {
        await db.query(
            `ALTER TABLE \`${T_DETALLE}\` ADD COLUMN porcentajeIva DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER subTotal`
        );
        console.log('✓ DETALLES_FACTURA.porcentajeIva agregada');
    }

    if (!colsDetalle.valorImpuesto) {
        await db.query(
            `ALTER TABLE \`${T_DETALLE}\` ADD COLUMN valorImpuesto DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER porcentajeIva`
        );
        console.log('✓ DETALLES_FACTURA.valorImpuesto agregada');
    }

    if (!colsFactura.descuentoMayorista) {
        await db.query(
            `ALTER TABLE \`${T_FACTURA}\` ADD COLUMN descuentoMayorista DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total`
        );
        console.log('✓ FACTURA_CLIENTES.descuentoMayorista agregada');
    }

    console.log('\nColumnas de DETALLES_FACTURA:');
    const [colsD] = await db.query(`SHOW COLUMNS FROM \`${T_DETALLE}\``);
    colsD.forEach(c => console.log(`   ${c.Field.padEnd(22)}${String(c.Type).padEnd(20)}${c.Null === 'YES' ? 'NULL' : 'NOT NULL'}`));

    console.log('\nColumnas de FACTURA_CLIENTES:');
    const [colsF] = await db.query(`SHOW COLUMNS FROM \`${T_FACTURA}\``);
    colsF.forEach(c => console.log(`   ${c.Field.padEnd(22)}${String(c.Type).padEnd(20)}${c.Null === 'YES' ? 'NULL' : 'NOT NULL'}`));

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
