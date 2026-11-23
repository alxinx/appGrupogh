import dotenv from 'dotenv';
import { QueryTypes } from 'sequelize';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import db from '../config/bd.js';
import { OrdenCorte, OrdenCorteEstado, FichaConfeccion, FichaConfeccionEstado, InsumoRolloEstado } from '../models/index.js';
import { migrarTablaAppendOnly } from './tablaAppendOnly.js';
import { recetaDeDxf } from '../helpers/trazo.js';

dotenv.config();

// Orden de corte desde el trazo (decidido con el dueño el 2026-11-21; CLAUDE.md §6.2).
// ADITIVA: tablas nuevas, columnas nuevas y valores nuevos al final de tres ENUM.
//
//   FICHAS_CONFECCION_DXF_PIEZAS        nueva — piezas de la prenda según el DXF de la ficha
//   ORDENES_CORTE                       nueva (borrado lógico)
//   ORDENES_CORTE_REFERENCIAS           nueva
//   ORDENES_CORTE_PIEZAS                nueva
//   ORDENES_CORTE_ROLLOS                nueva
//   ORDENES_CORTE_ESTADOS               nueva, append-only (triggers)
//   ORDENES_PRODUCCION.idOrdenCorte     + CHAR(36) NULL, FK a ORDENES_CORTE
//   FICHAS_CONFECCION.estado            + 'pendiente'
//   FICHAS_CONFECCION_ESTADOS.accion    + 'creada_pendiente', 'completada'
//   INSUMOS_ROLLOS_ESTADOS.accion       + 'corte'
//   SECUENCIAS 'orden_corte'            nueva fila → el primer corte es CT-1
//
// Además llena FICHAS_CONFECCION_DXF_PIEZAS de las fichas que ya existen, leyendo su DXF del
// bucket privado. Una ficha cuyo DXF no se puede leer queda sin piezas (se avisa): el corte
// usa entonces las piezas del trazo.
//
//   npm run db:migrar-ordenes-corte
//   npm run db:migrar-ordenes-corte -- --revertir     (solo si no hay cortes)

const REVERTIR = process.argv.includes('--revertir');
const SOLO_ESQUEMA = process.argv.includes('--sin-piezas');
const TABLAS = ['ORDENES_CORTE_ESTADOS', 'ORDENES_CORTE_ROLLOS', 'ORDENES_CORTE_PIEZAS', 'ORDENES_CORTE_REFERENCIAS'];

const uno = async (sql, replacements = {}) => (await db.query(sql, { replacements, type: QueryTypes.SELECT }))[0];
const existeTabla = async (t) => (await uno(
    'SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t', { t })).n > 0;
const columna = (t, c) => uno(
    `SELECT COLLATION_NAME coll, COLUMN_TYPE tipo FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`, { t, c });
const collation = async (t, c) => {
    const col = await columna(t, c);
    if (!col?.coll) throw new Error(`No se pudo leer la collation de ${t}.${c}`);
    return col.coll;
};
const enumSql = (modelo, campo) => `ENUM(${modelo.getAttributes()[campo].values.map(v => `'${v}'`).join(',')})`;
const crear = async (tabla, sql) => {
    if (await existeTabla(tabla)) { console.log(`· ${tabla} ya existe`); return; }
    await db.query(sql);
    console.log(`✓ ${tabla} creada`);
};

// Amplía un ENUM a los valores del modelo (solo agrega: los del modelo incluyen los de antes).
const ampliarEnum = async (tabla, col, modelo, campo, { nulo = false, defecto = null } = {}) => {
    const actual = await columna(tabla, col);
    const nuevo = enumSql(modelo, campo);
    if (actual.tipo.toLowerCase() === nuevo.toLowerCase()) { console.log(`· ${tabla}.${col} ya tiene sus valores`); return; }
    await db.query(`ALTER TABLE ${tabla} MODIFY COLUMN ${col} ${nuevo} ${nulo ? 'NULL' : 'NOT NULL'}${defecto ? ` DEFAULT '${defecto}'` : ''}`);
    console.log(`✓ ${tabla}.${col} → ${nuevo}`);
};

