import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prepararBaseDePrueba, cerrarBase } from './bdPrueba.js';
import db from '../config/bd.js';
import { Material, InsumoCapa, InsumoMovimiento } from '../models/index.js';
import {
    registrarEntrada, registrarSalidaAjuste, existenciasDeMateriales, moverFIFO
} from '../helpers/inventarioInsumos.js';
import {
    factorFijo, resolverContenido, convertirRecepcion, cantidadValida, a4
} from '../helpers/unidadesInsumo.js';

// Inventario de insumos (PLAN_COSTEO_PRODUCCION.md §3). Las reglas que no pueden fallar:
// el ponderado es SOLO de lo disponible y se gasta de la capa más vieja a la más nueva.

const ACTOR = { origen: 'panel', idUsuario: null, nombreUsuario: 'test', empleado: null };
let codigo = 9000;

const nuevoMaterial = (unidadConsumo = 'unidad') => Material.create({
    codigoMaterial: String(++codigo), nombre: `Prueba ${codigo}`, tipo: 'insumo', unidadConsumo
});
const entrar = (idMaterial, cantidad, costoUnitario) =>
    db.transaction(transaction => registrarEntrada({ idMaterial, cantidad, costoUnitario, actor: ACTOR, transaction }));
const sacar = (idMaterial, cantidad) =>
    db.transaction(transaction => registrarSalidaAjuste({ idMaterial, cantidad, motivo: 'conteo', actor: ACTOR, transaction }));
const existencias = async (idMaterial) => (await existenciasDeMateriales([idMaterial])).get(idMaterial);

// El consecutivo de órdenes lo siembra la migración de órdenes de compra en la base real; en
// la de prueba se agrega acá, en el mismo hook (después de crear la base).
before(async () => {
    await prepararBaseDePrueba();
    await db.query("INSERT IGNORE INTO SECUENCIAS (nombre, valor) VALUES ('orden_compra_insumo', 0)");
});
after(cerrarBase);

// ── Unidades ─────────────────────────────────────────────────────────────────────────────

test('conversión fija solo entre la misma magnitud', () => {
    assert.equal(factorFijo('metro', 'cm'), 100);
    assert.equal(factorFijo('kg', 'g'), 1000);
    assert.equal(factorFijo('unidad', 'unidad'), 1);
    assert.equal(factorFijo('kg', 'cm'), null);      // resorte por kilo: depende del resorte
    assert.equal(factorFijo('bolsa', 'unidad'), null); // depende de la bolsa
});

test('el contenido fijo ignora lo que mande el navegador; el variable es obligatorio', () => {
    assert.equal(resolverContenido({ presentacion: 'metro', unidadConsumo: 'cm', contenidoCrudo: '7' }).contenido.toNumber(), 100);
    assert.ok(resolverContenido({ presentacion: 'bolsa', unidadConsumo: 'unidad', contenidoCrudo: '' }).error);
    assert.equal(resolverContenido({ presentacion: 'bolsa', unidadConsumo: 'unidad', contenidoCrudo: '500' }).contenido.toNumber(), 500);
});

test('2 kg de resorte que traen 9.200 cm por kg a $23.000 el kg → 18.400 cm a $2,5 el cm', () => {
    const r = convertirRecepcion({ cantidad: '2', contenido: '9200', valorUnitario: '23000' });
    assert.equal(a4(r.cantidadConsumo), '18400.0000');
    assert.equal(a4(r.costoUnitario), '2.5000');
});

test('cantidadValida rechaza negativos, texto y más de 4 decimales', () => {
    assert.equal(cantidadValida('-5'), null);
    assert.equal(cantidadValida('abc'), null);
    assert.equal(cantidadValida('1.23456'), null);
    assert.equal(cantidadValida('0'), null);
    assert.equal(cantidadValida('0', { permitirCero: true }).toNumber(), 0);
    assert.equal(cantidadValida('2.5').toNumber(), 2.5);
});

// ── Ponderado y FIFO ─────────────────────────────────────────────────────────────────────

