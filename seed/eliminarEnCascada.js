/**
 * SEEDER — Eliminación en cascada, de la hoja hacia la raíz
 *
 * Borra una fila y todo lo que impide borrarla, resolviendo el orden a partir del grafo de
 * claves foráneas REAL de la base (information_schema), no de una lista escrita a mano: si
 * mañana se agrega una tabla que apunte a EMPLEADOS, este script la encuentra sola.
 *
 * Cómo decide:
 *   · Un hijo con RESTRICT / NO ACTION  → hay que borrarlo ANTES que el padre.
 *   · Un hijo con CASCADE               → la base lo borraría sola, pero se planifica igual,
 *                                         porque ese hijo puede tener a su vez quien lo
 *                                         bloquee (y entonces la cascada falla a mitad).
 *   · Un hijo con SET NULL              → no se borra: solo pierde la referencia.
 *
 * El recorrido es en post-orden: primero las hojas, al final la raíz. Es exactamente el
 * "de lo más básico hacia arriba": si un empleado está amarrado a una factura, se borran
 * primero los ítems de la factura, después la factura, y así hasta poder borrar al empleado.
 *
 * TODO va por SQL directo y no por los modelos. Dos motivos: EMPLEADOS es `paranoid` y acá
 * se quiere el borrado físico, y las bitácoras (MOVIMIENTOS_CAJAS_BANCOS,
 * TRASLADO_EFECTIVO_HISTORIAL) tienen hooks que lanzan ante cualquier destroy. Ese guard
 * sigue en pie para toda la aplicación; este script es la excepción manual y consciente.
 *
 * Uso:
 *   node ./seed/eliminarEnCascada.js --empleados=86304,66083
 *   node ./seed/eliminarEnCascada.js --empleados=86304 --borrar --base=grupogh
 *
 * Genérico (cualquier tabla):
 *   node ./seed/eliminarEnCascada.js --tabla=CLIENTES --columna=numero_doc --valores=123,456
 *   node ./seed/eliminarEnCascada.js --tabla=ABONO_CLIENTE_CREDITOS --todas
 */

import db from '../config/bd.js';

const args = process.argv.slice(2);
const tiene = (b) => args.includes(b);
const valor = (b) => args.find(a => a.startsWith(`${b}=`))?.split('=').slice(1).join('=') || null;

const EJECUTAR = tiene('--borrar');
const CON_USUARIO = tiene('--con-usuario');
const ESQUEMA = process.env.DB_NAME;

// Registros que el código busca por un valor fijo: si se borran, la aplicación deja de
// funcionar aunque la base no se queje. Son los mismos que protege formatearOperacion.js.
const INTOCABLES = [
    { tabla: 'EMPLEADOS', columna: 'codigoEmpleado', valor: '00000', motivo: '"Sistema Web": con él se facturan los pedidos web' },
    { tabla: 'CLIENTES',  columna: 'idCliente',      valor: '0',     motivo: 'Cliente Genérico: el POS factura con ese id' }
];

