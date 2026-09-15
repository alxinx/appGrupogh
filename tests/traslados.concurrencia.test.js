import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import {
    prepararBaseDePrueba, cerrarBase, TIENDA_A, TIENDA_B, empleadoDe, llamar,
    crearTrasladoEnTransito, crearStock, crearPack, stockTotal, insidenciasDe, recargar
} from './bdPrueba.js';
import db from '../config/bd.js';
import { Traslados, DetalleTraslados, Pack, Stock } from '../models/index.js';
import {
    aceptarTrasladoAPI, trasladarDesdeStoreAPI, verificarTrasladosExpirados, crearTrasladoSueltos,
    resolverControversiaAPI
} from '../controller/storeControllers.js';
import { trasladarPacks } from '../controller/dosificacionController.js';
import { recibirDevolucionAdmin, listarControversiasJSON, listarHistorialJSON } from '../controller/trasladosAdminController.js';
import { bloquearYValidarTraslado, ACTOR_JOB_EXPIRADOS, segundosMaximosEnTransito } from '../helpers/traslados.js';

const EMP_A  = empleadoDe('despacho-a');
const EMP_B  = empleadoDe('receptor-b');
const EMP_B2 = empleadoDe('receptor-b2');

const esperar = (ms) => new Promise(r => setTimeout(r, ms));
// Una hora más vieja que el máximo configurado en MAX_TRANSFER_TIME, sea cual sea.
const fechaVencida = () => new Date(Date.now() - (segundosMaximosEnTransito() + 3600) * 1000);

const conPrefijo = (filas, prefijo) => filas.filter(f => f.razonInsidencia.startsWith(prefijo));

const itemsCompletos = (detalles) => detalles.map(d => ({
    idDetalleTraslado: d.idDetalleTraslado, cantidadOriginal: d.cantidad, cantidadAceptada: d.cantidad, aceptado: true
}));

const aceptar = (traslado, detalles, { empleado = EMP_B, idPdv = traslado.idDestino, items } = {}) =>
    llamar(aceptarTrasladoAPI, {
        idPuntoDeVenta: idPdv,
        empleadoVerificado: empleado,
        body: { idTraslado: traslado.idTraslado, codigoEmpleado: empleado.codigoEmpleado, items: items ?? itemsCompletos(detalles) }
    });

const trasladarDesdeTienda = (idsPack, empleado = EMP_A) =>
    llamar(trasladarDesdeStoreAPI, {
        idPuntoDeVenta: TIENDA_A,
        empleadoVerificado: empleado,
        body: { packs: idsPack, idDestino: TIENDA_B, codigoEmpleado: empleado.codigoEmpleado, notas: '' }
    });

const trasladarDesdeDosificacion = (idsPack, empleado = EMP_A) =>
    llamar(trasladarPacks, { body: { packs: idsPack, idDestino: TIENDA_B, idEmpleadoDespacha: empleado.idEmpleado, notas: '' } });

// Un pack con su traslado anterior ya recibido: ahí tiene que quedar el rastro de un intento
// de moverlo que se rechace, porque ese intento no llega a crear traslado propio.
const packConHistoria = async (estado) => {
    const pack = await crearPack(estado);
    const { traslado } = await crearTrasladoEnTransito({ idOrigen: 'PRODUCCION', idDestino: TIENDA_A, lineas: [{ idPack: pack.idPack }] });
    await Traslados.update({ estado: 'RECIBIDO' }, { where: { idTraslado: traslado.idTraslado } });
    return { pack, trasladoPrevio: traslado };
};

before(prepararBaseDePrueba);
after(cerrarBase);

// ─── Fix 1 ───────────────────────────────────────────────────────────────────

test('dos aceptaciones simultáneas del mismo traslado: una gana y el stock entra una sola vez', async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
        const idProducto = randomUUID();
        const { traslado, detalles } = await crearTrasladoEnTransito({
            idOrigen: TIENDA_A, idDestino: TIENDA_B, lineas: [{ idProducto, cantidad: 7 }]
        });

        const [r1, r2] = await Promise.all([
            aceptar(traslado, detalles, { empleado: EMP_B }),
            aceptar(traslado, detalles, { empleado: EMP_B2 })
        ]);

        assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [200, 409]);
        assert.equal(await stockTotal({ idProducto, idPuntoVenta: TIENDA_B }), 7);
        assert.equal((await recargar(traslado.idTraslado)).estado, 'RECIBIDO');

        const filas = await insidenciasDe(traslado.idTraslado);
        assert.equal(conPrefijo(filas, 'RECIBIDO').length, 1);
        const rechazos = conPrefijo(filas, 'RECHAZADO');
        assert.equal(rechazos.length, 1);
        assert.equal(rechazos[0].idEmpleado, (r1.statusCode === 409 ? EMP_B : EMP_B2).idEmpleado);
    }
});

