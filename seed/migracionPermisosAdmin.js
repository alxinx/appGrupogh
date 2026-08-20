import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Prepara el panel de administrador para verificar permisos de verdad.
//
// Hoy `/admin` está protegido solo por `verificarRol('ADMIN')`: quien entra, entra a todo.
// Los permisos finos existen en USER_PERMISOS y se pueden asignar desde la ficha del
// empleado, pero ninguna ruta los lee. Un usuario al que se le dio solo "Inventario y
// Productos" puede mover plata entre bancos igual.
//
// Esta migración hace tres cosas, y la tercera es la importante:
//
//   1. Llena `folder` en los recursos administrativos. Es lo que permite decidir si una
//      ruta pertenece a un recurso, igual que ya hace el panel de tienda.
//   2. Renombra 'Web' a 'Tienda Web', que es como se llama en el menú. Ese recurso no
//      está referenciado en ningún lado del código, así que el cambio es solo de rótulo.
//   3. NO deja a nadie afuera. Un ADMIN que hoy no tiene NINGUNA fila de permiso
//      administrativo entra a todo por su rol; cuando la verificación se encienda, sin
//      filas se quedaría sin panel. A esos se les escribe el juego completo: no es darles
//      permisos nuevos, es anotar los que ya ejercen.
//
//      A quien YA tiene un conjunto curado no se le toca nada. Si a alguien se le dio solo
//      "Inventario y Productos", eso es exactamente lo que va a poder hacer — que es el
//      punto de encender esto.
//
//   node ./seed/migracionPermisosAdmin.js            (muestra qué haría)
//   node ./seed/migracionPermisosAdmin.js --aplicar
//
// Idempotente.

const APLICAR = process.argv.includes('--aplicar');

// Cada recurso administrativo con el prefijo de ruta que le corresponde en /admin.
// `null` significa que el recurso no gobierna ninguna pantalla: existe para autorizar
// acciones puntuales (como 'Bancos', que pide `verificarPermisoEmpleado` al aceptar un
// traslado) y no debe abrir ni cerrar ninguna carpeta del menú.
const CARPETAS = {
    'Inventario y Productos':   '/inventario',
    'Bancos':                   '/bankentities',
    'tiendas':                  '/tiendas',
    'Personal':                 '/personal',
    'Provedores':               '/provedores',
    'Clientes':                 '/clientes',
    'Dosificación y Repartos':  '/dosificaciones',
    'Pedidos y Reparto':        '/pedidos',
    'Settings':                 '/configuracion',
    'Tienda Web':               '/web',
    'Traslados':                null,
    'Autorizacion de creditos': null
};

