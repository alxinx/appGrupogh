import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Contadores para las referencias que ahora arma el sistema.
//
// La referencia de un egreso era un campo libre y opcional, y en la práctica quedaba vacía.
// Un egreso sin referencia no se puede nombrar: en el cuadre, en el listado y en una
// conversación por teléfono no hay forma de señalar CUÁL de los tres egresos de $50.000 de
// esa tienda es el que está en discusión. Lo mismo con un traslado hacia otra caja, donde
// además no hay ninguna referencia externa que transcribir —la plata pasa de mano a mano—.
//
//   EGR-{n}  egresos
//   TRA-{n}  traslados de efectivo
//
// Se generan solo cuando el operador no escribió una. Lo que él escriba manda siempre: en
// un egreso esa referencia es el número de la factura que pagó, y en un traslado a un banco
// es el comprobante de la consignación, que es lo único que permite encontrar el movimiento
// en el extracto. Pisarlos con un correlativo interno sería destruir el dato útil.
//
// Los contadores viven en SECUENCIAS porque `siguienteNumero` los reserva con un UPDATE
// sobre una sola fila: InnoDB la bloquea y las peticiones simultáneas hacen fila en vez de
// tomar el mismo número. Arrancan en 0 —la primera referencia es EGR-1— porque estos
// prefijos no existían antes y no hay nada contra lo que chocar; la migración lo verifica.
//
//   node ./seed/migracionReferenciasGeneradas.js            (muestra qué haría)
//   node ./seed/migracionReferenciasGeneradas.js --aplicar
//
// Idempotente.

const APLICAR = process.argv.includes('--aplicar');

const CONTADORES = [
    { nombre: 'egreso_referencia',            prefijo: 'EGR-' },
    { nombre: 'traslado_efectivo_referencia', prefijo: 'TRA-' }
];

const run = async () => {
    await db.authenticate();

    const existentes = await db.query('SELECT nombre, valor FROM SECUENCIAS', { type: QueryTypes.SELECT });
    const porNombre = Object.fromEntries(existentes.map(r => [r.nombre, Number(r.valor)]));

    // Si ya hubiera referencias con estos prefijos, arrancar en 0 generaría duplicados. Se
    // siembra con el máximo encontrado, no con cero.
    const maximos = {};
    for (const c of CONTADORES) {
        const [{ n, alto }] = await db.query(
            `SELECT COUNT(*) n, COALESCE(MAX(CAST(SUBSTRING(referencia, :largo) AS UNSIGNED)), 0) alto
             FROM EGRESOS WHERE referencia LIKE :patron`,
            { replacements: { largo: c.prefijo.length + 1, patron: `${c.prefijo}%` }, type: QueryTypes.SELECT }
        );
        maximos[c.nombre] = { usadas: Number(n), alto: Number(alto) };
    }

    console.log('Contadores:');
    for (const c of CONTADORES) {
        const m = maximos[c.nombre];
        const actual = porNombre[c.nombre];
        const arranque = Math.max(m.alto, 0);
        console.log(`   ${c.nombre.padEnd(30)} ${c.prefijo}  ${actual !== undefined
            ? `ya existe en ${actual}, se omite`
            : `se crea en ${arranque}${m.usadas ? ` (hay ${m.usadas} referencias ${c.prefijo}* ya usadas, la más alta ${c.prefijo}${m.alto})` : ''}`}`);
    }

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/migracionReferenciasGeneradas.js --aplicar');
        process.exit(0);
    }

    for (const c of CONTADORES) {
        if (porNombre[c.nombre] !== undefined) continue;
        await db.query(
            'INSERT INTO SECUENCIAS (nombre, valor) VALUES (:nombre, :valor)',
            { replacements: { nombre: c.nombre, valor: Math.max(maximos[c.nombre].alto, 0) } }
        );
        console.log(`✓ ${c.nombre} sembrado en ${Math.max(maximos[c.nombre].alto, 0)}`);
    }

    console.log('\nSECUENCIAS:');
    for (const r of await db.query('SELECT nombre, valor FROM SECUENCIAS ORDER BY nombre', { type: QueryTypes.SELECT })) {
        console.log(`   ${r.nombre.padEnd(30)} ${r.valor}`);
    }
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