test('aceptar espera el lock de la fila y, al obtenerlo, ve el estado ya cambiado', async () => {
    const idProducto = randomUUID();
    const { traslado, detalles } = await crearTrasladoEnTransito({
        idOrigen: TIENDA_A, idDestino: TIENDA_B, lineas: [{ idProducto, cantidad: 3 }]
    });

    const t = await db.transaction();
    await bloquearYValidarTraslado(traslado.idTraslado, ['EN_TRANSITO'], t);

    let terminada = false;
    const enCurso = aceptar(traslado, detalles).then((r) => { terminada = true; return r; });
    await esperar(400);
    assert.equal(terminada, false, 'aceptar tenía que quedar esperando el lock');

    await Traslados.update({ estado: 'RECIBIDO' }, { where: { idTraslado: traslado.idTraslado }, transaction: t });
    await t.commit();

    const res = await enCurso;
    assert.equal(res.statusCode, 409);
    assert.equal(await stockTotal({ idProducto }), 0);
    assert.equal(conPrefijo(await insidenciasDe(traslado.idTraslado), 'RECHAZADO').length, 1);
});

test('aceptar un traslado RECIBIDO o DEVUELTO falla explícitamente y deja rastro', async () => {
    for (const estado of ['RECIBIDO', 'DEVUELTO']) {
        const idProducto = randomUUID();
        const { traslado, detalles } = await crearTrasladoEnTransito({
            idOrigen: TIENDA_A, idDestino: TIENDA_B, lineas: [{ idProducto, cantidad: 2 }]
        });
        await Traslados.update({ estado }, { where: { idTraslado: traslado.idTraslado } });

        const res = await aceptar(traslado, detalles);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.success, false);
        assert.match(res.body.mensaje, new RegExp(estado));
        assert.equal(await stockTotal({ idProducto }), 0);
        const rechazos = conPrefijo(await insidenciasDe(traslado.idTraslado), 'RECHAZADO');
        assert.equal(rechazos.length, 1);
        assert.equal(rechazos[0].idEmpleado, EMP_B.idEmpleado);
        assert.match(rechazos[0].razonInsidencia, /\(aceptar\)/);
    }
});

test('aceptar rechaza un detalle ajeno, una cantidad mayor a la enviada y una tienda que no es el destino', async () => {
    const otro = await crearTrasladoEnTransito({ idOrigen: TIENDA_A, idDestino: TIENDA_B, lineas: [{ idProducto: randomUUID(), cantidad: 9 }] });

    const casos = [
        {
            nombre: 'detalle de otro traslado',
            status: 400,
            armar: (d) => ({ items: [{ idDetalleTraslado: otro.detalles[0].idDetalleTraslado, cantidadAceptada: 9, aceptado: true }] })
        },
        {
            nombre: 'cantidad mayor a la enviada, aunque el body mienta la original',
            status: 400,
            armar: (d) => ({ items: [{ idDetalleTraslado: d[0].idDetalleTraslado, cantidadOriginal: 50, cantidadAceptada: 50, aceptado: true }] })
        },
        {
            nombre: 'tienda que no es el destino',
            status: 403,
            armar: () => ({ idPdv: TIENDA_A })
        }
    ];

    for (const caso of casos) {
        const idProducto = randomUUID();
        const { traslado, detalles } = await crearTrasladoEnTransito({
            idOrigen: TIENDA_A, idDestino: TIENDA_B, lineas: [{ idProducto, cantidad: 5 }]
        });

        const res = await aceptar(traslado, detalles, caso.armar(detalles));

        assert.equal(res.statusCode, caso.status, caso.nombre);
        assert.equal((await recargar(traslado.idTraslado)).estado, 'EN_TRANSITO', caso.nombre);
        assert.equal(await stockTotal({ idProducto }), 0, caso.nombre);
        assert.equal(await stockTotal({ idProducto: otro.detalles[0].idProducto }), 0, caso.nombre);
        assert.equal(conPrefijo(await insidenciasDe(traslado.idTraslado), 'RECHAZADO').length, 1, caso.nombre);
    }
});

