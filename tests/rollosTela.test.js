import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararBaseDePrueba, cerrarBase } from './bdPrueba.js';
import db from '../config/bd.js';
import { Material, InsumoCapa, InsumoRollo, InsumoRolloEstado } from '../models/index.js';
import { registrarEntrada } from '../helpers/inventarioInsumos.js';
import {
    crearRollos, tenderRollos, adelantarReposo, deshacerTendido, salidaDeRollo, estadoVisible,
    metrajesDesdeMetros, esTelaPorRollo
} from '../helpers/rollosTela.js';
import { validarRecepcionOrden } from '../helpers/ordenesCompra.js';
import { migrarRollosTela } from '../seed/migracionRollosTela.js';

// Rollos de tela (decidido con el dueño el 2026-11-21): todo rollo entra sin tender, tendido
// reposa 48 horas (lo del material) antes de cortarse, y adelantar o deshacer pide motivo.

const ACTOR = { origen: 'panel', idUsuario: null, nombreUsuario: 'test', empleado: null };
const HORA = 3600 * 1000;
let codigo = 8000;

const nuevaTela = (reposoHoras = 48) => Material.create({
    codigoMaterial: String(++codigo), nombre: `Tela ${codigo}`, tipo: 'materia_prima', unidadCompra: 'rollo', unidadConsumo: 'cm', reposoHoras
});
// Una compra de tela con estos rollos (en metros), como la recepción.
const comprarRollos = (material, metros, costoUnitario = 50) => db.transaction(async (transaction) => {
    const metrajesCm = metrajesDesdeMetros(metros);
    const total = metrajesCm.reduce((s, m) => s.plus(m), metrajesCm[0].minus(metrajesCm[0]));
    const capa = await registrarEntrada({ idMaterial: material.idMaterial, cantidad: total, costoUnitario, actor: ACTOR, transaction });
    return crearRollos({ capa, metrajesCm, actor: ACTOR, transaction });
});
const enTx = (fn) => db.transaction((transaction) => fn(transaction));

before(async () => {
    await prepararBaseDePrueba();
    await migrarRollosTela();   // triggers + secuencia (el clon solo copia tablas)
});
after(cerrarBase);

test('una tela es materia prima que se gasta en cm', () => {
    assert.equal(esTelaPorRollo({ tipo: 'materia_prima', unidadConsumo: 'cm' }), true);
    assert.equal(esTelaPorRollo({ tipo: 'materia_prima', unidadConsumo: 'g' }), false);   // hilo por peso
    assert.equal(esTelaPorRollo({ tipo: 'insumo', unidadConsumo: 'cm' }), false);         // resorte
});

test('los metros de cada rollo pasan a cm; uno inválido invalida todo', () => {
    assert.deepEqual(metrajesDesdeMetros(['212', '259.6']).map(String), ['21200', '25960']);
    assert.equal(metrajesDesdeMetros(['212', '0']), null);
    assert.equal(metrajesDesdeMetros(['212', 'abc']), null);
    assert.equal(metrajesDesdeMetros([]), null);
});

test('cada rollo entra sin tender, con su metraje, y suman lo de la capa', async () => {
    const tela = await nuevaTela();
    const rollos = await comprarRollos(tela, ['212', '259.6']);
    assert.equal(rollos.length, 2);
    assert.ok(rollos.every(r => r.estado === 'sin_tender' && /^R-\d+$/.test(r.codigoRollo)));
    const capa = await InsumoCapa.findByPk(rollos[0].idCapa);
    assert.equal(Number(capa.cantidadInicial), 21200 + 25960);
    // No se pueden crear rollos que no sumen lo que entró.
    await assert.rejects(() => enTx(t => crearRollos({ capa, metrajesCm: metrajesDesdeMetros(['10']), actor: ACTOR, transaction: t })), /no suman/);
});

test('tendido reposa las horas del material; a las 48 h queda listo solo', async () => {
    const tela = await nuevaTela(48);
    const [r] = await comprarRollos(tela, ['200']);
    const t0 = new Date('2026-11-21T15:00:00Z');
    await enTx(t => tenderRollos({ idMaterial: tela.idMaterial, idsRollo: [r.idRollo], actor: ACTOR, transaction: t, ahora: t0 }));
    const tendido = await InsumoRollo.findByPk(r.idRollo);
    assert.equal(tendido.estado, 'tendido');
    assert.equal(estadoVisible(tendido, new Date(t0.getTime() + 47 * HORA)), 'en_reposo');
    assert.equal(estadoVisible(tendido, new Date(t0.getTime() + 48 * HORA)), 'listo');
    // Tenderlo otra vez no se puede: ya no está sin tender.
    await assert.rejects(() => enTx(t => tenderRollos({ idMaterial: tela.idMaterial, idsRollo: [r.idRollo], actor: ACTOR, transaction: t })), /ya no está sin tender/);
});

test('el reposo lo pone cada material (una tela de 24 h)', async () => {
    const tela = await nuevaTela(24);
    const [r] = await comprarRollos(tela, ['100']);
    const t0 = new Date('2026-11-21T15:00:00Z');
    await enTx(t => tenderRollos({ idMaterial: tela.idMaterial, idsRollo: [r.idRollo], actor: ACTOR, transaction: t, ahora: t0 }));
    assert.equal(estadoVisible(await InsumoRollo.findByPk(r.idRollo), new Date(t0.getTime() + 24 * HORA)), 'listo');
});