// Referencias que existen en los datos pero NO como clave foránea en la base. Sin esta
// lista el planificador no las ve y cada borrado deja filas apuntando a un id que ya no
// existe, en silencio: la base no se queja porque para ella esa relación no existe.
// (Ya pasó dos veces: INSIDENCIAS_TRASLADOS.idEmpleado y EGRESOS.idCajaTienda.)
//
// `regla` se interpreta igual que en una FK de verdad:
//   'RESTRICT' → el hijo se borra ANTES que el padre
//   'SET NULL' → el hijo se conserva y la columna queda en NULL
const REFERENCIAS_SIN_FK = [
    { padre: 'CAJA_TIENDA',    pk: 'idCajaTienda',    hijo: 'EGRESOS',               columna: 'idCajaTienda',        regla: 'RESTRICT' },
    { padre: 'EMPLEADOS',      pk: 'idEmpleado',      hijo: 'INSIDENCIAS_TRASLADOS', columna: 'idEmpleado',          regla: 'RESTRICT' },
    { padre: 'TRASLADOS',      pk: 'idTraslado',      hijo: 'INSIDENCIAS_TRASLADOS', columna: 'idTraslado',          regla: 'RESTRICT' },
    { padre: 'TRASLADOS',      pk: 'idTraslado',      hijo: 'DETALLE_TRASLADOS',     columna: 'idTraslado',          regla: 'RESTRICT' },
    { padre: 'DOSIFICACIONES',  pk: 'idDosificacion', hijo: 'PACKS',                columna: 'idDosificacion',      regla: 'RESTRICT' },
    { padre: 'PACKS',          pk: 'idPack',          hijo: 'DETALLES_PACK',         columna: 'idPack',              regla: 'RESTRICT' },
    { padre: 'PACKS',          pk: 'idPack',          hijo: 'STOCKS',                columna: 'idPack',              regla: 'RESTRICT' },
    { padre: 'PUNTO_DE_VENTA', pk: 'idPuntoDeVenta',  hijo: 'STOCKS',                columna: 'idPuntoVenta',        regla: 'RESTRICT' },
    { padre: 'PUNTO_DE_VENTA', pk: 'idPuntoDeVenta',  hijo: 'PEDIDOS_WEB',           columna: 'idPuntoVentaRecogida',regla: 'SET NULL' },
    { padre: 'PUNTO_DE_VENTA', pk: 'idPuntoDeVenta',  hijo: 'PEDIDOS_WEB',           columna: 'idTiendaFacturacion', regla: 'SET NULL' },
    { padre: 'CLIENTES',       pk: 'idCliente',       hijo: 'PEDIDOS_WEB',           columna: 'idCliente',           regla: 'SET NULL' },
    { padre: 'FACTURA_CLIENTES', pk: 'idFacturaCliente', hijo: 'PEDIDOS_WEB',        columna: 'idFacturaCliente',    regla: 'SET NULL' }
];

const titulo = (t) => console.log(`\n${'─'.repeat(74)}\n  ${t}\n${'─'.repeat(74)}`);
const sel = (sql, reemplazos) => db.query(sql, { replacements: reemplazos, type: db.QueryTypes.SELECT });

/** El grafo de FK de la base, cargado una vez. */
async function cargarGrafo() {
    const fks = await sel(`
        SELECT k.TABLE_NAME AS hijo, k.COLUMN_NAME AS columna,
               k.REFERENCED_TABLE_NAME AS padre, k.REFERENCED_COLUMN_NAME AS columnaPadre,
               r.DELETE_RULE AS regla
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r
          ON r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA
        WHERE k.TABLE_SCHEMA = :esquema AND k.REFERENCED_TABLE_NAME IS NOT NULL`, { esquema: ESQUEMA });

    const pks = await sel(`
        SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = :esquema AND CONSTRAINT_NAME = 'PRIMARY'`, { esquema: ESQUEMA });

    const hijosDe = {};
    fks.forEach(f => { (hijosDe[f.padre] ||= []).push(f); });
    REFERENCIAS_SIN_FK.forEach(r => {
        (hijosDe[r.padre] ||= []).push({
            hijo: r.hijo, columna: r.columna, padre: r.padre,
            columnaPadre: r.pk, regla: r.regla, sinFk: true
        });
    });
    const pkDe = Object.fromEntries(pks.map(p => [p.tabla, p.columna]));
    return { hijosDe, pkDe };
}

/**
 * Arma el plan de borrado en post-orden: las hojas primero, la raíz al final.
 * `plan` es un array de { tabla, columna, valores, via } y `vistos` evita repetir o ciclar.
 */