// ─── Fix 2 ───────────────────────────────────────────────────────────────────

const verificarUnSoloGanador = async ({ traslado, idProducto, cantidad, resAceptar }) => {
    const final     = await recargar(traslado.idTraslado);
    const enOrigen  = await stockTotal({ idProducto, idPuntoVenta: TIENDA_A });
    const enDestino = await stockTotal({ idProducto, idPuntoVenta: TIENDA_B });
    const filas     = await insidenciasDe(traslado.idTraslado);

    assert.equal(enOrigen + enDestino, cantidad, 'la mercancía tiene que existir una sola vez');

    if (final.estado === 'RECIBIDO') {
        assert.equal(resAceptar.statusCode, 200);
        assert.equal(enDestino, cantidad);
        assert.equal(conPrefijo(filas, 'DEVUELTO').length, 0);
        return { ganador: 'aceptar', rechazos: conPrefijo(filas, 'RECHAZADO') };
    }

    assert.equal(final.estado, 'DEVUELTO');
    assert.equal(resAceptar.statusCode, 409);
    assert.equal(enOrigen, cantidad);
    const devoluciones = conPrefijo(filas, 'DEVUELTO');
    assert.equal(devoluciones.length, 1);
    assert.equal(devoluciones[0].idEmpleado, ACTOR_JOB_EXPIRADOS);
    return { ganador: 'job', rechazos: conPrefijo(filas, 'RECHAZADO') };
};

test('job de expirados y aceptar encolados sobre el mismo traslado: gana uno, nunca los dos', async () => {
    const idProducto = randomUUID();
    const { traslado, detalles } = await crearTrasladoEnTransito({
        idOrigen: TIENDA_A, idDestino: TIENDA_B, lineas: [{ idProducto, cantidad: 4 }], fechaEnvio: fechaVencida()
    });

    // Los dos quedan esperando el mismo lock; al soltarlo, uno entra primero.
    const t = await db.transaction();
    await bloquearYValidarTraslado(traslado.idTraslado, ['EN_TRANSITO'], t);
    const enCursoAceptar = aceptar(traslado, detalles);
    const enCursoJob = verificarTrasladosExpirados();
    await esperar(400);
    await t.commit();
    const [resAceptar] = await Promise.all([enCursoAceptar, enCursoJob]);

    const { ganador, rechazos } = await verificarUnSoloGanador({ traslado, idProducto, cantidad: 4, resAceptar });
    // Los dos intentaron: el que perdió tiene que haber dejado su rechazo, con su actor.
    assert.equal(rechazos.length, 1);
    assert.equal(rechazos[0].idEmpleado, ganador === 'aceptar' ? ACTOR_JOB_EXPIRADOS : EMP_B.idEmpleado);
});

test('job de expirados y aceptar lanzados a la vez, varias rondas: el resultado siempre es consistente', async () => {
    for (let ronda = 0; ronda < 6; ronda++) {
        const idProducto = randomUUID();
        const { traslado, detalles } = await crearTrasladoEnTransito({
            idOrigen: TIENDA_A, idDestino: TIENDA_B, lineas: [{ idProducto, cantidad: 6 }], fechaEnvio: fechaVencida()
        });

        const resAceptar = ronda % 2 === 0
            ? (await Promise.all([aceptar(traslado, detalles), verificarTrasladosExpirados()]))[0]
            : (await Promise.all([verificarTrasladosExpirados(), aceptar(traslado, detalles)]))[1];

        const { rechazos } = await verificarUnSoloGanador({ traslado, idProducto, cantidad: 6, resAceptar });
        // Si el job consultó candidatos después de que aceptar terminara, no llegó a intentarlo.
        assert.ok(rechazos.length <= 1);
    }
});

