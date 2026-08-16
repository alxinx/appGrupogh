import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// El slug es la URL pública del producto y la tienda lo resuelve con findOne. Dos productos
// con el mismo slug no fallan en ningún lado: uno de los dos simplemente deja de ser
// alcanzable desde la web, en silencio. Este índice lo vuelve imposible.
//
// MySQL admite muchos NULL en un índice único, así que los productos sin slug conviven.
//
//   node ./seed/migracionSlugUnico.js
//   node ./seed/migracionSlugUnico.js --arreglar   (numera los repetidos antes de indexar)

const TABLA = 'PRODUCTOS';
const INDICE = 'productos_slug_unique';
const ARREGLAR = process.argv.includes('--arreglar');

const run = async () => {
    const qi = db.getQueryInterface();
    await db.authenticate();

    const repetidos = await db.query(
        `SELECT slug, COUNT(*) n FROM ${TABLA} WHERE slug IS NOT NULL AND slug <> ''
         GROUP BY slug HAVING n > 1`,
        { type: QueryTypes.SELECT }
    );

    if (repetidos.length) {
        console.log(`Hay ${repetidos.length} slug(s) repetido(s):`);
        repetidos.forEach(r => console.log(`   ${r.slug} × ${r.n}`));

        if (!ARREGLAR) {
            console.log('\nNo se creó el índice. Corré con --arreglar para numerar los repetidos y volver a intentar.');
            process.exit(1);
        }

        // Se conserva el más antiguo con su slug; los demás se numeran.
        for (const { slug } of repetidos) {
            const filas = await db.query(
                `SELECT idProducto FROM ${TABLA} WHERE slug = :slug ORDER BY createdAt ASC, idProducto ASC`,
                { replacements: { slug }, type: QueryTypes.SELECT }
            );
            for (let i = 1; i < filas.length; i++) {
                const nuevo = `${slug}-${i + 1}`;
                await db.query(`UPDATE ${TABLA} SET slug = :nuevo WHERE idProducto = :id`,
                    { replacements: { nuevo, id: filas[i].idProducto } });
                console.log(`   ✓ ${slug} → ${nuevo}`);
            }
        }
    } else {
        console.log('· no hay slugs repetidos');
    }

    const indices = await qi.showIndex(TABLA);
    if (indices.some(i => i.name === INDICE)) {
        console.log(`· índice ${INDICE} ya existe, se omite`);
    } else {
        await qi.addIndex(TABLA, ['slug'], { name: INDICE, unique: true });
        console.log(`✓ índice único ${INDICE} agregado`);
    }

    console.log('\nMigración del slug completada.');
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
