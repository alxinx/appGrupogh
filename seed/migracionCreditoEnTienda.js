import dotenv from 'dotenv';
import db from '../config/bd.js';

dotenv.config();

// Agrega 'Credito En Tienda' a DETALLES_PAGOS_FACTURA.metodoPago (distinto de 'Entidad
// Crediticia': esa es una financiera de terceros que ya pagó, esto es la tienda misma
// financiando al cliente — no entra plata) y las columnas de CAJA_TIENDA para su propio
// bucket en el cuadre de caja (ventasCreditoTienda / ventasCreditoTiendaRegistrada),
// separado de ventasCredito (Entidad Crediticia) a propósito — ver el comentario de
// models/DetallesPagosFactura.js y models/CajaTienda.js.
//
//   node ./seed/migracionCreditoEnTienda.js
//   node ./seed/migracionCreditoEnTienda.js --revertir

const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const colsCaja = await db.getQueryInterface().describeTable('CAJA_TIENDA');

    if (REVERTIR) {
        const [{ n }] = await db.query(
            `SELECT COUNT(*) n FROM DETALLES_PAGOS_FACTURA WHERE metodoPago = 'Credito En Tienda'`,
            { type: db.QueryTypes.SELECT }
        );
        if (n > 0) {
            console.log(`⚠ Hay ${n} pago(s) con metodoPago='Credito En Tienda' — no se puede revertir el ENUM sin decidir a qué valor migrarlos. Abortado.`);
            process.exit(1);
        }
        await db.query(`
            ALTER TABLE DETALLES_PAGOS_FACTURA
            MODIFY COLUMN metodoPago ENUM('Banco','Billetera Virtual','Entidad Crediticia','Tarjeta Credito','Efectivo') NOT NULL
        `);
        console.log('✓ Credito En Tienda eliminado del ENUM de metodoPago');

        if (colsCaja.ventasCreditoTienda || colsCaja.ventasCreditoTiendaRegistrada) {
            if (colsCaja.ventasCreditoTiendaRegistrada) await db.getQueryInterface().removeColumn('CAJA_TIENDA', 'ventasCreditoTiendaRegistrada');
            if (colsCaja.ventasCreditoTienda)          await db.getQueryInterface().removeColumn('CAJA_TIENDA', 'ventasCreditoTienda');
            console.log('✓ ventasCreditoTienda/ventasCreditoTiendaRegistrada eliminadas de CAJA_TIENDA');
        }
        process.exit(0);
    }

    await db.query(`
        ALTER TABLE DETALLES_PAGOS_FACTURA
        MODIFY COLUMN metodoPago ENUM('Banco','Billetera Virtual','Entidad Crediticia','Tarjeta Credito','Efectivo','Credito En Tienda') NOT NULL
    `);
    console.log('✓ Credito En Tienda agregado al ENUM de metodoPago (DETALLES_PAGOS_FACTURA)');

    if (!colsCaja.ventasCreditoTienda) {
        await db.query(`ALTER TABLE CAJA_TIENDA ADD COLUMN ventasCreditoTienda DECIMAL(10,2) NULL DEFAULT 0 AFTER ventasCreditoRegistradas`);
        console.log('✓ ventasCreditoTienda agregada a CAJA_TIENDA');
    } else {
        console.log('· ventasCreditoTienda ya existe, se omite');
    }

    if (!colsCaja.ventasCreditoTiendaRegistrada) {
        await db.query(`ALTER TABLE CAJA_TIENDA ADD COLUMN ventasCreditoTiendaRegistrada DECIMAL(10,2) NULL DEFAULT 0 AFTER ventasCreditoTienda`);
        console.log('✓ ventasCreditoTiendaRegistrada agregada a CAJA_TIENDA');
    } else {
        console.log('· ventasCreditoTiendaRegistrada ya existe, se omite');
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
