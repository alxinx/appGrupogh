import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Elimina la tabla CAJAS y su módulo.
//
// CAJAS era un diseño que nunca se llegó a usar: 0 filas, ningún controlador, ninguna
// ruta, ninguna vista. La caja que sí opera el negocio es CAJA_TIENDA (modelo
// CajaTienda) — esta migración NO la toca.
//
// El único vínculo real era la FK ABONOS_PROVEEDORES.idCaja → CAJAS. Esa tabla también
// está vacía y sin código que la use, así que se suelta la restricción y se conserva la
// columna: rediseñar el módulo de abonos a proveedores es otra decisión.
//
// Antes de correr esto se verificó, contra la base:
//   · CAJAS ......................... 0 filas
//   · ABONOS_PROVEEDORES ............ 0 filas  (única tabla que la referenciaba)
//   · CAJA_TIENDA ................... 45 filas (en uso, intacta)
//
//   node ./seed/migracionEliminarCajas.js
//   node ./seed/migracionEliminarCajas.js --revertir
//
// Es idempotente y se puede revertir: --revertir vuelve a crear la tabla y la FK tal
// como estaban (los datos no se recuperan, pero no había ninguno).

const REVERTIR = process.argv.includes('--revertir');
const FK_ABONOS = 'abonos_proveedores_ibfk_2';

// DDL exacto de la tabla al momento de eliminarla.
const CREAR_CAJAS = `
CREATE TABLE \`CAJAS\` (
  \`idCaja\` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  \`nombre\` varchar(100) NOT NULL,
  \`tipo\` enum('Efectivo','Banco','Billetera Virtual','Caja Menor') NOT NULL,
  \`numeroCuenta\` varchar(20) DEFAULT NULL,
  \`idPuntoDeVenta\` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  \`saldoActual\` decimal(15,2) DEFAULT '0.00',
  \`moneda\` varchar(3) DEFAULT 'COP',
  \`createdAt\` datetime NOT NULL,
  \`updatedAt\` datetime NOT NULL,
  PRIMARY KEY (\`idCaja\`),
  KEY \`idPuntoDeVenta\` (\`idPuntoDeVenta\`),
  CONSTRAINT \`cajas_ibfk_1\` FOREIGN KEY (\`idPuntoDeVenta\`) REFERENCES \`PUNTO_DE_VENTA\` (\`idPuntoDeVenta\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

const existeTabla = async (tabla) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tabla`,
        { replacements: { tabla }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

const existeFk = async (tabla, nombre) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tabla AND CONSTRAINT_NAME = :nombre`,
        { replacements: { tabla, nombre }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        if (await existeTabla('CAJAS')) {
            console.log('· CAJAS ya existe, se omite');
        } else {
            await db.query(CREAR_CAJAS);
            console.log('✓ CAJAS recreada');
        }
        if (await existeFk('ABONOS_PROVEEDORES', FK_ABONOS)) {
            console.log(`· ${FK_ABONOS} ya existe, se omite`);
        } else {
            await db.query(
                `ALTER TABLE ABONOS_PROVEEDORES
                 ADD CONSTRAINT ${FK_ABONOS} FOREIGN KEY (idCaja) REFERENCES CAJAS (idCaja)`
            );
            console.log(`✓ ${FK_ABONOS} restaurada`);
        }
        console.log('\nReversión completada. Falta restaurar models/Cajas.js desde git.');
        process.exit(0);
    }

    if (!(await existeTabla('CAJAS'))) {
        console.log('· CAJAS no existe, nada que eliminar');
        process.exit(0);
    }

    // Guarda de seguridad: si alguien cargó datos entre la auditoría y esta corrida,
    // no se borra nada. Un DROP de una tabla financiera con filas adentro no se
    // deshace con --revertir.
    const [{ n }] = await db.query('SELECT COUNT(*) n FROM CAJAS', { type: QueryTypes.SELECT });
    if (n > 0) {
        console.error(`✗ ABORTADO: CAJAS tiene ${n} fila(s). Se esperaba que estuviera vacía.`);
        console.error('  Revisá el contenido antes de eliminarla; --revertir no recupera datos.');
        process.exit(1);
    }

    // La FK va primero: MySQL no deja soltar una tabla referenciada.
    if (await existeFk('ABONOS_PROVEEDORES', FK_ABONOS)) {
        await db.query(`ALTER TABLE ABONOS_PROVEEDORES DROP FOREIGN KEY ${FK_ABONOS}`);
        console.log(`✓ FK ${FK_ABONOS} eliminada (ABONOS_PROVEEDORES.idCaja queda como columna suelta)`);
    } else {
        console.log(`· FK ${FK_ABONOS} no existe, se omite`);
    }

    await db.query('DROP TABLE CAJAS');
    console.log('✓ CAJAS eliminada');

    console.log('\nEliminación completada. CAJA_TIENDA no fue tocada.');
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
