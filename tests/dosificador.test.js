import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularKitting } from '../src/js/dosificador.js';

// El reparto de una dosificación es cálculo puro: no toca la base, así que estos tests
// corren sin sembrar nada. Lo que se fija acá es lo que el operario da por sentado cuando
// abre una bolsa del lote, más los bordes que llegan por el body del endpoint.

const CAP = 12;

// El lote real que destapó el problema: 15 variaciones, 4.344 unidades, 362 bolsas exactas.
const LOTE = [323, 264, 125, 357, 288, 473, 246, 431, 242, 127, 319, 313, 184, 364, 288];
const productosDe = (cantidades) => Object.fromEntries(cantidades.map((q, i) => [`P${i + 1}`, q]));

// Expande el plan agrupado ("8 bolsas así") a la lista de bolsas.
const bolsasDe = (productos, capacidad = CAP) =>
    calcularKitting(productos, capacidad).packs.flatMap(g =>
        Array.from({ length: g.cantidad }, () => g.detalle));

const unidadesDe = (bolsa) => Object.values(bolsa).reduce((a, b) => a + b, 0);
const sumar = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

test('toda bolsa completa suma exactamente la capacidad', () => {
    const bolsas = bolsasDe(productosDe(LOTE));
    assert.equal(bolsas.length, 362);
    bolsas.forEach((b, i) => assert.equal(unidadesDe(b), CAP, `la bolsa ${i + 1} no lleva ${CAP} unidades`));
});

test('lo empacado de cada producto más su sobrante es lo que se pidió', () => {
    const productos = productosDe(LOTE);
    const { residuo } = calcularKitting(productos, CAP);
    const empacado = {};
    bolsasDe(productos).forEach(b => Object.entries(b).forEach(([id, c]) => {
        empacado[id] = (empacado[id] || 0) + c;
    }));

    Object.entries(productos).forEach(([id, pedido]) =>
        assert.equal((empacado[id] || 0) + (residuo[id] || 0), pedido, `${id} no cuadra`));
});

// El invariante que el reparto anterior no cumplía: metía 2 unidades de un producto que no
// llega ni a 1 por bolsa, y dejaba a otro fuera de 14 bolsas.
test('cada producto va piso o techo en TODAS las bolsas', () => {
    const productos = productosDe(LOTE);
    const bolsas = bolsasDe(productos);
    const B = bolsas.length;

    Object.entries(productos).forEach(([id, q]) => {
        const piso = Math.floor(q / B);
        const techo = Math.ceil(q / B);
        bolsas.forEach((b, i) => {
            const c = b[id] || 0;
            assert.ok(c === piso || c === techo,
                `${id} (${q} u.) lleva ${c} en la bolsa ${i + 1}; solo puede llevar ${piso} o ${techo}`);
        });
    });
});

test('el lote de prueba da exactamente el reparto esperado', () => {
    const bolsas = bolsasDe(productosDe(LOTE));
    const bolsasCon = (id, cant) => bolsas.filter(b => (b[id] || 0) === cant).length;

    assert.equal(bolsasCon('P6', 2), 111, 'P6 (473 u.) debe ir 2 veces en 111 bolsas');
    assert.equal(bolsasCon('P8', 2), 69, 'P8 (431 u.) debe ir 2 veces en 69 bolsas');
    assert.equal(bolsasCon('P14', 2), 2, 'P14 (364 u.) debe ir 2 veces en 2 bolsas');

    // Los demás, como mucho una vez por bolsa.
    ['P1', 'P2', 'P3', 'P4', 'P5', 'P7', 'P9', 'P10', 'P11', 'P12', 'P13', 'P15'].forEach(id =>
        bolsas.forEach(b => assert.ok((b[id] || 0) <= 1, `${id} apareció ${b[id]} veces en una bolsa`)));
});

test('con más variaciones que unidades por bolsa nadie queda fuera del lote', () => {
    // 15 productos en bolsas de 12: ninguna bolsa puede traerlos todos, pero todos tienen
    // que entrar en el lote.
    const productos = productosDe(LOTE);
    const bolsas = bolsasDe(productos);

    Object.keys(productos).forEach(id =>
        assert.ok(bolsas.some(b => b[id] > 0), `${id} no entró en ninguna bolsa`));
    bolsas.forEach(b => assert.ok(Object.keys(b).length <= CAP,
        'una bolsa no puede traer más referencias que unidades'));
});

test('un total que no es múltiplo de la capacidad deja el resto en el sobrante', () => {
    // 4.344 + 7 = 4.351: 362 bolsas y 7 unidades sueltas.
    const productos = productosDe([...LOTE.slice(0, 14), LOTE[14] + 7]);
    const total = sumar(productos);
    const { residuo } = calcularKitting(productos, CAP);
    const bolsas = bolsasDe(productos);

    assert.equal(total % CAP, 7);
    assert.equal(bolsas.length, Math.floor(total / CAP));
    assert.equal(sumar(residuo), 7, 'el sobrante tiene que ser exactamente el resto');
    bolsas.forEach(b => assert.equal(unidadesDe(b), CAP));
});

