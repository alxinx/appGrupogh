/**
 * SEEDER — Eliminación física de empleados
 *
 * La regla del proyecto es que un empleado NO se borra: se le cambia el `estado` a
 * 'despedido' o 'suspendido' (por eso EMPLEADOS es paranoid y no hay ningún endpoint de
 * borrado en la aplicación). Este script es la excepción manual para limpiar registros que
 * no corresponden a personas reales, y por eso vive en seed/ y no en un controlador.
 *
 * Antes de borrar informa qué se lleva puesto cada empleado. Lo que hay que mirar:
 *
 *   SE BORRA EN CASCADA, sin aviso de la base
 *     · TRASLADO_EFECTIVO donde el empleado es quien envía (y con él su historial)
 *     · EGRESOS registrados por el empleado
 *
 *   BLOQUEA EL BORRADO (hay que resolverlo antes)
 *     · CAJA_TIENDA — aperturas y cierres de caja (RESTRICT)
 *     · MOVIMIENTOS_CAJAS_BANCOS y TRASLADO_EFECTIVO_HISTORIAL (NO ACTION)
 *
 *   QUEDA SIN AUTOR, pero no se pierde
 *     · FACTURA_CLIENTES.idEmpleado → NULL (la factura y su monto siguen)
 *     · INSIDENCIAS_TRASLADOS — no tiene FK: sus filas quedan apuntando a un id que ya no
 *       existe. No se borran acá a propósito: son la bitácora de qué pasó con un traslado.
 *
 * Uso:
 *   node ./seed/eliminarEmpleados.js --empleados=86304,37511
 *   node ./seed/eliminarEmpleados.js --empleados=86304 --borrar --base=grupogh
 *
 * Opcionales:
 *   --con-movimientos   borra también sus bitácoras de caja/banco, que si no lo bloquean
 *   --con-usuario       borra además su usuario del panel y sus permisos finos
 */

import db from '../config/bd.js';
import { Op } from 'sequelize';
import { Empleados, Usuarios, UserPermisos, PuntosDeVenta } from '../models/index.js';

const args = process.argv.slice(2);
const tiene = (b) => args.includes(b);
const valor = (b) => args.find(a => a.startsWith(`${b}=`))?.split('=').slice(1).join('=') || null;

const CODIGOS = (valor('--empleados') || '').split(',').map(s => s.trim()).filter(Boolean);
const EJECUTAR = tiene('--borrar');
const CON_MOVIMIENTOS = tiene('--con-movimientos');
const CON_USUARIO = tiene('--con-usuario');

const EMPLEADO_SISTEMA_WEB = '00000';

const titulo = (t) => console.log(`\n${'─'.repeat(72)}\n  ${t}\n${'─'.repeat(72)}`);
const uno = async (sql, reemplazos) => (await db.query(sql, { replacements: reemplazos, type: db.QueryTypes.SELECT }))[0].n;

/** Todo lo que cuelga de un empleado, con el efecto que tiene su borrado. */
async function radiografia(idEmpleado) {
    const c = async (sql) => uno(sql, { id: idEmpleado });
    return {
        cajas:        await c('SELECT COUNT(*) n FROM CAJA_TIENDA WHERE idEmpleadoApertura=:id OR idEmpleadoCierre=:id OR idEmpleado=:id'),
        movimientos:  await c('SELECT COUNT(*) n FROM MOVIMIENTOS_CAJAS_BANCOS WHERE idEmpleado=:id'),
        trEfectHist:  await c('SELECT COUNT(*) n FROM TRASLADO_EFECTIVO_HISTORIAL WHERE idEmpleado=:id'),
        trEfectEnvia: await c('SELECT COUNT(*) n FROM TRASLADO_EFECTIVO WHERE idEmpleadoEnvia=:id'),
        trEfectRecibe:await c('SELECT COUNT(*) n FROM TRASLADO_EFECTIVO WHERE idEmpleadoRecibe=:id'),
        egresos:      await c('SELECT COUNT(*) n FROM EGRESOS WHERE idEmpleado=:id'),
        facturas:     await c('SELECT COUNT(*) n FROM FACTURA_CLIENTES WHERE idEmpleado=:id'),
        incidencias:  await c('SELECT COUNT(*) n FROM INSIDENCIAS_TRASLADOS WHERE idEmpleado=:id'),
        abonos:       await c('SELECT COUNT(*) n FROM ABONO_CLIENTE_CREDITOS WHERE idEmpleado=:id'),
        autorizo:     await c('SELECT COUNT(*) n FROM CREDITO_DISPONIBLE_CLIENTE WHERE autorizo=:id')
    };
}

async function resolver() {
    if (!CODIGOS.length) throw new Error('Falta --empleados=<código,código>. Son los códigos de EMPLEADOS.codigoEmpleado.');

    const empleados = await Empleados.findAll({
        where: { codigoEmpleado: CODIGOS }, paranoid: false, include: [{ model: PuntosDeVenta, as: 'sede', attributes: ['nombreComercial'] }]
    });
    const faltantes = CODIGOS.filter(c => !empleados.some(e => e.codigoEmpleado === c));
    if (faltantes.length) throw new Error(`Estos códigos no existen en EMPLEADOS: ${faltantes.join(', ')}`);

    const sistemaWeb = empleados.find(e => e.codigoEmpleado === EMPLEADO_SISTEMA_WEB);
    if (sistemaWeb) throw new Error(`El empleado "${EMPLEADO_SISTEMA_WEB}" (Sistema Web) no se puede borrar: ` +
        'con él se facturan los pedidos web (webApiController).');

    const detalle = [];
    for (const e of empleados) {
        const usuario = e.idUsuario ? await Usuarios.findByPk(e.idUsuario, { raw: true }) : null;
        const permisos = usuario ? await UserPermisos.count({ where: { idUsuario: usuario.idUsuario } }) : 0;
        detalle.push({ emp: e, datos: await radiografia(e.idEmpleado), usuario, permisos });
    }
    return detalle;
}