async function planificar(grafo, tabla, columna, valores, plan, vistos, via = 'raíz', profundidad = 0) {
    if (!valores.length || profundidad > 12) return;
    const clave = `${tabla}.${columna}`;
    const yaVistos = vistos.get(clave) || new Set();
    const nuevos = valores.map(String).filter(v => !yaVistos.has(v));
    if (!nuevos.length) return;
    nuevos.forEach(v => yaVistos.add(v));
    vistos.set(clave, yaVistos);

    const pk = grafo.pkDe[tabla] || columna;

    // Los ids concretos de las filas de ESTA tabla que se van a borrar: son los que hay que
    // ir a buscar entre sus hijos.
    const filas = await sel(
        `SELECT DISTINCT \`${pk}\` AS id FROM \`${tabla}\` WHERE \`${columna}\` IN (:valores)`,
        { valores: nuevos });
    const ids = filas.map(f => String(f.id));
    if (!ids.length) return;

    for (const hijo of (grafo.hijosDe[tabla] || [])) {
        if (hijo.regla === 'SET NULL') continue;          // no se borra, solo se desvincula
        if (hijo.columnaPadre !== pk) continue;
        const suyos = await sel(
            `SELECT DISTINCT \`${grafo.pkDe[hijo.hijo]}\` AS id FROM \`${hijo.hijo}\` WHERE \`${hijo.columna}\` IN (:ids)`,
            { ids });
        if (!suyos.length) continue;
        await planificar(grafo, hijo.hijo, grafo.pkDe[hijo.hijo], suyos.map(s => String(s.id)),
            plan, vistos, `${tabla}.${hijo.columna} [${hijo.regla}${hijo.sinFk ? ', sin FK' : ''}]`, profundidad + 1);
    }

    plan.push({ tabla, columna: pk, valores: ids, via, profundidad });
}

/** Tablas que apuntan a lo borrado con SET NULL: no se pierden, quedan sin autor. */
async function efectosSetNull(grafo, tabla, ids) {
    const efectos = [];
    for (const hijo of (grafo.hijosDe[tabla] || [])) {
        if (hijo.regla !== 'SET NULL') continue;
        const [{ n }] = await sel(
            `SELECT COUNT(*) n FROM \`${hijo.hijo}\` WHERE \`${hijo.columna}\` IN (:ids)`, { ids });
        if (n) efectos.push({ tabla: hijo.hijo, columna: hijo.columna, n, sinFk: !!hijo.sinFk });
    }
    return efectos;
}

async function resolverEmpleados(codigos) {
    const filas = await sel(
        `SELECT idEmpleado, codigoEmpleado, TRIM(CONCAT(PrimerNombre,' ',PrimerApellido)) AS nombre, idUsuario
         FROM EMPLEADOS WHERE codigoEmpleado IN (:codigos)`, { codigos });
    const faltan = codigos.filter(c => !filas.some(f => f.codigoEmpleado === c));
    if (faltan.length) throw new Error(`Estos códigos no existen en EMPLEADOS: ${faltan.join(', ')}`);
    return filas;
}

