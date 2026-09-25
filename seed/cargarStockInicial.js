/**
 * SEEDER — Carga de inventario inicial
 *
 * Crea una fila de STOCKS por cada producto en cada punto de venta indicado, con la misma
 * cantidad. Es una carga directa: no genera traslado ni dosificación, el inventario queda
 * disponible en el acto. Sirve para dejar la base lista después de un formateo.
 *
 * `valorUnidad` sale del `costo` del producto, que es lo que vale esa unidad en inventario
 * —no el precio de venta—. Es el mismo criterio con el que `crearStockRow` copia el valor
 * de la última fila conocida cuando ya hay stock.
 *
 * Las filas nacen SUELTO y sin pack: un pack cerrado se crea por dosificación, no por acá.
 *
 * Uso:
 *   node ./seed/cargarStockInicial.js --unidades=10000 --tiendas="GH 102,Grupo GH Redes"
 *   node ./seed/cargarStockInicial.js --unidades=10000 --tiendas="GH 102" --cargar --base=grupogh
 *
 * Opcionales:
 *   --solo-activos   omite los productos con activo=0
 */

import db from '../config/bd.js';
import { Productos, PuntosDeVenta, Stock } from '../models/index.js';

const args = process.argv.slice(2);
const tiene = (b) => args.includes(b);
const valor = (b) => args.find(a => a.startsWith(`${b}=`))?.split('=').slice(1).join('=') || null;

const UNIDADES = parseInt(valor('--unidades'), 10);
const TIENDAS = (valor('--tiendas') || '').split(',').map(s => s.trim()).filter(Boolean);
const EJECUTAR = tiene('--cargar');
const SOLO_ACTIVOS = tiene('--solo-activos');
const LOTE = 500;   // filas por bulkCreate: 5.000 en una sola sentencia revienta el paquete de MySQL

const titulo = (t) => console.log(`\n${'─'.repeat(72)}\n  ${t}\n${'─'.repeat(72)}`);

const run = async () => {
    try {
        await db.authenticate();
        console.log(`\n  Base: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);

        if (!Number.isInteger(UNIDADES) || UNIDADES <= 0) {
            throw new Error(`--unidades tiene que ser un entero mayor a 0 (llegó "${valor('--unidades')}").`);
        }
        if (!TIENDAS.length) throw new Error('Falta --tiendas="Nombre 1,Nombre 2" (nombre comercial exacto).');

        const puntos = await PuntosDeVenta.findAll({ where: { nombreComercial: TIENDAS }, raw: true });
        const faltan = TIENDAS.filter(n => !puntos.some(p => p.nombreComercial === n));
        if (faltan.length) throw new Error(`No existen estos puntos de venta: ${faltan.join(', ')}`);

        const productos = await Productos.findAll({
            where: SOLO_ACTIVOS ? { activo: true } : {},
            attributes: ['idProducto', 'costo'], raw: true
        });
        if (!productos.length) throw new Error('No hay productos que cargar.');

        titulo('LO QUE SE VA A CREAR');
        console.log(`   Productos                 ${productos.length}${SOLO_ACTIVOS ? ' (solo activos)' : ''}`);
        console.log(`   Unidades por producto     ${UNIDADES.toLocaleString('es-CO')}`);
        puntos.forEach(p => console.log(`   · ${p.nombreComercial.padEnd(22)} ${productos.length} filas · ` +
            `${(productos.length * UNIDADES).toLocaleString('es-CO')} unidades`));
        const filasTotales = productos.length * puntos.length;
        console.log(`\n   TOTAL                     ${filasTotales.toLocaleString('es-CO')} filas de STOCKS · ` +
            `${(filasTotales * UNIDADES).toLocaleString('es-CO')} unidades`);

        // Lo que ya tiene stock no se duplica: el aviso importa porque dos filas del mismo
        // producto en la misma tienda no son un error para la base, pero sí descuadran el
        // inventario que ve el vendedor.
        const yaHay = await Stock.count({ where: { idPuntoVenta: puntos.map(p => p.idPuntoDeVenta) } });
        if (yaHay) console.log(`\n   ⚠️  Esos puntos de venta ya tienen ${yaHay} filas de stock: esta carga SUMA, no reemplaza.`);

        if (!EJECUTAR) {
            titulo('MODO ENSAYO — no se creó nada');
            console.log(`\n   ...agregá --cargar --base=${process.env.DB_NAME}\n`);
            return process.exit(0);
        }
        if (valor('--base') !== process.env.DB_NAME) {
            throw new Error(`Falta --base=${process.env.DB_NAME}: se escribe a mano para confirmar contra qué base se corre.`);
        }

        titulo('CARGANDO');
        const t = await db.transaction();
        try {
            for (const p of puntos) {
                let creadas = 0;
                for (let i = 0; i < productos.length; i += LOTE) {
                    const filas = productos.slice(i, i + LOTE).map(prod => ({
                        idPuntoVenta:      p.idPuntoDeVenta,
                        idProducto:        prod.idProducto,
                        idPack:            null,
                        idFacturaPro:      null,
                        cantidadExistente: UNIDADES,
                        cantidadOriginal:  UNIDADES,
                        valorUnidad:       parseFloat(prod.costo) || 0,
                        estadoInterno:     'SUELTO'
                    }));
                    await Stock.bulkCreate(filas, { transaction: t });
                    creadas += filas.length;
                }
                console.log(`   ${p.nombreComercial.padEnd(24)} ${String(creadas).padStart(6)} filas`);
            }
            await t.commit();
            console.log('\n  Listo.');
        } catch (e) {
            if (!t.finished) await t.rollback().catch(() => {});
            throw e;
        }
        process.exit(0);
    } catch (e) {
        console.error(`\n  ✗ ${e.message}\n`);
        process.exit(1);
    }
};

run();
