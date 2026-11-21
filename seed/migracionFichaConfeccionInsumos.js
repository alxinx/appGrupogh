import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea FICHAS_CONFECCION_INSUMOS — insumos adicionales de una ficha de confección (botones,
// cierres, elástico…), opcionales y aparte del texto libre de "Complementos". Ver
// models/FichaConfeccionInsumo.js.
//
//   node ./seed/migracionFichaConfeccionInsumos.js
//   node ./seed/migracionFichaConfeccionInsumos.js --revertir
//
// Idempotente.

const TABLA = 'FICHAS_CONFECCION_INSUMOS';
const TABLA_FICHA = 'FICHAS_CONFECCION';
const REVERTIR = process.argv.includes('--revertir');

const existeTabla = async (tabla) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t: tabla }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

// La collation real de cada columna referenciada — nunca asumida (mismo motivo que el
// resto de migraciones de este módulo: un FK que no calce exacto falla con el Error 3780
// de MySQL).
const collationDeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT COLLATION_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    if (!r?.COLLATION_NAME) throw new Error(`No se pudo leer la collation de ${tabla}.${columna}`);
    return r.COLLATION_NAME;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        if (!(await existeTabla(TABLA))) {
            console.log(`· ${TABLA} no existe, nada que revertir`);
        } else {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA} tiene ${n} fila(s). No se elimina con datos adentro.`);
                process.exit(1);
            }
            await db.query(`DROP TABLE ${TABLA}`);
            console.log(`✓ ${TABLA} eliminada`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (await existeTabla(TABLA)) {
        console.log(`· ${TABLA} ya existe, se omite`);
        process.exit(0);
    }

    const collationFicha = await collationDeColumna(TABLA_FICHA, 'idFicha');
    const collationMaterial = await collationDeColumna('MATERIAL', 'idMaterial');
    await db.query(`
        CREATE TABLE ${TABLA} (
            idDetalle INT NOT NULL AUTO_INCREMENT,
            idFicha CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collationFicha} NOT NULL,
            idMaterial CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collationMaterial} NOT NULL,
            nombreMaterial VARCHAR(100) NOT NULL,
            cantidad INT NOT NULL,
            orden INT NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            PRIMARY KEY (idDetalle),
            INDEX fichas_confeccion_insumos_ficha_idx (idFicha),
            CONSTRAINT fichas_confeccion_insumos_ficha_fk FOREIGN KEY (idFicha) REFERENCES ${TABLA_FICHA}(idFicha) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT fichas_confeccion_insumos_material_fk FOREIGN KEY (idMaterial) REFERENCES MATERIAL(idMaterial) ON DELETE RESTRICT ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`✓ ${TABLA} creada (idFicha collation ${collationFicha}, idMaterial collation ${collationMaterial})`);

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
