import { DataTypes } from 'sequelize';
import dotenv from 'dotenv';
import db from '../config/bd.js';

dotenv.config();

// Columnas del pago por QR en PEDIDOS_WEB + el nuevo valor 'qr' del ENUM metodoPago.
// db.sync() sin `alter` no toca tablas existentes, por eso va aparte. Idempotente.
//
//   node ./seed/migracionPagoQrPedidos.js

const COLUMNAS = {
    idEntidadPagoQr:    { type: DataTypes.INTEGER,    allowNull: true },
    comprobantePagoKey: { type: DataTypes.STRING(255), allowNull: true },
    comprobantePagoAt:  { type: DataTypes.DATE,       allowNull: true },
    pagoQrReferencia:   { type: DataTypes.STRING(50), allowNull: true },
    pagoQrValor:        { type: DataTypes.DECIMAL(15, 2), allowNull: true },
};

const run = async () => {
    const qi = db.getQueryInterface();
    await db.authenticate();

    // 1 — Ampliar el ENUM. MySQL no tiene "add value", se redefine la columna completa.
    const [[col]] = await db.query("SHOW COLUMNS FROM PEDIDOS_WEB LIKE 'metodoPago'");
    if (col?.Type?.includes("'qr'")) {
        console.log("· metodoPago ya acepta 'qr', se omite");
    } else {
        await db.query("ALTER TABLE PEDIDOS_WEB MODIFY COLUMN metodoPago ENUM('contraentrega','tarjeta','pse','nequi','qr') NOT NULL");
        console.log("✓ metodoPago ahora acepta 'qr'");
    }

    // 2 — Columnas nuevas
    const actuales = await qi.describeTable('PEDIDOS_WEB');
    for (const [nombre, definicion] of Object.entries(COLUMNAS)) {
        if (actuales[nombre]) {
            console.log(`· ${nombre} ya existe, se omite`);
            continue;
        }
        await qi.addColumn('PEDIDOS_WEB', nombre, definicion);
        console.log(`✓ ${nombre} agregada`);
    }

    // 3 — FK a ENTIDADES
    try {
        await qi.addConstraint('PEDIDOS_WEB', {
            fields: ['idEntidadPagoQr'],
            type: 'foreign key',
            name: 'fk_pedidos_web_entidad_qr',
            references: { table: 'ENTIDADES', field: 'idEntidad' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });
        console.log('✓ FK fk_pedidos_web_entidad_qr agregada');
    } catch (e) {
        if (/Duplicate|already exists|errno: 121/i.test(e.message)) {
            console.log('· FK fk_pedidos_web_entidad_qr ya existe, se omite');
        } else {
            console.warn('! No se pudo crear la FK:', e.message);
        }
    }

    console.log('\nMigración del pago por QR en pedidos web completada.');
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