test('adelantar el reposo lo deja listo y queda con su motivo', async () => {
    const tela = await nuevaTela();
    const [r] = await comprarRollos(tela, ['150']);
    await enTx(t => tenderRollos({ idMaterial: tela.idMaterial, idsRollo: [r.idRollo], actor: ACTOR, transaction: t }));
    await enTx(t => adelantarReposo({ idRollo: r.idRollo, motivo: 'Corte urgente', actor: ACTOR, transaction: t }));
    assert.equal(estadoVisible(await InsumoRollo.findByPk(r.idRollo)), 'listo');
    const c = await InsumoRolloEstado.findOne({ where: { idRollo: r.idRollo, accion: 'listo_adelantado' } });
    assert.equal(c.motivo, 'Corte urgente');
    // Ya listo, no se adelanta otra vez.
    await assert.rejects(() => enTx(t => adelantarReposo({ idRollo: r.idRollo, motivo: 'otra vez', actor: ACTOR, transaction: t })), /no está en reposo/);
});

test('deshacer un tendido lo devuelve a sin tender; si se tiende de nuevo, el reposo empieza de cero', async () => {
    const tela = await nuevaTela();
    const [r] = await comprarRollos(tela, ['150']);
    const t0 = new Date('2026-11-21T15:00:00Z');
    await enTx(t => tenderRollos({ idMaterial: tela.idMaterial, idsRollo: [r.idRollo], actor: ACTOR, transaction: t, ahora: t0 }));
    await enTx(t => deshacerTendido({ idRollo: r.idRollo, motivo: 'Rollo equivocado', actor: ACTOR, transaction: t }));
    assert.equal((await InsumoRollo.findByPk(r.idRollo)).estado, 'sin_tender');
    const t1 = new Date(t0.getTime() + 10 * HORA);
    await enTx(t => tenderRollos({ idMaterial: tela.idMaterial, idsRollo: [r.idRollo], actor: ACTOR, transaction: t, ahora: t1 }));
    assert.equal(new Date((await InsumoRollo.findByPk(r.idRollo)).listoDesde).getTime(), t1.getTime() + 48 * HORA);
});

test('dos tendidos del mismo rollo a la vez: uno solo gana', async () => {
    const tela = await nuevaTela();
    const [r] = await comprarRollos(tela, ['120']);
    const intentos = await Promise.allSettled([1, 2].map(() =>
        enTx(t => tenderRollos({ idMaterial: tela.idMaterial, idsRollo: [r.idRollo], actor: ACTOR, transaction: t }))));
    assert.equal(intentos.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(await InsumoRolloEstado.count({ where: { idRollo: r.idRollo, accion: 'tendido' } }), 1);
});

test('una salida por ajuste sale del rollo elegido y de SU capa, no de la más vieja', async () => {
    const tela = await nuevaTela();
    const [viejo] = await comprarRollos(tela, ['100'], 40);
    const [nuevo] = await comprarRollos(tela, ['100'], 60);
    await enTx(t => salidaDeRollo({ idMaterial: tela.idMaterial, idRollo: nuevo.idRollo, cantidad: '2500', motivo: 'Mancha', actor: ACTOR, transaction: t }));
    assert.equal(Number((await InsumoCapa.findByPk(viejo.idCapa)).cantidadDisponible), 10000);   // intacta
    assert.equal(Number((await InsumoCapa.findByPk(nuevo.idCapa)).cantidadDisponible), 7500);
    assert.equal(Number((await InsumoRollo.findByPk(nuevo.idRollo)).metrajeActualCm), 7500);
    // Más de lo que tiene el rollo, no.
    await assert.rejects(() => enTx(t => salidaDeRollo({ idMaterial: tela.idMaterial, idRollo: nuevo.idRollo, cantidad: '8000', motivo: 'x', actor: ACTOR, transaction: t })), /no pueden salir más/);
    // Lo que queda, sí: el rollo pasa a agotado.
    await enTx(t => salidaDeRollo({ idMaterial: tela.idMaterial, idRollo: nuevo.idRollo, cantidad: '7500', motivo: 'Se dañó', actor: ACTOR, transaction: t }));
    assert.equal((await InsumoRollo.findByPk(nuevo.idRollo)).estado, 'agotado');
});

test('la recepción de una tela por rollo exige un metraje por rollo y rollos enteros', () => {
    const detalle = { idDetalleOrdenCompra: 1, nombreMaterial: 'Mallatex', unidadCompra: 'rollo', material: { tipo: 'materia_prima', unidadConsumo: 'cm' } };
    let r = validarRecepcionOrden({ lineas: [{ idDetalleOrdenCompra: 1, cantidadLlega: '2', rollos: ['212'] }] }, [detalle]);
    assert.match(r.errores[0].mensaje, /cada uno de los 2 rollos/);
    r = validarRecepcionOrden({ lineas: [{ idDetalleOrdenCompra: 1, cantidadLlega: '1.5', rollos: ['212'] }] }, [detalle]);
    assert.match(r.errores[0].mensaje, /enteros/);
    r = validarRecepcionOrden({ lineas: [{ idDetalleOrdenCompra: 1, cantidadLlega: '2', rollos: ['212', '259.6'] }] }, [detalle]);
    assert.equal(r.datos.lineas[0].totalCm.toString(), '47160');
    assert.deepEqual(r.datos.lineas[0].metrajesCm.map(String), ['21200', '25960']);
});

test('la bitácora de rollos no se edita ni se borra', async () => {
    const fila = await InsumoRolloEstado.findOne();
    await assert.rejects(() => db.query('UPDATE INSUMOS_ROLLOS_ESTADOS SET motivo = "x" WHERE idRegistro = :id', { replacements: { id: fila.idRegistro } }), /append-only/);
    await assert.rejects(() => db.query('DELETE FROM INSUMOS_ROLLOS_ESTADOS WHERE idRegistro = :id', { replacements: { id: fila.idRegistro } }), /append-only/);
});
