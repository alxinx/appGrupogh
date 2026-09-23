import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import {
    prepararBaseDePrueba, cerrarBase, TIENDA_A, TIENDA_B, empleadoDe, llamar,
    crearStock, crearPack, stockTotal
} from './bdPrueba.js';
import { DetallesPack, Pack, Stock } from '../models/index.js';
import { desempacarPackAPI } from '../controller/storeControllers.js';

// Desempacar saca un bulto del inventario y mete sus prendas sueltas. Lo que se fija acá es
// que esa mercancía ni se duplique ni se pierda: el pack se abre una sola vez, pase lo que
// pase con la otra caja que está tocando el mismo bulto al mismo tiempo.

const EMP = empleadoDe('bodega-a');

before(prepararBaseDePrueba);
after(cerrarBase);

const desempacar = (body, idPdv = TIENDA_A) =>
    llamar(desempacarPackAPI, {
        idPuntoDeVenta: idPdv,
        empleadoVerificado: EMP,
        body: { codigoEmpleado: EMP.codigoEmpleado, ...body }
    });

// Un pack sellado en una tienda: su fila de STOCKS CERRADA más las prendas que lleva dentro.
const packEnTienda = async (lineas, { estado = 'EMPACADO', idPuntoVenta = TIENDA_A } = {}) => {
    const pack = await crearPack(estado);
    await DetallesPack.bulkCreate(lineas.map(l => ({ idPack: pack.idPack, ...l })));
    await crearStock({ idPuntoVenta, idPack: pack.idPack, cantidadExistente: 1, estadoInterno: 'CERRADO' });
    return pack;
};

const linea = (cantidad) => ({ idProducto: randomUUID(), cantidad });

test('desempacar varios packs a la vez: cada prenda entra una sola vez y los bultos salen del inventario', async () => {
    const a = [linea(4), linea(8)];
    const b = [linea(3)];
    const packA = await packEnTienda(a);
    const packB = await packEnTienda(b, { estado: 'TRASLADADO' }); // llegó de otra sede: su fila acá es la que manda

    const res = await desempacar({ packs: [packA.idPack, packB.idPack] });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.desempacados, 2);
    for (const l of [...a, ...b]) {
        assert.equal(await stockTotal({ idProducto: l.idProducto, idPuntoVenta: TIENDA_A }), l.cantidad);
    }
    for (const pack of [packA, packB]) {
        assert.equal((await Pack.findByPk(pack.idPack)).estado, 'DESEMPACADO');
        assert.equal(await stockTotal({ idPack: pack.idPack, idPuntoVenta: TIENDA_A }), 0);
    }
});

test('el menú de la fila manda un solo idPack y se desempaca igual', async () => {
    const [l] = [linea(6)];
    const pack = await packEnTienda([l]);

    const res = await desempacar({ idPack: pack.idPack });

    assert.equal(res.statusCode, 200);
    assert.equal(await stockTotal({ idProducto: l.idProducto, idPuntoVenta: TIENDA_A }), 6);
});

test('un pack ya desempacado no se vuelve a abrir: sus prendas no entran dos veces', async () => {
    const l = linea(5);
    const pack = await packEnTienda([l]);

    assert.equal((await desempacar({ idPack: pack.idPack })).statusCode, 200);
    // El segundo intento llega con la fila de stock ya vacía y el pack en DESEMPACADO.
    const repetido = await desempacar({ idPack: pack.idPack });

    assert.equal(repetido.statusCode, 409);
    assert.equal(await stockTotal({ idProducto: l.idProducto, idPuntoVenta: TIENDA_A }), 5);
});

test('es todo o nada: si uno del lote no está en la tienda, no se abre ninguno', async () => {
    const propio = linea(7);
    const ajeno  = linea(9);
    const packPropio = await packEnTienda([propio]);
    const packAjeno  = await packEnTienda([ajeno], { idPuntoVenta: TIENDA_B });

    const res = await desempacar({ packs: [packPropio.idPack, packAjeno.idPack] });

    assert.equal(res.statusCode, 409);
    assert.match(res.body.mensaje, /no está|No están/);
    assert.equal(await stockTotal({ idProducto: propio.idProducto, idPuntoVenta: TIENDA_A }), 0);
    assert.equal((await Pack.findByPk(packPropio.idPack)).estado, 'EMPACADO');
    assert.equal(await stockTotal({ idPack: packPropio.idPack, idPuntoVenta: TIENDA_A }), 1);
});

test('un pack vendido o anulado se rechaza nombrándolo, y el resto del lote tampoco se abre', async () => {
    const vivo    = linea(2);
    const vendido = linea(2);
    const packVivo    = await packEnTienda([vivo]);
    const packVendido = await packEnTienda([vendido], { estado: 'VENDIDO' });

    const res = await desempacar({ packs: [packVivo.idPack, packVendido.idPack] });

    assert.equal(res.statusCode, 409);
    assert.match(res.body.mensaje, /No se puede desempacar/);
    assert.match(res.body.mensaje, new RegExp(packVendido.codigoEtiqueta));
    assert.equal(await stockTotal({ idProducto: vivo.idProducto, idPuntoVenta: TIENDA_A }), 0);
});

test('dos desempaques simultáneos del mismo pack: uno gana y las prendas entran una sola vez', async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
        const l = linea(12);
        const pack = await packEnTienda([l]);

        const [r1, r2] = await Promise.all([
            desempacar({ idPack: pack.idPack }),
            desempacar({ idPack: pack.idPack })
        ]);

        assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [200, 409]);
        assert.equal(await stockTotal({ idProducto: l.idProducto, idPuntoVenta: TIENDA_A }), 12);
        assert.equal((await Pack.findByPk(pack.idPack)).estado, 'DESEMPACADO');
    }
});

test('un pack sin productos registrados no deja stock ni se marca desempacado', async () => {
    const pack = await packEnTienda([]);

    const res = await desempacar({ idPack: pack.idPack });

    assert.equal(res.statusCode, 400);
    assert.equal((await Pack.findByPk(pack.idPack)).estado, 'EMPACADO');
    assert.equal(await Stock.count({ where: { idPack: pack.idPack, estadoInterno: 'CERRADO' } }), 1);
});

test('sin packs en el body no se toca nada', async () => {
    assert.equal((await desempacar({ packs: [] })).statusCode, 400);
    assert.equal((await desempacar({})).statusCode, 400);
});
