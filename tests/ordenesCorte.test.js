import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { prepararBaseDePrueba, cerrarBase, crearEmpleadoConUsuario } from './bdPrueba.js';
import db from '../config/bd.js';
import {
    Material, Atributos, Familia, FichaConfeccion, FichaConfeccionDxf, FichaConfeccionDxfPieza, FichaConfeccionMolde,
    FichaConfeccionInsumo, FichaConfeccionVideo, InsumoRollo, InsumoCapa, OrdenCorte, OrdenCorteEstado, OrdenProduccion, OrdenProduccionCantidad
} from '../models/index.js';
import { registrarEntrada } from '../helpers/inventarioInsumos.js';
import { crearRollos, tenderRollos, metrajesDesdeMetros } from '../helpers/rollosTela.js';
import { dec } from '../helpers/unidadesInsumo.js';
import { fechaHoyBogota } from '../helpers/fechas.js';
import {
    leerTrazo, referenciasDeTrazo, preguntasEspejo, aplicarEspejos, resultadoReferencia, recetaDeDxf, dxfDeReferencia, prendasPorCapa, recetaDeTela
} from '../helpers/trazo.js';
import {
    analizarTrazo, validarCorte, crearOrdenCorte, registrarCorte, cantidadesDeCorte, repartirPorPeso, promoverFichaSiCompleta
} from '../helpers/ordenesCorte.js';
import { pdfOrdenCorte } from '../helpers/ordenCortePdf.js';
import { PassThrough } from 'stream';
import { migrarRollosTela } from '../seed/migracionRollosTela.js';
import { migrarOrdenesProduccion } from '../seed/migracionOrdenesProduccion.js';
import { migrarOrdenesCorte } from '../seed/migracionOrdenesCorte.js';

// Orden de corte desde el trazo (decidido con el dueño el 2026-11-21). El trazo real de
// prueba (tests/fixtures/trazo-tres-referencias.dxf, "alejo emvoar.dxf") trae tres
// referencias en Mallatex (código 1), 618 × 140 cm:
//   REF 0213 BODY ROMA   3 espaldas + 3 frentes por capa  → 3 prendas completas
//   REF 0172 BODY SEUL   10 espaldas + 20 mangas, sin frente
//   REF 0395 BODY AGATA  "@MANGA" y "MANGA" (1XT cada una: dos piezas distintas, como está hoy
//                        en Optitex; el archivo original traía 2XT de antes de la regla)

const TRAZO = readFileSync(new URL('./fixtures/trazo-tres-referencias.dxf', import.meta.url));
// Exportado con la regla de Optitex (wiki): "Quality: 2XT" y "Annotation: BODY".
const TRAZO_CALIDAD = readFileSync(new URL('./fixtures/trazo-calidad-optitex.dxf', import.meta.url), 'utf8');
const FICHA_ROMA = readFileSync(new URL('./fixtures/ficha-body-roma.dxf', import.meta.url), 'utf8');
const FICHA_AUTOCAD = readFileSync(new URL('./fixtures/ficha-autocad-mtext.dxf', import.meta.url), 'utf8');
const ROMA = 'REF 0213 BODY ROMA', SEUL = 'REF 0172 BODY SEUL', AGATA = 'REF 0395 BODY AGATA';
const ACTOR = { origen: 'panel', idUsuario: null, nombreUsuario: 'test', empleado: null };
const HORA = 3600 * 1000;
const sinSubir = async () => {};
const manana = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 2); return fechaHoyBogota(d); };

let usuario, tela, negro, blanco, rolloNegro, rolloBlanco, fichaRoma, moldeAgata, etiqueta, videoAgata;

// ── Lectura del trazo (puro) ─────────────────────────────────────────────────────────────

test('lee el trazo real: 40 piezas, 618 × 140 cm, tres referencias en la tela 1', () => {
    const l = leerTrazo(TRAZO.toString('utf8'));
    assert.equal(l.piezas.length, 40);
    assert.equal(l.sinEtiqueta, 0);
    assert.equal(Math.round(l.largoCm), 618);
    assert.equal(Math.round(l.anchoCm), 140);
    assert.deepEqual([...new Set(l.piezas.map(p => p.material))], ['1']);
    assert.deepEqual(referenciasDeTrazo(l.piezas).map(r => r.estilo), [SEUL, ROMA, AGATA]);
    assert.deepEqual(preguntasEspejo(l.piezas), [{ estilo: AGATA, pieza: 'MANGA' }]);
});

