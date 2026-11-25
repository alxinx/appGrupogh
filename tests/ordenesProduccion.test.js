import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prepararBaseDePrueba, cerrarBase, crearEmpleadoConUsuario, llamar } from './bdPrueba.js';
import db from '../config/bd.js';
import {
    Material, Atributos, FichaConfeccion, FichaConfeccionDxf, FichaConfeccionInsumo, FichaConfeccionMolde, Familia,
    OrdenProduccion, OrdenProduccionEstado
} from '../models/index.js';
import { registrarEntrada } from '../helpers/inventarioInsumos.js';
import { dec } from '../helpers/unidadesInsumo.js';
import { fechaHoyBogota } from '../helpers/fechas.js';
import {
    necesidadesDeOrdenes, compararConDisponible, claveNecesidad, tallasDeFicha, validarOrdenBody, revisarMaterial
} from '../helpers/ordenesProduccion.js';
import { migrarOrdenesProduccion } from '../seed/migracionOrdenesProduccion.js';
import {
    crearOrdenProduccion, actualizarOrdenProduccion, confirmarOrdenProduccion, cancelarOrdenProduccion
} from '../controller/ordenProduccionController.js';

// Orden de producción (CLAUDE.md §6.2). Lo que no puede fallar: la cuenta de lo que
// necesita, que el aviso descuente lo comprometido por otras órdenes en curso, y que dos
// clics a la vez no confirmen ni cancelen dos veces.

const ACTOR = { origen: 'panel', idUsuario: null, nombreUsuario: 'test', empleado: null };
const TALLAS = tallasDeFicha(['Talla S', 'Talla M']);
const manana = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 2); return fechaHoyBogota(d); };
let codigo = 7000;
let usuario, ficha, negro, blanco;

const nuevoMaterial = () => Material.create({ codigoMaterial: String(++codigo), nombre: `Insumo ${codigo}`, tipo: 'insumo', unidadConsumo: 'cm' });
const entrar = (idMaterial, cantidad, idAtributoColor = null) =>
    db.transaction(transaction => registrarEntrada({ idMaterial, idAtributoColor, cantidad, costoUnitario: 1, actor: ACTOR, transaction }));
const req = (body = {}, params = {}) => ({ usuario: { idUsuario: usuario.idUsuario, nombreUsuario: 'Prueba' }, body, params });

before(async () => {
    await prepararBaseDePrueba();
    await migrarOrdenesProduccion();   // triggers + secuencia (el clon solo copia tablas)
    usuario = await crearEmpleadoConUsuario({ conEmpleado: false });
    // Una ficha terminada (con molde y familia): sin eso la orden no se confirma.
    const familia = await Familia.create({ nombreFamilia: `BODY PRUEBA ${randomUUID().slice(0, 4)}` });
    const dxf = await FichaConfeccionDxf.create({ idUsuarioCarga: usuario.idUsuario, nombreOriginal: 'prueba.dxf', pesoBytes: 1, talla: ['Talla S', 'Talla M'], idFamiliaAsociada: familia.idFamilia });
    const molde = await FichaConfeccionMolde.create({ idUsuarioCarga: usuario.idUsuario, nombreOriginal: 'molde.jpg', pesoBytes: 1, tipoArchivo: 'jpg', objectKey: 'moldes/prueba.jpg', shaHash: 'x' });
    ficha = await FichaConfeccion.create({
        idUsuarioCreacion: usuario.idUsuario, idDxf: dxf.idArchivoDxf, idMolde: molde.idMolde, referencia: 'BODY PRUEBA',
        materialNombre: 'Polilicra', precioConfeccion: 5000, cantidadTotal: 0
    });
    [negro, blanco] = await Promise.all([
        Atributos.create({ tipo: 'COLOR', valor: `Negro ${randomUUID().slice(0, 4)}`, codigo1: '#000000' }),
        Atributos.create({ tipo: 'COLOR', valor: `Blanco ${randomUUID().slice(0, 4)}`, codigo1: '#ffffff' })
    ]);
});
after(cerrarBase);

// ── Cálculo puro ─────────────────────────────────────────────────────────────────────────

test('tallas del DXF en el orden del catálogo; sin graduación es talla única', () => {
    assert.deepEqual(tallasDeFicha(['Talla L', 'Talla S']).map(t => t.codigo), ['S', 'L']);
    assert.deepEqual(tallasDeFicha(['Talla Única']).map(t => t.codigo), ['UNICA']);
    assert.deepEqual(tallasDeFicha(null).map(t => t.codigo), ['UNICA']);
});

