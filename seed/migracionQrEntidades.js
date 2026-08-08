import { DataTypes } from 'sequelize';
import dotenv from 'dotenv';
import db from '../config/bd.js';

dotenv.config();

// db.sync() sin `alter` crea tablas nuevas pero NO agrega columnas a una tabla que ya
// existe. Esta migración agrega las columnas del QR de pago a ENTIDADES. Es idempotente:
// se puede correr varias veces sin romper nada.
//
//   node ./seed/migracionQrEntidades.js

const COLUMNAS = {
    qrObjectKey:  { type: DataTypes.STRING(255), allowNull: true },
    qrHashSha256: { type: DataTypes.STRING(64),  allowNull: true },
    qrEnabled:    { type: DataTypes.BOOLEAN,     allowNull: false, defaultValue: false },
    qrUploadedAt: { type: DataTypes.DATE,        allowNull: true },
    qrUploadedBy: { type: DataTypes.UUID,        allowNull: true },
    qrStatus:     { type: DataTypes.ENUM('active', 'replaced', 'compromised'), allowNull: true },
};

const run = async () => {
    const qi = db.getQueryInterface();
    await db.authenticate();

    const actuales = await qi.describeTable('ENTIDADES');

    for (const [nombre, definicion] of Object.entries(COLUMNAS)) {
        if (actuales[nombre]) {
            console.log(`· ${nombre} ya existe, se omite`);
            continue;
        }
        await qi.addColumn('ENTIDADES', nombre, definicion);
        console.log(`✓ ${nombre} agregada`);
    }

    // La FK a USUARIOS se agrega aparte: si la tabla tiene datos previos, la columna
    // debe existir (y ser nullable) antes de poder referenciarla.
    try {
        await qi.addConstraint('ENTIDADES', {
            fields: ['qrUploadedBy'],
            type: 'foreign key',
            name: 'fk_entidades_qr_uploaded_by',
            references: { table: 'USUARIOS', field: 'idUsuario' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });
        console.log('✓ FK fk_entidades_qr_uploaded_by agregada');
    } catch (e) {
        if (/Duplicate|already exists|errno: 121/i.test(e.message)) {
            console.log('· FK fk_entidades_qr_uploaded_by ya existe, se omite');
        } else {
            console.warn('! No se pudo crear la FK:', e.message);
        }
    }

    // La tabla de historial sí la crea db.sync(), pero se asegura aquí para que la
    // migración deje el esquema completo aunque DB_SYNC esté apagado.
    const { EntidadesQrHistorial } = await import('../models/index.js');
    await EntidadesQrHistorial.sync();
    console.log('✓ ENTIDADES_QR_HISTORIAL lista');

    console.log('\nMigración del QR de pago completada.');
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