test('el ejemplo del dueño: 10 a $1.000 + 10 a $1.100 = $1.050, y lo gastado deja de pesar', async () => {
    const m = await nuevoMaterial();
    await entrar(m.idMaterial, 10, 1000);
    assert.equal((await existencias(m.idMaterial)).costoPonderado, '1000.0000');

    await entrar(m.idMaterial, 10, 1100);
    let e = await existencias(m.idMaterial);
    assert.equal(e.disponible, '20.0000');
    assert.equal(e.costoPonderado, '1050.0000');

    // Se gastan 5: salen de la capa vieja (FIFO) → 5 a $1.000 + 10 a $1.100.
    await sacar(m.idMaterial, 5);
    e = await existencias(m.idMaterial);
    assert.equal(e.disponible, '15.0000');
    assert.equal(e.costoPonderado, '1066.6667');

    // 5 más: la capa vieja se agota y el costo queda en el de la nueva.
    await sacar(m.idMaterial, 5);
    e = await existencias(m.idMaterial);
    assert.equal(e.costoPonderado, '1100.0000');
    assert.equal(e.ultimoCosto, '1100.0000');

    const capas = await InsumoCapa.findAll({ where: { idMaterial: m.idMaterial }, order: [['fechaEntrada', 'ASC'], [db.literal('secuencia'), 'ASC']], raw: true });
    assert.equal(capas[0].cantidadDisponible, '0.0000');
    assert.equal(capas[0].cantidadBaja, '10.0000');
    assert.equal(capas[1].cantidadDisponible, '10.0000');
});

test('una salida que cruza dos capas deja un movimiento por capa, cada uno con su costo', async () => {
    const m = await nuevoMaterial('cm');
    await entrar(m.idMaterial, 300, 20);
    await entrar(m.idMaterial, 300, 22);
    await sacar(m.idMaterial, 450);

    const salidas = await InsumoMovimiento.findAll({ where: { idMaterial: m.idMaterial, tipo: 'ajuste_salida' }, order: [['idMovimiento', 'ASC']], raw: true });
    assert.deepEqual(salidas.map(s => [s.cantidad, s.costoUnitario]), [['300.0000', '20.0000'], ['150.0000', '22.0000']]);
    assert.equal((await existencias(m.idMaterial)).costoPonderado, '22.0000');
});

test('sin existencias el costo es null ("Sin existencia"), nunca 0', async () => {
    const m = await nuevoMaterial();
    assert.equal(await existencias(m.idMaterial), undefined);
    await entrar(m.idMaterial, 4, 500);
    await sacar(m.idMaterial, 4);
    const e = await existencias(m.idMaterial);
    assert.equal(e.disponible, '0.0000');
    assert.equal(e.costoPonderado, null);
    assert.equal(e.ultimoCosto, '500.0000');   // queda para mostrar "última compra"
});

test('si no alcanza responde 409 y no mueve nada', async () => {
    const m = await nuevoMaterial();
    await entrar(m.idMaterial, 3, 100);
    await assert.rejects(sacar(m.idMaterial, 5), (e) => e.publico && e.status === 409);
    assert.equal((await existencias(m.idMaterial)).disponible, '3.0000');
    assert.equal(await InsumoMovimiento.count({ where: { idMaterial: m.idMaterial, tipo: 'ajuste_salida' } }), 0);
});

test('dos salidas simultáneas no gastan la misma cantidad', async () => {
    const m = await nuevoMaterial();
    await entrar(m.idMaterial, 10, 100);
    const r = await Promise.allSettled([sacar(m.idMaterial, 8), sacar(m.idMaterial, 8)]);
    assert.deepEqual(r.map(x => x.status).sort(), ['fulfilled', 'rejected']);
    assert.equal((await existencias(m.idMaterial)).disponible, '2.0000');
});

test('los estados de la orden de producción usan la misma pieza y la capa siempre cuadra', async () => {
    const m = await nuevoMaterial();
    await entrar(m.idMaterial, 20, 50);
    await db.transaction(async (transaction) => {
        await moverFIFO({ idMaterial: m.idMaterial, cantidad: 12, desde: 'cantidadDisponible', hacia: 'cantidadReservada', tipo: 'reserva', actor: ACTOR, transaction });
        await moverFIFO({ idMaterial: m.idMaterial, cantidad: 12, desde: 'cantidadReservada', hacia: 'cantidadEnProceso', tipo: 'entrega_taller', actor: ACTOR, transaction });
        await moverFIFO({ idMaterial: m.idMaterial, cantidad: 2, desde: 'cantidadEnProceso', hacia: 'cantidadDisponible', tipo: 'devolucion', actor: ACTOR, transaction });
        await moverFIFO({ idMaterial: m.idMaterial, cantidad: 10, desde: 'cantidadEnProceso', hacia: 'cantidadConsumida', tipo: 'consumo', actor: ACTOR, transaction });
    });
    const e = await existencias(m.idMaterial);
    // Lo que tuvo el taller nunca entró al ponderado; lo devuelto vuelve a su capa.
    assert.equal(e.disponible, '10.0000');
    assert.equal(e.enProceso, '0.0000');
    const [c] = await InsumoCapa.findAll({ where: { idMaterial: m.idMaterial }, raw: true });
    assert.equal(c.cantidadConsumida, '10.0000');
});