const run = async () => {
    await db.authenticate();
    const [{ bd }] = await db.query('SELECT DATABASE() bd', { type: QueryTypes.SELECT });
    console.log(`base: ${bd}\n`);

    // ── 1. Renombrar 'Web' → 'Tienda Web' ────────────────────────────────────
    const [web] = await db.query(
        "SELECT idRecurso, nombreRecurso FROM PERMISOS_RECURSOS WHERE tipo='administrativo' AND nombreRecurso IN ('Web','Tienda Web')",
        { type: QueryTypes.SELECT }
    );
    const renombrar = web?.nombreRecurso === 'Web';
    console.log(renombrar ? "→ renombrar 'Web' a 'Tienda Web'" : "· el recurso de la tienda web ya se llama 'Tienda Web'");

    // ── 2. Carpetas ──────────────────────────────────────────────────────────
    const recursos = await db.query(
        "SELECT idRecurso, nombreRecurso, folder FROM PERMISOS_RECURSOS WHERE tipo='administrativo' ORDER BY nombreRecurso",
        { type: QueryTypes.SELECT }
    );

    console.log('\nCarpetas:');
    const cambios = [];
    const faltantes = [];
    for (const [nombre, folder] of Object.entries(CARPETAS)) {
        const r = recursos.find(x => x.nombreRecurso === nombre)
               || (nombre === 'Tienda Web' ? recursos.find(x => x.nombreRecurso === 'Web') : null);
        if (!r) { faltantes.push({ nombre, folder }); console.log(`   + ${nombre.padEnd(26)} ${folder || '(sin carpeta)'}  ← se crea`); continue; }
        if ((r.folder || null) === folder) { console.log(`   · ${nombre.padEnd(26)} ${folder || '(sin carpeta)'}  ya está`); continue; }
        cambios.push({ id: r.idRecurso, nombre, folder });
        console.log(`   → ${nombre.padEnd(26)} ${folder || '(sin carpeta)'}`);
    }

    // ── 3. Quién se quedaría sin panel ───────────────────────────────────────
    const admins = await db.query(
        `SELECT u.idUsuario, u.emailUsuario, COUNT(up.idPermiso) n
         FROM USUARIOS u
         LEFT JOIN USER_PERMISOS up ON up.idUsuario = u.idUsuario
         LEFT JOIN PERMISOS_RECURSOS r ON r.idRecurso = up.idRecurso AND r.tipo = 'administrativo'
         WHERE u.permisos = 'ADMIN'
         GROUP BY u.idUsuario
         HAVING SUM(CASE WHEN r.idRecurso IS NOT NULL THEN 1 ELSE 0 END) = 0`,
        { type: QueryTypes.SELECT }
    );

    console.log('\nUsuarios ADMIN sin ningún permiso administrativo:');
    if (!admins.length) console.log('   · ninguno');
    admins.forEach(a => console.log(`   ${a.emailUsuario} → se le escribe el juego completo (hoy ya entra a todo por su rol)`));

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/migracionPermisosAdmin.js --aplicar');
        process.exit(0);
    }

    await db.transaction(async (t) => {
        if (renombrar) {
            await db.query("UPDATE PERMISOS_RECURSOS SET nombreRecurso='Tienda Web' WHERE idRecurso=:id",
                { replacements: { id: web.idRecurso }, transaction: t });
        }
        for (const c of cambios) {
            await db.query('UPDATE PERMISOS_RECURSOS SET folder=:f WHERE idRecurso=:id',
                { replacements: { f: c.folder, id: c.id }, transaction: t });
        }
        for (const f of faltantes) {
            await db.query(
                'INSERT INTO PERMISOS_RECURSOS (idRecurso, nombreRecurso, tipo, folder, createdAt) VALUES (UUID(), :n, :t, :f, NOW())',
                { replacements: { n: f.nombre, t: 'administrativo', f: f.folder }, transaction: t }
            );
        }

        if (admins.length) {
            const rs = await db.query("SELECT idRecurso FROM PERMISOS_RECURSOS WHERE tipo='administrativo'", { type: QueryTypes.SELECT, transaction: t });
            const as = await db.query('SELECT idAccion FROM PERMISOS_ACCIONES', { type: QueryTypes.SELECT, transaction: t });
            for (const u of admins) {
                for (const r of rs) for (const a of as) {
                    await db.query(
                        `INSERT INTO USER_PERMISOS (idUsuario, idRecurso, idAccion, createdAt)
                         SELECT :u, :r, :a, NOW() FROM DUAL
                         WHERE NOT EXISTS (SELECT 1 FROM USER_PERMISOS WHERE idUsuario=:u AND idRecurso=:r AND idAccion=:a)`,
                        { replacements: { u: u.idUsuario, r: r.idRecurso, a: a.idAccion }, transaction: t }
                    );
                }
            }
        }
    });

    console.log('\n✓ Aplicado.');
    const fin = await db.query("SELECT nombreRecurso, folder FROM PERMISOS_RECURSOS WHERE tipo='administrativo' ORDER BY nombreRecurso", { type: QueryTypes.SELECT });
    fin.forEach(r => console.log(`   ${r.nombreRecurso.padEnd(26)} ${r.folder || '(sin carpeta)'}`));
    process.exit(0);
};

run().catch((e) => { console.error('Falló:', e.message || e); process.exit(1); });
