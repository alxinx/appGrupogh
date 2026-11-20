import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';
import { InsumoMovimiento } from '../models/index.js';
import { migrarTablaAppendOnly } from './tablaAppendOnly.js';

dotenv.config();

// Inventario de insumos — entrega 1 de PLAN_COSTEO_PRODUCCION.md. Todo ADITIVO: no modifica
// ni borra ninguna fila existente salvo rellenar la columna nueva MATERIAL.unidadConsumo.
//
//   MATERIAL                 + bolsa/caja en unidadCompra, + unidadConsumo, anchoUtilCm, gramajeGm2
//   DETALLES_ORDEN_COMPRA    + bolsa/caja en unidadCompra, + contenidoPorPresentacion, cantidadConsumoRecibida
//   MATERIAL_PRESENTACIONES  nueva
//   INSUMOS_CAPAS            nueva
//   INSUMOS_MOVIMIENTOS      nueva, append-only (triggers)
//
//   npm run db:migrar-inventario-insumos
//   npm run db:migrar-inventario-insumos -- --revertir     (solo si no hay inventario cargado)
//
// Idempotente: cada paso revisa si ya está hecho.
//
// unidadConsumo de los materiales que ya existen se deduce de su unidad de compra
// (metro/rollo → cm, kg → g, lo demás → unidad): es lo que hoy se puede inferir; se corrige
// en el formulario del insumo mientras ese material no tenga inventario.

const REVERTIR = process.argv.includes('--revertir');
const PRESENTACIONES = ['kg', 'metro', 'rollo', 'unidad', 'bolsa', 'caja'];
const NUEVAS_PRESENTACIONES = ['bolsa', 'caja'];

const uno = async (sql, replacements = {}) => (await db.query(sql, { replacements, type: QueryTypes.SELECT }))[0];

const existeTabla = async (t) => (await uno(
    `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`, { t })).n > 0;

const columna = (t, c) => uno(
    `SELECT COLUMN_TYPE tipo, IS_NULLABLE nulo, COLUMN_DEFAULT def, COLLATION_NAME coll
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`, { t, c });

const collation = async (t, c) => {
    const col = await columna(t, c);
    if (!col?.coll) throw new Error(`No se pudo leer la collation de ${t}.${c}`);
    return col.coll;
};

// Reescribe un ENUM con la lista dada conservando NULL/NOT NULL y el default. Agregar
// valores al final de un ENUM no toca las filas existentes.
const ponerEnum = async (tabla, col, valores) => {
    const actual = await columna(tabla, col);
    const tipo = `enum(${valores.map(v => `'${v}'`).join(',')})`;
    if (actual.tipo.replace(/\s/g, '').toLowerCase() === tipo) return false;   // ya está así
    const nulo = actual.nulo === 'YES' ? 'NULL' : 'NOT NULL';
    const def = actual.def === null ? (actual.nulo === 'YES' ? 'DEFAULT NULL' : '') : `DEFAULT '${actual.def}'`;
    await db.query(`ALTER TABLE ${tabla} MODIFY COLUMN ${col} ${tipo} ${nulo} ${def}`);
    return true;
};

