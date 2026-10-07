import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea los recursos de permiso fino de la pestaña "Producción" del menú admin
// (views/partials/leftMenu.pug): Confeccionistas, Procesos e Insumos. Mismo patrón que
// migracionPermisoMisClientes.js — tipo='administrativo' en vez de 'vendedor', folder es
// lo que permisosAdmin.js usa para decidir si la carpeta entra en `carpetasAdmin`.
//
// A propósito NO se le asigna ninguno de los tres a nadie: son pantallas nuevas (hoy solo
// la base del módulo, sin datos todavía) y el acceso queda en $0 hasta que un admin lo
// otorgue explícitamente desde la ficha del empleado, en Personal — igual que "Mis
// Clientes". Sin el permiso otorgado, el ítem simplemente no aparece en la pestaña
// Producción; no es un error.
//
//   node ./seed/migracionPermisosProduccion.js
//   node ./seed/migracionPermisosProduccion.js --revertir

const REVERTIR = process.argv.includes('--revertir');

const RECURSOS = [
    { nombre: 'Confeccionistas', folder: '/confeccionistas' },
    { nombre: 'Procesos',        folder: '/procesos' },
    { nombre: 'Insumos',         folder: '/insumos' }
];

const run = async () => {
    await db.authenticate();

    for (const r of RECURSOS) {
        const [existente] = await db.query(
            "SELECT idRecurso FROM PERMISOS_RECURSOS WHERE tipo='administrativo' AND nombreRecurso=:n",
            { replacements: { n: r.nombre }, type: QueryTypes.SELECT }
        );

        if (REVERTIR) {
            if (!existente) { console.log(`· "${r.nombre}" no existe, nada que revertir`); continue; }
            const [{ n }] = await db.query(
                'SELECT COUNT(*) n FROM USER_PERMISOS WHERE idRecurso=:id',
                { replacements: { id: existente.idRecurso }, type: QueryTypes.SELECT }
            );
            if (n > 0) {
                console.error(`✗ ABORTADO "${r.nombre}": ${n} empleado(s) ya tienen este permiso asignado. Quitalo primero desde su ficha si de verdad querés revertir.`);
                continue;
            }
            await db.query('DELETE FROM PERMISOS_RECURSOS WHERE idRecurso=:id', { replacements: { id: existente.idRecurso } });
            console.log(`✓ Recurso "${r.nombre}" eliminado`);
            continue;
        }

        if (existente) {
            console.log(`· El recurso "${r.nombre}" ya existe (folder ${r.folder}), se omite`);
            continue;
        }

        await db.query(
            'INSERT INTO PERMISOS_RECURSOS (idRecurso, nombreRecurso, tipo, folder, createdAt) VALUES (UUID(), :n, :t, :f, NOW())',
            { replacements: { n: r.nombre, t: 'administrativo', f: r.folder } }
        );
        console.log(`✓ Recurso "${r.nombre}" creado (tipo=administrativo, folder=${r.folder})`);
    }

    if (!REVERTIR) console.log('\nRecordá otorgarlo desde la ficha de cada empleado que deba verlo — nadie lo tiene por defecto.');
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e.message || e); process.exit(1); });
