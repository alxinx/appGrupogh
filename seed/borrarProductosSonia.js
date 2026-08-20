import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Borra un lote de productos por SKU, con todo lo que cuelga de ellos.
//
// A diferencia de `limpiarProductos.js`, que vacía el catálogo entero, esto toma una lista
// explícita. La lista está escrita acá adentro y no se pasa por parámetro a propósito:
// un borrado de producción no debe depender de lo que alguien alcance a teclear bien en
// una terminal.
//
// SE NIEGA A BORRAR un producto que tenga historia: ventas, compras a proveedor, pedidos
// web o reservas. Esas tablas son el respaldo de plata que entró o salió, y una línea de
// factura que apunta a un producto inexistente convierte un informe en un agujero. Si
// aparece alguno, el script aborta y dice cuál: la decisión de qué hacer con un producto
// vendido no la toma un script.
//
// Todo va en una transacción. Si algo falla a mitad no queda un producto sin variación ni
// una familia sin productos.
//
//   node ./seed/borrarProductosSonia.js            (muestra qué haría)
//   node ./seed/borrarProductosSonia.js --aplicar
//
// NO toca los archivos en Cloudflare R2: borra las filas de IMAGENES y los .webp quedan
// en el bucket. Eso es otro sistema y no se recupera, así que se limpia aparte y a mano.

const SKUS = [
    'VESTIDOSONIANEGR', 'VESTIDOSONIAAMAR', 'VESTIDOSONIAROSA',
    'VESTIDOSONIAVERD', 'VESTIDOSONIABEIG', 'VESTIDOSONIAROJO',
    'CAMISETASUPRIMEBASICANEGRS', 'CAMISETASUPRIMEBASICABLANS',
    'CAMISETASUPRIMEBASICANEGRM', 'CAMISETASUPRIMEBASICACHOCM'
];

const APLICAR = process.argv.includes('--aplicar');

// Tablas que guardan historia. Si hay una sola fila acá, el borrado no procede.
const HISTORIA = [
    { tabla: 'DETALLES_FACTURA',             que: 'ventas a clientes' },
    { tabla: 'DETALLES_FACTURA_PROVEEDORES', que: 'compras a proveedor' },
    { tabla: 'DETALLES_PEDIDO_WEB',          que: 'pedidos web' }
];

// Tablas que solo describen al producto: se borran con él.
const DEPENDENCIAS = [
    { tabla: 'RESERVAS_CARRITO',   que: 'reservas de carrito' },
    { tabla: 'STOCKS',             que: 'stock' },
    { tabla: 'IMAGENES',           que: 'imágenes' },
    { tabla: 'PRODUCTO_CATEGORIAS', que: 'categorías' },
    { tabla: 'VARIACION_PRODUCTO', que: 'variaciones' }
];

const existeTabla = async (t) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t }, type: QueryTypes.SELECT }
    );
    return Number(r.n) > 0;
};