test('el job devuelve un traslado expirado y la aceptación posterior se rechaza con su rastro', async () => {
    const idProducto = randomUUID();
    const { traslado, detalles } = await crearTrasladoEnTransito({
        idOrigen: TIENDA_A, idDestino: TIENDA_B, lineas: [{ idProducto, cantidad: 5 }], fechaEnvio: fechaVencida()
    });

    await verificarTrasladosExpirados();
    const resAceptar = await aceptar(traslado, detalles);

    const { ganador, rechazos } = await verificarUnSoloGanador({ traslado, idProducto, cantidad: 5, resAceptar });
    assert.equal(ganador, 'job');
    assert.equal(rechazos.length, 1);
    assert.equal(rechazos[0].idEmpleado, EMP_B.idEmpleado);
});

// ─── Fix 3 ───────────────────────────────────────────────────────────────────

test('dosificación: trasladar un pack VENDIDO o TRASLADADO falla explícitamente y deja rastro', async () => {
    for (const estado of ['VENDIDO', 'TRASLADADO']) {
        const { pack, trasladoPrevio } = await packConHistoria(estado);
        const trasladosAntes = await Traslados.count();

        const res = await trasladarDesdeDosificacion([pack.idPack]);

        assert.equal(res.statusCode, 409, estado);
        assert.match(res.body.mensaje, new RegExp(`${pack.codigoEtiqueta} está ${estado}`));
        assert.equal(await Traslados.count(), trasladosAntes, 'no se crea traslado');
        assert.equal((await Pack.findByPk(pack.idPack)).estado, estado);
        const rechazos = conPrefijo(await insidenciasDe(trasladoPrevio.idTraslado), 'RECHAZADO');
        assert.equal(rechazos.length, 1, estado);
        assert.equal(rechazos[0].idEmpleado, EMP_A.idEmpleado);
        assert.match(rechazos[0].razonInsidencia, /dosificación/);
    }
});

test('tienda: trasladar un pack VENDIDO, o TRASLADADO que no está en esta tienda, falla y deja rastro', async () => {
    for (const estado of ['VENDIDO', 'TRASLADADO']) {
        const { pack, trasladoPrevio } = await packConHistoria(estado);

        const res = await trasladarDesdeTienda([pack.idPack]);

        assert.equal(res.statusCode, 409, estado);
        assert.equal(await DetalleTraslados.count({ where: { idPack: pack.idPack } }), 1, 'solo el traslado previo');
        const rechazos = conPrefijo(await insidenciasDe(trasladoPrevio.idTraslado), 'RECHAZADO');
        assert.equal(rechazos.length, 1, estado);
        assert.equal(rechazos[0].idEmpleado, EMP_A.idEmpleado);
    }
});

test('tienda: un pack TRASLADADO con stock CERRADO en la tienda sí se puede trasladar', async () => {
    const { pack } = await packConHistoria('TRASLADADO');
    await crearStock({ idPuntoVenta: TIENDA_A, idPack: pack.idPack, cantidadExistente: 1, estadoInterno: 'CERRADO' });

    const res = await trasladarDesdeTienda([pack.idPack]);

    assert.equal(res.statusCode, 200);
    assert.equal(await stockTotal({ idPack: pack.idPack, idPuntoVenta: TIENDA_A }), 0);
    assert.equal(conPrefijo(await insidenciasDe(res.body.idTraslado), 'ENVIADO').length, 1);
});

test('tienda: dos traslados simultáneos del mismo pack: uno gana y el pack sale una sola vez', async () => {
    const { pack } = await packConHistoria('TRASLADADO');
    await crearStock({ idPuntoVenta: TIENDA_A, idPack: pack.idPack, cantidadExistente: 1, estadoInterno: 'CERRADO' });

    const [r1, r2] = await Promise.all([trasladarDesdeTienda([pack.idPack], EMP_A), trasladarDesdeTienda([pack.idPack], EMP_B)]);

    assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [200, 409]);
    const ganador = r1.statusCode === 200 ? r1 : r2;
    assert.equal(await DetalleTraslados.count({ where: { idPack: pack.idPack } }), 2, 'el previo + uno nuevo');
    const filas = await insidenciasDe(ganador.body.idTraslado);
    assert.equal(conPrefijo(filas, 'ENVIADO').length, 1);
    assert.equal(conPrefijo(filas, 'RECHAZADO').length, 1, 'el rechazo queda en el último traslado del pack');
});

