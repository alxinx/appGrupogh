import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Separa el material de FICHAS_CONFECCION_DXF en su propia tabla
// FICHAS_CONFECCION_DXF_MATERIALES (models/FichaConfeccionDxfMaterial.js): un DXF puede
// traer más de un código de "Material: X" (el cuerpo en una tela, el puño/elástico en otra
// — confirmado contra BLUSA SERENA.dxf, que repite "Material: 1" y "Material: 2" en piezas
// distintas), así que una sola columna/FK por archivo se quedaba con el último encontrado.
// Ver helpers/dxf.js y controller/fichaConfeccionDxfController.js.
//
//   node ./seed/migracionFichasConfeccionDxfMateriales.js
//   node ./seed/migracionFichasConfeccionDxfMateriales.js --revertir
//
// Idempotente.

const TABLA_DXF = 'FICHAS_CONFECCION_DXF';
const TABLA_MATERIALES = 'FICHAS_CONFECCION_DXF_MATERIALES';
const REVERTIR = process.argv.includes('--revertir');

const existeTabla = async (tabla) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t: tabla }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

const existeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

// La collation real de una columna CHAR/VARCHAR — nunca asumida (mismo motivo que
// seed/migracionFichasConfeccionDxf.js: MATERIAL.idMaterial no comparte collation con
// FICHAS_CONFECCION_DXF.idArchivoDxf, un FK que no calce exacto falla con el Error 3780).
const collationDeColumna = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT COLLATION_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    if (!r?.COLLATION_NAME) throw new Error(`No se pudo leer la collation de ${tabla}.${columna}`);
    return r.COLLATION_NAME;
};