test('la base rechaza una capa descuadrada o negativa (CHECK), aunque alguien se salte el helper', async () => {
    const m = await nuevoMaterial();
    const capa = await entrar(m.idMaterial, 5, 10);
    await assert.rejects(db.query('UPDATE INSUMOS_CAPAS SET cantidadDisponible = cantidadDisponible - 6, cantidadBaja = cantidadBaja + 6 WHERE idCapa = :id', { replacements: { id: capa.idCapa } }));
    await assert.rejects(db.query('UPDATE INSUMOS_CAPAS SET cantidadDisponible = 99 WHERE idCapa = :id', { replacements: { id: capa.idCapa } }));
    assert.ok(randomUUID());
});

// ── Recepción de una orden de compra = entrada al inventario ────────────────────────────

import { crearEmpleadoConUsuario, llamar } from './bdPrueba.js';
import { OrdenesCompra, DetallesOrdenCompra, MaterialPresentacion } from '../models/index.js';
import { recibirOrden } from '../controller/ordenesCompraController.js';

// Orden con una línea, sembrada directo (las FK a proveedor no hacen falta para esto).
const ordenConLinea = async ({ tipo = 'orden_compra', material, cantidad, unidadCompra, valorUnitario, porcentajeIva = 19 }) => {
    const idOrdenCompra = randomUUID();
    const usuario = await crearEmpleadoConUsuario({ conEmpleado: false });
    let detalle;
    await db.transaction(async (t) => {
        await db.query('SET FOREIGN_KEY_CHECKS = 0', { transaction: t });
        await OrdenesCompra.create({
            idOrdenCompra, numeroOrden: `OC-T${++codigo}`, tipo, estado: 'confirmada', idProveedor: randomUUID(),
            origen: 'operador', fechaOrden: new Date(), subtotal: 0, porcentajeIva, valorIva: 0, total: 0, idUsuarioCrea: usuario.idUsuario
        }, { transaction: t });
        detalle = await DetallesOrdenCompra.create({
            idOrdenCompra, idMaterial: material.idMaterial, nombreMaterial: material.nombre, codigoMaterialDxf: material.codigoMaterial,
            cantidad, unidadCompra, valorUnitario, valorTotal: cantidad * valorUnitario
        }, { transaction: t });
        await db.query('SET FOREIGN_KEY_CHECKS = 1', { transaction: t });
    });
    return { idOrdenCompra, detalle, usuario: { idUsuario: usuario.idUsuario, nombreUsuario: 'Prueba' } };
};
const recibir = ({ idOrdenCompra, usuario }, lineas) =>
    llamar(recibirOrden, { params: { idOrdenCompra }, body: { lineas }, usuario, empleadoVerificado: null });

test('recibir 2 kg de resorte que traen 9.200 cm por kg: entran 18.400 cm a $2,5 el cm (sin IVA)', async () => {
    const m = await nuevoMaterial('cm');
    const o = await ordenConLinea({ material: m, cantidad: 2, unidadCompra: 'kg', valorUnitario: 23000 });
    const r = await recibir(o, [{ idDetalleOrdenCompra: o.detalle.idDetalleOrdenCompra, cantidadLlega: '2', contenido: '9200' }]);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));

    const [capa] = await InsumoCapa.findAll({ where: { idMaterial: m.idMaterial }, raw: true });
    assert.equal(capa.cantidadInicial, '18400.0000');
    assert.equal(capa.costoUnitario, '2.5000');
    assert.equal(capa.ivaUnitario, '0.4750');
    assert.equal(capa.idDetalleOrdenCompra, o.detalle.idDetalleOrdenCompra);
    // El contenido queda recordado para la próxima recepción de ese material por kilo.
    const rec = await MaterialPresentacion.findOne({ where: { idMaterial: m.idMaterial, presentacion: 'kg' }, raw: true });
    assert.equal(rec.contenidoSugerido, '9200.0000');
});