test('dosificación: dos envíos simultáneos del mismo pack EMPACADO: uno gana', async () => {
    const pack = await crearPack('EMPACADO');

    const [r1, r2] = await Promise.all([trasladarDesdeDosificacion([pack.idPack], EMP_A), trasladarDesdeDosificacion([pack.idPack], EMP_B)]);

    assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [200, 409]);
    assert.equal(await DetalleTraslados.count({ where: { idPack: pack.idPack } }), 1);
    assert.equal((await Pack.findByPk(pack.idPack)).estado, 'TRASLADADO');
    const ganador = r1.statusCode === 200 ? r1 : r2;
    const perdedor = r1.statusCode === 200 ? EMP_B : EMP_A;
    const filas = await insidenciasDe(ganador.body.idTraslado);
    assert.equal(conPrefijo(filas, 'ENVIADO').length, 1);
    const rechazos = conPrefijo(filas, 'RECHAZADO');
    assert.equal(rechazos.length, 1);
    assert.equal(rechazos[0].idEmpleado, perdedor.idEmpleado);
});

// ─── Inventario global ───────────────────────────────────────────────────────

test('traslado de unidades sueltas entre dos tiendas: el inventario global no cambia', async () => {
    const idProducto = randomUUID();
    await crearStock({ idPuntoVenta: TIENDA_A, idProducto, cantidadExistente: 10 });
    await crearStock({ idPuntoVenta: TIENDA_B, idProducto, cantidadExistente: 3 });
    const antes = await stockTotal({ idProducto });

    const envio = await llamar(crearTrasladoSueltos, {
        idPuntoDeVenta: TIENDA_A,
        empleadoVerificado: EMP_A,
        body: { items: [{ idProducto, cantidad: 4 }], idDestino: TIENDA_B, codigoEmpleado: EMP_A.codigoEmpleado, notas: '' }
    });
    assert.equal(envio.statusCode, 200);

    const traslado = await Traslados.findByPk(envio.body.idTraslado);
    const detalles = await DetalleTraslados.findAll({ where: { idTraslado: traslado.idTraslado } });
    const recibo = await aceptar(traslado, detalles);
    assert.equal(recibo.statusCode, 200);

    assert.equal(await stockTotal({ idProducto }), antes);
    assert.equal(await stockTotal({ idProducto, idPuntoVenta: TIENDA_A }), 6);
    assert.equal(await stockTotal({ idProducto, idPuntoVenta: TIENDA_B }), 7);

    const filas = await insidenciasDe(traslado.idTraslado);
    assert.equal(conPrefijo(filas, 'ENVIADO')[0]?.idEmpleado, EMP_A.idEmpleado);
    assert.equal(conPrefijo(filas, 'RECIBIDO')[0]?.idEmpleado, EMP_B.idEmpleado);
});

test('traslado de un pack entre dos tiendas: el inventario global no cambia', async () => {
    const { pack } = await packConHistoria('TRASLADADO');
    await crearStock({ idPuntoVenta: TIENDA_A, idPack: pack.idPack, cantidadExistente: 1, estadoInterno: 'CERRADO' });
    const antes = await stockTotal({ idPack: pack.idPack, estadoInterno: 'CERRADO' });

    const envio = await trasladarDesdeTienda([pack.idPack]);
    assert.equal(envio.statusCode, 200);
    const traslado = await Traslados.findByPk(envio.body.idTraslado);
    const detalles = await DetalleTraslados.findAll({ where: { idTraslado: traslado.idTraslado } });
    const recibo = await aceptar(traslado, detalles);
    assert.equal(recibo.statusCode, 200);

    assert.equal(await stockTotal({ idPack: pack.idPack, estadoInterno: 'CERRADO' }), antes);
    assert.equal(await Stock.count({ where: { idPack: pack.idPack, idPuntoVenta: TIENDA_B, estadoInterno: 'CERRADO' } }), 1);

    const filas = await insidenciasDe(traslado.idTraslado);
    assert.equal(conPrefijo(filas, 'ENVIADO')[0]?.idEmpleado, EMP_A.idEmpleado);
    assert.equal(conPrefijo(filas, 'RECIBIDO')[0]?.idEmpleado, EMP_B.idEmpleado);
});

// ─── Rechazo en destino y devolución al origen ───────────────────────────────

