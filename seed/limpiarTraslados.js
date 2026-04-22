/**
 * SEEDER — Formateo de Traslados y Dosificaciones
 *
 * Elimina en orden seguro (respetando FK):
 *   DetallesPack → DetalleTraslados → Stocks (de packs) → Packs
 *   → Dosificaciones → Traslados
 *
 * NO toca: Usuarios, Empleados, PuntosDeVenta, Productos,
 *          Proveedores, FacturaProveedores, Cajas, Categorias.
 *
 * Uso:
 *   node ./seed/limpiarTraslados.js           → muestra conteos (dry-run)
 *   node ./seed/limpiarTraslados.js --borrar  → ejecuta la eliminación
 */

import db from '../config/bd.js';
import { Op } from 'sequelize';
import {
    Dosificaciones,
    Pack,
    DetallesPack,
    Traslados,
    DetalleTraslados,
    Stock,
} from '../models/index.js';

const TABLAS = [
    { modelo: DetallesPack,     nombre: 'DETALLES_PACK'    },
    { modelo: DetalleTraslados, nombre: 'DETALLE_TRASLADOS' },
    { modelo: Stock,            nombre: 'STOCKS (de packs)' },
    { modelo: Pack,             nombre: 'PACKS'             },
    { modelo: Dosificaciones,   nombre: 'DOSIFICACIONES'    },
    { modelo: Traslados,        nombre: 'TRASLADOS'         },
];

const contarRegistros = async () => {
    console.log('\n  Registros actuales:\n');

    const counts = await Promise.all([
        DetallesPack.count(),
        DetalleTraslados.count(),
        Stock.count({ where: { idPack: { [Op.not]: null } } }),
        Pack.count(),
        Dosificaciones.count(),
        Traslados.count(),
    ]);

    TABLAS.forEach(({ nombre }, i) => {
        console.log(`   ${nombre.padEnd(24)} → ${counts[i]} registros`);
    });
    console.log('');
};

const limpiar = async () => {
    const t = await db.transaction();
    try {
        console.log('\n  Iniciando formateo...\n');

        const dp = await DetallesPack.destroy({ where: {}, force: true, transaction: t });
        console.log(`   DETALLES_PACK         → ${dp} eliminados`);

        const dt = await DetalleTraslados.destroy({ where: {}, force: true, transaction: t });
        console.log(`   DETALLE_TRASLADOS     → ${dt} eliminados`);

        const st = await Stock.destroy({ where: { idPack: { [Op.not]: null } }, force: true, transaction: t });
        console.log(`   STOCKS (de packs)     → ${st} eliminados`);

        const pk = await Pack.destroy({ where: {}, force: true, transaction: t });
        console.log(`   PACKS                 → ${pk} eliminados`);

        const dos = await Dosificaciones.destroy({ where: {}, force: true, transaction: t });
        console.log(`   DOSIFICACIONES        → ${dos} eliminados`);

        const tr = await Traslados.destroy({ where: {}, force: true, transaction: t });
        console.log(`   TRASLADOS             → ${tr} eliminados`);

        await t.commit();
        console.log('\n  Formateo completado.\n');
    } catch (error) {
        await t.rollback();
        throw error;
    }
};

const run = async () => {
    try {
        await db.authenticate();
        console.log('  Conexion a DB OK');

        await contarRegistros();

        if (process.argv[2] === '--borrar') {
            await limpiar();
        } else {
            console.log('  Modo dry-run. Para ejecutar el borrado corre:');
            console.log('  node ./seed/limpiarTraslados.js --borrar\n');
        }

        process.exit(0);
    } catch (error) {
        console.error('  Error:', error.message);
        process.exit(1);
    }
};

run();