test('prendas por capa: ROMA da 3; SEUL contra una receta con frente no da ninguna', () => {
    const refs = new Map(referenciasDeTrazo(leerTrazo(TRAZO.toString('utf8')).piezas).map(r => [r.estilo, r]));
    assert.deepEqual(resultadoReferencia({ colocadas: refs.get(ROMA).piezas, receta: recetaDeDxf(FICHA_ROMA) }).porTalla, { UNICA: 3 });

    const recetaSeul = [{ nombre: 'FRENTE', talla: 'M', porPrenda: 1 }, { nombre: 'ESPALDA', talla: 'M', porPrenda: 1 }, { nombre: 'MANGA', talla: 'M', porPrenda: 2 }];
    const seul = resultadoReferencia({ colocadas: refs.get(SEUL).piezas, receta: recetaSeul });
    assert.equal(seul.prendasPorCapa, 0);
    assert.deepEqual(seul.faltantes, [{ nombre: 'FRENTE', talla: 'M' }]);
    assert.equal(seul.necesitaDecision, true);
    // Sin receta, las piezas del trazo son la prenda: 10 (sobran 10 mangas).
    const sola = prendasPorCapa(refs.get(SEUL).piezas, refs.get(SEUL).piezas);
    assert.deepEqual(sola.porTalla, { M: 10 });
    assert.deepEqual(sola.sobrantes, [{ nombre: 'MANGA', talla: 'M', cantidad: 10 }]);
});

test('"@MANGA" cuenta con "MANGA" solo si el operador dice que es su espejo', () => {
    // La ficha de AGATA pide 2 mangas por prenda y no conoce "@MANGA".
    const receta = [
        { nombre: 'MANGA', talla: 'UNICA', porPrenda: 2 },
        { nombre: 'ESPALDA SUPERIOR MAYA', talla: 'UNICA', porPrenda: 1 },
        { nombre: 'FRENTE SUPERIOR MAYA', talla: 'UNICA', porPrenda: 1 }
    ];
    const agata = (texto, espejos) => {
        const ref = referenciasDeTrazo(aplicarEspejos(leerTrazo(texto).piezas, espejos)).find(r => r.estilo === AGATA);
        return resultadoReferencia({ colocadas: ref.piezas, receta });
    };
    const espejo = new Set([`${AGATA}|MANGA`]);
    // "@MANGA" es otra pieza con su Calidad: 1XT + 1XT = 2 por prenda.
    assert.equal(agata(TRAZO.toString('utf8'), espejo).prendasPorCapa, 1);
    const no = agata(TRAZO.toString('utf8'), new Set());
    assert.equal(no.prendasPorCapa, 0);           // una manga sola, y la ficha pide 2
    assert.equal(no.necesitaDecision, true);
    // Tres MANGA y tres @MANGA, 1XT cada una: con la ficha, que pide 2, salen 3 y no sobra nada.
    assert.equal(agata(TRAZO_CALIDAD, espejo).prendasPorCapa, 3);
    assert.deepEqual(agata(TRAZO_CALIDAD, espejo).sueltas, []);
});

test('ROMA3: las tres referencias dan 3 prendas por capa y no sobra nada (SEUL con Par en la manga, AGATA con @MANGA)', () => {
    const l = leerTrazo(readFileSync(new URL('./fixtures/trazo-roma3.dxf', import.meta.url), 'utf8'));
    const espejos = new Set(preguntasEspejo(l.piezas).map(e => `${e.estilo}|${e.pieza}`));
    for (const ref of referenciasDeTrazo(aplicarEspejos(l.piezas, espejos))) {
        const r = resultadoReferencia({ colocadas: ref.piezas, receta: null });
        assert.equal(r.prendasPorCapa, 3, ref.estilo);
        assert.deepEqual(r.sueltas, [], ref.estilo);
    }
});