const recibirDevolucion = (traslado, { empleado = EMP_A, idPdv = TIENDA_A } = {}) =>
    llamar(resolverControversiaAPI, {
        idPuntoDeVenta: idPdv,
        empleadoVerificado: empleado,
        body: { idTraslado: traslado.idTraslado, codigoEmpleado: empleado.codigoEmpleado }
    });

const packEnTienda = async (idPuntoVenta) => {
    const { pack } = await packConHistoria('TRASLADADO');
    await crearStock({ idPuntoVenta, idPack: pack.idPack, cantidadExistente: 1, estadoInterno: 'CERRADO' });
    return pack;
};

const dondeEstaElPack = async (idPack) =>
    (await Stock.findAll({ where: { idPack, estadoInterno: 'CERRADO' }, raw: true }))
        .filter(s => s.cantidadExistente > 0)
        .map(s => s.idPuntoVenta);

test('pack rechazado en destino: no entra a su inventario, y al recibir la devolución vuelve al origen', async () => {
    const aceptado  = await packEnTienda(TIENDA_A);
    const rechazado = await packEnTienda(TIENDA_A);

    const envio = await trasladarDesdeTienda([aceptado.idPack, rechazado.idPack]);
    assert.equal(envio.statusCode, 200);
    const traslado = await Traslados.findByPk(envio.body.idTraslado);
    const detalles = await DetalleTraslados.findAll({ where: { idTraslado: traslado.idTraslado } });
    const detalleDe = (pack) => detalles.find(d => d.idPack === pack.idPack);

    // Lo mismo que mandaba la pantalla: el pack desmarcado con la cantidad todavía en 1.
    const recibo = await aceptar(traslado, detalles, {
        items: [
            { idDetalleTraslado: detalleDe(aceptado).idDetalleTraslado, cantidadOriginal: 1, cantidadAceptada: 1, aceptado: true },
            { idDetalleTraslado: detalleDe(rechazado).idDetalleTraslado, cantidadOriginal: 1, cantidadAceptada: 1, aceptado: false, razon: 'Llegó destapado' }
        ]
    });
    assert.equal(recibo.statusCode, 200);
    assert.equal(recibo.body.estado, 'EN_CONTROVERSIA');
    assert.deepEqual(await dondeEstaElPack(aceptado.idPack), [TIENDA_B]);
    assert.deepEqual(await dondeEstaElPack(rechazado.idPack), [], 'un pack rechazado no queda en ninguna tienda mientras vuelve');
    const enControversia = await DetalleTraslados.findByPk(detalleDe(rechazado).idDetalleTraslado);
    assert.equal(enControversia.estado, 'CONTROVERSIA');
    assert.equal(enControversia.cantidadControversia, 1);

    const devolucion = await recibirDevolucion(traslado);

    assert.equal(devolucion.statusCode, 200);
    assert.equal((await recargar(traslado.idTraslado)).estado, 'RECIBIDO');
    assert.deepEqual(await dondeEstaElPack(rechazado.idPack), [TIENDA_A], 'el rechazado vuelve al inventario del origen');
    assert.deepEqual(await dondeEstaElPack(aceptado.idPack), [TIENDA_B], 'el aceptado se queda en destino');

    const filas = await insidenciasDe(traslado.idTraslado);
    const vuelta = conPrefijo(filas, 'DEVUELTO AL ORIGEN');
    assert.equal(vuelta.length, 1);
    assert.equal(vuelta[0].idDetalleTraslado, detalleDe(rechazado).idDetalleTraslado);
    assert.equal(vuelta[0].idEmpleado, EMP_A.idEmpleado);
    assert.equal(filas.filter(f => f.resuelta === 'no').length, 0, 'no queda ninguna incidencia abierta');
});