const nombreFk = async (tabla, columna) => {
    const [r] = await db.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c AND REFERENCED_TABLE_NAME IS NOT NULL`,
        { replacements: { t: tabla, c: columna }, type: QueryTypes.SELECT }
    );
    return r?.CONSTRAINT_NAME || null;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        if (await existeTabla(TABLA_MATERIALES)) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA_MATERIALES}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA_MATERIALES} tiene ${n} fila(s). No se elimina con datos adentro.`);
                process.exit(1);
            }
            await db.query(`DROP TABLE ${TABLA_MATERIALES}`);
            console.log(`✓ ${TABLA_MATERIALES} eliminada`);
        } else {
            console.log(`· ${TABLA_MATERIALES} no existe, nada que revertir`);
        }

        if (await existeColumna(TABLA_DXF, 'material')) {
            console.log(`· ${TABLA_DXF}.material ya existe, se omite`);
        } else {
            await db.query(`ALTER TABLE ${TABLA_DXF} ADD COLUMN material VARCHAR(255) NULL AFTER talla`);
            console.log(`✓ ${TABLA_DXF}.material restaurada (vacía)`);
        }

        if (await existeColumna(TABLA_DXF, 'idMaterialAsociado')) {
            console.log(`· ${TABLA_DXF}.idMaterialAsociado ya existe, se omite`);
        } else {
            const collation = await collationDeColumna('MATERIAL', 'idMaterial');
            await db.query(`ALTER TABLE ${TABLA_DXF} ADD COLUMN idMaterialAsociado CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collation} NULL AFTER material`);
            await db.query(`ALTER TABLE ${TABLA_DXF} ADD CONSTRAINT fichas_confeccion_dxf_material_fk FOREIGN KEY (idMaterialAsociado) REFERENCES MATERIAL(idMaterial) ON DELETE SET NULL ON UPDATE CASCADE`);
            console.log(`✓ ${TABLA_DXF}.idMaterialAsociado restaurada (vacía)`);
        }

        console.log('\nReversión completada.');
        process.exit(0);
    }

    // 1 — Crear la tabla de detalle. Raw SQL, no FichaConfeccionDxfMaterial.sync(): la FK a
    // MATERIAL necesita su collation real (ver el aviso arriba) y sync() no la lee, asume el
    // default de la tabla — exactamente el Error 3780 que ya se vio con idMaterialAsociado.
    if (await existeTabla(TABLA_MATERIALES)) {
        console.log(`· ${TABLA_MATERIALES} ya existe, se omite`);
    } else {
        const collationDxf = await collationDeColumna(TABLA_DXF, 'idArchivoDxf');
        const collationMaterial = await collationDeColumna('MATERIAL', 'idMaterial');
        await db.query(`
            CREATE TABLE ${TABLA_MATERIALES} (
                idDetalle INT NOT NULL AUTO_INCREMENT,
                idArchivoDxf CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collationDxf} NOT NULL,
                codigoMaterial VARCHAR(50) NOT NULL,
                idMaterial CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collationMaterial} NULL,
                orden INT NOT NULL,
                createdAt DATETIME NOT NULL,
                updatedAt DATETIME NOT NULL,
                PRIMARY KEY (idDetalle),
                INDEX fichas_confeccion_dxf_materiales_dxf_idx (idArchivoDxf),
                CONSTRAINT fichas_confeccion_dxf_materiales_dxf_fk FOREIGN KEY (idArchivoDxf) REFERENCES ${TABLA_DXF}(idArchivoDxf) ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT fichas_confeccion_dxf_materiales_material_fk FOREIGN KEY (idMaterial) REFERENCES MATERIAL(idMaterial) ON DELETE SET NULL ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log(`✓ ${TABLA_MATERIALES} creada (idArchivoDxf collation ${collationDxf}, idMaterial collation ${collationMaterial})`);
    }

    // 2 — Migrar lo que ya hubiera en la columna vieja (archivos ya analizados antes de este
    // cambio), una fila por cada uno — orden=1 porque esa columna solo guardaba un código.
    if (await existeColumna(TABLA_DXF, 'material')) {
        const filas = await db.query(
            `SELECT idArchivoDxf, material, idMaterialAsociado FROM ${TABLA_DXF} WHERE material IS NOT NULL`,
            { type: QueryTypes.SELECT }
        );
        let migradas = 0;
        for (const fila of filas) {
            const [{ n }] = await db.query(
                `SELECT COUNT(*) n FROM ${TABLA_MATERIALES} WHERE idArchivoDxf = :id`,
                { replacements: { id: fila.idArchivoDxf }, type: QueryTypes.SELECT }
            );
            if (n > 0) continue; // ya migrada en una corrida anterior
            await db.query(
                `INSERT INTO ${TABLA_MATERIALES} (idArchivoDxf, codigoMaterial, idMaterial, orden, createdAt, updatedAt)
                 VALUES (:idArchivoDxf, :codigoMaterial, :idMaterial, 1, NOW(), NOW())`,
                { replacements: { idArchivoDxf: fila.idArchivoDxf, codigoMaterial: fila.material, idMaterial: fila.idMaterialAsociado } }
            );
            migradas += 1;
        }
        if (migradas) console.log(`✓ ${migradas} fila(s) de ${TABLA_DXF}.material migrada(s) a ${TABLA_MATERIALES}`);
        else console.log(`· nada que migrar de ${TABLA_DXF}.material`);

        // 3 — Columnas viejas fuera: ya nadie las lee (helpers/dxf.js, los controladores y
        // el modelo quedaron apuntando a la tabla de detalle).
        const fk = await nombreFk(TABLA_DXF, 'idMaterialAsociado');
        if (fk) await db.query(`ALTER TABLE ${TABLA_DXF} DROP FOREIGN KEY ${fk}`);
        if (await existeColumna(TABLA_DXF, 'idMaterialAsociado')) {
            await db.query(`ALTER TABLE ${TABLA_DXF} DROP COLUMN idMaterialAsociado`);
        }
        await db.query(`ALTER TABLE ${TABLA_DXF} DROP COLUMN material`);
        console.log(`✓ ${TABLA_DXF}.material / idMaterialAsociado eliminadas`);
    } else {
        console.log(`· ${TABLA_DXF}.material ya no existe, se omite`);
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