test('una prenda en dos materiales: el trazo de una tela solo compara las piezas de esa tela', () => {
    // SEUL: espalda y 2 mangas en el material 1; frente y sesgo en el 2.
    const receta = [
        { nombre: 'ESPALDA', talla: 'M', porPrenda: 1, material: '1' },
        { nombre: 'MANGA', talla: 'M', porPrenda: 2, material: '1' },
        { nombre: 'FRENTE', talla: 'M', porPrenda: 1, material: '2' },
        { nombre: 'SESGO', talla: 'M', porPrenda: 2, material: '2' }
    ];
    const enMallatex = recetaDeTela(receta, '1');
    assert.deepEqual(enMallatex.receta.map(r => r.nombre), ['ESPALDA', 'MANGA']);
    assert.deepEqual(enMallatex.otrosMateriales, ['2']);
    const trazo = [{ nombre: 'ESPALDA', talla: 'M', colocadas: 3 }, { nombre: 'MANGA', talla: 'M', colocadas: 6 }];
    const r = resultadoReferencia({ colocadas: trazo, receta: enMallatex.receta });
    assert.equal(r.prendasPorCapa, 3);
    assert.equal(r.necesitaDecision, false);
    // Una pieza sin material (ficha leída antes de guardarlo) va en cualquier tela; "1-23" = "1.23".
    assert.equal(recetaDeTela([{ nombre: 'X', talla: 'M', porPrenda: 1, material: null }], '2').receta.length, 1);
    assert.equal(recetaDeTela([{ nombre: 'X', talla: 'M', porPrenda: 1, material: '1.23' }], '1-23').receta.length, 1);
});

test('la "Calidad" de Optitex (Quality) dice cuántas de esa pieza lleva la prenda; la "Descripción" no cuenta', () => {
    const l = leerTrazo(TRAZO_CALIDAD);
    const refs = new Map(referenciasDeTrazo(l.piezas).map(r => [r.estilo, r]));
    assert.deepEqual(refs.get(SEUL).piezas.map(p => `${p.nombre} ${p.colocadas}/${p.porPrenda}`), ['ESPALDA 3/1', 'MANGA 6/2']);
    // Sin la ficha, SEUL da 3 prendas y no sobra ninguna manga (antes contaba 6).
    const seul = prendasPorCapa(refs.get(SEUL).piezas, refs.get(SEUL).piezas);
    assert.deepEqual(seul.porTalla, { M: 3 });
    assert.deepEqual(seul.sobrantes, []);
    assert.equal(Math.round(l.largoCm), 280);
});

test('el patrón de una referencia sale del trazo con una pieza de cada', () => {
    const l = leerTrazo(TRAZO.toString('utf8'));
    assert.deepEqual(recetaDeDxf(dxfDeReferencia(l, SEUL)).map(p => `${p.nombre}/${p.talla}`).sort(), ['ESPALDA/M', 'MANGA/M']);
});

test('un DXF vuelto a guardar en AutoCAD (LWPOLYLINE, MTEXT, "Style Name" al final) también se lee', () => {
    const receta = recetaDeDxf(FICHA_AUTOCAD);
    // "Size: TALLAS/M" es un patrón graduado: S y M.
    assert.deepEqual(receta.map(p => `${p.nombre}/${p.talla}×${p.porPrenda}`).sort(), ['ESPALDA/M×2', 'ESPALDA/S×2', 'FRENTE/M×2', 'FRENTE/S×2']);
});

test('cantidades = prendas por capa × capas de cada color; el reparto no pierde un centavo', () => {
    const c = cantidadesDeCorte({ UNICA: 3 }, [{ idAtributoColor: 1, capas: 2 }, { idAtributoColor: 2, capas: 1 }, { idAtributoColor: 1, capas: 4 }]);
    assert.deepEqual(c, [{ idAtributoColor: 1, talla: 'UNICA', cantidad: 18 }, { idAtributoColor: 2, talla: 'UNICA', cantidad: 3 }]);
    const partes = repartirPorPeso(dec('100000.01'), [dec(1), dec(1), dec(1)], 2);
    assert.equal(partes.reduce((s, p) => s.plus(p), dec(0)).toString(), '100000.01');
});

// ── Con base de datos ────────────────────────────────────────────────────────────────────

