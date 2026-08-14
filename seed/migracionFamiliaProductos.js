import { DataTypes, QueryTypes } from 'sequelize';
import dotenv from 'dotenv';
import db from '../config/bd.js';
import { normalizarFamilia } from '../helpers/helpers.js';

dotenv.config();

// Lleva la familia a su forma normalizada: tabla propia FAMILIA + FK en PRODUCTOS.
//
// Una versión anterior guardaba el nombre de la familia repetido en cada producto
// (PRODUCTOS.familia VARCHAR). Esta migración:
//
//   1. crea FAMILIA
//   2. pasa los nombres distintos que hubiera en PRODUCTOS.familia a filas de FAMILIA
//   3. agrega PRODUCTOS.idFamilia y lo apunta a la fila que corresponde
//   4. recién ahí borra la columna vieja
//
// El orden importa: si la columna se borrara antes del paso 2 se perderían los datos.
// Es idempotente: se puede correr varias veces sin romper nada.
//
//   node ./seed/migracionFamiliaProductos.js

const TABLA        = 'PRODUCTOS';
const INDICE       = 'productos_familia_idx';
const INDICE_VIEJO = 'productos_familia_unique';
const FK           = 'fk_productos_familia';

const run = async () => {
    const qi = db.getQueryInterface();
    await db.authenticate();

    // ── 1. Tabla FAMILIA ────────────────────────────────────────────────────
    const { default: Familia } = await import('../models/Familia.js');
    await Familia.sync();
    console.log('✓ tabla FAMILIA lista');

    const actuales = await qi.describeTable(TABLA);
    const indices  = await qi.showIndex(TABLA);
    const tieneIndice = (nombre) => indices.some(i => i.name === nombre);

    // ── 2. Rescatar los nombres de la columna vieja ─────────────────────────
    // Mapa valorCrudoEnLaTabla -> idFamilia. La clave es el texto TAL CUAL está guardado,
    // no el normalizado: el UPDATE de abajo compara por igualdad exacta y así no depende de
    // que SQL sepa reproducir la normalización de JS (TRIM no colapsa espacios internos,
    // que es justo lo que diferencia "BLUSA  GREICY" de "BLUSA GREICY").
    const mapaFamilias = new Map();

    if (actuales.familia) {
        const filas = await db.query(
            `SELECT DISTINCT familia FROM ${TABLA} WHERE familia IS NOT NULL AND familia <> ''`,
            { type: QueryTypes.SELECT }
        );

        const nombresCreados = new Set();
        for (const { familia } of filas) {
            const nombre = normalizarFamilia(familia);
            if (!nombre) continue;
            // findOrCreate y no create: varias grafías ("Blusa Greicy", "BLUSA  GREICY",
            // "  blusa greicy ") normalizan al mismo nombre y deben caer en UNA sola fila.
            const [fila] = await Familia.findOrCreate({
                where:    { nombreFamilia: nombre },
                defaults: { nombreFamilia: nombre }
            });
            mapaFamilias.set(familia, { idFamilia: fila.idFamilia, nombre });
            nombresCreados.add(nombre);
        }
        console.log(`✓ ${nombresCreados.size} familia(s) rescatada(s) de ${filas.length} grafía(s) distinta(s)`);
    }

    // ── 3. Columna idFamilia ────────────────────────────────────────────────
    if (actuales.idFamilia) {
        console.log('· idFamilia ya existe, se omite');
    } else {
        await qi.addColumn(TABLA, 'idFamilia', { type: DataTypes.UUID, allowNull: true });
        console.log('✓ idFamilia agregada');
    }

    // Apuntar cada producto a su fila de FAMILIA. Se compara contra el valor crudo exacto
    // (`familia = :crudo`), que es el que salió del DISTINCT de arriba.
    const enlazados = new Map();
    for (const [crudo, { idFamilia, nombre }] of mapaFamilias) {
        const [, meta] = await db.query(
            `UPDATE ${TABLA} SET idFamilia = :idFamilia
             WHERE idFamilia IS NULL AND familia = :crudo`,
            { replacements: { idFamilia, crudo } }
        );
        enlazados.set(nombre, (enlazados.get(nombre) || 0) + (meta?.affectedRows ?? 0));
    }
    for (const [nombre, total] of enlazados) {
        console.log(`  · ${nombre}: ${total} producto(s) enlazado(s)`);
    }

    // Red de seguridad: si algún producto tenía familia y quedó sin enlazar, la columna NO
    // se puede borrar todavía — se perdería el dato. Mejor abortar y que quede a la vista.
    if (actuales.familia) {
        const [huerfanos] = await db.query(
            `SELECT COUNT(*) n FROM ${TABLA} WHERE familia IS NOT NULL AND familia <> '' AND idFamilia IS NULL`,
            { type: QueryTypes.SELECT, plain: false }
        );
        const n = huerfanos?.n ?? huerfanos?.[0]?.n ?? 0;
        if (n > 0) {
            throw new Error(`${n} producto(s) con familia quedaron sin enlazar. Se aborta antes de borrar la columna para no perder datos.`);
        }
    }

    // ── 4. Limpiar lo viejo ─────────────────────────────────────────────────
    // Los índices sobre la columna vieja se van antes que la columna.
    for (const viejo of [INDICE_VIEJO, INDICE]) {
        if (!tieneIndice(viejo)) continue;
        const sobreColumnaVieja = indices
            .find(i => i.name === viejo)
            ?.fields.some(f => f.attribute === 'familia');
        if (!sobreColumnaVieja) continue;
        await qi.removeIndex(TABLA, viejo);
        console.log(`✓ índice ${viejo} (sobre la columna vieja) eliminado`);
    }

    if (actuales.familia) {
        await qi.removeColumn(TABLA, 'familia');
        console.log('✓ columna familia (VARCHAR) eliminada');
    } else {
        console.log('· columna familia ya no existe, se omite');
    }

    // ── 5. Índice y FK sobre idFamilia ──────────────────────────────────────
    const indicesFinales = await qi.showIndex(TABLA);
    if (indicesFinales.some(i => i.name === INDICE)) {
        console.log(`· índice ${INDICE} ya existe, se omite`);
    } else {
        await qi.addIndex(TABLA, ['idFamilia'], { name: INDICE });
        console.log(`✓ índice ${INDICE} agregado`);
    }

    try {
        // SET NULL y no CASCADE: borrar una familia no puede borrar sus productos, solo
        // dejarlos sin agrupar.
        await qi.addConstraint(TABLA, {
            fields: ['idFamilia'],
            type: 'foreign key',
            name: FK,
            references: { table: 'FAMILIA', field: 'idFamilia' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });
        console.log(`✓ FK ${FK} agregada`);
    } catch (e) {
        if (/Duplicate|already exists|errno: 121/i.test(e.message)) {
            console.log(`· FK ${FK} ya existe, se omite`);
        } else {
            throw e;
        }
    }

    console.log('\nMigración de FAMILIA completada.');
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