test('el sobrante se elige por proporción y no cortando la cola de la lista', () => {
    // 1.007 unidades → 83 bolsas y 11 sueltas. Cortar la secuencia por donde termina dejaría
    // al último producto entero en el sobrante: sus 7 unidades no entrarían en ninguna bolsa.
    const productos = { GRANDE: 1000, ULTIMO: 7 };
    const { residuo } = calcularKitting(productos, CAP);

    assert.equal(sumar(residuo), 11);
    assert.ok(!residuo.ULTIMO, `el último de la lista quedó fuera del empaque: ${JSON.stringify(residuo)}`);
});

test('lo empacado de cada producto no se aparta de su proporción en más de una unidad', () => {
    // Es la contracara de lo anterior: el sobrante queda repartido según el peso de cada
    // producto en el pedido, no concentrado en uno.
    const productos = { SOBRADO: 29, JUSTO_A: 24, JUSTO_B: 24 };  // 77 → 6 bolsas, sobran 5
    const total = sumar(productos);
    const empacables = Math.floor(total / CAP) * CAP;
    const { residuo } = calcularKitting(productos, CAP);

    assert.equal(sumar(residuo), total - empacables);
    Object.entries(productos).forEach(([id, q]) => {
        const empacado = q - (residuo[id] || 0);
        const ideal = (q * empacables) / total;
        assert.ok(Math.abs(empacado - ideal) < 1,
            `${id}: se empacaron ${empacado} y su proporción son ${ideal.toFixed(2)}`);
    });
});

test('menos variaciones que unidades por bolsa', () => {
    const productos = { A: 60, B: 36, C: 24 };  // 120 → 10 bolsas de 12
    const bolsas = bolsasDe(productos);

    assert.equal(bolsas.length, 10);
    bolsas.forEach(b => {
        assert.equal(unidadesDe(b), CAP);
        assert.equal(b.A, 6);   // 60/10, exacto en todas
    });
    bolsas.forEach(b => assert.ok([3, 4].includes(b.B), `B lleva ${b.B}`));
    bolsas.forEach(b => assert.ok([2, 3].includes(b.C), `C lleva ${b.C}`));
    assert.deepEqual(calcularKitting(productos, CAP).residuo, {});
});

test('un producto con más del doble de unidades que bolsas', () => {
    // A tiene 2,5 veces la cantidad de bolsas: tiene que ir 2 o 3 veces por bolsa, nunca 1.
    const productos = { A: 250, B: 100, C: 50 };  // 400 → 33 bolsas, sobran 4
    const bolsas = bolsasDe(productos);
    const B = bolsas.length;

    assert.equal(B, 33);
    const empacadoA = bolsas.reduce((acc, b) => acc + (b.A || 0), 0);
    const piso = Math.floor(empacadoA / B), techo = Math.ceil(empacadoA / B);
    assert.ok(piso >= 2, `A debería ir al menos 2 por bolsa, va ${piso}`);
    bolsas.forEach(b => assert.ok(b.A === piso || b.A === techo, `A lleva ${b.A} en una bolsa`));
});

test('el residuo nunca alcanza para otra bolsa', () => {
    const { residuo } = calcularKitting({ A: 137, B: 89, C: 41 }, CAP);
    assert.ok(sumar(residuo) < CAP, `el residuo (${sumar(residuo)}) da para otra bolsa`);
});

test('nunca se empaca más stock del que hay', () => {
    const productos = { A: 100, B: 7 };
    const empacado = {};
    bolsasDe(productos).forEach(b => Object.entries(b).forEach(([id, c]) => {
        empacado[id] = (empacado[id] || 0) + c;
    }));

    Object.entries(empacado).forEach(([id, c]) =>
        assert.ok(c <= productos[id], `se empacaron ${c} de ${id} y solo había ${productos[id]}`));
});

test('el mismo plan se calcula igual dos veces', () => {
    // La vista previa del formulario y el guardado corren esto por separado: si no fuera
    // determinista, el operario vería un plan y se guardaría otro.
    const productos = { A: 137, B: 89, C: 41, D: 5 };
    assert.deepEqual(calcularKitting(productos, CAP), calcularKitting(productos, CAP));
});

test('una capacidad inválida falla en vez de colgar el proceso', () => {
    // capacidad 0 dejaba el bucle girando para siempre y, con Node de un solo hilo, la app
    // entera dejaba de responder.
    [0, -5, 12.5, null, undefined, 'doce', NaN].forEach(valor =>
        assert.throws(() => calcularKitting({ A: 100 }, valor), /capacidad de la bolsa/,
            `capacidad ${JSON.stringify(valor)} no fue rechazada`));

    assert.doesNotThrow(() => calcularKitting({ A: 100 }, '12'), 'un entero como texto es válido');
});

test('sin stock suficiente para una bolsa, todo queda en el residuo', () => {
    const r = calcularKitting({ A: 3, B: 2 }, CAP);
    assert.equal(r.packs.length, 0);
    assert.deepEqual(r.residuo, { A: 3, B: 2 });
});
