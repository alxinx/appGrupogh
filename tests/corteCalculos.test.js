import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularOrden, unidadesReferencia } from '../src/js/corteCalculos.js';

// La guía de corte es el checklist con el que el cortador verifica lo que cortó: si un total
// sale mal, sobra o falta tela. Estos son los números de la orden de ejemplo.

const p = (nombre, cantidad = 1, dimension = '') => ({ nombre, cantidad, dimension });

const ORDEN_EJEMPLO = {
    referencias: [
        { codigo: '0438', nombre: 'Body Dulce', tallas: ['UNICA'], veces: 3, materiales: [
            { nombre: 'Polilicra', piezas: [p('Frente'), p('Espalda')] },
            { nombre: 'Forro',     piezas: [p('Forro frente'), p('Tira sesgo', 3, '3cm × Ancho')] }
        ] },
        { codigo: '0085', nombre: 'Blusa Paris', tallas: ['UNICA'], veces: 3, materiales: [
            { nombre: 'Polilicra', piezas: [p('Frente'), p('Espalda'), p('Mangas')] },
            { nombre: 'Forro',     piezas: [p('Forro frente')] },
            { nombre: 'RIB',       piezas: [p('Cuello')] }
        ] },
        { codigo: '0389', nombre: 'Top Daniela', tallas: ['UNICA'], veces: 3, materiales: [
            { nombre: 'Polilicra', piezas: [p('Frente'), p('Espalda'), p('Copa', 2)] }
        ] }
    ]
};

test('orden de ejemplo: 3 referencias, 9 prendas, 45 piezas', () => {
    const o = calcularOrden(ORDEN_EJEMPLO);
    assert.equal(o.totalReferencias, 3);
    assert.equal(o.totalPrendas, 9);
    assert.equal(o.totalPiezas, 45);
    assert.deepEqual(o.referencias.map(r => [r.unidades, r.totalPiezas]), [[3, 18], [3, 15], [3, 12]]);
});

test('cada pieza se multiplica por su cantidad y por las unidades', () => {
    const body = calcularOrden(ORDEN_EJEMPLO).referencias[0];
    const forro = body.materiales[1];
    assert.equal(forro.piezasPorPrenda, 4);
    assert.equal(forro.totalPiezas, 12);
    assert.deepEqual(forro.piezas.map(x => x.total), [3, 9]);
});

test('unidades = tallas marcadas × veces por talla', () => {
    assert.equal(unidadesReferencia({ tallas: ['S', 'M', 'L'], veces: 2 }), 6);
    assert.equal(unidadesReferencia({ tallas: ['S', 'S'], veces: 2 }), 2);   // talla repetida cuenta una vez
    assert.equal(unidadesReferencia({ tallas: [], veces: 5 }), 0);
});

test('valores inválidos no producen NaN ni negativos', () => {
    const o = calcularOrden({ referencias: [{ tallas: ['M'], veces: -4, materiales: [
        { nombre: 'X', piezas: [p('Frente', 'abc'), p('Espalda', 0)] }
    ] }] });
    assert.equal(o.totalPrendas, 0);
    assert.equal(o.totalPiezas, 0);
    assert.equal(o.referencias[0].materiales[0].piezasPorPrenda, 2); // cantidad mínima 1
});

test('no muta la orden recibida', () => {
    const copia = structuredClone(ORDEN_EJEMPLO);
    calcularOrden(ORDEN_EJEMPLO);
    assert.deepEqual(ORDEN_EJEMPLO, copia);
});
