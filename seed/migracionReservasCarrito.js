import dotenv from 'dotenv';
import db from '../config/bd.js';

dotenv.config();

// Crea RESERVAS_CARRITO: las intenciones de compra vivas (carrito web / orden de POS) que
// alimentan el aviso de "otros clientes tienen este producto cargado".
// Es idempotente: se puede correr varias veces sin romper nada.
//
//   node ./seed/migracionReservasCarrito.js

const TABLA = 'RESERVAS_CARRITO';
const FK_PRODUCTO = 'fk_reservas_carrito_producto';
const FK_PUNTO    = 'fk_reservas_carrito_punto';

const run = async () => {
    const qi = db.getQueryInterface();
    await db.authenticate();

    const { ReservasCarrito } = await import('../models/index.js');
    await ReservasCarrito.sync();
    console.log(`✓ tabla ${TABLA} lista`);

    // Las FK van aparte: sync() no las crea y así se puede reportar si ya existían.
    // ON DELETE CASCADE: si el producto se borra, su intención de compra no tiene sentido.
    const fks = [
        { nombre: FK_PRODUCTO, campo: 'idProducto',     tabla: 'PRODUCTOS',      pk: 'idProducto',     alBorrar: 'CASCADE'  },
        { nombre: FK_PUNTO,    campo: 'idPuntoDeVenta', tabla: 'PUNTO_DE_VENTA', pk: 'idPuntoDeVenta', alBorrar: 'SET NULL' },
    ];

    for (const fk of fks) {
        try {
            await qi.addConstraint(TABLA, {
                fields: [fk.campo],
                type: 'foreign key',
                name: fk.nombre,
                references: { table: fk.tabla, field: fk.pk },
                onUpdate: 'CASCADE',
                onDelete: fk.alBorrar
            });
            console.log(`✓ FK ${fk.nombre} agregada`);
        } catch (e) {
            if (/Duplicate|already exists|errno: 121/i.test(e.message)) {
                console.log(`· FK ${fk.nombre} ya existe, se omite`);
            } else {
                console.warn(`! No se pudo crear ${fk.nombre}:`, e.message);
            }
        }
    }

    console.log('\nMigración de RESERVAS_CARRITO completada.');
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
