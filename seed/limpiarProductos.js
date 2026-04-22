/**
 * SEEDER — Limpieza de catálogo de productos
 *
 * Elimina en orden seguro (respetando FK):
 *   DetallesPack → DetalleTraslados → Stocks → Packs
 *   → Dosificaciones → Traslados → Imagenes → Productos
 *
 * NO toca: Usuarios, Empleados, PuntosDeVenta, Proveedores,
 *          FacturaProveedores, AbonosProveedores, Cajas,
 *          Categorias, Departamentos, Municipios.
 *
 * Uso:
 *   node ./seed/limpiarProductos.js          → muestra conteos (modo dry-run)
 *   node ./seed/limpiarProductos.js --borrar → ejecuta la eliminación
 */

import db from '../config/bd.js';
import {
    Productos,
    Imagenes,
    Stock,
    Dosificaciones,
    Pack,
    DetallesPack,
    Traslados,
    DetalleTraslados,
} from '../models/index.js';

const TABLAS = [
    { modelo: DetallesPack,     nombre: 'DETALLES_PACK'     },
    { modelo: DetalleTraslados, nombre: 'DETALLE_TRASLADOS'  },
    { modelo: Stock,            nombre: 'STOCKS'             },
    { modelo: Pack,             nombre: 'PACKS'              },
    { modelo: Dosificaciones,   nombre: 'DOSIFICACIONES'     },
    { modelo: Traslados,        nombre: 'TRASLADOS'          },
    { modelo: Imagenes,         nombre: 'IMAGENES'           },
    { modelo: Productos,        nombre: 'PRODUCTOS'          },
];

const contarRegistros = async () => {
    console.log('\n📊  Registros actuales en cada tabla:\n');
    for (const { modelo, nombre } of TABLAS) {
        const count = await modelo.count();
        console.log(`   ${nombre.padEnd(22)} → ${count} registros`);
    }
    console.log('');
};

const limpiar = async () => {
    console.log('\n🗑️   Iniciando limpieza de catálogo...\n');

    for (const { modelo, nombre } of TABLAS) {
        const antes = await modelo.count();
        await modelo.destroy({ where: {}, force: true }); // force:true respeta paranoid
        console.log(`   ✓ ${nombre.padEnd(22)} → ${antes} registros eliminados`);
    }

    console.log('\n✅  Limpieza completada.\n');
    console.log('   Recuerda borrar manualmente las imágenes en Cloudflare R2.\n');
};

const run = async () => {
    try {
        await db.authenticate();
        console.log('🔌  Conexión a DB OK');

        await contarRegistros();

        if (process.argv[2] === '--borrar') {
            await limpiar();
        } else {
            console.log('ℹ️   Modo dry-run. Para ejecutar el borrado corre:');
            console.log('    node ./seed/limpiarProductos.js --borrar\n');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌  Error:', error.message);
        process.exit(1);
    }
};

run();