test('sin color se cuenta junto; con color, cada color de prenda suma a su color de insumo', () => {
    const n = necesidadesDeOrdenes([{
        cantidades: [{ idAtributoColor: 1, cantidad: 10 }, { idAtributoColor: 1, cantidad: 6 }, { idAtributoColor: 2, cantidad: 4 }],
        insumos: [
            { idMaterial: 'etiqueta', cantidadPorPrenda: '1', colores: [] },
            { idMaterial: 'resorte', cantidadPorPrenda: '2.5', colores: [{ idAtributoColorPrenda: 1, idAtributoColorInsumo: 9 }, { idAtributoColorPrenda: 2, idAtributoColorInsumo: 8 }] }
        ]
    }]);
    assert.equal(n.get(claveNecesidad('etiqueta', null)).necesario.toString(), '20');
    assert.equal(n.get(claveNecesidad('resorte', 9)).necesario.toString(), '40');   // 16 × 2,5
    assert.equal(n.get(claveNecesidad('resorte', 8)).necesario.toString(), '10');   // 4 × 2,5
});

test('el aviso descuenta lo que piden otras órdenes en curso', () => {
    const necesidades = new Map([[claveNecesidad('m', null), { idMaterial: 'm', idAtributoColor: null, necesario: dec(30) }]]);
    const disponibles = new Map([['m', { total: dec(50), porColor: new Map([[null, dec(50)]]) }]]);
    const sinOtras = compararConDisponible({ necesidades, disponibles, comprometidas: new Map() });
    assert.equal(sinOtras[0].estado, 'alcanza');

    const comprometidas = new Map([[claveNecesidad('m', 3), { idMaterial: 'm', idAtributoColor: 3, necesario: dec(40) }]]);
    const [l] = compararConDisponible({ necesidades, disponibles, comprometidas });
    assert.equal(l.estado, 'falta');
    assert.equal(l.faltante, '20.0000');   // 30 − (50 − 40)
});

test('sin nada en bodega es "sin existencia", no "falta"', () => {
    const necesidades = new Map([[claveNecesidad('m', 5), { idMaterial: 'm', idAtributoColor: 5, necesario: dec(1) }]]);
    const disponibles = new Map([['m', { total: dec(100), porColor: new Map([[7, dec(100)]]) }]]);   // hay, pero de otro color
    const [l] = compararConDisponible({ necesidades, disponibles, comprometidas: new Map() });
    assert.equal(l.estado, 'sin_existencia');
    assert.equal(l.faltante, '1.0000');
});

// ── Validación ───────────────────────────────────────────────────────────────────────────

test('rechaza fecha pasada, orden vacía y talla que no es de la ficha', async () => {
    const ayer = fechaHoyBogota(new Date(Date.now() - 2 * 86400000));
    let r = await validarOrdenBody({ fechaRequerida: ayer, cantidades: [{ idAtributoColor: negro.idAtributo, talla: 'S', cantidad: 5 }] }, { tallas: TALLAS });
    assert.ok(r.errores.fechaRequerida);
    r = await validarOrdenBody({ fechaRequerida: manana(), cantidades: [] }, { tallas: TALLAS });
    assert.ok(r.errores.cantidades);
    r = await validarOrdenBody({ fechaRequerida: manana(), cantidades: [{ idAtributoColor: negro.idAtributo, talla: 'XL', cantidad: 5 }] }, { tallas: TALLAS });
    assert.ok(r.errores.cantidades);
});

test('un insumo con colores exige el color para cada color de la prenda; sin colores se ignoran', async () => {
    const resorte = await nuevoMaterial();
    const etiqueta = await nuevoMaterial();
    await entrar(resorte.idMaterial, 100, negro.idAtributo);   // ahora maneja colores
    const base = {
        fechaRequerida: manana(),
        cantidades: [{ idAtributoColor: negro.idAtributo, talla: 'S', cantidad: 5 }, { idAtributoColor: blanco.idAtributo, talla: 'M', cantidad: 3 }]
    };

    let r = await validarOrdenBody({ ...base, insumos: [{ idMaterial: resorte.idMaterial, cantidadPorPrenda: '2', colores: [{ idAtributoColorPrenda: negro.idAtributo, idAtributoColorInsumo: negro.idAtributo }] }] }, { tallas: TALLAS });
    assert.match(r.errores.insumos, /maneja colores/);

    r = await validarOrdenBody({ ...base, insumos: [
        { idMaterial: resorte.idMaterial, cantidadPorPrenda: '2', colores: [{ idAtributoColorPrenda: negro.idAtributo, idAtributoColorInsumo: negro.idAtributo }, { idAtributoColorPrenda: blanco.idAtributo, idAtributoColorInsumo: blanco.idAtributo }] },
        { idMaterial: etiqueta.idMaterial, cantidadPorPrenda: '1', colores: [{ idAtributoColorPrenda: negro.idAtributo, idAtributoColorInsumo: negro.idAtributo }] }
    ] }, { tallas: TALLAS });
    assert.ok(r.datos, JSON.stringify(r.errores));
    assert.equal(r.datos.insumos[0].colores.length, 2);
    assert.equal(r.datos.insumos[1].colores.length, 0);   // la etiqueta no maneja colores
    assert.equal(r.datos.insumos[0].cantidadPorPrenda, '2.0000');
});

