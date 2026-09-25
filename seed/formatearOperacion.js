/**
 * SEEDER — Formateo de la operación
 *
 * Deja la base lista para arrancar de cero SIN perder lo que es configuración:
 *
 *   SE CONSERVA
 *     · Catálogo completo: PRODUCTOS, VARIACION_PRODUCTO, IMAGENES, FAMILIA,
 *       CATEGORIAS, ATRIBUTOS
 *     · Los puntos de venta de PDV_A_CONSERVAR (por nombre comercial)
 *     · Los empleados de esos puntos de venta, con su usuario y sus permisos finos
 *     · Los usuarios que se pasen en --admin=correo1,correo2
 *     · CLIENTES.idCliente = '0' (el Cliente Genérico del mostrador)
 *     · ENTIDADES (bancos, tarjetas y billeteras con las que se cobra)
 *     · Geografía, permisos y contenido web
 *
 *   SE BORRA
 *     · Inventario y traslados, facturas, clientes, pedidos web, cajas y bancos
 *     · Los puntos de venta que no estén en la lista, con sus empleados y usuarios
 *
 * Tres registros NO se pueden borrar aunque no se los nombre, y el script los protege:
 *   · CLIENTES '0'          — el POS factura con ese id cuando no hay cliente elegido
 *   · empleado '00000'      — "Sistema Web", con el que se facturan los pedidos web
 *   · bodega "Pedidos Web"  — webApiController la busca por nombre exacto
 *
 * Uso:
 *   node ./seed/formatearOperacion.js                        → ensayo (no borra nada)
 *   node ./seed/formatearOperacion.js --borrar --base=grupogh --admin=correo@dominio
 *
 * Opcionales:
 *   --proveedores          también borra facturas de proveedor y cuentas por pagar
 *   --reiniciar-dian       pone nroActual en 0 en los regímenes que quedan
 *   --reiniciar-secuencias pone SECUENCIAS en 0
 */

import db from '../config/bd.js';
import { Op } from 'sequelize';
import {
    PuntosDeVenta, RegimenFacturacion, Empleados, Usuarios, UserPermisos,
    Clientes, ClientesTributario, ClientesUbicacion, ClientesCreditoHistorial,
    CreditoDisponibleCliente, CreditoDisponibleClienteHistorial, AbonoClienteCreditos,
    FacturaClientes, DetallesFactura, DetallesImpuestosFacturaCliente, DetallesPagosFactura,
    PedidosWeb, DetallesPedidoWeb, PagosPedidoWeb, PedidosWebHistorialEstado,
    Stock, Pack, DetallesPack, Dosificaciones,
    Traslados, DetalleTraslados, InsidenciaTraslado, ReservasCarrito,
    CajaTienda, CajasYBancos, MovimientosCajasBancos, Egresos,
    TrasladoEfectivo, TrasladoEfectivoHistorial, Documentacion,
    FacturaProveedores, DetallesFacturaProvedores, AbonosProveedores, CuentasPorPagar,
    Secuencias
} from '../models/index.js';

// Los puntos de venta que quedan en pie, por nombre comercial. "Pedidos Web" y
// "BODEGA_VIRTUAL" no son tiendas: son los destinos que el código busca por nombre para
// los pedidos web y para el tránsito de traslados.
const PDV_A_CONSERVAR = ['BODEGA_VIRTUAL', 'GH 102', 'Pedidos Web'];

const CLIENTE_GENERICO = '0';
const EMPLEADO_SISTEMA_WEB = '00000';

const args = process.argv.slice(2);
const tiene = (bandera) => args.includes(bandera);
const valor = (bandera) => args.find(a => a.startsWith(`${bandera}=`))?.split('=').slice(1).join('=') || null;

