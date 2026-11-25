import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { QueryTypes } from 'sequelize';
import db from '../config/bd.js';
import { InsumoRolloEstado } from '../models/index.js';
import { migrarTablaAppendOnly } from './tablaAppendOnly.js';
import { siguienteNumero } from '../helpers/secuencias.js';

dotenv.config();

// Rollos de tela con su estado (sin tender → tendido/en reposo → listo para cortar),
// decidido con el dueño el 2026-11-21. ADITIVA:
//
//   MATERIAL.reposoHoras          + INT NOT NULL DEFAULT 48
//   INSUMOS_ROLLOS                nueva
//   INSUMOS_ROLLOS_ESTADOS        nueva, append-only (triggers)
//   SECUENCIAS 'rollo_tela'       nueva fila → el primer rollo es R-1
//
// Además, cada capa de TELA (materia prima que se gasta en cm) que ya tenga saldo y ningún
// rollo recibe UNA pieza "sin tender" con ese saldo: no hay forma de saber cuántos rollos
// físicos eran. Queda en su bitácora que la creó la migración.
//
//   npm run db:migrar-rollos-tela
//   npm run db:migrar-rollos-tela -- --revertir     (solo si ningún rollo se movió)

const REVERTIR = process.argv.includes('--revertir');
const uno = async (sql, replacements = {}) => (await db.query(sql, { replacements, type: QueryTypes.SELECT }))[0];
const existeTabla = async (t) => (await uno(
    'SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t', { t })).n > 0;
const columna = (t, c) => uno(
    `SELECT COLLATION_NAME coll FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`, { t, c });

const ESTADOS = "ENUM('sin_tender','tendido','en_corte','agotado')";

