import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Filas de STOCKS que apuntan a un producto que ya no existe.
//
// Quedan cuando se borra un producto sin limpiar su stock. No son inertes: el inventario
// de la tienda (adminControllers.js, la consulta que arma la vista por punto de venta) une
// con PRODUCTOS por LEFT JOIN, así que estas filas aparecen en la lista con el nombre en
// blanco. Y las que todavía declaran existencia suman unidades que no se pueden vender,
// porque el producto al que pertenecían ya no está.
//
// Solo borra filas cuyo idProducto NO resuelve. Una fila con producto vivo no se toca
// jamás, sea cual sea su estado: eso es inventario de verdad.
//
//   node ./seed/limpiarStockHuerfano.js            (muestra qué haría)
//   node ./seed/limpiarStockHuerfano.js --aplicar
//
// No es reversible. Antes de aplicar conviene correrlo sobre una copia.

const APLICAR = process.argv.includes('--aplicar');
const pesos = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');

const run = async () => {
    await db.authenticate();
    const [{ bd }] = await db.query('SELECT DATABASE() bd', { type: QueryTypes.SELECT });
    console.log(`base: ${bd}\n`);

    const huerfanas = await db.query(`
        SELECT s.idStock, s.idProducto, s.cantidadExistente, s.valorUnidad, s.estadoInterno,
               s.createdAt, pv.nombreComercial tienda
        FROM STOCKS s
        LEFT JOIN PRODUCTOS p       ON p.idProducto     = s.idProducto
        LEFT JOIN PUNTO_DE_VENTA pv ON pv.idPuntoDeVenta = s.idPuntoVenta
        WHERE s.idProducto IS NOT NULL AND p.idProducto IS NULL
        ORDER BY s.createdAt`, { type: QueryTypes.SELECT });

    if (!huerfanas.length) { console.log('· No hay stock huérfano. Nada que hacer.'); process.exit(0); }

    const conExistencia = huerfanas.filter(f => Number(f.cantidadExistente) > 0);
    const unidades = conExistencia.reduce((a, f) => a + Number(f.cantidadExistente), 0);
    const valor    = conExistencia.reduce((a, f) => a + Number(f.cantidadExistente) * Number(f.valorUnidad || 0), 0);

    const porTienda = {};
    huerfanas.forEach(f => { const k = f.tienda || '(sin tienda)'; porTienda[k] = (porTienda[k] || 0) + 1; });

    console.log(`${huerfanas.length} fila(s) de STOCKS apuntan a un producto inexistente`);
    Object.entries(porTienda).forEach(([t, n]) => console.log(`   ${t.padEnd(20)} ${n}`));
    console.log(`\nRango: ${new Date(huerfanas[0].createdAt).toLocaleDateString('es-CO')} → ${new Date(huerfanas.at(-1).createdAt).toLocaleDateString('es-CO')}`);

    if (conExistencia.length) {
        console.log(`\n⚠ ${conExistencia.length} de ellas todavía declaran existencia: ${unidades} unidad(es), ${pesos(valor)}`);
        console.log('  Es inventario que el sistema cree tener y que no se puede vender: el producto');
        console.log('  al que pertenecía ya no existe. Al borrarlas ese número deja de aparecer.');
        conExistencia.forEach(f => console.log(`     ${f.tienda || '—'} · ${f.cantidadExistente} u. × ${pesos(f.valorUnidad)} · ${f.estadoInterno}`));
    } else {
        console.log('\n· Ninguna declara existencia: no cambia ningún número de inventario.');
    }

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/limpiarStockHuerfano.js --aplicar');
        process.exit(0);
    }

    const ids = huerfanas.map(f => f.idStock);

    await db.transaction(async (t) => {
        // El DELETE repite la condición de orfandad en vez de confiar en la lista leída
        // antes: si entre la lectura y el borrado alguien recreó un producto con ese id,
        // esa fila deja de ser huérfana y no debe borrarse.
        await db.query(`
            DELETE s FROM STOCKS s
            LEFT JOIN PRODUCTOS p ON p.idProducto = s.idProducto
            WHERE s.idStock IN (:ids) AND s.idProducto IS NOT NULL AND p.idProducto IS NULL`,
            { replacements: { ids }, transaction: t });
    });

    const [{ quedan }] = await db.query(`
        SELECT COUNT(*) quedan FROM STOCKS s
        LEFT JOIN PRODUCTOS p ON p.idProducto = s.idProducto
        WHERE s.idProducto IS NOT NULL AND p.idProducto IS NULL`, { type: QueryTypes.SELECT });

    console.log(`\n✓ ${huerfanas.length} fila(s) eliminadas · huérfanas restantes: ${quedan}`);
    process.exit(0);
};

run().catch((e) => { console.error('Falló:', e.message || e); process.exit(1); });