const run = async () => {
    await db.authenticate();
    const [{ bd }] = await db.query('SELECT DATABASE() bd', { type: QueryTypes.SELECT });
    console.log(`base: ${bd}\n`);

    const productos = await db.query(
        'SELECT idProducto, sku, nombreProducto, idFamilia FROM PRODUCTOS WHERE sku IN (:s) ORDER BY sku',
        { replacements: { s: SKUS }, type: QueryTypes.SELECT }
    );

    const faltantes = SKUS.filter(s => !productos.find(p => p.sku === s));
    console.log(`${productos.length} de ${SKUS.length} productos encontrados`);
    productos.forEach(p => console.log(`   ${p.sku.padEnd(28)} ${p.nombreProducto}`));
    if (faltantes.length) console.log(`\n· No existen (se ignoran): ${faltantes.join(', ')}`);
    if (!productos.length) { console.log('\nNada que borrar.'); process.exit(0); }

    const ids = productos.map(p => p.idProducto);

    // ── Freno: historia ──────────────────────────────────────────────────────
    console.log('\nHistoria asociada:');
    let bloqueado = false;
    for (const h of HISTORIA) {
        if (!await existeTabla(h.tabla)) continue;
        const [r] = await db.query(
            `SELECT COUNT(*) n FROM \`${h.tabla}\` WHERE idProducto IN (:ids)`,
            { replacements: { ids }, type: QueryTypes.SELECT }
        );
        const n = Number(r.n);
        console.log(`   ${h.tabla.padEnd(30)} ${n}`);
        if (n > 0) bloqueado = true;
    }

    if (bloqueado) {
        console.error('\n✗ ABORTADO: alguno de estos productos tiene movimientos registrados.');
        console.error('  Borrarlo dejaría líneas de factura apuntando a un producto que no existe.');
        console.error('  Desactivalo (activo=0, web=0) en vez de borrarlo, o decidí caso por caso.');
        process.exit(1);
    }

    // ── Qué se va a borrar ───────────────────────────────────────────────────
    console.log('\nSe eliminaría:');
    const plan = [];
    for (const d of DEPENDENCIAS) {
        if (!await existeTabla(d.tabla)) continue;
        const [r] = await db.query(
            `SELECT COUNT(*) n FROM \`${d.tabla}\` WHERE idProducto IN (:ids)`,
            { replacements: { ids }, type: QueryTypes.SELECT }
        );
        plan.push({ tabla: d.tabla, n: Number(r.n) });
        console.log(`   ${d.tabla.padEnd(30)} ${r.n}`);
    }
    console.log(`   ${'PRODUCTOS'.padEnd(30)} ${productos.length}`);

    // Familias que se quedan sin ningún producto. Solo esas: una familia con hermanos
    // vivos se queda donde está.
    const familias = [...new Set(productos.map(p => p.idFamilia).filter(Boolean))];
    const vacias = [];
    for (const f of familias) {
        const [r] = await db.query(
            'SELECT COUNT(*) n FROM PRODUCTOS WHERE idFamilia = :f AND idProducto NOT IN (:ids)',
            { replacements: { f, ids }, type: QueryTypes.SELECT }
        );
        const [nom] = await db.query('SELECT nombreFamilia FROM FAMILIA WHERE idFamilia = :f', { replacements: { f }, type: QueryTypes.SELECT });
        if (Number(r.n) === 0) { vacias.push(f); console.log(`   ${'FAMILIA'.padEnd(30)} ${nom?.nombreFamilia || f} (queda sin productos)`); }
        else console.log(`   · familia ${nom?.nombreFamilia || f} conserva ${r.n} producto(s): NO se borra`);
    }

    // Archivos que quedan huérfanos en el bucket.
    if (await existeTabla('IMAGENES')) {
        const imgs = await db.query(
            'SELECT nombreImagen FROM IMAGENES WHERE idProducto IN (:ids)',
            { replacements: { ids }, type: QueryTypes.SELECT }
        );
        if (imgs.length) {
            console.log(`\n⚠ ${imgs.length} archivo(s) quedan en Cloudflare R2 sin fila que los referencie:`);
            imgs.forEach(i => console.log(`   ${i.nombreImagen}`));
            console.log('  Este script no borra del bucket. Hay que limpiarlos aparte.');
        }
    }

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/borrarProductosSonia.js --aplicar');
        process.exit(0);
    }

    // ── Borrado, todo o nada ─────────────────────────────────────────────────
    await db.transaction(async (t) => {
        for (const p of plan) {
            if (!p.n) continue;
            await db.query(`DELETE FROM \`${p.tabla}\` WHERE idProducto IN (:ids)`, { replacements: { ids }, transaction: t });
        }
        await db.query('DELETE FROM PRODUCTOS WHERE idProducto IN (:ids)', { replacements: { ids }, transaction: t });
        if (vacias.length) {
            await db.query('DELETE FROM FAMILIA WHERE idFamilia IN (:f)', { replacements: { f: vacias }, transaction: t });
        }
    });

    console.log('\n✓ Borrado completo.');

    const [{ quedan }] = await db.query(
        'SELECT COUNT(*) quedan FROM PRODUCTOS WHERE sku IN (:s)',
        { replacements: { s: SKUS }, type: QueryTypes.SELECT }
    );
    console.log(`  Productos de la lista que quedan en la base: ${quedan}`);
    process.exit(0);
};

run().catch((e) => { console.error('Falló:', e.message || e); process.exit(1); });