function informar(detalle) {
    titulo('EMPLEADOS A ELIMINAR');
    for (const { emp, datos, usuario, permisos } of detalle) {
        const nombre = `${emp.PrimerNombre} ${emp.PrimerApellido}`.trim();
        console.log(`\n  ${emp.codigoEmpleado} · ${nombre}  —  ${emp.sede?.nombreComercial || 'sin sede'} · ${emp.cargo}`);

        const bloquean = [];
        if (datos.cajas)       bloquean.push(`${datos.cajas} cajas de tienda`);
        if (!CON_MOVIMIENTOS && datos.movimientos) bloquean.push(`${datos.movimientos} movimientos de caja/banco`);
        if (!CON_MOVIMIENTOS && datos.trEfectHist) bloquean.push(`${datos.trEfectHist} pasos de traslado de efectivo`);
        if (bloquean.length) console.log(`     ⛔ BLOQUEAN el borrado: ${bloquean.join(', ')}`);

        const arrastra = [];
        if (datos.trEfectEnvia) arrastra.push(`${datos.trEfectEnvia} traslados de efectivo (y su historial)`);
        if (datos.egresos)      arrastra.push(`${datos.egresos} egresos`);
        if (CON_MOVIMIENTOS && datos.movimientos) arrastra.push(`${datos.movimientos} movimientos de caja/banco`);
        if (CON_MOVIMIENTOS && datos.trEfectHist) arrastra.push(`${datos.trEfectHist} pasos de traslado de efectivo`);
        if (arrastra.length) console.log(`     ⚠️  SE BORRA con él: ${arrastra.join(', ')}`);

        const sinAutor = [];
        if (datos.facturas)      sinAutor.push(`${datos.facturas} facturas quedan sin vendedor`);
        if (datos.abonos)        sinAutor.push(`${datos.abonos} abonos sin empleado`);
        if (datos.autorizo)      sinAutor.push(`${datos.autorizo} créditos sin quien los autorizó`);
        if (datos.trEfectRecibe) sinAutor.push(`${datos.trEfectRecibe} traslados sin quien recibió`);
        if (datos.incidencias)   sinAutor.push(`${datos.incidencias} incidencias quedan huérfanas (sin FK)`);
        if (sinAutor.length) console.log(`     · ${sinAutor.join(' · ')}`);

        if (usuario) console.log(`     · usuario ${usuario.nombreUsuario} <${usuario.emailUsuario}> con ${permisos} permisos` +
            (CON_USUARIO ? ' → SE BORRA' : ' → se conserva (--con-usuario para borrarlo)'));
    }
}

async function eliminar(detalle) {
    const t = await db.transaction();
    try {
        titulo('ELIMINANDO');
        for (const { emp, usuario } of detalle) {
            const nombre = `${emp.PrimerNombre} ${emp.PrimerApellido}`.trim();
            const id = emp.idEmpleado;

            if (CON_MOVIMIENTOS) {
                // Bitácoras append-only: sus modelos lanzan ante cualquier destroy, así que
                // la única forma de vaciarlas es SQL directo. El guard sigue en pie para el
                // resto de la aplicación, que es donde importa.
                for (const tabla of ['TRASLADO_EFECTIVO_HISTORIAL', 'MOVIMIENTOS_CAJAS_BANCOS']) {
                    const [, meta] = await db.query(`DELETE FROM \`${tabla}\` WHERE idEmpleado = :id`,
                        { replacements: { id }, transaction: t });
                    if (meta?.affectedRows) console.log(`   ${nombre}: ${meta.affectedRows} filas de ${tabla}`);
                }
            }

            await Empleados.destroy({ where: { idEmpleado: id }, force: true, transaction: t });
            console.log(`   ✓ ${emp.codigoEmpleado} ${nombre} eliminado`);

            if (CON_USUARIO && usuario) {
                const p = await UserPermisos.destroy({ where: { idUsuario: usuario.idUsuario }, transaction: t });
                await Usuarios.destroy({ where: { idUsuario: usuario.idUsuario }, transaction: t });
                console.log(`     · usuario ${usuario.nombreUsuario} y sus ${p} permisos`);
            }
        }
        await t.commit();
        console.log('\n  Listo.');
    } catch (e) {
        if (!t.finished) await t.rollback().catch(() => {});
        throw e;
    }
}

const run = async () => {
    try {
        await db.authenticate();
        console.log(`\n  Base: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
        const detalle = await resolver();
        informar(detalle);

        if (!EJECUTAR) {
            titulo('MODO ENSAYO — no se borró nada');
            console.log(`\n   node ./seed/eliminarEmpleados.js --empleados=${CODIGOS.join(',')} --borrar --base=${process.env.DB_NAME}\n`);
            return process.exit(0);
        }
        if (valor('--base') !== process.env.DB_NAME) {
            throw new Error(`Falta --base=${process.env.DB_NAME}: se escribe a mano para confirmar contra qué base se corre.`);
        }
        await eliminar(detalle);
        process.exit(0);
    } catch (e) {
        console.error(`\n  ✗ ${e.message}\n`);
        process.exit(1);
    }
};

run();
