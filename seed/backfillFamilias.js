import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';
import { normalizarFamilia } from '../helpers/helpers.js';

dotenv.config();

// Asigna familia a los productos que no la tienen, deduciéndola del nombre.
// Regla: el nombre es [NOMBRE DEL ARTÍCULO] + [COLOR] (a veces + talla), así que se recorta
// el color del final y lo que queda es la familia.
//
//   node ./seed/backfillFamilias.js            → simulación, no escribe nada
//   node ./seed/backfillFamilias.js --aplicar  → escribe
//
// Trabaja solo sobre productos con idFamilia NULL: correrlo dos veces no reasigna nada.

const APLICAR = process.argv.includes('--aplicar');

// Palabras que, al final del nombre, no son parte del artículo. Se arman con los colores
// reales de ATRIBUTOS más las variantes que aparecen escritas distinto en el catálogo
// (género, separado en dos palabras, o mal tipeado) — ATRIBUTOS no las cubre todas.
const VARIANTES_EXTRA = [
    'AMARILLA', 'ROJA', 'ROSADO', 'ROSADA', 'VINO', 'TINTO', 'BLANCCO', 'AMARILLO'
];
const RELLENO = ['COLOR', 'COLORES', '-', '+', '/'];

const construirVocabulario = async () => {
    const filas = await db.query(
        "SELECT valor, tipo FROM ATRIBUTOS WHERE tipo IN ('COLOR','TALLA')",
        { type: QueryTypes.SELECT }
    );
    const palabras = new Set([...VARIANTES_EXTRA, ...RELLENO]);
    // Los colores compuestos ("Amarillo Colombia", "Blanco + Negro") se cargan por palabra:
    // el recorte va token a token desde el final.
    filas.forEach(({ valor }) => {
        normalizarFamilia(valor)?.split(' ').forEach(p => palabras.add(p));
    });
    return palabras;
};

// Recorta desde el final todo lo que sea color, talla o relleno. Lo que sobra es la familia.
const deducirFamilia = (nombreProducto, vocabulario) => {
    const tokens = (normalizarFamilia(nombreProducto) || '').split(' ').filter(Boolean);
    let fin = tokens.length;
    // Nunca se baja de 2 palabras: el nombre del artículo ("Blusa Greicy") tiene al menos
    // dos, y sin este tope un producto llamado "Blusa Rosa" quedaría como familia "BLUSA".
    while (fin > 2 && vocabulario.has(tokens[fin - 1])) fin--;
    return { familia: tokens.slice(0, fin).join(' '), recortado: tokens.slice(fin).join(' ') };
};

const run = async () => {
    await db.authenticate();
    const vocabulario = await construirVocabulario();

    const productos = await db.query(
        'SELECT idProducto, nombreProducto FROM PRODUCTOS WHERE idFamilia IS NULL ORDER BY nombreProducto',
        { type: QueryTypes.SELECT }
    );

    if (!productos.length) {
        console.log('No hay productos sin familia.');
        process.exit(0);
    }

    // Agrupar en memoria para poder mostrar el plan antes de escribir.
    const plan = new Map();
    const sinColor = [];
    for (const p of productos) {
        const { familia, recortado } = deducirFamilia(p.nombreProducto, vocabulario);
        if (!recortado) sinColor.push(p.nombreProducto);
        if (!plan.has(familia)) plan.set(familia, []);
        plan.get(familia).push({ ...p, recortado });
    }

    const { Familia } = await import('../models/index.js');
    const existentes = new Set(
        (await Familia.findAll({ attributes: ['nombreFamilia'], raw: true })).map(f => f.nombreFamilia)
    );

    console.log(`${productos.length} producto(s) sin familia → ${plan.size} familia(s)\n`);
    for (const [familia, items] of [...plan].sort()) {
        const marca = existentes.has(familia) ? 'ya existe' : 'NUEVA';
        console.log(`${familia}  (${items.length} producto(s), ${marca})`);
        items.forEach(i => console.log(`    ${i.nombreProducto.padEnd(32)} recorta: ${i.recortado || '— (sin color detectado)'}`));
    }

    if (sinColor.length) {
        console.log(`\n⚠ ${sinColor.length} producto(s) sin color reconocible al final; se usa el nombre completo como familia:`);
        sinColor.forEach(n => console.log(`    ${n}`));
    }

    if (!APLICAR) {
        console.log('\n── SIMULACIÓN: no se escribió nada. Volvé a correr con --aplicar ──');
        process.exit(0);
    }

    // Todo o nada: si falla a la mitad, no quedan productos a medio agrupar.
    const t = await db.transaction();
    try {
        let asignados = 0;
        for (const [familia, items] of plan) {
            const [fila] = await Familia.findOrCreate({
                where:    { nombreFamilia: familia },
                defaults: { nombreFamilia: familia },
                transaction: t
            });
            const [, meta] = await db.query(
                'UPDATE PRODUCTOS SET idFamilia = :idFamilia WHERE idProducto IN (:ids) AND idFamilia IS NULL',
                { replacements: { idFamilia: fila.idFamilia, ids: items.map(i => i.idProducto) }, transaction: t }
            );
            asignados += meta?.affectedRows ?? 0;
        }
        await t.commit();
        console.log(`\n✓ ${asignados} producto(s) asignado(s) a ${plan.size} familia(s)`);
    } catch (e) {
        if (!t.finished) await t.rollback().catch(() => {});
        throw e;
    }

    const [pendientes] = await db.query('SELECT COUNT(*) n FROM PRODUCTOS WHERE idFamilia IS NULL', { type: QueryTypes.SELECT, plain: false });
    console.log(`Productos sin familia después: ${pendientes?.n ?? 0}`);
    process.exit(0);
};

run().catch((e) => {
    console.error('Backfill fallido:', e);
    process.exit(1);
});