const migrar = async () => {
    const cDxf      = await collation('FICHAS_CONFECCION_DXF', 'idArchivoDxf');
    const cFicha    = await collation('FICHAS_CONFECCION', 'idFicha');
    const cMaterial = await collation('MATERIAL', 'idMaterial');
    const cUsuario  = await collation('USUARIOS', 'idUsuario');
    const cRollo    = await collation('INSUMOS_ROLLOS', 'idRollo');
    const cOrden    = await collation('ORDENES_PRODUCCION', 'idOrdenProduccion');
    const uuid = (coll) => `CHAR(36) CHARACTER SET utf8mb4 COLLATE ${coll}`;
    const estados = enumSql(OrdenCorte, 'estado');

    await ampliarEnum('FICHAS_CONFECCION', 'estado', FichaConfeccion, 'estado', { defecto: 'activa' });
    await ampliarEnum('FICHAS_CONFECCION_ESTADOS', 'accion', FichaConfeccionEstado, 'accion');
    await ampliarEnum('INSUMOS_ROLLOS_ESTADOS', 'accion', InsumoRolloEstado, 'accion');

    await crear('FICHAS_CONFECCION_DXF_PIEZAS', `
        CREATE TABLE FICHAS_CONFECCION_DXF_PIEZAS (
            idDetalle INT NOT NULL AUTO_INCREMENT,
            idArchivoDxf ${uuid(cDxf)} NOT NULL,
            nombrePieza VARCHAR(120) NOT NULL,
            talla VARCHAR(20) NOT NULL,
            porPrenda INT NOT NULL DEFAULT 1,
            codigoMaterial VARCHAR(25) NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            PRIMARY KEY (idDetalle),
            UNIQUE KEY fichas_dxf_piezas_uk (idArchivoDxf, nombrePieza, talla, codigoMaterial),
            CONSTRAINT fichas_dxf_piezas_dxf_fk FOREIGN KEY (idArchivoDxf) REFERENCES FICHAS_CONFECCION_DXF(idArchivoDxf) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT fichas_dxf_piezas_por_prenda CHECK (porPrenda > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await crear('ORDENES_CORTE', `
        CREATE TABLE ORDENES_CORTE (
            idOrdenCorte ${uuid(cOrden)} NOT NULL,
            numeroCorte VARCHAR(20) NOT NULL,
            estado ${estados} NOT NULL DEFAULT 'borrador',
            idMaterial ${uuid(cMaterial)} NOT NULL,
            nombreArchivo VARCHAR(255) NOT NULL,
            objectKey VARCHAR(500) NOT NULL,
            shaHash VARCHAR(64) NOT NULL,
            largoCm DECIMAL(10,2) NOT NULL,
            anchoCm DECIMAL(10,2) NOT NULL,
            areaPiezasCm2 DECIMAL(15,2) NOT NULL,
            fechaRequerida DATE NOT NULL,
            notas TEXT NULL,
            cmTela DECIMAL(15,4) NULL,
            costoTela DECIMAL(15,2) NULL,
            cortadaEn DATETIME NULL,
            idUsuarioCreacion ${uuid(cUsuario)} NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            deletedAt DATETIME NULL,
            PRIMARY KEY (idOrdenCorte),
            UNIQUE KEY ordenes_corte_numero_uk (numeroCorte),
            INDEX ordenes_corte_estado_idx (estado, createdAt),
            CONSTRAINT ordenes_corte_material_fk FOREIGN KEY (idMaterial) REFERENCES MATERIAL(idMaterial) ON DELETE RESTRICT ON UPDATE CASCADE,
            CONSTRAINT ordenes_corte_usuario_fk FOREIGN KEY (idUsuarioCreacion) REFERENCES USUARIOS(idUsuario) ON DELETE RESTRICT ON UPDATE CASCADE,
            CONSTRAINT ordenes_corte_medidas CHECK (largoCm > 0 AND anchoCm > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await crear('ORDENES_CORTE_REFERENCIAS', `
        CREATE TABLE ORDENES_CORTE_REFERENCIAS (
            idReferencia INT NOT NULL AUTO_INCREMENT,
            idOrdenCorte ${uuid(cOrden)} NOT NULL,
            estilo VARCHAR(150) NOT NULL,
            idFicha ${uuid(cFicha)} NOT NULL,
            fichaCreadaEnCorte TINYINT(1) NOT NULL DEFAULT 0,
            areaCm2 DECIMAL(15,2) NOT NULL,
            prendasPorCapa JSON NOT NULL,
            faltanPiezas TINYINT(1) NOT NULL DEFAULT 0,
            piezasSueltas ENUM('pendientes','excluir') NULL,
            cmTela DECIMAL(15,4) NULL,
            costoTela DECIMAL(15,2) NULL,
            orden INT NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            PRIMARY KEY (idReferencia),
            UNIQUE KEY ordenes_corte_referencias_uk (idOrdenCorte, estilo),
            INDEX ordenes_corte_referencias_ficha_idx (idFicha),
            CONSTRAINT ordenes_corte_referencias_corte_fk FOREIGN KEY (idOrdenCorte) REFERENCES ORDENES_CORTE(idOrdenCorte) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT ordenes_corte_referencias_ficha_fk FOREIGN KEY (idFicha) REFERENCES FICHAS_CONFECCION(idFicha) ON DELETE RESTRICT ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await crear('ORDENES_CORTE_PIEZAS', `
        CREATE TABLE ORDENES_CORTE_PIEZAS (
            idDetalle INT NOT NULL AUTO_INCREMENT,
            idReferencia INT NOT NULL,
            nombrePieza VARCHAR(120) NOT NULL,
            talla VARCHAR(20) NOT NULL,
            colocadas INT NOT NULL,
            porPrenda INT NOT NULL DEFAULT 1,
            areaCm2 DECIMAL(15,2) NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            PRIMARY KEY (idDetalle),
            UNIQUE KEY ordenes_corte_piezas_uk (idReferencia, nombrePieza, talla),
            CONSTRAINT ordenes_corte_piezas_referencia_fk FOREIGN KEY (idReferencia) REFERENCES ORDENES_CORTE_REFERENCIAS(idReferencia) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT ordenes_corte_piezas_positivas CHECK (colocadas > 0 AND porPrenda > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await crear('ORDENES_CORTE_ROLLOS', `
        CREATE TABLE ORDENES_CORTE_ROLLOS (
            idDetalle INT NOT NULL AUTO_INCREMENT,
            idOrdenCorte ${uuid(cOrden)} NOT NULL,
            idRollo ${uuid(cRollo)} NOT NULL,
            idAtributoColor INT NOT NULL,
            capas INT NOT NULL,
            cmUsados DECIMAL(15,4) NOT NULL,
            costo DECIMAL(15,2) NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            PRIMARY KEY (idDetalle),
            UNIQUE KEY ordenes_corte_rollos_uk (idOrdenCorte, idRollo),
            INDEX ordenes_corte_rollos_rollo_idx (idRollo),
            CONSTRAINT ordenes_corte_rollos_corte_fk FOREIGN KEY (idOrdenCorte) REFERENCES ORDENES_CORTE(idOrdenCorte) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT ordenes_corte_rollos_rollo_fk FOREIGN KEY (idRollo) REFERENCES INSUMOS_ROLLOS(idRollo) ON DELETE RESTRICT ON UPDATE CASCADE,
            CONSTRAINT ordenes_corte_rollos_color_fk FOREIGN KEY (idAtributoColor) REFERENCES ATRIBUTOS(idAtributo) ON DELETE RESTRICT ON UPDATE CASCADE,
            CONSTRAINT ordenes_corte_rollos_capas CHECK (capas > 0 AND cmUsados > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await crear('ORDENES_CORTE_ESTADOS', `
        CREATE TABLE ORDENES_CORTE_ESTADOS (
            idRegistro INT NOT NULL AUTO_INCREMENT,
            idOrdenCorte ${uuid(cOrden)} NOT NULL,
            accion ${enumSql(OrdenCorteEstado, 'accion')} NOT NULL,
            estadoAnterior ${estados} NULL,
            estadoNuevo ${estados} NOT NULL,
            motivo TEXT NULL,
            origen ENUM('panel','portal') NOT NULL DEFAULT 'panel',
            idUsuario CHAR(36) NULL,
            nombreUsuario VARCHAR(150) NULL,
            idEmpleado CHAR(36) NULL,
            nombreEmpleado VARCHAR(150) NULL,
            codigoEmpleado VARCHAR(20) NULL,
            createdAt DATETIME NOT NULL,
            PRIMARY KEY (idRegistro),
            INDEX ordenes_corte_estados_corte_idx (idOrdenCorte, createdAt),
            CONSTRAINT ordenes_corte_estados_corte_fk FOREIGN KEY (idOrdenCorte) REFERENCES ORDENES_CORTE(idOrdenCorte) ON DELETE RESTRICT ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const r = await migrarTablaAppendOnly({
        modelo: OrdenCorteEstado,
        tabla: 'ORDENES_CORTE_ESTADOS',
        mensaje: 'ORDENES_CORTE_ESTADOS es append-only: no se edita ni se borra'
    });
    if (r) throw new Error('No se pudieron crear los triggers de ORDENES_CORTE_ESTADOS');

    if (await columna('ORDENES_PRODUCCION', 'idOrdenCorte')) console.log('· ORDENES_PRODUCCION.idOrdenCorte ya existe');
    else {
        await db.query(`ALTER TABLE ORDENES_PRODUCCION
            ADD COLUMN idOrdenCorte ${uuid(cOrden)} NULL AFTER notas,
            ADD INDEX ordenes_produccion_corte_idx (idOrdenCorte),
            ADD CONSTRAINT ordenes_produccion_corte_fk FOREIGN KEY (idOrdenCorte) REFERENCES ORDENES_CORTE(idOrdenCorte) ON DELETE RESTRICT ON UPDATE CASCADE`);
        console.log('✓ ORDENES_PRODUCCION.idOrdenCorte agregada');
    }

    const [ins] = await db.query("INSERT IGNORE INTO SECUENCIAS (nombre, valor) VALUES ('orden_corte', 0)");
    console.log((ins?.affectedRows ?? 0) > 0 ? "✓ SECUENCIAS 'orden_corte' sembrada en 0" : "· SECUENCIAS 'orden_corte' ya existe");

    await materialDePiezas();
    if (!SOLO_ESQUEMA) await llenarPiezasDeFichas();
};

// FICHAS_CONFECCION_DXF_PIEZAS.codigoMaterial (2026-11-22): una prenda puede ir en dos
// materiales y un trazo solo compara las piezas de su tela. En una base que ya tenía la tabla
// se agrega la columna, la unicidad pasa a incluirla, y las piezas de una ficha de UN solo
// material toman ese; las de varias se vuelven a leer de su DXF (llenarPiezasDeFichas).
async function materialDePiezas() {
    if (await columna('FICHAS_CONFECCION_DXF_PIEZAS', 'codigoMaterial')) {
        console.log('· FICHAS_CONFECCION_DXF_PIEZAS.codigoMaterial ya existe');
    } else {
        await db.query(`ALTER TABLE FICHAS_CONFECCION_DXF_PIEZAS
            ADD COLUMN codigoMaterial VARCHAR(25) NULL AFTER porPrenda,
            DROP INDEX fichas_dxf_piezas_uk,
            ADD UNIQUE KEY fichas_dxf_piezas_uk (idArchivoDxf, nombrePieza, talla, codigoMaterial)`);
        console.log('✓ FICHAS_CONFECCION_DXF_PIEZAS.codigoMaterial agregada');
    }
    const [, una] = await db.query(`
        UPDATE FICHAS_CONFECCION_DXF_PIEZAS p
        JOIN (SELECT idArchivoDxf, MIN(codigoMaterial) codigo FROM FICHAS_CONFECCION_DXF_MATERIALES
              GROUP BY idArchivoDxf HAVING COUNT(*) = 1) m ON m.idArchivoDxf = p.idArchivoDxf
        SET p.codigoMaterial = REPLACE(TRIM(m.codigo), '-', '.')
        WHERE p.codigoMaterial IS NULL`);
    console.log(`✓ ${una?.affectedRows ?? 0} pieza(s) de fichas de un solo material quedaron con su material`);
    // Las de varios materiales: se borran y llenarPiezasDeFichas las vuelve a leer del DXF.
    const [, varias] = await db.query(`
        DELETE p FROM FICHAS_CONFECCION_DXF_PIEZAS p
        WHERE p.codigoMaterial IS NULL
          AND (SELECT COUNT(*) FROM FICHAS_CONFECCION_DXF_MATERIALES m WHERE m.idArchivoDxf = p.idArchivoDxf) > 1`);
    if (varias?.affectedRows) console.log(`✓ ${varias.affectedRows} pieza(s) de fichas con varios materiales se vuelven a leer de su DXF`);
}

// Las piezas de cada DXF de ficha que todavía no las tiene, leídas del bucket privado.
async function llenarPiezasDeFichas() {
    const { default: r2PrivateClient, R2_PRIVATE_BUCKET } = await import('../config/r2Private.js');
    const dxfs = await db.query(`
        SELECT d.idArchivoDxf, d.objectKey, d.nombreOriginal FROM FICHAS_CONFECCION_DXF d
        WHERE d.estado = 'listo' AND d.objectKey IS NOT NULL
          AND EXISTS (SELECT 1 FROM FICHAS_CONFECCION f WHERE f.idDxf = d.idArchivoDxf)
          AND NOT EXISTS (SELECT 1 FROM FICHAS_CONFECCION_DXF_PIEZAS p WHERE p.idArchivoDxf = d.idArchivoDxf)`,
        { type: QueryTypes.SELECT });
    for (const d of dxfs) {
        try {
            const obj = await r2PrivateClient.send(new GetObjectCommand({ Bucket: R2_PRIVATE_BUCKET, Key: d.objectKey }));
            const receta = recetaDeDxf(await obj.Body.transformToString('utf8'));
            const ahora = new Date();
            await db.query(
                `INSERT IGNORE INTO FICHAS_CONFECCION_DXF_PIEZAS (idArchivoDxf, nombrePieza, talla, porPrenda, codigoMaterial, createdAt, updatedAt) VALUES ${receta.map(() => '(?,?,?,?,?,?,?)').join(',')}`,
                { replacements: receta.flatMap(p => [d.idArchivoDxf, p.nombre.slice(0, 120), p.talla.slice(0, 20), p.porPrenda, p.material, ahora, ahora]) });
            console.log(`✓ ${d.nombreOriginal}: ${receta.map(p => `${p.nombre} (${p.talla}${p.porPrenda > 1 ? ` ×${p.porPrenda}` : ''})`).join(', ')}`);
        } catch (e) {
            console.warn(`! ${d.nombreOriginal}: no se pudieron leer sus piezas (${e.message}). El corte usará las del trazo.`);
        }
    }
    if (!dxfs.length) console.log('· Todas las fichas ya tienen sus piezas');
}

const revertir = async () => {
    if (await existeTabla('ORDENES_CORTE')) {
        const { n } = await uno('SELECT COUNT(*) n FROM ORDENES_CORTE');
        if (n > 0) { console.error(`✗ ABORTADO: ORDENES_CORTE tiene ${n} corte(s). No se revierte con datos.`); return 1; }
    }
    if (await columna('ORDENES_PRODUCCION', 'idOrdenCorte')) {
        await db.query('ALTER TABLE ORDENES_PRODUCCION DROP FOREIGN KEY ordenes_produccion_corte_fk, DROP INDEX ordenes_produccion_corte_idx, DROP COLUMN idOrdenCorte');
        console.log('✓ ORDENES_PRODUCCION.idOrdenCorte eliminada');
    }
    for (const tg of ['ORDENES_CORTE_ESTADOS_sin_update', 'ORDENES_CORTE_ESTADOS_sin_delete']) await db.query(`DROP TRIGGER IF EXISTS \`${tg}\``);
    for (const t of [...TABLAS, 'ORDENES_CORTE', 'FICHAS_CONFECCION_DXF_PIEZAS']) {
        if (await existeTabla(t)) { await db.query(`DROP TABLE ${t}`); console.log(`✓ ${t} eliminada`); }
    }
    await db.query("DELETE FROM SECUENCIAS WHERE nombre = 'orden_corte'");
    console.log('Los valores nuevos de los ENUM se dejan: quitarlos fallaría si alguna fila ya los usa.');
    return 0;
};

export const migrarOrdenesCorte = async () => { await db.authenticate(); await migrar(); };

if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        await db.authenticate();
        if (REVERTIR) process.exit(await revertir());
        await migrar();
        console.log('\nMigración completada.');
        process.exit(0);
    })().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
}