const migrar = async () => {
    if (await columna('MATERIAL', 'reposoHoras')) console.log('· MATERIAL.reposoHoras ya existe');
    else {
        await db.query('ALTER TABLE MATERIAL ADD COLUMN reposoHoras INT NOT NULL DEFAULT 48 AFTER gramajeGm2');
        console.log('✓ MATERIAL.reposoHoras agregada (48 por defecto)');
    }

    const coll = (await columna('INSUMOS_CAPAS', 'idCapa')).coll;
    const collMaterial = (await columna('MATERIAL', 'idMaterial')).coll;
    const uuid = (c) => `CHAR(36) CHARACTER SET utf8mb4 COLLATE ${c}`;

    if (await existeTabla('INSUMOS_ROLLOS')) console.log('· INSUMOS_ROLLOS ya existe');
    else {
        await db.query(`
            CREATE TABLE INSUMOS_ROLLOS (
                idRollo ${uuid(coll)} NOT NULL,
                codigoRollo VARCHAR(20) NOT NULL,
                idCapa ${uuid(coll)} NOT NULL,
                idMaterial ${uuid(collMaterial)} NOT NULL,
                idAtributoColor INT NULL,
                metrajeInicialCm DECIMAL(15,4) NOT NULL,
                metrajeActualCm DECIMAL(15,4) NOT NULL,
                estado ${ESTADOS} NOT NULL DEFAULT 'sin_tender',
                tendidoEn DATETIME NULL,
                listoDesde DATETIME NULL,
                createdAt DATETIME NOT NULL,
                updatedAt DATETIME NOT NULL,
                PRIMARY KEY (idRollo),
                UNIQUE KEY insumos_rollos_codigo_uk (codigoRollo),
                INDEX insumos_rollos_material_idx (idMaterial, estado),
                INDEX insumos_rollos_capa_idx (idCapa),
                CONSTRAINT insumos_rollos_capa_fk FOREIGN KEY (idCapa) REFERENCES INSUMOS_CAPAS(idCapa) ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT insumos_rollos_material_fk FOREIGN KEY (idMaterial) REFERENCES MATERIAL(idMaterial) ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT insumos_rollos_color_fk FOREIGN KEY (idAtributoColor) REFERENCES ATRIBUTOS(idAtributo) ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT insumos_rollos_metraje CHECK (metrajeInicialCm > 0 AND metrajeActualCm >= 0 AND metrajeActualCm <= metrajeInicialCm)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        console.log('✓ INSUMOS_ROLLOS creada');
    }

    if (await existeTabla('INSUMOS_ROLLOS_ESTADOS')) console.log('· INSUMOS_ROLLOS_ESTADOS ya existe');
    else {
        const acciones = InsumoRolloEstado.getAttributes().accion.values.map(v => `'${v}'`).join(',');
        await db.query(`
            CREATE TABLE INSUMOS_ROLLOS_ESTADOS (
                idRegistro INT NOT NULL AUTO_INCREMENT,
                idRollo ${uuid(coll)} NOT NULL,
                accion ENUM(${acciones}) NOT NULL,
                estadoAnterior ${ESTADOS} NULL,
                estadoNuevo ${ESTADOS} NOT NULL,
                cantidadCm DECIMAL(15,4) NULL,
                motivo VARCHAR(300) NULL,
                origen ENUM('panel','portal') NOT NULL DEFAULT 'panel',
                idUsuario CHAR(36) NULL,
                nombreUsuario VARCHAR(150) NULL,
                idEmpleado CHAR(36) NULL,
                nombreEmpleado VARCHAR(150) NULL,
                codigoEmpleado VARCHAR(20) NULL,
                createdAt DATETIME NOT NULL,
                PRIMARY KEY (idRegistro),
                INDEX insumos_rollos_estados_rollo_idx (idRollo, createdAt),
                CONSTRAINT insumos_rollos_estados_rollo_fk FOREIGN KEY (idRollo) REFERENCES INSUMOS_ROLLOS(idRollo) ON DELETE RESTRICT ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        console.log('✓ INSUMOS_ROLLOS_ESTADOS creada');
    }
    const r = await migrarTablaAppendOnly({
        modelo: InsumoRolloEstado,
        tabla: 'INSUMOS_ROLLOS_ESTADOS',
        mensaje: 'INSUMOS_ROLLOS_ESTADOS es append-only: no se edita ni se borra'
    });
    if (r) throw new Error('No se pudieron crear los triggers de INSUMOS_ROLLOS_ESTADOS');

    const [ins] = await db.query("INSERT IGNORE INTO SECUENCIAS (nombre, valor) VALUES ('rollo_tela', 0)");
    console.log((ins?.affectedRows ?? 0) > 0 ? "✓ SECUENCIAS 'rollo_tela' sembrada en 0" : "· SECUENCIAS 'rollo_tela' ya existe");

    // Telas que ya tenían existencias: una pieza sin tender por capa con saldo.
    const capas = await db.query(`
        SELECT c.idCapa, c.idMaterial, c.idAtributoColor,
               c.cantidadDisponible + c.cantidadReservada + c.cantidadEnProceso saldo
        FROM INSUMOS_CAPAS c
        JOIN MATERIAL m ON m.idMaterial = c.idMaterial
        WHERE m.tipo = 'materia_prima' AND m.unidadConsumo = 'cm'
          AND c.cantidadDisponible + c.cantidadReservada + c.cantidadEnProceso > 0
          AND NOT EXISTS (SELECT 1 FROM INSUMOS_ROLLOS r WHERE r.idCapa = c.idCapa)`,
        { type: QueryTypes.SELECT });
    for (const c of capas) {
        await db.transaction(async (transaction) => {
            const idRollo = randomUUID();
            const numero = await siguienteNumero('rollo_tela', transaction);
            await db.query(`
                INSERT INTO INSUMOS_ROLLOS (idRollo, codigoRollo, idCapa, idMaterial, idAtributoColor, metrajeInicialCm, metrajeActualCm, estado, createdAt, updatedAt)
                VALUES (:idRollo, :codigo, :idCapa, :idMaterial, :color, :saldo, :saldo, 'sin_tender', NOW(), NOW())`,
                { replacements: { idRollo, codigo: `R-${numero}`, idCapa: c.idCapa, idMaterial: c.idMaterial, color: c.idAtributoColor, saldo: c.saldo }, transaction });
            await db.query(`
                INSERT INTO INSUMOS_ROLLOS_ESTADOS (idRollo, accion, estadoNuevo, cantidadCm, motivo, origen, nombreUsuario, createdAt)
                VALUES (:idRollo, 'recibido', 'sin_tender', :saldo, 'Pieza creada por la migración con el saldo que ya tenía la capa', 'panel', 'migración', NOW())`,
                { replacements: { idRollo, saldo: c.saldo }, transaction });
        });
    }
    console.log(capas.length ? `✓ ${capas.length} pieza(s) creada(s) para telas con existencias` : '· No hay telas con existencias sin rollos');
};

const revertir = async () => {
    if (await existeTabla('INSUMOS_ROLLOS_ESTADOS')) {
        const { n } = await uno("SELECT COUNT(*) n FROM INSUMOS_ROLLOS_ESTADOS WHERE accion <> 'recibido'");
        if (n > 0) { console.error(`✗ ABORTADO: ${n} movimiento(s) de rollos. No se revierte con rollos usados.`); return 1; }
    }
    for (const tg of ['INSUMOS_ROLLOS_ESTADOS_sin_update', 'INSUMOS_ROLLOS_ESTADOS_sin_delete']) await db.query(`DROP TRIGGER IF EXISTS \`${tg}\``);
    for (const t of ['INSUMOS_ROLLOS_ESTADOS', 'INSUMOS_ROLLOS']) {
        if (await existeTabla(t)) { await db.query(`DROP TABLE ${t}`); console.log(`✓ ${t} eliminada`); }
    }
    if (await columna('MATERIAL', 'reposoHoras')) { await db.query('ALTER TABLE MATERIAL DROP COLUMN reposoHoras'); console.log('✓ MATERIAL.reposoHoras eliminada'); }
    await db.query("DELETE FROM SECUENCIAS WHERE nombre = 'rollo_tela'");
    console.log('\nReversión completada.');
    return 0;
};

export const migrarRollosTela = async () => { await db.authenticate(); await migrar(); };

if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        await db.authenticate();
        if (REVERTIR) process.exit(await revertir());
        await migrar();
        console.log('\nMigración completada.');
        process.exit(0);
    })().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
}