before(async () => {
    await prepararBaseDePrueba();
    await migrarRollosTela();
    await migrarOrdenesProduccion();
    await migrarOrdenesCorte();
    usuario = await crearEmpleadoConUsuario({ conEmpleado: false });
    tela = await Material.create({ codigoMaterial: '1', nombre: 'Mallatex', tipo: 'materia_prima', unidadCompra: 'rollo', unidadConsumo: 'cm' });
    [negro, blanco] = await Promise.all([
        Atributos.create({ tipo: 'COLOR', valor: `Negro ${randomUUID().slice(0, 4)}`, codigo1: '#000000' }),
        Atributos.create({ tipo: 'COLOR', valor: `Blanco ${randomUUID().slice(0, 4)}`, codigo1: '#ffffff' })
    ]);
    // Dos rollos tendidos hace tres días: listos para cortar.
    const comprar = (idAtributoColor, metros, costo) => db.transaction(async (transaction) => {
        const capa = await registrarEntrada({ idMaterial: tela.idMaterial, idAtributoColor, cantidad: dec(metros).times(100), costoUnitario: costo, actor: ACTOR, transaction });
        const [r] = await crearRollos({ capa, metrajesCm: metrajesDesdeMetros([metros]), actor: ACTOR, transaction });
        await tenderRollos({ idMaterial: tela.idMaterial, idsRollo: [r.idRollo], actor: ACTOR, transaction, ahora: new Date(Date.now() - 72 * HORA) });
        return r;
    });
    rolloNegro = await comprar(negro.idAtributo, '20', 50);      // caben 3 capas de 6,18 m
    rolloBlanco = await comprar(blanco.idAtributo, '10', 40);    // cabe 1

    // ROMA ya tiene ficha terminada, con sus piezas y un insumo.
    const familia = await Familia.create({ nombreFamilia: 'BODY ROMA MALLATEX' });
    const dxf = await FichaConfeccionDxf.create({
        idUsuarioCarga: usuario.idUsuario, nombreOriginal: 'REF 0213 BODY ROMA.dxf', pesoBytes: 1, estado: 'listo',
        estiloNombre: ROMA, talla: ['Talla Única'], idFamiliaAsociada: familia.idFamilia
    });
    await FichaConfeccionDxfPieza.bulkCreate(recetaDeDxf(FICHA_ROMA).map(p => ({ idArchivoDxf: dxf.idArchivoDxf, nombrePieza: p.nombre, talla: p.talla, porPrenda: p.porPrenda })));
    const molde = await FichaConfeccionMolde.create({ idUsuarioCarga: usuario.idUsuario, nombreOriginal: 'roma.jpg', pesoBytes: 1, tipoArchivo: 'jpg', objectKey: 'moldes/roma.jpg', shaHash: 'x' });
    fichaRoma = await FichaConfeccion.create({
        idUsuarioCreacion: usuario.idUsuario, idDxf: dxf.idArchivoDxf, idMolde: molde.idMolde, referencia: 'BODY ROMA MALLATEX',
        materialNombre: 'Mallatex', precioConfeccion: 4000, cantidadTotal: 0
    });
    etiqueta = await Material.create({ codigoMaterial: '900', nombre: 'Etiqueta', tipo: 'insumo', unidadConsumo: 'unidad' });
    videoAgata = await FichaConfeccionVideo.create({ idUsuarioCarga: usuario.idUsuario, nombreOriginal: 'agata.mp4', orden: 1, cloudflareVideoUid: 'uid-agata', estado: 'ready' });
    await FichaConfeccionInsumo.create({ idFicha: fichaRoma.idFicha, idMaterial: etiqueta.idMaterial, nombreMaterial: 'Etiqueta', cantidad: 1, orden: 1 });
    moldeAgata = await FichaConfeccionMolde.create({ idUsuarioCarga: usuario.idUsuario, nombreOriginal: 'agata.jpg', pesoBytes: 1, tipoArchivo: 'jpg', objectKey: 'moldes/agata.jpg', shaHash: 'y' });
});
after(cerrarBase);

const respuestas = (cambios = {}) => ({
    fechaRequerida: manana(),
    espejos: { [`${AGATA}|MANGA`]: true },
    referencias: {
        [SEUL]: { modo: 'despues', faltanPiezas: true, piezasSueltas: 'pendientes' },
        [AGATA]: {
            modo: 'ahora', nombreFamilia: 'BODY AGATA', idMolde: moldeAgata.idMolde, precioConfeccion: '3.500',
            insumos: [{ idMaterial: etiqueta.idMaterial, cantidad: 2 }], idsVideos: [videoAgata.idVideo], complementos: 'Elástico al asiento'
        }
    },
    rollos: [{ idRollo: rolloNegro.idRollo, capas: 2 }, { idRollo: rolloBlanco.idRollo, capas: 1 }],
    ...cambios
});

