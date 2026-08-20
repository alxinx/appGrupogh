import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';
import { sanitizarContenidoPagina } from '../helpers/helpers.js';

dotenv.config();

// Limpia el HTML de las páginas del CMS que se guardaron sin sanear.
//
// `contenido` se guardaba tal cual llegaba del editor y el formulario de edición lo vuelve
// a pintar sin escapar. Un editor con acceso al CMS podía dejar un <script> que se ejecuta
// en el navegador de cualquier administrador que abra esa página. La cookie es httpOnly,
// así que no se la roba; hace algo peor: actúa con su sesión abierta.
//
// La entrada ya quedó saneada. Esto limpia lo que entró antes.
//
//   node ./seed/migracionSanearPaginasWeb.js            (muestra qué cambiaría)
//   node ./seed/migracionSanearPaginasWeb.js --aplicar
//
// Idempotente: aplicarla dos veces no cambia nada la segunda.

const APLICAR = process.argv.includes('--aplicar');

const run = async () => {
    await db.authenticate();
    const [{ bd }] = await db.query('SELECT DATABASE() bd', { type: QueryTypes.SELECT });
    console.log(`base: ${bd}\n`);

    const paginas = await db.query(
        'SELECT idPagina, nombrePagina, slug, contenido FROM PAGINAS_WEB ORDER BY nombrePagina',
        { type: QueryTypes.SELECT }
    );

    if (!paginas.length) { console.log('· No hay páginas. Nada que hacer.'); process.exit(0); }

    // Lo que de verdad importa: si tras limpiar desaparece algo ejecutable, esa página
    // tenía código adentro.
    const PELIGRO = /<\s*(script|iframe|object|embed|svg|form)\b|\son\w+\s*=|javascript:/i;

    const cambian = [];
    for (const p of paginas) {
        const limpio = sanitizarContenidoPagina(p.contenido);
        if (limpio !== (p.contenido ?? '')) {
            cambian.push({ ...p, limpio, ejecutable: PELIGRO.test(p.contenido || '') });
        }
    }

    console.log(`${paginas.length} página(s) · ${cambian.length} cambian al sanear\n`);
    for (const c of cambian) {
        const marca = c.ejecutable ? '⚠ TENÍA CÓDIGO EJECUTABLE' : '· solo etiquetas no permitidas';
        console.log(`   ${String(c.nombrePagina).padEnd(28)} /${c.slug}`);
        console.log(`      ${marca} · ${String(c.contenido || '').length} → ${c.limpio.length} caracteres`);
        if (c.ejecutable) {
            const m = String(c.contenido).match(PELIGRO);
            console.log(`      encontrado: ${m[0]}`);
        }
    }
    if (!cambian.length) console.log('   · Todas están limpias.');

    if (!APLICAR || !cambian.length) {
        if (cambian.length) {
            console.log('\n(simulación) Para aplicarlo:');
            console.log('   node ./seed/migracionSanearPaginasWeb.js --aplicar');
        }
        process.exit(0);
    }

    await db.transaction(async (t) => {
        for (const c of cambian) {
            await db.query('UPDATE PAGINAS_WEB SET contenido = :c WHERE idPagina = :id',
                { replacements: { c: c.limpio, id: c.idPagina }, transaction: t });
        }
    });

    console.log(`\n✓ ${cambian.length} página(s) saneadas.`);
    process.exit(0);
};

run().catch((e) => { console.error('Falló:', e.message || e); process.exit(1); });