const run = async () => {
    try {
        await db.authenticate();
        console.log(`\n  Base: ${ESQUEMA} @ ${process.env.DB_HOST}`);
        const grafo = await cargarGrafo();

        // Punto de entrada: empleados por código, o cualquier tabla/columna/valores.
        let tabla, columna, valores, usuarios = [];
        if (valor('--empleados')) {
            const codigos = valor('--empleados').split(',').map(s => s.trim()).filter(Boolean);
            const emps = await resolverEmpleados(codigos);
            emps.forEach(e => console.log(`   · ${e.codigoEmpleado} ${e.nombre}`));
            tabla = 'EMPLEADOS'; columna = 'idEmpleado'; valores = emps.map(e => e.idEmpleado);
            usuarios = emps.map(e => e.idUsuario).filter(Boolean);
        } else {
            tabla = valor('--tabla');
            if (!tabla) throw new Error('Usá --empleados=<códigos> o --tabla= con --columna=/--valores= o --todas');

            if (tiene('--todas')) {
                // La tabla entera: se resuelve a la lista de sus claves primarias, así el
                // planificador trabaja igual que con una selección y arrastra lo que cuelgue.
                columna = grafo.pkDe[tabla];
                if (!columna) throw new Error(`No encuentro la clave primaria de ${tabla}.`);
                const filas = await sel(`SELECT \`${columna}\` AS id FROM \`${tabla}\``);
                valores = filas.map(f => String(f.id));
                if (!valores.length) throw new Error(`${tabla} ya está vacía.`);
                console.log(`   · ${tabla}: las ${valores.length} filas`);
            } else {
                columna = valor('--columna');
                valores = (valor('--valores') || '').split(',').map(s => s.trim()).filter(Boolean);
                if (!columna || !valores.length) {
                    throw new Error('Usá --tabla= con --columna= y --valores=, o --todas para la tabla entera.');
                }
            }
        }

        for (const p of INTOCABLES) {
            if (p.tabla !== tabla) continue;
            const [{ n }] = await sel(
                `SELECT COUNT(*) n FROM \`${tabla}\` WHERE \`${columna}\` IN (:valores) AND \`${p.columna}\` = :protegido`,
                { valores, protegido: p.valor });
            if (n) throw new Error(`${p.tabla}.${p.columna}='${p.valor}' no se puede borrar — ${p.motivo}`);
        }

        const plan = [];
        await planificar(grafo, tabla, columna, valores, plan, new Map());

        titulo('PLAN DE BORRADO — de la hoja hacia la raíz');
        let total = 0;
        plan.forEach((paso, i) => {
            total += paso.valores.length;
            console.log(`  ${String(i + 1).padStart(2)}. ${'  '.repeat(Math.max(0, 3 - paso.profundidad))}` +
                `${paso.tabla.padEnd(36)} ${String(paso.valores.length).padStart(5)} filas   ← ${paso.via}`);
        });
        console.log(`\n  ${plan.length} tablas · ${total} filas en total`);

        titulo('QUEDA SIN AUTOR (SET NULL — no se pierde el registro)');
        for (const paso of plan) {
            const efectos = await efectosSetNull(grafo, paso.tabla, paso.valores);
            efectos.forEach(e => console.log(`   ${e.tabla}.${e.columna} → NULL en ${e.n} filas${e.sinFk ? '   (sin FK: lo pone el script, no la base)' : ''}`));
        }

        if (usuarios.length) {
            console.log(`\n  Usuarios del panel: ${usuarios.length}` +
                (CON_USUARIO ? ' → SE BORRAN con sus permisos' : ' → se conservan (--con-usuario)'));
        }

        if (!EJECUTAR) {
            titulo('MODO ENSAYO — no se borró nada');
            console.log(`\n   ...agregá --borrar --base=${ESQUEMA}\n`);
            return process.exit(0);
        }
        if (valor('--base') !== ESQUEMA) {
            throw new Error(`Falta --base=${ESQUEMA}: se escribe a mano para confirmar contra qué base se corre.`);
        }

        titulo('EJECUTANDO');
        const t = await db.transaction();
        try {
            for (const paso of plan) {
                // Las relaciones SET NULL declaradas acá arriba las tiene que aplicar el
                // script: la base no las conoce, así que no desvincula nada sola. Va ANTES
                // del DELETE, para que ninguna fila quede apuntando a lo que se borró.
                for (const r of REFERENCIAS_SIN_FK) {
                    if (r.padre !== paso.tabla || r.regla !== 'SET NULL') continue;
                    const [, meta] = await db.query(
                        `UPDATE \`${r.hijo}\` SET \`${r.columna}\` = NULL WHERE \`${r.columna}\` IN (:valores)`,
                        { replacements: { valores: paso.valores }, transaction: t });
                    if (meta?.affectedRows) {
                        console.log(`   ${`${r.hijo}.${r.columna}`.padEnd(38)} ${String(meta.affectedRows).padStart(5)} a NULL`);
                    }
                }
                const [, meta] = await db.query(
                    `DELETE FROM \`${paso.tabla}\` WHERE \`${paso.columna}\` IN (:valores)`,
                    { replacements: { valores: paso.valores }, transaction: t });
                console.log(`   ${paso.tabla.padEnd(38)} ${String(meta?.affectedRows ?? 0).padStart(5)} borradas`);
            }
            if (CON_USUARIO && usuarios.length) {
                for (const tab of ['USER_PERMISOS', 'USUARIOS']) {
                    const [, meta] = await db.query(`DELETE FROM \`${tab}\` WHERE idUsuario IN (:ids)`,
                        { replacements: { ids: usuarios }, transaction: t });
                    console.log(`   ${tab.padEnd(38)} ${String(meta?.affectedRows ?? 0).padStart(5)} borradas`);
                }
            }
            await t.commit();
            console.log('\n  Listo.');
        } catch (e) {
            if (!t.finished) await t.rollback().catch(() => {});
            throw e;
        }
        process.exit(0);
    } catch (e) {
        console.error(`\n  ✗ ${e.message}\n`);
        process.exit(1);
    }
};

run();
