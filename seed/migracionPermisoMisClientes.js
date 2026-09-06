import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea el recurso de permiso fino "Mis Clientes" (tipo='vendedor', folder='/clientes')
// para la nueva página del POS que lista los clientes con facturas pendientes en
// crédito de la tienda — mismo patrón que "Pedidos Web", "Caja y ventas", etc.
// (PERMISOS_RECURSOS.folder es lo que storeMiddleware.js usa para decidir si un
// empleado puede ver esa carpeta del menú).
//
// A propósito NO se le asigna este permiso a ningún empleado existente: expone deuda
// de clientes (dato financiero sensible), así que el acceso queda en $0 hasta que un
// admin lo otorgue explícitamente desde la ficha del empleado — a diferencia de
// migracionPermisosAdmin.js, que sí retrocompletaba folders viejos para no dejar a
// nadie afuera de algo a lo que ya entraba por su rol.
//
//   node ./seed/migracionPermisoMisClientes.js
//   node ./seed/migracionPermisoMisClientes.js --revertir

const REVERTIR = process.argv.includes('--revertir');
const NOMBRE = 'Mis Clientes';
const FOLDER = '/clientes';

const run = async () => {
    await db.authenticate();

    const [existente] = await db.query(
        "SELECT idRecurso FROM PERMISOS_RECURSOS WHERE tipo='vendedor' AND nombreRecurso=:n",
        { replacements: { n: NOMBRE }, type: QueryTypes.SELECT }
    );

    if (REVERTIR) {
        if (!existente) { console.log('· el recurso no existe, nada que revertir'); process.exit(0); }
        const [{ n }] = await db.query(
            'SELECT COUNT(*) n FROM USER_PERMISOS WHERE idRecurso=:id',
            { replacements: { id: existente.idRecurso }, type: QueryTypes.SELECT }
        );
        if (n > 0) {
            console.error(`✗ ABORTADO: ${n} empleado(s) ya tienen este permiso asignado. Quitalo primero desde su ficha si de verdad querés revertir.`);
            process.exit(1);
        }
        await db.query('DELETE FROM PERMISOS_RECURSOS WHERE idRecurso=:id', { replacements: { id: existente.idRecurso } });
        console.log(`✓ Recurso "${NOMBRE}" eliminado`);
        process.exit(0);
    }

    if (existente) {
        console.log(`· El recurso "${NOMBRE}" ya existe (folder ${FOLDER}), se omite`);
        process.exit(0);
    }

    await db.query(
        'INSERT INTO PERMISOS_RECURSOS (idRecurso, nombreRecurso, tipo, folder, createdAt) VALUES (UUID(), :n, :t, :f, NOW())',
        { replacements: { n: NOMBRE, t: 'vendedor', f: FOLDER } }
    );
    console.log(`✓ Recurso "${NOMBRE}" creado (tipo=vendedor, folder=${FOLDER})`);
    console.log('  Recordá otorgarlo desde la ficha de cada empleado que deba verlo — nadie lo tiene por defecto.');
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e.message || e); process.exit(1); });
