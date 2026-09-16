import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { QueryTypes } from 'sequelize';
import { prepararBaseDePrueba, cerrarBase } from './bdPrueba.js';
import db from '../config/bd.js';
import { digitoVerificadorEan13, siguienteSkuInterno } from '../helpers/productos.js';

before(prepararBaseDePrueba);
after(cerrarBase);

const valorDelContador = async () => {
    const [fila] = await db.query("SELECT valor FROM SECUENCIAS WHERE nombre = 'sku_producto'", { type: QueryTypes.SELECT });
    return fila ? Number(fila.valor) : null;
};

// EAN-13 reales, tomados de productos de góndola: si el algoritmo estuviera invertido
// (pesos 3,1 en vez de 1,3) estos tres no darían el dígito que traen impreso.
test('el dígito verificador coincide con EAN-13 reales', () => {
    assert.equal(digitoVerificadorEan13('400638133393'), '1');
    assert.equal(digitoVerificadorEan13('590123412345'), '7');
    assert.equal(digitoVerificadorEan13('978020137962'), '4');
});

test('un múltiplo exacto de 10 cierra en 0 y no en 10', () => {
    // 000000000000 suma 0: (10 - 0 % 10) % 10 tiene que dar '0', no '10'.
    assert.equal(digitoVerificadorEan13('000000000000'), '0');
});

test('el SKU generado son 13 dígitos, con prefijo interno y verificador válido', async () => {
    const sku = await db.transaction((t) => siguienteSkuInterno(t));

    assert.match(sku, /^\d{13}$/);
    assert.ok(sku.startsWith('200'), `esperaba prefijo interno 200, llegó ${sku}`);
    assert.equal(sku.slice(-1), digitoVerificadorEan13(sku.slice(0, 12)));
});

test('el contador avanza de a uno y el correlativo va dentro del código', async () => {
    const antes = await valorDelContador();
    const sku = await db.transaction((t) => siguienteSkuInterno(t));

    assert.equal(await valorDelContador(), antes + 1);
    assert.equal(Number(sku.slice(3, 12)), antes + 1);
});

test('el número se libera si la transacción se revierte', async () => {
    const antes = await valorDelContador();

    await assert.rejects(db.transaction(async (t) => {
        await siguienteSkuInterno(t);
        throw new Error('la transacción del alta falló después de pedir el código');
    }));

    // Sin esto se saltaría un correlativo por cada alta que falla a mitad de camino.
    assert.equal(await valorDelContador(), antes);
});

test('20 altas simultáneas reciben 20 códigos distintos', async () => {
    const antes = await valorDelContador();
    const skus = await Promise.all(
        Array.from({ length: 20 }, () => db.transaction((t) => siguienteSkuInterno(t)))
    );

    assert.equal(new Set(skus).size, 20, 'dos altas concurrentes recibieron el mismo código');
    assert.equal(await valorDelContador(), antes + 20);
    skus.forEach(sku => assert.equal(sku.slice(-1), digitoVerificadorEan13(sku.slice(0, 12))));
});

test('sin la fila en SECUENCIAS el alta falla en vez de inventar un código', async () => {
    await db.query("DELETE FROM SECUENCIAS WHERE nombre = 'sku_producto'");
    try {
        await assert.rejects(
            db.transaction((t) => siguienteSkuInterno(t)),
            /no existe en SECUENCIAS/
        );
    } finally {
        await db.query("INSERT INTO SECUENCIAS (nombre, valor) VALUES ('sku_producto', 0)");
    }
});