test('recepción parcial de sueltos: lo aceptado queda en destino, lo faltante vuelve al origen, y el total no cambia', async () => {
    const idProducto = randomUUID();
    await crearStock({ idPuntoVenta: TIENDA_A, idProducto, cantidadExistente: 10 });

    const envio = await llamar(crearTrasladoSueltos, {
        idPuntoDeVenta: TIENDA_A,
        empleadoVerificado: EMP_A,
        body: { items: [{ idProducto, cantidad: 10 }], idDestino: TIENDA_B, codigoEmpleado: EMP_A.codigoEmpleado, notas: '' }
    });
    const traslado = await Traslados.findByPk(envio.body.idTraslado);
    const detalles = await DetalleTraslados.findAll({ where: { idTraslado: traslado.idTraslado } });

    const recibo = await aceptar(traslado, detalles, {
        items: [{ idDetalleTraslado: detalles[0].idDetalleTraslado, cantidadOriginal: 10, cantidadAceptada: 7, aceptado: true, razon: 'Faltan 3' }]
    });
    assert.equal(recibo.body.estado, 'EN_CONTROVERSIA');
    assert.equal(await stockTotal({ idProducto, idPuntoVenta: TIENDA_B }), 7);
    assert.equal(await stockTotal({ idProducto, idPuntoVenta: TIENDA_A }), 0);

    assert.equal((await recibirDevolucion(traslado)).statusCode, 200);
    assert.equal(await stockTotal({ idProducto, idPuntoVenta: TIENDA_A }), 3);
    assert.equal(await stockTotal({ idProducto, idPuntoVenta: TIENDA_B }), 7);
    assert.equal(await stockTotal({ idProducto }), 10);
});

test('el destino no puede recibir la devolución de lo que él mismo rechazó', async () => {
    const pack = await packEnTienda(TIENDA_A);
    const envio = await trasladarDesdeTienda([pack.idPack]);
    const traslado = await Traslados.findByPk(envio.body.idTraslado);
    const detalles = await DetalleTraslados.findAll({ where: { idTraslado: traslado.idTraslado } });
    await aceptar(traslado, detalles, {
        items: [{ idDetalleTraslado: detalles[0].idDetalleTraslado, cantidadAceptada: 1, aceptado: false, razon: 'x' }]
    });

    const res = await recibirDevolucion(traslado, { empleado: EMP_B, idPdv: TIENDA_B });

    assert.equal(res.statusCode, 403);
    assert.equal((await recargar(traslado.idTraslado)).estado, 'EN_CONTROVERSIA');
    assert.deepEqual(await dondeEstaElPack(pack.idPack), []);
    assert.equal(conPrefijo(await insidenciasDe(traslado.idTraslado), 'RECHAZADO').length, 1);
});

test('dos recepciones simultáneas de la misma devolución: el stock vuelve una sola vez', async () => {
    const idProducto = randomUUID();
    const { traslado, detalles } = await crearTrasladoEnTransito({
        idOrigen: TIENDA_A, idDestino: TIENDA_B, lineas: [{ idProducto, cantidad: 4 }]
    });
    await aceptar(traslado, detalles, {
        items: [{ idDetalleTraslado: detalles[0].idDetalleTraslado, cantidadAceptada: 4, aceptado: false, razon: 'x' }]
    });

    const [r1, r2] = await Promise.all([recibirDevolucion(traslado, { empleado: EMP_A }), recibirDevolucion(traslado, { empleado: EMP_B2 })]);

    assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [200, 409]);
    assert.equal(await stockTotal({ idProducto, idPuntoVenta: TIENDA_A }), 4);
    assert.equal(await stockTotal({ idProducto, idPuntoVenta: TIENDA_B }), 0);
    const filas = await insidenciasDe(traslado.idTraslado);
    assert.equal(conPrefijo(filas, 'DEVUELTO AL ORIGEN').length, 1);
    assert.equal(conPrefijo(filas, 'RECHAZADO').length, 1);
});

// ─── /admin/traslados ────────────────────────────────────────────────────────

const EMP_ADMIN = empleadoDe('bodega-admin');

const recibirEnAdmin = (traslado, empleado = EMP_ADMIN) =>
    llamar(recibirDevolucionAdmin, { params: { idTraslado: traslado.idTraslado }, empleadoVerificado: empleado, body: {} });

// Un pack enviado desde dosificación y rechazado por la tienda destino.
const packDeProduccionRechazado = async () => {
    const pack = await crearPack('EMPACADO');
    const envio = await trasladarDesdeDosificacion([pack.idPack]);
    const traslado = await Traslados.findByPk(envio.body.idTraslado);
    const detalles = await DetalleTraslados.findAll({ where: { idTraslado: traslado.idTraslado } });
    await aceptar(traslado, detalles, {
        items: [{ idDetalleTraslado: detalles[0].idDetalleTraslado, cantidadAceptada: 1, aceptado: false, razon: 'Destapado' }]
    });
    return { pack, traslado };
};