test('el análisis cruza cada referencia con la ficha de su Style Name y trae los rollos listos', async () => {
    const a = await analizarTrazo(TRAZO);
    assert.equal(a.tela.idMaterial, tela.idMaterial);
    const ficha = Object.fromEntries(a.referencias.map(r => [r.estilo, r.ficha?.idFicha ?? null]));
    assert.deepEqual(ficha, { [SEUL]: null, [ROMA]: fichaRoma.idFicha, [AGATA]: null });
    assert.deepEqual(a.rollos.map(r => [r.codigo, r.capasMax]).sort(), [[rolloBlanco.codigoRollo, 1], [rolloNegro.codigoRollo, 3]].sort());
});

test('no se arma el corte sin responder lo que el sistema no puede saber', async () => {
    const a = await analizarTrazo(TRAZO);
    const sin = async (cambios) => (await validarCorte(respuestas(cambios), a, usuario.idUsuario)).error;
    assert.match(await sin({ espejos: {} }), /espejo/);
    assert.match(await sin({ referencias: { [AGATA]: respuestas().referencias[AGATA] } }), /SEUL no tiene ficha/);
    assert.match(await sin({ referencias: { ...respuestas().referencias, [SEUL]: { modo: 'despues', faltanPiezas: true } } }), /qué hacer con ellas/);
    assert.match(await sin({ rollos: [{ idRollo: rolloBlanco.idRollo, capas: 2 }] }), /le caben 1 capa/);
    assert.match(await sin({ rollos: [] }), /al menos un rollo/);
    assert.match(await sin({ referencias: { ...respuestas().referencias, [SEUL]: { ...respuestas().referencias[AGATA], idsVideos: [videoAgata.idVideo] } } }), /mismo video está en dos fichas/);
    assert.match(await sin({ referencias: { ...respuestas().referencias, [AGATA]: { ...respuestas().referencias[AGATA], precioConfeccion: '99999999999999' } } }), /no puede pasar de/);
    const otro = await FichaConfeccionMolde.create({ idUsuarioCarga: (await crearEmpleadoConUsuario({ conEmpleado: false })).idUsuario, nombreOriginal: 'x.jpg', pesoBytes: 1, tipoArchivo: 'jpg', objectKey: 'moldes/x.jpg', shaHash: 'z' });
    assert.match(await sin({ referencias: { ...respuestas().referencias, [AGATA]: { modo: 'ahora', nombreFamilia: 'X', idMolde: otro.idMolde } } }), /no lo subiste tú/);
});

let idCorte;
test('crear el corte: fichas base para lo que no tenía, nada movido todavía', async () => {
    const a = await analizarTrazo(TRAZO);
    const { datos, error } = await validarCorte(respuestas(), a, usuario.idUsuario);
    assert.equal(error, undefined);
    const { orden, fichasNuevas } = await crearOrdenCorte({ buffer: TRAZO, nombreArchivo: 'alejo emvoar.dxf', analisis: a, datos, idUsuario: usuario.idUsuario, actor: ACTOR, subir: sinSubir });
    idCorte = orden.idOrdenCorte;
    assert.match(orden.numeroCorte, /^CT-\d+$/);
    assert.equal(fichasNuevas.length, 2);

    const nuevas = await FichaConfeccion.findAll({ where: { idFicha: fichasNuevas }, include: [{ model: FichaConfeccionDxf, as: 'dxf', include: [{ model: FichaConfeccionDxfPieza, as: 'piezas' }] }] });
    const porEstilo = Object.fromEntries(nuevas.map(f => [f.dxf.estiloNombre, f]));
    // SEUL quedó pendiente; AGATA se creó completa, con su familia y la manga espejo unida.
    assert.equal(porEstilo[SEUL].estado, 'pendiente');
    assert.equal(porEstilo[AGATA].estado, 'activa');
    assert.equal(porEstilo[AGATA].referencia, 'BODY AGATA');
    assert.equal(Number(porEstilo[AGATA].precioConfeccion), 3500);
    // Lo mismo que guarda el asistente: insumos por prenda, videos y textos.
    assert.equal(porEstilo[AGATA].complementos, 'Elástico al asiento');
    assert.deepEqual((await FichaConfeccionInsumo.findAll({ where: { idFicha: porEstilo[AGATA].idFicha }, raw: true })).map(i => i.cantidad), [2]);
    assert.equal((await FichaConfeccionVideo.findByPk(videoAgata.idVideo)).idFicha, porEstilo[AGATA].idFicha);
    assert.deepEqual(porEstilo[AGATA].dxf.piezas.map(p => p.nombrePieza).sort(), ['ESPALDA SUPERIOR MAYA', 'FRENTE SUPERIOR MAYA', 'MANGA']);

    assert.equal(Number((await InsumoRollo.findByPk(rolloNegro.idRollo)).metrajeActualCm), 2000);   // intacto
});

