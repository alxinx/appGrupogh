import { pathToFileURL } from 'url';
import { QueryTypes } from 'sequelize';
import db from '../config/bd.js';

// Contador de los SKU internos (200 + 9 dígitos + verificador, ver helpers/productos.js).
// Arranca en 0: el primer producto queda 2000000000018. No se siembra con el máximo actual
// porque los SKU viejos son alfanuméricos y no ocupan ningún número de esta serie.
//
//   npm run db:migrar-secuencia-sku

const SECUENCIA = 'sku_producto';

export const migrarSecuenciaSku = async () => {
    const [fila] = await db.query('SELECT valor FROM SECUENCIAS WHERE nombre = :nombre', {
        replacements: { nombre: SECUENCIA }, type: QueryTypes.SELECT
    });
    if (fila) return false;
    await db.query('INSERT INTO SECUENCIAS (nombre, valor) VALUES (:nombre, 0)', {
        replacements: { nombre: SECUENCIA }
    });
    return true;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    (async () => {
        await db.authenticate();
        const creada = await migrarSecuenciaSku();
        console.log(creada ? `✓ contador '${SECUENCIA}' creado en 0` : `· el contador '${SECUENCIA}' ya existía, se omite`);
        const filas = await db.query('SELECT nombre, valor FROM SECUENCIAS ORDER BY nombre', { type: QueryTypes.SELECT });
        filas.forEach(f => console.log(`   ${f.nombre.padEnd(30)} ${f.valor}`));
        process.exit(0);
    })().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
}
