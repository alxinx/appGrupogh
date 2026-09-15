import { pathToFileURL } from 'url';
import { QueryTypes } from 'sequelize';
import db from '../config/bd.js';

// models/Traslados.js declara DEVUELTO, pero la columna nunca se amplió, así que el job de
// traslados expirados no podía completar ni un traslado. Correr esta migración es lo que
// activa la devolución automática en un entorno: hasta entonces el job falla y revierte.
//
//   npm run db:migrar-traslado-devuelto

const TABLA = 'TRASLADOS';
const NUEVO = 'DEVUELTO';

const columnaEstado = async () => {
    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    const estado = cols.find(c => c.Field === 'estado');
    if (!estado) throw new Error(`${TABLA} no tiene columna estado`);
    return estado;
};

export const migrarTrasladoDevuelto = async () => {
    const estado = await columnaEstado();
    if (estado.Type.includes(`'${NUEVO}'`)) return false;

    // El ENUM se reescribe con los valores que ya tiene ESTA base, en su orden, más el nuevo:
    // un MODIFY con otra lista dejaría en '' las filas de los valores que no se nombren.
    // NULL y DEFAULT se repiten porque MODIFY no los hereda.
    const valores = [...estado.Type.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'"));
    const lista = [...valores, NUEVO].map(v => db.escape(v)).join(',');
    const nulo = estado.Null === 'YES' ? 'NULL' : 'NOT NULL';
    const porDefecto = estado.Default === null
        ? (estado.Null === 'YES' ? 'DEFAULT NULL' : '')
        : `DEFAULT ${db.escape(estado.Default)}`;

    await db.query(`ALTER TABLE ${TABLA} MODIFY COLUMN estado ENUM(${lista}) ${nulo} ${porDefecto}`);
    return true;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    (async () => {
        await db.authenticate();
        const cambio = await migrarTrasladoDevuelto();
        console.log(cambio ? `✓ ${TABLA}.estado ampliado con '${NUEVO}'` : `· ${TABLA}.estado ya admite '${NUEVO}', se omite`);
        console.log('estado →', (await columnaEstado()).Type);
        process.exit(0);
    })().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
}