test('pack de producción rechazado: ninguna tienda puede recibirlo, lo recibe el admin y vuelve a EMPACADO', async () => {
    const { pack, traslado } = await packDeProduccionRechazado();
    assert.deepEqual(await dondeEstaElPack(pack.idPack), []);

    // Ni la tienda que lo rechazó ni otra: producción no es una tienda.
    for (const idPdv of [TIENDA_B, TIENDA_A]) {
        const intento = await recibirDevolucion(traslado, { idPdv });
        assert.equal(intento.statusCode, 403, idPdv);
    }
    assert.equal((await recargar(traslado.idTraslado)).estado, 'EN_CONTROVERSIA');

    const recibo = await recibirEnAdmin(traslado);
    assert.equal(recibo.statusCode, 200);
    assert.equal((await recargar(traslado.idTraslado)).estado, 'RECIBIDO');
    assert.equal((await Pack.findByPk(pack.idPack)).estado, 'EMPACADO');
    assert.deepEqual(await dondeEstaElPack(pack.idPack), []);

    const filas = await insidenciasDe(traslado.idTraslado);
    assert.equal(conPrefijo(filas, 'DEVUELTO AL ORIGEN')[0]?.idEmpleado, EMP_ADMIN.idEmpleado);
    assert.equal(conPrefijo(filas, 'RECHAZADO').length, 2, 'los dos intentos de las tiendas quedan registrados');
    assert.equal(filas.filter(f => f.resuelta === 'no').length, 0);

    assert.equal((await trasladarDesdeDosificacion([pack.idPack])).statusCode, 200, 'se puede volver a trasladar');
});

test('el admin no recibe devoluciones entre tiendas: esas las recibe la tienda de origen', async () => {
    const pack = await packEnTienda(TIENDA_A);
    const envio = await trasladarDesdeTienda([pack.idPack]);
    const traslado = await Traslados.findByPk(envio.body.idTraslado);
    const detalles = await DetalleTraslados.findAll({ where: { idTraslado: traslado.idTraslado } });
    await aceptar(traslado, detalles, {
        items: [{ idDetalleTraslado: detalles[0].idDetalleTraslado, cantidadAceptada: 1, aceptado: false, razon: 'x' }]
    });

    const res = await recibirEnAdmin(traslado);

    assert.equal(res.statusCode, 403);
    assert.equal((await recargar(traslado.idTraslado)).estado, 'EN_CONTROVERSIA');
    assert.deepEqual(await dondeEstaElPack(pack.idPack), []);
    assert.equal(conPrefijo(await insidenciasDe(traslado.idTraslado), 'RECHAZADO')[0]?.idEmpleado, EMP_ADMIN.idEmpleado);
});

test('listado de controversias: marca cuáles recibe la administración', async () => {
    const { traslado: deProduccion } = await packDeProduccionRechazado();

    const res = await llamar(listarControversiasJSON, { query: {} });

    assert.equal(res.statusCode, 200);
    const fila = res.body.controversias.find(c => c.idTraslado === deProduccion.idTraslado);
    assert.ok(fila, 'la controversia de producción aparece');
    assert.equal(fila.recibeAdmin, true);
    assert.equal(fila.origen, 'Producción');
    assert.equal(fila.packsRechazados, 1);
    assert.ok(res.body.controversias.every(c => c.recibeAdmin === (c.origen === 'Producción')));
});

test('historial: pagina por cursor sin repetir ni saltarse traslados, y filtra por estado', async () => {
    const vistos = [];
    let cursor = null;
    do {
        const res = await llamar(listarHistorialJSON, { query: cursor ? { cursor } : {} });
        assert.equal(res.statusCode, 200);
        vistos.push(...res.body.traslados.map(t => t.idTraslado));
        cursor = res.body.cursorSiguiente;
    } while (cursor);

    assert.equal(new Set(vistos).size, vistos.length, 'ningún traslado aparece dos veces');
    assert.equal(vistos.length, await Traslados.count(), 'están todos');

    const soloControversia = await llamar(listarHistorialJSON, { query: { estado: 'EN_CONTROVERSIA' } });
    assert.ok(soloControversia.body.traslados.length > 0);
    assert.ok(soloControversia.body.traslados.every(t => t.estado === 'EN_CONTROVERSIA'));
});