const agregarColumna = async (tabla, col, definicion) => {
    if (await columna(tabla, col)) { console.log(`· ${tabla}.${col} ya existe`); return false; }
    await db.query(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${definicion}`);
    console.log(`✓ ${tabla}.${col} agregada`);
    return true;
};

const vacia = async (tabla) => !(await existeTabla(tabla)) || (await uno(`SELECT COUNT(*) n FROM ${tabla}`)).n === 0;

const migrar = async () => {
    // ── MATERIAL ────────────────────────────────────────────────────────────────
    if (await ponerEnum('MATERIAL', 'unidadCompra', PRESENTACIONES)) console.log('✓ MATERIAL.unidadCompra admite bolsa y caja');
    if (await agregarColumna('MATERIAL', 'unidadConsumo', `ENUM('cm','g','unidad') NOT NULL DEFAULT 'unidad' AFTER unidadCompra`)) {
        const [r] = await db.query(`UPDATE MATERIAL SET unidadConsumo = CASE
            WHEN unidadCompra IN ('metro','rollo') THEN 'cm'
            WHEN unidadCompra = 'kg' THEN 'g'
            ELSE 'unidad' END`);
        console.log(`  unidadConsumo deducida para ${r.affectedRows ?? 0} material(es)`);
    }
    await agregarColumna('MATERIAL', 'anchoUtilCm', 'DECIMAL(8,2) NULL AFTER unidadConsumo');
    await agregarColumna('MATERIAL', 'gramajeGm2', 'DECIMAL(8,2) NULL AFTER anchoUtilCm');

    // ── DETALLES_ORDEN_COMPRA ───────────────────────────────────────────────────
    if (await ponerEnum('DETALLES_ORDEN_COMPRA', 'unidadCompra', PRESENTACIONES)) console.log('✓ DETALLES_ORDEN_COMPRA.unidadCompra admite bolsa y caja');
    await agregarColumna('DETALLES_ORDEN_COMPRA', 'contenidoPorPresentacion', 'DECIMAL(15,4) NULL AFTER cantidadRecibida');
    await agregarColumna('DETALLES_ORDEN_COMPRA', 'cantidadConsumoRecibida', 'DECIMAL(15,4) NULL AFTER contenidoPorPresentacion');

    const collMaterial = await collation('MATERIAL', 'idMaterial');

    // ── MATERIAL_PRESENTACIONES ─────────────────────────────────────────────────
    if (await existeTabla('MATERIAL_PRESENTACIONES')) console.log('· MATERIAL_PRESENTACIONES ya existe');
    else {
        await db.query(`
            CREATE TABLE MATERIAL_PRESENTACIONES (
                idDetalle INT NOT NULL AUTO_INCREMENT,
                idMaterial CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collMaterial} NOT NULL,
                presentacion ENUM(${PRESENTACIONES.map(v => `'${v}'`).join(',')}) NOT NULL,
                contenidoSugerido DECIMAL(15,4) NOT NULL,
                createdAt DATETIME NOT NULL,
                updatedAt DATETIME NOT NULL,
                PRIMARY KEY (idDetalle),
                UNIQUE KEY material_presentaciones_unica (idMaterial, presentacion),
                CONSTRAINT material_presentaciones_material_fk FOREIGN KEY (idMaterial) REFERENCES MATERIAL(idMaterial) ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        console.log('✓ MATERIAL_PRESENTACIONES creada');
    }

    // ── INSUMOS_CAPAS ───────────────────────────────────────────────────────────
    const cantidad = 'DECIMAL(15,4) NOT NULL DEFAULT 0';
    if (await existeTabla('INSUMOS_CAPAS')) console.log('· INSUMOS_CAPAS ya existe');
    else {
        await db.query(`
            CREATE TABLE INSUMOS_CAPAS (
                idCapa CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collMaterial} NOT NULL,
                idMaterial CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collMaterial} NOT NULL,
                idAtributoColor INT NULL,
                origen ENUM('compra','ajuste') NOT NULL,
                idDetalleOrdenCompra INT NULL,
                fechaEntrada DATETIME(3) NOT NULL,
                secuencia BIGINT NOT NULL AUTO_INCREMENT,
                cantidadInicial ${cantidad},
                cantidadDisponible ${cantidad},
                cantidadReservada ${cantidad},
                cantidadEnProceso ${cantidad},
                cantidadConsumida ${cantidad},
                cantidadBaja ${cantidad},
                costoUnitario DECIMAL(15,4) NOT NULL,
                ivaUnitario DECIMAL(15,4) NOT NULL DEFAULT 0,
                createdAt DATETIME NOT NULL,
                updatedAt DATETIME NOT NULL,
                PRIMARY KEY (idCapa),
                UNIQUE KEY insumos_capas_secuencia (secuencia),
                INDEX insumos_capas_fifo_idx (idMaterial, fechaEntrada, secuencia),
                INDEX insumos_capas_detalle_idx (idDetalleOrdenCompra),
                CONSTRAINT insumos_capas_material_fk FOREIGN KEY (idMaterial) REFERENCES MATERIAL(idMaterial) ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT insumos_capas_color_fk FOREIGN KEY (idAtributoColor) REFERENCES ATRIBUTOS(idAtributo) ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT insumos_capas_detalle_fk FOREIGN KEY (idDetalleOrdenCompra) REFERENCES DETALLES_ORDEN_COMPRA(idDetalleOrdenCompra) ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT insumos_capas_cuadre CHECK (
                    cantidadDisponible >= 0 AND cantidadReservada >= 0 AND cantidadEnProceso >= 0
                    AND cantidadConsumida >= 0 AND cantidadBaja >= 0
                    AND cantidadInicial = cantidadDisponible + cantidadReservada + cantidadEnProceso + cantidadConsumida + cantidadBaja)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        console.log('✓ INSUMOS_CAPAS creada (con CHECK de cuadre: ninguna cantidad negativa y la suma igual a la inicial)');
    }

    // Orden FIFO determinista (para tablas creadas con la primera versión de esta migración):
    // fecha con milisegundos y un consecutivo que desempata dos entradas del mismo instante.
    if ((await columna('INSUMOS_CAPAS', 'fechaEntrada')).tipo === 'datetime') {
        await db.query('ALTER TABLE INSUMOS_CAPAS MODIFY COLUMN fechaEntrada DATETIME(3) NOT NULL');
        console.log('✓ INSUMOS_CAPAS.fechaEntrada con milisegundos');
    }
    if (await agregarColumna('INSUMOS_CAPAS', 'secuencia', 'BIGINT NOT NULL AUTO_INCREMENT UNIQUE AFTER fechaEntrada')) {
        await db.query('ALTER TABLE INSUMOS_CAPAS DROP INDEX insumos_capas_fifo_idx, ADD INDEX insumos_capas_fifo_idx (idMaterial, fechaEntrada, secuencia)');
    }

    // ── INSUMOS_MOVIMIENTOS (append-only) ───────────────────────────────────────
    if (await existeTabla('INSUMOS_MOVIMIENTOS')) console.log('· INSUMOS_MOVIMIENTOS ya existe');
    else {
        const tipos = InsumoMovimiento.getAttributes().tipo.values;
        await db.query(`
            CREATE TABLE INSUMOS_MOVIMIENTOS (
                idMovimiento INT NOT NULL AUTO_INCREMENT,
                idCapa CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collMaterial} NOT NULL,
                idMaterial CHAR(36) CHARACTER SET utf8mb4 COLLATE ${collMaterial} NOT NULL,
                tipo ENUM(${tipos.map(v => `'${v}'`).join(',')}) NOT NULL,
                cantidad DECIMAL(15,4) NOT NULL,
                costoUnitario DECIMAL(15,4) NOT NULL,
                idDetalleOrdenCompra INT NULL,
                motivo VARCHAR(300) NULL,
                origen ENUM('panel','portal') NOT NULL DEFAULT 'panel',
                idUsuario CHAR(36) NULL,
                nombreUsuario VARCHAR(150) NULL,
                idEmpleado CHAR(36) NULL,
                nombreEmpleado VARCHAR(150) NULL,
                codigoEmpleado VARCHAR(20) NULL,
                createdAt DATETIME NOT NULL,
                PRIMARY KEY (idMovimiento),
                INDEX insumos_movimientos_material_idx (idMaterial, createdAt),
                INDEX insumos_movimientos_capa_idx (idCapa),
                CONSTRAINT insumos_movimientos_capa_fk FOREIGN KEY (idCapa) REFERENCES INSUMOS_CAPAS(idCapa) ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT insumos_movimientos_material_fk FOREIGN KEY (idMaterial) REFERENCES MATERIAL(idMaterial) ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT insumos_movimientos_cantidad CHECK (cantidad > 0)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        console.log('✓ INSUMOS_MOVIMIENTOS creada');
    }
    // Los triggers los pone el helper compartido de constancias (la tabla ya existe: solo sella).
    const r = await migrarTablaAppendOnly({
        modelo: InsumoMovimiento,
        tabla: 'INSUMOS_MOVIMIENTOS',
        mensaje: 'INSUMOS_MOVIMIENTOS es append-only: un movimiento de inventario no se edita ni se borra'
    });
    if (r) throw new Error('No se pudieron crear los triggers de INSUMOS_MOVIMIENTOS');
};

const revertir = async () => {
    // Nada se revierte si ya hay inventario: serían datos reales.
    for (const t of ['INSUMOS_MOVIMIENTOS', 'INSUMOS_CAPAS']) {
        if (!(await vacia(t))) { console.error(`✗ ABORTADO: ${t} tiene filas. No se revierte con inventario cargado.`); process.exit(1); }
    }
    const conBolsa = (await uno(`SELECT
        (SELECT COUNT(*) FROM MATERIAL WHERE unidadCompra IN ('bolsa','caja'))
      + (SELECT COUNT(*) FROM DETALLES_ORDEN_COMPRA WHERE unidadCompra IN ('bolsa','caja')) n`)).n;
    if (conBolsa > 0) { console.error(`✗ ABORTADO: ${conBolsa} fila(s) usan bolsa/caja.`); process.exit(1); }

    const r = await migrarTablaAppendOnly({ modelo: InsumoMovimiento, tabla: 'INSUMOS_MOVIMIENTOS', mensaje: '', argv: ['--revertir'] });
    if (r) process.exit(1);
    for (const t of ['INSUMOS_CAPAS', 'MATERIAL_PRESENTACIONES']) {
        if (await existeTabla(t)) { await db.query(`DROP TABLE ${t}`); console.log(`✓ ${t} eliminada`); }
    }
    for (const [t, c] of [['DETALLES_ORDEN_COMPRA', 'cantidadConsumoRecibida'], ['DETALLES_ORDEN_COMPRA', 'contenidoPorPresentacion'],
                          ['MATERIAL', 'gramajeGm2'], ['MATERIAL', 'anchoUtilCm'], ['MATERIAL', 'unidadConsumo']]) {
        if (await columna(t, c)) { await db.query(`ALTER TABLE ${t} DROP COLUMN ${c}`); console.log(`✓ ${t}.${c} eliminada`); }
    }
    const viejas = PRESENTACIONES.filter(p => !NUEVAS_PRESENTACIONES.includes(p));
    await ponerEnum('MATERIAL', 'unidadCompra', viejas);
    await ponerEnum('DETALLES_ORDEN_COMPRA', 'unidadCompra', viejas);
    console.log('\nReversión completada.');
};

const run = async () => {
    await db.authenticate();
    if (REVERTIR) await revertir();
    else await migrar();
    console.log('\nListo.');
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