// ── Flujo completo ───────────────────────────────────────────────────────────────────────

test('crear, revisar contra otra en curso, confirmar dos veces a la vez, y cancelar', async () => {
    const hilo = await nuevoMaterial();
    await entrar(hilo.idMaterial, 100);
    await FichaConfeccionInsumo.create({ idFicha: ficha.idFicha, idMaterial: hilo.idMaterial, nombreMaterial: hilo.nombre, cantidad: 3, orden: 1 });

    const cuerpo = (n) => ({
        idFicha: ficha.idFicha, fechaRequerida: manana(), notas: '',
        cantidades: [{ idAtributoColor: negro.idAtributo, talla: 'S', cantidad: n }],
        insumos: [{ idMaterial: hilo.idMaterial, cantidadPorPrenda: '3', colores: [] }]
    });

    // Orden A: 20 prendas × 3 = 60 de hilo. Se confirma: queda comprometida.
    const a = await llamar(crearOrdenProduccion, req(cuerpo(20)));
    assert.equal(a.statusCode, 201, JSON.stringify(a.body));
    assert.match(a.body.numeroProduccion, /^OP-\d+$/);
    const idA = a.body.idOrdenProduccion;

    const [c1, c2] = await Promise.all([
        llamar(confirmarOrdenProduccion, req({}, { idOrdenProduccion: idA })),
        llamar(confirmarOrdenProduccion, req({}, { idOrdenProduccion: idA }))
    ]);
    assert.deepEqual([c1.statusCode, c2.statusCode].sort(), [200, 409]);
    assert.equal(await OrdenProduccionEstado.count({ where: { idOrdenProduccion: idA, accion: 'confirmada' } }), 1);

    // Una orden en curso ya no se edita.
    const ed = await llamar(actualizarOrdenProduccion, req(cuerpo(1), { idOrdenProduccion: idA }));
    assert.equal(ed.statusCode, 409);

    // Orden B: 15 × 3 = 45. Hay 100, A compromete 60 → libres 40 → faltan 5.
    const b = await llamar(crearOrdenProduccion, req(cuerpo(15)));
    const revB = await revisarMaterial({ idOrdenProduccion: b.body.idOrdenProduccion, cantidades: [{ idAtributoColor: negro.idAtributo, cantidad: 15 }], insumos: [{ idMaterial: hilo.idMaterial, cantidadPorPrenda: '3', colores: [] }] });
    assert.equal(revB.lineas[0].comprometido, '60.0000');
    assert.equal(revB.lineas[0].faltante, '5.0000');
    assert.equal(revB.conFaltante, 1);

    // La propia orden A no se cuenta como comprometida contra sí misma.
    const revA = await revisarMaterial({ idOrdenProduccion: idA, cantidades: [{ idAtributoColor: negro.idAtributo, cantidad: 20 }], insumos: [{ idMaterial: hilo.idMaterial, cantidadPorPrenda: '3', colores: [] }] });
    assert.equal(revA.lineas[0].estado, 'alcanza');

    // Cancelar exige motivo; una cancelada libera lo comprometido.
    assert.equal((await llamar(cancelarOrdenProduccion, req({ motivo: '' }, { idOrdenProduccion: idA }))).statusCode, 422);
    assert.equal((await llamar(cancelarOrdenProduccion, req({ motivo: 'El cliente la canceló' }, { idOrdenProduccion: idA }))).statusCode, 200);
    assert.equal((await OrdenProduccion.findByPk(idA)).estado, 'cancelada');
    const revB2 = await revisarMaterial({ idOrdenProduccion: b.body.idOrdenProduccion, cantidades: [{ idAtributoColor: negro.idAtributo, cantidad: 15 }], insumos: [{ idMaterial: hilo.idMaterial, cantidadPorPrenda: '3', colores: [] }] });
    assert.equal(revB2.lineas[0].estado, 'alcanza');
});

test('la bitácora de la orden no se edita ni se borra', async () => {
    const fila = await OrdenProduccionEstado.findOne();
    await assert.rejects(() => db.query('UPDATE ORDENES_PRODUCCION_ESTADOS SET motivo = "x" WHERE idRegistro = :id', { replacements: { id: fila.idRegistro } }), /append-only/);
    await assert.rejects(() => db.query('DELETE FROM ORDENES_PRODUCCION_ESTADOS WHERE idRegistro = :id', { replacements: { id: fila.idRegistro } }), /append-only/);
});

test('una ficha anulada no arma órdenes', async () => {
    await FichaConfeccion.update({ estado: 'anulada' }, { where: { idFicha: ficha.idFicha } });
    const r = await llamar(crearOrdenProduccion, req({ idFicha: ficha.idFicha, fechaRequerida: manana(), cantidades: [{ idAtributoColor: negro.idAtributo, talla: 'S', cantidad: 1 }] }));
    assert.equal(r.statusCode, 404);
    await FichaConfeccion.update({ estado: 'activa' }, { where: { idFicha: ficha.idFicha } });
});