test('la recepción es acumulativa: dos llegadas son dos capas y lo recibido se suma', async () => {
    const m = await nuevoMaterial('cm');
    const o = await ordenConLinea({ material: m, cantidad: 10, unidadCompra: 'metro', valorUnitario: 2000 });
    const id = o.detalle.idDetalleOrdenCompra;
    // metro→cm es fijo: el contenido que mande el navegador se ignora.
    assert.equal((await recibir(o, [{ idDetalleOrdenCompra: id, cantidadLlega: '4', contenido: '1' }])).statusCode, 200);
    assert.equal((await recibir(o, [{ idDetalleOrdenCompra: id, cantidadLlega: '6' }])).statusCode, 200);

    const d = await DetallesOrdenCompra.findByPk(id, { raw: true });
    assert.equal(d.cantidadRecibida, '10.0000');
    assert.equal(d.cantidadConsumoRecibida, '1000.0000');
    assert.equal(await InsumoCapa.count({ where: { idMaterial: m.idMaterial } }), 2);
    assert.equal((await existencias(m.idMaterial)).costoPonderado, '20.0000');   // $2.000 el metro = $20 el cm
});

test('una bolsa sin contenido se rechaza y no entra nada al inventario', async () => {
    const m = await nuevoMaterial('unidad');
    const o = await ordenConLinea({ material: m, cantidad: 3, unidadCompra: 'bolsa', valorUnitario: 50000 });
    const r = await recibir(o, [{ idDetalleOrdenCompra: o.detalle.idDetalleOrdenCompra, cantidadLlega: '3' }]);
    assert.equal(r.statusCode, 400);
    assert.equal(await InsumoCapa.count({ where: { idMaterial: m.idMaterial } }), 0);
    assert.equal((await DetallesOrdenCompra.findByPk(o.detalle.idDetalleOrdenCompra, { raw: true })).cantidadRecibida, null);
});

test('una cotización no se recibe', async () => {
    const m = await nuevoMaterial('unidad');
    const o = await ordenConLinea({ tipo: 'cotizacion', material: m, cantidad: 1, unidadCompra: 'unidad', valorUnitario: 100 });
    const r = await recibir(o, [{ idDetalleOrdenCompra: o.detalle.idDetalleOrdenCompra, cantidadLlega: '1' }]);
    assert.equal(r.statusCode, 400);
    assert.match(r.body.mensaje, /cotización/i);
});

// ── "Recibida" solo se gana recibiendo ──────────────────────────────────────────────────

import { validarEdicionOrden } from '../helpers/ordenesCompra.js';

const actual = (extra = {}) => ({ tipo: 'orden_compra', estado: 'enviada', fechaOrden: '2026-11-01', idsLineasActuales: [], ...extra });

test('el estado "Recibida" no se elige a mano: se pone con "Recibir orden"', async () => {
    const { errores } = await validarEdicionOrden({ estado: 'recibida' }, actual());
    assert.match(errores?.estado || '', /Recibir orden/);
});

test('una orden que ya entró al inventario no cambia de estado', async () => {
    const { errores } = await validarEdicionOrden({ estado: 'cancelada' }, actual({ estado: 'recibida', entroAlInventario: true }));
    assert.match(errores?.estado || '', /inventario/);
    // Guardar notas o fecha dejándola en Recibida sí se puede.
    const ok = await validarEdicionOrden({ estado: 'recibida' }, actual({ estado: 'recibida', entroAlInventario: true }));
    assert.equal(ok.errores?.estado, undefined);
});

// ── Crear la orden con "La mercancía ya llegó" ─────────────────────────────────────────

import { crearOrdenCompra } from '../controller/ordenesCompraController.js';

const proveedorDePrueba = async () => {
    const idProveedor = randomUUID();
    await db.transaction(async (t) => {
        await db.query('SET FOREIGN_KEY_CHECKS = 0', { transaction: t });
        await db.query(`INSERT INTO PROVEDORES (idProveedor, razonSocial, tipoDocumento, taxIdSupplier, nombreContacto, emailProvedor, direccionProvedor, ciudad, departamento, estado, createdAt, updatedAt)
            VALUES (:id, 'Proveedor prueba', 'NIT', :doc, 'Contacto', 'p@prueba.test', 'Calle 1', '05001', '05', 1, NOW(), NOW())`,
            { replacements: { id: idProveedor, doc: String(Date.now()) }, transaction: t });
        await db.query('SET FOREIGN_KEY_CHECKS = 1', { transaction: t });
    });
    return idProveedor;
};