test('registrar el corte: la tela sale de cada rollo y nacen las órdenes de confección', async () => {
    const corteAntes = await OrdenCorte.findByPk(idCorte);
    const largo = dec(corteAntes.largoCm);
    const { ordenes } = await db.transaction(t => registrarCorte({ idOrdenCorte: idCorte, actor: ACTOR, idUsuario: usuario.idUsuario, transaction: t }));

    const negroDespues = await InsumoRollo.findByPk(rolloNegro.idRollo);
    assert.equal(dec(negroDespues.metrajeActualCm).toString(), dec(2000).minus(largo.times(2)).toString());
    const capaNegro = await InsumoCapa.findByPk(rolloNegro.idCapa);
    assert.equal(dec(capaNegro.cantidadConsumida).toString(), largo.times(2).toString());

    // ROMA: 3 por capa × (2 negras, 1 blanca). AGATA: 1 por capa. SEUL no da prendas.
    assert.deepEqual(ordenes.map(o => o.referencia).sort(), ['BODY AGATA', 'BODY ROMA MALLATEX']);
    const roma = await OrdenProduccion.findOne({ where: { idOrdenCorte: idCorte, idFicha: fichaRoma.idFicha } });
    const cant = await OrdenProduccionCantidad.findAll({ where: { idOrdenProduccion: roma.idOrdenProduccion }, raw: true });
    assert.deepEqual(Object.fromEntries(cant.map(c => [c.idAtributoColor, c.cantidad])), { [negro.idAtributo]: 6, [blanco.idAtributo]: 3 });
    assert.equal(roma.estado, 'borrador');

    // El costo del corte se reparte sin perder nada: 2 capas a $50 + 1 a $40 por cm.
    const corte = await OrdenCorte.findByPk(idCorte, { include: ['referencias'] });
    assert.equal(corte.estado, 'cortada');
    assert.equal(dec(corte.costoTela).toString(), largo.times(2).times(50).plus(largo.times(40)).toDecimalPlaces(2).toString());
    const suma = corte.referencias.reduce((s, r) => s.plus(dec(r.costoTela)), dec(0));
    assert.equal(suma.toString(), dec(corte.costoTela).toString());
    assert.equal(await OrdenCorteEstado.count({ where: { idOrdenCorte: idCorte, accion: 'cortada' } }), 1);
});

test('un corte registrado no se registra otra vez', async () => {
    await assert.rejects(() => db.transaction(t => registrarCorte({ idOrdenCorte: idCorte, actor: ACTOR, idUsuario: usuario.idUsuario, transaction: t })), /ya se registró/);
});

test('la ficha base pendiente pasa a activa cuando tiene molde y familia', async () => {
    const pendiente = await FichaConfeccion.findOne({ where: { estado: 'pendiente' }, include: ['dxf'] });
    assert.equal(await db.transaction(t => promoverFichaSiCompleta(pendiente.idFicha, usuario.idUsuario, t)), false);
    const familia = await Familia.create({ nombreFamilia: 'BODY SEUL' });
    await FichaConfeccionDxf.update({ idFamiliaAsociada: familia.idFamilia }, { where: { idArchivoDxf: pendiente.idDxf } });
    await FichaConfeccion.update({ idMolde: moldeAgata.idMolde }, { where: { idFicha: pendiente.idFicha } });
    assert.equal(await db.transaction(t => promoverFichaSiCompleta(pendiente.idFicha, usuario.idUsuario, t)), true);
    assert.equal((await FichaConfeccion.findByPk(pendiente.idFicha)).estado, 'activa');
});