const EJECUTAR = tiene('--borrar');
const CON_PROVEEDORES = tiene('--proveedores');
const REINICIAR_DIAN = tiene('--reiniciar-dian');
const REINICIAR_SECUENCIAS = tiene('--reiniciar-secuencias');
const ADMINS = (valor('--admin') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const titulo = (t) => console.log(`\n${'─'.repeat(72)}\n  ${t}\n${'─'.repeat(72)}`);
const linea = (etiqueta, n) => console.log(`   ${String(etiqueta).padEnd(46)} ${String(n).padStart(8)}`);

/**
 * Resuelve qué sobrevive. Se calcula una sola vez y lo usan tanto el ensayo como el
 * borrado: lo que el ensayo informa es exactamente lo que después se ejecuta.
 */
async function resolverAlcance() {
    const pdvTodos = await PuntosDeVenta.findAll({ raw: true });
    const pdvConservar = pdvTodos.filter(p => PDV_A_CONSERVAR.includes(p.nombreComercial));
    const pdvBorrar = pdvTodos.filter(p => !PDV_A_CONSERVAR.includes(p.nombreComercial));

    const faltantes = PDV_A_CONSERVAR.filter(n => !pdvTodos.some(p => p.nombreComercial === n));
    if (faltantes.length) {
        throw new Error(`No existen estos puntos de venta que se querían conservar: ${faltantes.join(', ')}. ` +
            'Revisá los nombres antes de seguir: el script no borra nada si la lista no calza.');
    }

    const idsConservar = pdvConservar.map(p => p.idPuntoDeVenta);
    const empleadosConservar = await Empleados.findAll({
        where: { idPuntoDeVenta: idsConservar }, paranoid: false, raw: true
    });
    const empleadosBorrar = await Empleados.findAll({
        where: { idPuntoDeVenta: { [Op.notIn]: idsConservar } }, paranoid: false, raw: true
    });

    // El empleado del sistema web tiene que estar entre los que se conservan: si su tienda
    // quedó fuera de la lista, la tienda web deja de poder facturar.
    const sistemaWeb = empleadosConservar.find(e => e.codigoEmpleado === EMPLEADO_SISTEMA_WEB);
    if (!sistemaWeb) {
        throw new Error(`El empleado "${EMPLEADO_SISTEMA_WEB}" (Sistema Web) no está entre los que se conservan. ` +
            'Sin él ningún pedido web se puede procesar.');
    }

    const usuariosTodos = await Usuarios.findAll({ raw: true });
    const idsUsuarioDeEmpleados = new Set(empleadosConservar.map(e => e.idUsuario).filter(Boolean));
    const usuariosConservar = usuariosTodos.filter(u =>
        idsUsuarioDeEmpleados.has(u.idUsuario) || ADMINS.includes(String(u.emailUsuario).toLowerCase()));
    const usuariosBorrar = usuariosTodos.filter(u => !usuariosConservar.includes(u));

    const adminsNoEncontrados = ADMINS.filter(c =>
        !usuariosTodos.some(u => String(u.emailUsuario).toLowerCase() === c));
    if (adminsNoEncontrados.length) {
        throw new Error(`Estos correos de --admin no existen en USUARIOS: ${adminsNoEncontrados.join(', ')}`);
    }

    return { pdvConservar, pdvBorrar, empleadosConservar, empleadosBorrar, usuariosConservar, usuariosBorrar };
}

async function informar(alcance) {
    const { pdvConservar, pdvBorrar, empleadosConservar, empleadosBorrar, usuariosConservar, usuariosBorrar } = alcance;

    titulo('SE CONSERVA');
    console.log('\n  Puntos de venta:');
    pdvConservar.forEach(p => console.log(`   · ${p.nombreComercial} (${p.tipo})`));
    console.log('\n  Empleados y su usuario:');
    for (const e of empleadosConservar) {
        const u = usuariosConservar.find(x => x.idUsuario === e.idUsuario);
        const permisos = u ? await UserPermisos.count({ where: { idUsuario: u.idUsuario } }) : 0;
        console.log(`   · ${`${e.PrimerNombre} ${e.PrimerApellido}`.trim().padEnd(24)} ${(u ? u.nombreUsuario : 'SIN USUARIO').padEnd(12)} ${permisos} permisos`);
    }
    const soloAdmin = usuariosConservar.filter(u => !empleadosConservar.some(e => e.idUsuario === u.idUsuario));
    if (soloAdmin.length) {
        console.log('\n  Usuarios sin ficha de empleado que se conservan (--admin):');
        soloAdmin.forEach(u => console.log(`   · ${u.nombreUsuario} <${u.emailUsuario}> (${u.permisos})`));
    }
    console.log('\n  Catálogo y configuración:');
    linea('PRODUCTOS + VARIACION_PRODUCTO + IMAGENES', 'intactos');
    linea('FAMILIA / CATEGORIAS / ATRIBUTOS', 'intactos');
    linea('ENTIDADES (bancos, tarjetas, billeteras)', 'intactas');
    linea('DEPARTAMENTOS / MUNICIPIOS / PERMISOS_*', 'intactos');
    linea('Contenido web (banners, páginas, popup…)', 'intacto');
    linea(`CLIENTES '${CLIENTE_GENERICO}' (Cliente Genérico)`, 'intacto');

    titulo('SE BORRA');
    const idsClienteBorrar = { idCliente: { [Op.ne]: CLIENTE_GENERICO } };
    const conteos = [
        ['PEDIDOS_WEB_HISTORIAL_ESTADO', await PedidosWebHistorialEstado.count()],
        ['PAGOS_PEDIDO_WEB', await PagosPedidoWeb.count()],
        ['DETALLES_PEDIDO_WEB', await DetallesPedidoWeb.count()],
        ['PEDIDOS_WEB', await PedidosWeb.count()],
        ['ABONO_CLIENTE_CREDITOS', await AbonoClienteCreditos.count()],
        ['DETALLES_PAGOS_FACTURA', await DetallesPagosFactura.count()],
        ['DETALLES_IMPUESTOS_FACTURA_CLIENTE', await DetallesImpuestosFacturaCliente.count()],
        ['DETALLES_FACTURA', await DetallesFactura.count()],
        ['FACTURA_CLIENTES', await FacturaClientes.count()],
        ['CREDITO_DISPONIBLE_CLIENTE_HISTORIAL', await CreditoDisponibleClienteHistorial.count()],
        ['CREDITO_DISPONIBLE_CLIENTE', await CreditoDisponibleCliente.count()],
        ['CLIENTES_CREDITO_HISTORIAL', await ClientesCreditoHistorial.count()],
        ['CLIENTES_UBICACION', await ClientesUbicacion.count()],
        ['CLIENTES_TRIBUTARIO', await ClientesTributario.count()],
        [`CLIENTES (menos el genérico)`, await Clientes.count({ where: idsClienteBorrar })],
        ['RESERVAS_CARRITO', await ReservasCarrito.count()],
        ['INSIDENCIAS_TRASLADOS', await InsidenciaTraslado.count()],
        ['DETALLE_TRASLADOS', await DetalleTraslados.count()],
        ['TRASLADOS', await Traslados.count()],
        ['DETALLES_PACK', await DetallesPack.count()],
        ['PACKS', await Pack.count()],
        ['DOSIFICACIONES', await Dosificaciones.count()],
        ['STOCKS', await Stock.count()],
        ['TRASLADO_EFECTIVO_HISTORIAL', await TrasladoEfectivoHistorial.count()],
        ['EGRESOS', await Egresos.count()],
        ['TRASLADO_EFECTIVO', await TrasladoEfectivo.count()],
        ['MOVIMIENTOS_CAJAS_BANCOS', await MovimientosCajasBancos.count()],
        ['CAJA_TIENDA', await CajaTienda.count()],
        ['CAJAS_Y_BANCOS', await CajasYBancos.count()],
    ];
    if (CON_PROVEEDORES) {
        conteos.push(
            ['ABONOS_PROVEEDORES', await AbonosProveedores.count()],
            ['CUENTAS_POR_PAGAR', await CuentasPorPagar.count()],
            ['DETALLES_FACTURA_PROVEEDORES', await DetallesFacturaProvedores.count()],
            ['FACTURA_PROVEEDORES', await FacturaProveedores.count()],
        );
    }
    const [[{ n: backup }]] = await db.query("SELECT COUNT(*) n FROM TRASLADOS_BACKUP_20260914")
        .then(r => [r[0]]).catch(() => [[{ n: 0 }]]);
    conteos.push(['TRASLADOS_BACKUP_20260914', backup]);
    conteos.forEach(([t, n]) => linea(t, n));

    console.log('\n  Puntos de venta, empleados y usuarios que se van:');
    pdvBorrar.forEach(p => console.log(`   · punto de venta  ${p.nombreComercial}`));
    empleadosBorrar.forEach(e => console.log(`   · empleado        ${`${e.PrimerNombre} ${e.PrimerApellido}`.trim()} (${e.codigoEmpleado})`));
    usuariosBorrar.forEach(u => console.log(`   · usuario         ${u.nombreUsuario} <${u.emailUsuario}>`));

    // Los archivos de R2 no se borran solos: el script solo lista las claves que quedan
    // sin dueño para que alguien las limpie del bucket.
    const docs = await Documentacion.findAll({ where: { pertenece: { [Op.ne]: 'producto' } }, raw: true });
    console.log(`\n  Archivos en R2 que quedarán huérfanos: ${docs.length} (el script NO toca el bucket)`);

    titulo('NUMERACIÓN');
    const regimenes = await RegimenFacturacion.findAll({ raw: true });
    for (const r of regimenes) {
        const pdv = [...pdvConservar, ...pdvBorrar].find(p => p.idPuntoDeVenta === r.idPuntoDeVenta);
        const seConserva = pdvConservar.some(p => p.idPuntoDeVenta === r.idPuntoDeVenta);
        console.log(`   · ${String(pdv?.nombreComercial || '?').padEnd(18)} resolución ${r.resolucionFacturacion} · nroActual ${r.nroActual}` +
            (seConserva ? (REINICIAR_DIAN ? '  → se REINICIA a 0' : '  → se conserva') : '  → se borra con su tienda'));
    }
    const secuencias = await Secuencias.findAll({ raw: true });
    console.log(`   · SECUENCIAS: ${secuencias.map(s => `${s.nombre}=${s.valor}`).join(', ')}` +
        (REINICIAR_SECUENCIAS ? '  → se REINICIAN a 0' : '  → se conservan'));
}

async function formatear(alcance) {
    const { pdvBorrar, empleadosBorrar, usuariosBorrar } = alcance;
    const idsPdvBorrar = pdvBorrar.map(p => p.idPuntoDeVenta);
    const idsEmpBorrar = empleadosBorrar.map(e => e.idEmpleado);
    const idsUsrBorrar = usuariosBorrar.map(u => u.idUsuario);

    const t = await db.transaction();
    const borrar = async (modelo, etiqueta, where = {}) => {
        const n = await modelo.destroy({ where, force: true, transaction: t });
        linea(etiqueta, n);
        return n;
    };

    // MOVIMIENTOS_CAJAS_BANCOS y TRASLADO_EFECTIVO_HISTORIAL son bitácoras append-only: sus
    // modelos tienen hooks que lanzan ante cualquier destroy, justamente para que ningún
    // controlador pueda editarlas. Un formateo es el único caso en que eso se salta, y por
    // eso va por SQL directo y no tocando el guard del modelo: la regla sigue en pie para
    // todo el resto de la aplicación.
    const borrarBitacora = async (tabla, etiqueta) => {
        const [, meta] = await db.query(`DELETE FROM \`${tabla}\``, { transaction: t });
        linea(`${etiqueta} (bitácora)`, meta?.affectedRows ?? '—');
    };

    try {
        titulo('BORRANDO');
        // El orden es el inverso al de las dependencias. No se apagan las FK: si algo
        // quedó mal mapeado, preferimos que la base lo frene a que deje filas huérfanas.

        console.log('\n  Pedidos web');
        await borrar(PedidosWebHistorialEstado, 'PEDIDOS_WEB_HISTORIAL_ESTADO');
        await borrar(PagosPedidoWeb, 'PAGOS_PEDIDO_WEB');
        await borrar(DetallesPedidoWeb, 'DETALLES_PEDIDO_WEB');
        await borrar(PedidosWeb, 'PEDIDOS_WEB');

        console.log('\n  Facturas');
        await borrar(AbonoClienteCreditos, 'ABONO_CLIENTE_CREDITOS');
        await borrar(DetallesPagosFactura, 'DETALLES_PAGOS_FACTURA');
        await borrar(DetallesImpuestosFacturaCliente, 'DETALLES_IMPUESTOS_FACTURA_CLIENTE');
        await borrar(DetallesFactura, 'DETALLES_FACTURA');
        await borrar(FacturaClientes, 'FACTURA_CLIENTES');

        console.log('\n  Clientes');
        await borrar(CreditoDisponibleClienteHistorial, 'CREDITO_DISPONIBLE_CLIENTE_HISTORIAL');
        await borrar(CreditoDisponibleCliente, 'CREDITO_DISPONIBLE_CLIENTE');
        await borrar(ClientesCreditoHistorial, 'CLIENTES_CREDITO_HISTORIAL');
        await borrar(ClientesUbicacion, 'CLIENTES_UBICACION', { idCliente: { [Op.ne]: CLIENTE_GENERICO } });
        await borrar(ClientesTributario, 'CLIENTES_TRIBUTARIO', { idCliente: { [Op.ne]: CLIENTE_GENERICO } });
        await borrar(Clientes, 'CLIENTES (menos el genérico)', { idCliente: { [Op.ne]: CLIENTE_GENERICO } });

        if (CON_PROVEEDORES) {
            console.log('\n  Proveedores');
            await borrar(AbonosProveedores, 'ABONOS_PROVEEDORES');
            await borrar(CuentasPorPagar, 'CUENTAS_POR_PAGAR');
            await borrar(DetallesFacturaProvedores, 'DETALLES_FACTURA_PROVEEDORES');
            await borrar(FacturaProveedores, 'FACTURA_PROVEEDORES');
        }

        console.log('\n  Inventario y traslados');
        await borrar(ReservasCarrito, 'RESERVAS_CARRITO');
        await borrar(InsidenciaTraslado, 'INSIDENCIAS_TRASLADOS');
        await borrar(DetalleTraslados, 'DETALLE_TRASLADOS');
        await borrar(Traslados, 'TRASLADOS');
        await borrar(DetallesPack, 'DETALLES_PACK');
        await borrar(Pack, 'PACKS');
        await borrar(Dosificaciones, 'DOSIFICACIONES');
        await borrar(Stock, 'STOCKS');
        const [borradoBackup] = await db.query('DELETE FROM TRASLADOS_BACKUP_20260914', { transaction: t })
            .then(() => ['ok']).catch(() => [null]);
        if (borradoBackup) linea('TRASLADOS_BACKUP_20260914', 'vaciada');

        // EGRESOS antes que TRASLADO_EFECTIVO (RESTRICT), y TRASLADO_EFECTIVO antes que
        // MOVIMIENTOS_CAJAS_BANCOS, que también le apunta con RESTRICT.
        console.log('\n  Cajas y bancos');
        await borrarBitacora('TRASLADO_EFECTIVO_HISTORIAL', 'TRASLADO_EFECTIVO_HISTORIAL');
        await borrar(Egresos, 'EGRESOS');
        await borrar(TrasladoEfectivo, 'TRASLADO_EFECTIVO');
        await borrarBitacora('MOVIMIENTOS_CAJAS_BANCOS', 'MOVIMIENTOS_CAJAS_BANCOS');
        await borrar(CajaTienda, 'CAJA_TIENDA');
        await borrar(CajasYBancos, 'CAJAS_Y_BANCOS');

        console.log('\n  Usuarios, empleados y puntos de venta que se descartan');
        if (idsUsrBorrar.length) await borrar(UserPermisos, 'USER_PERMISOS', { idUsuario: idsUsrBorrar });
        if (idsEmpBorrar.length) await borrar(Empleados, 'EMPLEADOS', { idEmpleado: idsEmpBorrar });
        if (idsUsrBorrar.length) await borrar(Usuarios, 'USUARIOS', { idUsuario: idsUsrBorrar });
        if (idsPdvBorrar.length) {
            await borrar(RegimenFacturacion, 'REGIMEN_FACTURACION', { idPuntoDeVenta: idsPdvBorrar });
            await borrar(PuntosDeVenta, 'PUNTO_DE_VENTA', { idPuntoDeVenta: idsPdvBorrar });
        }

        // La documentación se borra al final: sus filas no tienen FK, así que hay que
        // decidirlo acá y no esperar que la base lo arrastre.
        await borrar(Documentacion, 'DOCUMENTACION', { pertenece: { [Op.ne]: 'producto' } });

        if (REINICIAR_DIAN) {
            const [n] = await RegimenFacturacion.update({ nroActual: 0 }, { where: {}, transaction: t });
            linea('REGIMEN_FACTURACION.nroActual → 0', n);
        }
        if (REINICIAR_SECUENCIAS) {
            const [n] = await Secuencias.update({ valor: 0 }, { where: {}, transaction: t });
            linea('SECUENCIAS.valor → 0', n);
        }

        await t.commit();
        console.log('\n  Formateo completado.');
    } catch (e) {
        if (!t.finished) await t.rollback().catch(() => {});
        throw e;
    }
}

const run = async () => {
    try {
        await db.authenticate();
        console.log(`\n  Base: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);

        const alcance = await resolverAlcance();
        await informar(alcance);

        if (!EJECUTAR) {
            titulo('MODO ENSAYO — no se borró nada');
            console.log('\n  Para ejecutarlo de verdad:\n');
            console.log(`   node ./seed/formatearOperacion.js --borrar --base=${process.env.DB_NAME} --admin=<correo>\n`);
            return process.exit(0);
        }

        // Dos llaves para el borrado: el nombre de la base escrito a mano —para que no se
        // ejecute por error contra producción— y al menos un administrador que sobreviva.
        const base = valor('--base');
        if (base !== process.env.DB_NAME) {
            throw new Error(`Falta --base=${process.env.DB_NAME} (llegó ${base ?? 'nada'}). ` +
                'Se escribe a mano a propósito: es la confirmación de contra qué base se está corriendo.');
        }
        if (!ADMINS.length) {
            const admins = await Usuarios.findAll({ where: { permisos: 'ADMIN' }, attributes: ['nombreUsuario', 'emailUsuario'], raw: true });
            throw new Error('Falta --admin=<correo>. Sin eso, un usuario ADMIN sin ficha de empleado se borraría.\n' +
                '  Candidatos:\n' + admins.map(a => `   · ${a.nombreUsuario} <${a.emailUsuario}>`).join('\n'));
        }

        await formatear(alcance);
        process.exit(0);
    } catch (e) {
        console.error(`\n  ✗ ${e.message}\n`);
        process.exit(1);
    }
};

run();