// Permiso fino Insumos/EDIT para el usuario del empleado (lo exige recibir).
const darPermisoRecibir = async (idUsuario) => {
    const [[rec]] = await db.query("SELECT idRecurso FROM PERMISOS_RECURSOS WHERE nombreRecurso='Insumos' AND tipo='administrativo'");
    const idRecurso = rec?.idRecurso ?? (await db.query("INSERT INTO PERMISOS_RECURSOS (idRecurso, nombreRecurso, tipo) VALUES (UUID(), 'Insumos', 'administrativo')"),
        (await db.query("SELECT idRecurso FROM PERMISOS_RECURSOS WHERE nombreRecurso='Insumos' AND tipo='administrativo'"))[0][0].idRecurso);
    const [[acc]] = await db.query("SELECT idAccion FROM PERMISOS_ACCIONES WHERE nombreAccion='EDIT'");
    const idAccion = acc?.idAccion ?? (await db.query("INSERT INTO PERMISOS_ACCIONES (idAccion, nombreAccion) VALUES (UUID(), 'EDIT')"),
        (await db.query("SELECT idAccion FROM PERMISOS_ACCIONES WHERE nombreAccion='EDIT'"))[0][0].idAccion);
    await db.query('INSERT INTO USER_PERMISOS (idPermiso, idUsuario, idRecurso, idAccion) VALUES (UUID(), :u, :r, :a)', { replacements: { u: idUsuario, r: idRecurso, a: idAccion } });
};

const crearConRecepcion = async ({ conPermiso, material, unidadCompra, recepcion }) => {
    const emp = await crearEmpleadoConUsuario();
    if (conPermiso) await darPermisoRecibir(emp.idUsuario);
    const idProveedor = await proveedorDePrueba();
    return llamar(crearOrdenCompra, {
        usuario: { idUsuario: emp.idUsuario, nombreUsuario: 'Prueba' },
        empleadoVerificado: { idEmpleado: emp.idEmpleado, idUsuario: emp.idUsuario, nombre: 'Empleado Prueba', codigoEmpleado: '12345' },
        body: {
            tipo: 'orden_compra', idProveedores: [idProveedor], fechaOrden: new Date().toISOString().slice(0, 10),
            lineas: [{ idMaterial: material.idMaterial, cantidad: '4', unidadCompra, valorUnitario: '60000' }],
            recibirAhora: true, recepcion
        }
    });
};

test('crear con "ya llegó" crea la orden recibida y la mercancía queda en el inventario, con la presentación elegida', async () => {
    const m = await nuevoMaterial('unidad');
    await m.update({ activo: true });
    const r = await crearConRecepcion({ conPermiso: true, material: m, unidadCompra: 'bolsa', recepcion: [{ cantidadLlega: '4', contenido: '300' }] });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.recibida, true);

    const orden = await OrdenesCompra.findByPk(r.body.ordenes[0].idOrdenCompra, { raw: true });
    assert.equal(orden.estado, 'recibida');
    const [d] = await DetallesOrdenCompra.findAll({ where: { idOrdenCompra: orden.idOrdenCompra }, raw: true });
    assert.equal(d.unidadCompra, 'bolsa');                 // la presentación de la línea, no la del insumo
    const e = await existencias(m.idMaterial);
    assert.equal(e.disponible, '1200.0000');               // 4 bolsas × 300
    assert.equal(e.costoPonderado, '200.0000');            // $60.000 / 300
});

test('sin permiso para recibir, no se crea ni la orden', async () => {
    const m = await nuevoMaterial('unidad');
    const antes = await OrdenesCompra.count();
    const r = await crearConRecepcion({ conPermiso: false, material: m, unidadCompra: 'unidad', recepcion: [{ cantidadLlega: '4' }] });
    assert.equal(r.statusCode, 403);
    assert.equal(await OrdenesCompra.count(), antes);
});