test('dos registros del mismo corte a la vez: uno solo mueve la tela', async () => {
    const a = await analizarTrazo(TRAZO);
    const { datos } = await validarCorte(respuestas({
        referencias: {
            [SEUL]: { modo: 'despues', faltanPiezas: true, piezasSueltas: 'excluir' },
            [AGATA]: { modo: 'despues', piezasSueltas: null }
        },
        rollos: [{ idRollo: rolloNegro.idRollo, capas: 1 }]
    }), a, usuario.idUsuario);
    assert.ok(datos, 'el segundo corte debería validar');
    const { orden } = await crearOrdenCorte({ buffer: TRAZO, nombreArchivo: 'otra.dxf', analisis: a, datos, idUsuario: usuario.idUsuario, actor: ACTOR, subir: sinSubir });
    const antes = dec((await InsumoRollo.findByPk(rolloNegro.idRollo)).metrajeActualCm);
    const intentos = await Promise.allSettled([1, 2].map(() =>
        db.transaction(t => registrarCorte({ idOrdenCorte: orden.idOrdenCorte, actor: ACTOR, idUsuario: usuario.idUsuario, transaction: t }))));
    assert.equal(intentos.filter(x => x.status === 'fulfilled').length, 1);
    const despues = dec((await InsumoRollo.findByPk(rolloNegro.idRollo)).metrajeActualCm);
    assert.equal(antes.minus(despues).toString(), dec(orden.largoCm).toString());
});

test('la bitácora del corte no se edita ni se borra', async () => {
    const fila = await OrdenCorteEstado.findOne();
    await assert.rejects(() => db.query('UPDATE ORDENES_CORTE_ESTADOS SET motivo = "x" WHERE idRegistro = :id', { replacements: { id: fila.idRegistro } }), /append-only/);
    await assert.rejects(() => db.query('DELETE FROM ORDENES_CORTE_ESTADOS WHERE idRegistro = :id', { replacements: { id: fila.idRegistro } }), /append-only/);
});

test('la hoja del corte sale en PDF aunque las referencias no quepan en una página', async () => {
    const ref = (i) => ({
        estilo: `REF ${i}`, tipoPrenda: i % 2 ? 'BODY' : null, excluida: i === 3, faltanPiezas: i === 4,
        tallas: [{ codigo: 'S', etiqueta: 'S', porCapa: 2 }, { codigo: 'M', etiqueta: 'M', porCapa: 1 }],
        grilla: [{ color: { idAtributo: 1, valor: 'Negro' }, porTalla: { S: 14, M: 7 } }], prendas: 21,
        piezas: [{ nombre: 'FRENTE', talla: 'S', porPrenda: 1 }, { nombre: 'MANGA', talla: 'S', porPrenda: 2 }],
        sueltas: i === 2 ? [{ nombre: 'ESPALDA', talla: 'M', total: 7 }] : []
    });
    const detalle = {
        corte: { numeroCorte: 'CT-99', estado: 'borrador', createdAt: new Date(), fechaRequerida: '2026-12-01', nombreArchivo: 't.dxf', largoCm: 618, anchoCm: 140, notas: null, material: { nombre: 'Mallatex', codigoMaterial: '1' } },
        rollos: [{ codigo: 'R-1', color: 'Negro', capas: 7, metros: 43.26 }], referencias: Array.from({ length: 14 }, (_, i) => ref(i)),
        proveedores: [], capasTotal: 7, metrosTotal: 43.26, aprovechamiento: '75.1'
    };
    const salida = new PassThrough();
    const trozos = [];
    salida.on('data', (d) => trozos.push(d));
    const fin = new Promise((resolve) => salida.on('end', resolve));
    pdfOrdenCorte(detalle, salida);
    await fin;
    const pdf = Buffer.concat(trozos).toString('latin1');
    assert.ok(pdf.startsWith('%PDF'));
    assert.ok((pdf.match(/\/Type \/Page\b/g) || []).length >= 2, 'catorce referencias pasan a una segunda hoja');
});