test('si la recepción no es válida (bolsa sin contenido), tampoco queda la orden', async () => {
    const m = await nuevoMaterial('unidad');
    const antes = await OrdenesCompra.count();
    const r = await crearConRecepcion({ conPermiso: true, material: m, unidadCompra: 'bolsa', recepcion: [{ cantidadLlega: '4' }] });
    assert.equal(r.statusCode, 400);
    assert.equal(await OrdenesCompra.count(), antes);
    assert.equal(await InsumoCapa.count({ where: { idMaterial: m.idMaterial } }), 0);
});

// ── Proveedores a los que se les compró un insumo (perfil del insumo) ──────────────────

import { proveedoresDelInsumo } from '../helpers/insumos.js';

test('proveedores del insumo: solo órdenes de compra confirmadas, precio ponderado en la presentación de la última compra', async () => {
    const m = await nuevoMaterial('unidad');
    const idProveedor = await proveedorDePrueba();
    const linea = async ({ tipo = 'orden_compra', estado, fecha, cantidad, unidadCompra, valorUnitario }) => {
        await db.transaction(async (t) => {
            await db.query('SET FOREIGN_KEY_CHECKS = 0', { transaction: t });
            const o = await OrdenesCompra.create({
                numeroOrden: `OC-P${++codigo}`, tipo, estado, idProveedor, origen: 'operador', fechaOrden: fecha,
                subtotal: 0, porcentajeIva: 19, valorIva: 0, total: 0, idUsuarioCrea: randomUUID()
            }, { transaction: t });
            await DetallesOrdenCompra.create({
                idOrdenCompra: o.idOrdenCompra, idMaterial: m.idMaterial, nombreMaterial: m.nombre, codigoMaterialDxf: m.codigoMaterial,
                cantidad, unidadCompra, valorUnitario, valorTotal: cantidad * valorUnitario
            }, { transaction: t });
            await db.query('SET FOREIGN_KEY_CHECKS = 1', { transaction: t });
        });
    };
    await linea({ estado: 'recibida', fecha: '2026-10-01', cantidad: 10, unidadCompra: 'unidad', valorUnitario: 1000 });
    await linea({ estado: 'confirmada', fecha: '2026-11-01', cantidad: 30, unidadCompra: 'unidad', valorUnitario: 1200 });
    await linea({ estado: 'recibida', fecha: '2026-09-01', cantidad: 2, unidadCompra: 'bolsa', valorUnitario: 90000 });   // otra presentación
    await linea({ estado: 'borrador', fecha: '2026-11-15', cantidad: 99, unidadCompra: 'unidad', valorUnitario: 1 });     // no es compra
    await linea({ tipo: 'cotizacion', estado: 'confirmada', fecha: '2026-11-16', cantidad: 99, unidadCompra: 'unidad', valorUnitario: 1 }); // tampoco

    const [p] = await proveedoresDelInsumo(m.idMaterial);
    assert.equal(p.idProveedor, idProveedor);
    assert.equal(p.compras, 3);
    assert.equal(p.ultimaFechaOrden, '2026-11-01');
    assert.equal(p.precioPromedio, 1150);          // (10×1.000 + 30×1.200) / 40, por unidad
    assert.equal(p.unidadPrecio, 'ud');
    assert.equal(p.otrasPresentaciones, 1);
    assert.equal(p.calificacion, null);            // punto de conexión de la calificación
});

import { resumenComprasInsumo } from '../helpers/insumos.js';

test('resumen de compras: porcentajes por proveedor y mejor precio solo entre la misma presentación', () => {
    const p = (nombre, totalComprado, precioPromedio, unidadPrecio) => ({ nombre, totalComprado, precioPromedio, unidadPrecio });
    const r = resumenComprasInsumo([p('A', 300000, 1500, 'ud'), p('B', 100000, 1200, 'ud'), p('C', 600000, 900, 'bolsa')]);
    assert.equal(r.totalComprado, 1000000);
    assert.deepEqual(r.resumenCompras.map(x => [x.nombre, x.pct]), [['C', 60], ['A', 30], ['B', 10]]);
    // C es más barato pero vende por bolsa: no se compara con los que venden por unidad.
    assert.deepEqual(r.mejorProveedor, { nombre: 'B', precioPromedio: 1200, unidad: 'ud' });
    // Un solo proveedor: no hay a quién comparar.
    assert.equal(resumenComprasInsumo([p('A', 5000, 100, 'ud')]).mejorProveedor, null);
    assert.equal(resumenComprasInsumo([]).resumenCompras.length, 0);
});
