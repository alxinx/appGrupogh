import crypto from 'crypto';
import Decimal from 'decimal.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import db from '../config/bd.js';
import {
    OrdenCorte, OrdenCorteReferencia, OrdenCortePieza, OrdenCorteRollo, OrdenCorteEstado,
    FichaConfeccion, FichaConfeccionDxf, FichaConfeccionDxfMaterial, FichaConfeccionDxfPieza, FichaConfeccionEstado,
    FichaConfeccionInsumo, Familia, Material, InsumoRollo, InsumoRolloEstado,
    OrdenProduccion, OrdenProduccionEstado
} from '../models/index.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { keyDocumento, bajarObjetoPrivado } from './almacenamientoDocumentos.js';
import { esDxfValido, asociarCamposDxf } from './dxf.js';
import { leerTrazo, referenciasDeTrazo, preguntasEspejo, aplicarEspejos, recetaConEspejos, resultadoReferencia, recetaDeDxf, recetaDeTela, dxfDeReferencia } from './trazo.js';
import { esTelaPorRollo, rollosEnBodega, estadoVisible } from './rollosTela.js';
import { moverFIFO, columnasActor } from './inventarioInsumos.js';
import { tallasDeFicha, escribirDetalleOrden } from './ordenesProduccion.js';
import { crearConCodigo } from './secuencias.js';
import { errorPublico, montoNoNegativo } from './helpers.js';
import { resolverIdFamilia } from './productos.js';
import { dec, a4 } from './unidadesInsumo.js';
import { fechaHoyBogota } from './fechas.js';
import { TAMANO_MAXIMO_BYTES } from '../middlewares/uploadDxf.js';
import { validarDatosFicha, columnasDatosFicha, guardarDatosFicha } from './fichaConfeccionDatos.js';

// Orden de corte desde el trazo (decidido con el dueño el 2026-11-21; CLAUDE.md §6.2):
//
//   1. El operador sube el trazo que armó en Optitex. Se leen sus referencias (Style Name),
//      piezas, tallas, la tela y el largo (helpers/trazo.js).
//   2. Cada referencia se cruza con la ficha cuyo DXF tiene ese mismo Style Name. Una sin
//      ficha entra igual: el operador elige crearla ya (con molde y familia), dejarla como
//      ficha base pendiente, o decir que es una ficha que ya existe con otro nombre.
//   3. "@MANGA" junto a "MANGA": se pregunta si es su espejo. Piezas que no forman prendas
//      completas: se pregunta si quedan pendientes (otro corte las completa) o no se cortan.
//   4. El operador elige los rollos listos y cuántas capas salen de cada uno; el color de la
//      capa es el del rollo.
//   5. Al registrar el corte la tela sale de esos rollos (de SU capa, no FIFO), el gasto se
//      reparte entre las referencias por el área de sus piezas y nacen las órdenes de
//      confección (ORDENES_PRODUCCION, en borrador) con lo que de verdad se cortó.
//
// Una ficha no pasa a confección sin molde y sin familia (faltantesFicha).

export const ETIQUETA_ESTADO_CORTE = { borrador: 'Borrador', cortada: 'Cortada', cancelada: 'Cancelada' };
// precioConfeccionMax: más que eso es un error de captura, y FICHAS_CONFECCION.precioConfeccion
// es DECIMAL(15,2): un número de 14 dígitos reventaría el insert con un 500.
export const LIMITES_CORTE = {
    capasMax: 500, rollosMax: 60, referenciasMax: 30, notasMax: 2000, motivoMax: 500,
    dxfMaxBytes: TAMANO_MAXIMO_BYTES, precioConfeccionMax: 99999999
};

// ── Fichas ───────────────────────────────────────────────────────────────────────────────

/** Lo que le falta a una ficha para pasar a confección: [] si nada. */
export const faltantesFicha = (ficha) => {
    const faltan = [];
    if (!ficha?.idMolde) faltan.push('el molde');
    if (!ficha?.dxf?.idFamiliaAsociada) faltan.push('la familia');
    return faltan;
};

/** Una ficha pendiente que ya tiene molde y familia pasa a activa (con su constancia). */
export async function promoverFichaSiCompleta(idFicha, idUsuario, transaction) {
    const ficha = await FichaConfeccion.findByPk(idFicha, {
        attributes: ['idFicha', 'estado', 'idMolde'],
        include: [{ model: FichaConfeccionDxf, as: 'dxf', attributes: ['idFamiliaAsociada'] }],
        transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined
    });
    if (!ficha || ficha.estado !== 'pendiente' || faltantesFicha(ficha).length) return false;
    const [filas] = await FichaConfeccion.update({ estado: 'activa' }, { where: { idFicha, estado: 'pendiente' }, transaction });
    if (filas) await FichaConfeccionEstado.create({ idFicha, accion: 'completada', idUsuario }, { transaction });
    return filas > 0;
}

/** Las piezas de un DXF de ficha listas para FICHAS_CONFECCION_DXF_PIEZAS; [] si no se pueden leer. */
export function piezasParaGuardar(buffer) {
    try {
        return recetaDeDxf(buffer.toString('utf8')).map(p => ({ nombrePieza: p.nombre.slice(0, 120), talla: p.talla.slice(0, 20), porPrenda: p.porPrenda, codigoMaterial: p.material }));
    } catch {
        return [];
    }
}

const tallaAFicha = (codigo) => (codigo === 'UNICA' ? 'Talla Única' : `Talla ${codigo}`);

// ── Análisis del trazo ───────────────────────────────────────────────────────────────────

const ATRIBUTOS_FICHA = ['idFicha', 'referencia', 'estado', 'idMolde', 'createdAt'];
const INCLUDE_DXF_FICHA = {
    model: FichaConfeccionDxf, as: 'dxf', attributes: ['idArchivoDxf', 'estiloNombre', 'talla', 'idFamiliaAsociada'],
    include: [{ model: FichaConfeccionDxfPieza, as: 'piezas', attributes: ['nombrePieza', 'talla', 'porPrenda', 'codigoMaterial'] }]
};

// Una ficha frente a un trazo: su receta es solo la de la tela del trazo; las piezas de sus
// otros materiales se cortan en otro trazo (`otrosMateriales`, para avisarlo).
const presentarFicha = (f, codigoTela) => {
    const { receta, otrosMateriales } = recetaDeTela(
        (f.dxf?.piezas || []).map(p => ({ nombre: p.nombrePieza, talla: p.talla, porPrenda: p.porPrenda, material: p.codigoMaterial })),
        codigoTela
    );
    return {
        idFicha: f.idFicha,
        referencia: f.referencia,
        estado: f.estado,
        tallas: tallasDeFicha(f.dxf?.talla).map(t => t.codigo),
        receta: receta.map(({ nombre, talla, porPrenda }) => ({ nombre, talla, porPrenda })),
        otrosMateriales,
        faltan: faltantesFicha(f)
    };
};

/**
 * Lee el trazo y lo cruza con el catálogo: la tela, la ficha de cada referencia y los rollos
 * listos de esa tela. No guarda nada. Lanza un error público si el archivo no sirve.
 */
export async function analizarTrazo(buffer) {
    if (!esDxfValido(buffer)) throw errorPublico('El archivo no parece ser un DXF válido.', 422);
    const lectura = leerTrazo(buffer.toString('utf8'));
    const refs = referenciasDeTrazo(lectura.piezas);
    if (refs.length > LIMITES_CORTE.referenciasMax) throw errorPublico(`El trazo trae ${refs.length} referencias: el máximo es ${LIMITES_CORTE.referenciasMax}.`, 422);

    // Un trazo, una tela.
    const codigos = [...new Set(lectura.piezas.map(p => p.material).filter(Boolean))];
    if (!codigos.length) throw errorPublico('Las piezas del trazo no dicen de qué tela son (falta "Material:" en la etiqueta).', 422);
    const { materialesAsociados } = await asociarCamposDxf({ materiales: codigos, estiloNombre: null });
    if (materialesAsociados.length > 1) {
        throw errorPublico(`El trazo trae piezas de ${materialesAsociados.length} telas (códigos ${materialesAsociados.map(m => m.codigoMaterial).join(', ')}). Exporta un trazo por tela.`, 422);
    }
    const asociado = materialesAsociados[0];
    const tela = asociado?.idMaterial
        ? await Material.findByPk(asociado.idMaterial, { attributes: ['idMaterial', 'nombre', 'codigoMaterial', 'tipo', 'unidadConsumo', 'activo'] })
        : null;
    if (!tela) throw errorPublico(`No hay ninguna tela con el código ${asociado?.codigoMaterial ?? codigos[0]} en el catálogo de insumos.`, 422);
    if (!esTelaPorRollo(tela)) throw errorPublico(`El código ${tela.codigoMaterial} es "${tela.nombre}", que no es una tela que se lleve por rollo.`, 422);

    // La ficha de cada referencia: la de su DXF con el mismo Style Name (la más reciente).
    const estilos = refs.map(r => r.estilo);
    const [coincidentes, todas, rollos] = await Promise.all([
        FichaConfeccion.findAll({
            where: { estado: ['activa', 'pendiente'] },
            attributes: ATRIBUTOS_FICHA,
            include: [{ ...INCLUDE_DXF_FICHA, where: { estiloNombre: estilos }, required: true }],
            order: [['createdAt', 'DESC'], ['idFicha', 'ASC']]
        }),
        // Todas las fichas vivas, con sus tallas y piezas, para "es una ficha que ya existe".
        FichaConfeccion.findAll({
            where: { estado: ['activa', 'pendiente'] },
            attributes: ATRIBUTOS_FICHA,
            include: [INCLUDE_DXF_FICHA],
            order: [['referencia', 'ASC'], ['idFicha', 'ASC']]
        }),
        rollosEnBodega(tela.idMaterial)
    ]);
    const porEstilo = new Map();
    for (const f of coincidentes) {
        const clave = f.dxf.estiloNombre.trim().toUpperCase();
        if (!porEstilo.has(clave)) porEstilo.set(clave, presentarFicha(f, tela.codigoMaterial));
    }

    const largo = lectura.largoCm;
    return {
        lectura,
        tela: { idMaterial: tela.idMaterial, nombre: tela.nombre, codigo: tela.codigoMaterial },
        trazo: {
            largoCm: Number(largo.toFixed(2)),
            anchoCm: Number(lectura.anchoCm.toFixed(2)),
            areaPiezasCm2: Number(lectura.areaPiezasCm2.toFixed(2)),
            aprovechamiento: Number((lectura.areaPiezasCm2 / (largo * lectura.anchoCm) * 100).toFixed(1)),
            piezas: lectura.piezas.length
        },
        preguntasEspejo: preguntasEspejo(lectura.piezas),
        referencias: refs.map(r => ({
            estilo: r.estilo,
            areaCm2: Number(r.areaCm2.toFixed(2)),
            tallas: [...new Set(r.piezas.map(p => p.talla))],
            ficha: porEstilo.get(r.estilo.trim().toUpperCase()) || null
        })),
        fichas: todas.map(f => presentarFicha(f, tela.codigoMaterial)),
        rollos: rollos.filter(r => r.estado === 'listo').map(r => ({
            idRollo: r.idRollo, codigo: r.codigo, color: r.color, colorHex: r.colorHex, idAtributoColor: r.idAtributoColor,
            metrajeCm: Number(r.metrajeCm),
            capasMax: Math.floor(Number(r.metrajeCm) / largo)
        })),
        rollosEnReposo: rollos.filter(r => ['en_reposo', 'sin_tender'].includes(r.estado)).length
    };
}

/** Lo que ve el navegador del análisis: sin la lectura interna (geometría). */
export const analisisParaNavegador = (a) => ({
    tela: a.tela, trazo: a.trazo, preguntasEspejo: a.preguntasEspejo, referencias: a.referencias,
    fichas: a.fichas, rollos: a.rollos, rollosEnReposo: a.rollosEnReposo,
    // Las piezas tal como vienen, para que la pantalla calcule con helpers/trazo.js.
    piezas: a.lectura.piezas.map(({ estilo, nombre, talla, porPrenda, areaCm2 }) => ({ estilo, nombre, talla, porPrenda, areaCm2 }))
});

// ── Validación ───────────────────────────────────────────────────────────────────────────

const entero = (v) => { const n = Number(v); return Number.isInteger(n) ? n : null; };
const texto = (v, max) => String(v ?? '').trim().slice(0, max);

/**
 * Valida lo que respondió el operador contra el análisis (que el servidor vuelve a hacer con
 * el mismo archivo: nunca se toma el del navegador). Arma todo campo por campo (§12).
 * @returns { datos } | { error }
 */
export async function validarCorte(body, analisis, idUsuario) {
    const fechaRequerida = texto(body?.fechaRequerida, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRequerida) || Number.isNaN(Date.parse(fechaRequerida))) return { error: 'Elige para qué fecha se necesitan las prendas.' };
    if (fechaRequerida < fechaHoyBogota()) return { error: 'La fecha requerida no puede ser anterior a hoy.' };
    const notas = String(body?.notas ?? '').trim();
    if (notas.length > LIMITES_CORTE.notasMax) return { error: `Las notas no pueden pasar de ${LIMITES_CORTE.notasMax} caracteres.` };

    // Espejos: todas las preguntas respondidas.
    const respuestasEspejo = body?.espejos && typeof body.espejos === 'object' ? body.espejos : {};
    const espejos = new Set();
    for (const p of analisis.preguntasEspejo) {
        const clave = `${p.estilo}|${p.pieza}`;
        if (typeof respuestasEspejo[clave] !== 'boolean') return { error: `Responde si "@${p.pieza}" de ${p.estilo} es el espejo de "${p.pieza}".` };
        if (respuestasEspejo[clave]) espejos.add(clave);
    }
    const piezas = aplicarEspejos(analisis.lectura.piezas, espejos);
    const refsTrazo = new Map(referenciasDeTrazo(piezas).map(r => [r.estilo, r]));

    const fichasValidas = new Map(analisis.fichas.map(f => [f.idFicha, f]));
    const respuestasRef = body?.referencias && typeof body.referencias === 'object' ? body.referencias : {};
    const idsVinculadas = [];
    const videosUsados = new Set();
    const referencias = [];
    for (const [orden, ref] of analisis.referencias.entries()) {
        const r = respuestasRef[ref.estilo] || {};
        const trazo = refsTrazo.get(ref.estilo);
        let ficha = ref.ficha;
        let nueva = null;
        if (!ficha) {
            if (r.modo === 'vincular') {
                const id = texto(r.idFicha, 36);
                if (!fichasValidas.has(id)) return { error: `Elige la ficha de ${ref.estilo}.` };
                idsVinculadas.push(id);
                ficha = { idFicha: id };          // se completa abajo con una consulta
            } else if (r.modo === 'ahora') {
                // Lo mismo que pide el asistente "Nueva ficha", salvo el DXF (sale del trazo):
                // una sola copia de las reglas (helpers/fichaConfeccionDatos.js). Una consulta
                // por referencia creada ahora, acotada por LIMITES_CORTE.referenciasMax.
                const nombreFamilia = texto(r.nombreFamilia, 150);
                if (!nombreFamilia) return { error: `Escribe la familia de ${ref.estilo}.` };
                if (!texto(r.idMolde, 36)) return { error: `Sube el molde de ${ref.estilo}.` };
                const precio = r.precioConfeccion === '' || r.precioConfeccion === undefined || r.precioConfeccion === null ? 0 : montoNoNegativo(r.precioConfeccion);
                if (precio === null) return { error: `El precio de confección de ${ref.estilo} no es válido.` };
                if (precio > LIMITES_CORTE.precioConfeccionMax) return { error: `El precio de confección de ${ref.estilo} no puede pasar de $${LIMITES_CORTE.precioConfeccionMax.toLocaleString('es-CO')}.` };
                const { datos: datosFicha, error } = await validarDatosFicha(r, idUsuario);
                if (error) return { error: `${ref.estilo}: ${error}` };
                for (const idVideo of datosFicha.idsVideos) {
                    if (videosUsados.has(idVideo)) return { error: `Un mismo video está en dos fichas (${ref.estilo}).` };
                    videosUsados.add(idVideo);
                }
                nueva = { modo: 'ahora', nombreFamilia, precioConfeccion: precio, datosFicha };
            } else if (r.modo === 'despues') {
                nueva = { modo: 'despues' };
            } else {
                return { error: `${ref.estilo} no tiene ficha: elige si la creas ahora, más adelante o si es una que ya existe.` };
            }
        }
        // Una referencia sin ficha puede llevar piezas que el trazo no trae: lo dice el operador.
        const faltanPiezas = !ref.ficha && !ficha?.idFicha ? r.faltanPiezas === true : false;
        const piezasSueltas = ['pendientes', 'excluir'].includes(r.piezasSueltas) ? r.piezasSueltas : null;
        referencias.push({ orden, estilo: ref.estilo, trazo, ficha, nueva, faltanPiezas, piezasSueltas });
    }

    // Fichas vinculadas a mano: una consulta para todas.
    const vinculadas = idsVinculadas.length
        ? await FichaConfeccion.findAll({ where: { idFicha: idsVinculadas, estado: ['activa', 'pendiente'] }, attributes: ATRIBUTOS_FICHA, include: [INCLUDE_DXF_FICHA] })
        : [];
    const vinculadaPorId = new Map(vinculadas.map(f => [f.idFicha, presentarFicha(f)]));

    let algunaSeCorta = false;
    for (const ref of referencias) {
        if (ref.ficha && !ref.ficha.referencia) {
            ref.ficha = vinculadaPorId.get(ref.ficha.idFicha);
            if (!ref.ficha) return { error: `La ficha elegida para ${ref.estilo} ya no está disponible.` };
        }

        // Las tallas del trazo tienen que ser tallas de la ficha.
        if (ref.ficha) {
            const ajenas = ref.trazo.piezas.map(p => p.talla).filter(t => !ref.ficha.tallas.includes(t));
            if (ajenas.length && !(ref.ficha.tallas.length === 1 && ref.ficha.tallas[0] === 'UNICA' && ref.trazo.piezas.every(p => p.talla === 'UNICA'))) {
                return { error: `${ref.estilo} viene en talla ${[...new Set(ajenas)].join(', ')} pero su ficha "${ref.ficha.referencia}" es de ${ref.ficha.tallas.join(', ')}.` };
            }
        }
        const receta = ref.ficha?.receta?.length ? recetaConEspejos(ref.ficha.receta, ref.estilo, espejos) : null;
        const resultado = resultadoReferencia({ colocadas: ref.trazo.piezas, receta, faltanPiezas: ref.faltanPiezas, piezasSueltas: ref.piezasSueltas });
        if (resultado.necesitaDecision && !ref.piezasSueltas) return { error: `${ref.estilo} tiene piezas que no forman prendas completas: elige qué hacer con ellas.` };
        if (!resultado.necesitaDecision) ref.piezasSueltas = null;
        ref.resultado = resultado;
        if (!resultado.excluida) algunaSeCorta = true;
    }
    if (!algunaSeCorta) return { error: 'Todas las referencias quedaron fuera del corte: no hay nada que cortar.' };

    // Rollos: listos, de esta tela, con color, sin repetir y con las capas que les caben.
    const rollosBody = Array.isArray(body?.rollos) ? body.rollos.slice(0, LIMITES_CORTE.rollosMax + 1) : [];
    if (rollosBody.length > LIMITES_CORTE.rollosMax) return { error: `Un corte no puede llevar más de ${LIMITES_CORTE.rollosMax} rollos.` };
    const listos = new Map(analisis.rollos.map(r => [r.idRollo, r]));
    const rollos = [];
    const vistos = new Set();
    for (const fila of rollosBody) {
        const idRollo = texto(fila?.idRollo, 36);
        const capas = entero(fila?.capas);
        const rollo = listos.get(idRollo);
        if (!rollo) return { error: 'Uno de los rollos elegidos ya no está listo para cortar: recarga la página.' };
        if (vistos.has(idRollo)) return { error: `${rollo.codigo} está dos veces.` };
        vistos.add(idRollo);
        if (!rollo.idAtributoColor) return { error: `${rollo.codigo} no tiene color: las prendas salen del color del rollo.` };
        if (!capas || capas < 1 || capas > LIMITES_CORTE.capasMax) return { error: `Escribe cuántas capas salen de ${rollo.codigo}.` };
        if (capas > rollo.capasMax) return { error: `${rollo.codigo} tiene ${(rollo.metrajeCm / 100).toLocaleString('es-CO')} m: le caben ${rollo.capasMax} capa(s) de ${(analisis.trazo.largoCm / 100).toLocaleString('es-CO')} m.` };
        rollos.push({ ...rollo, capas });
    }
    if (!rollos.length) return { error: 'Elige al menos un rollo listo para cortar y cuántas capas salen de él.' };

    return { datos: { fechaRequerida, notas: notas || null, espejos, referencias, rollos } };
}

// ── Crear la orden de corte (borrador) ───────────────────────────────────────────────────

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const subirDxfPrivado = (key, buffer, nombre) => r2PrivateClient.send(new PutObjectCommand({
    Bucket: R2_PRIVATE_BUCKET, Key: key, Body: buffer, ContentType: 'application/dxf', CacheControl: 'no-store',
    Metadata: { sha256: sha256(buffer), nombreOriginal: encodeURIComponent(nombre) }
}));

/**
 * Crea la orden de corte en borrador con sus referencias, piezas y rollos, y las fichas base
 * de las referencias que no tenían. Solo sube el trazo, ANTES de la transacción (si ésta
 * falla, queda huérfano, igual que un DXF de ficha abandonado). El DXF de cada ficha base NO
 * se sube: es un recorte del trazo y se arma al pedirlo (dxfDeFichaDeCorte). Subir uno por
 * ficha hacía que un trazo con 12 referencias nuevas tardara ~24 s (2026-11-24).
 * `subir` es la subida al bucket; los tests pasan una que no sale de la máquina.
 * @returns { orden, fichasNuevas: [idFicha] }
 */
/**
 * El DXF de una ficha base creada en un corte, que no se guarda aparte: el recorte de su
 * referencia en el trazo de ese corte. null si la ficha no nació en un corte.
 * @returns { buffer, nombre } | null
 */
export async function dxfDeFichaDeCorte(idFicha) {
    const ref = await OrdenCorteReferencia.findOne({
        where: { idFicha, fichaCreadaEnCorte: true },
        attributes: ['estilo'],
        include: [{ model: OrdenCorte, as: 'ordenCorte', attributes: ['objectKey'], paranoid: false }]
    });
    if (!ref?.ordenCorte?.objectKey) return null;
    const trazo = await bajarObjetoPrivado(ref.ordenCorte.objectKey);
    return { buffer: Buffer.from(dxfDeReferencia(leerTrazo(trazo.toString('utf8')), ref.estilo), 'utf8'), nombre: `${ref.estilo}.dxf` };
}

export async function crearOrdenCorte({ buffer, nombreArchivo, analisis, datos, idUsuario, actor, subir = subirDxfPrivado }) {
    const idOrdenCorte = crypto.randomUUID();
    const keyTrazo = keyDocumento({ carpeta: 'dxf', prefijo: 'trazo', idPropietario: idOrdenCorte, idx: 0, extension: 'dxf' });
    await subir(keyTrazo, buffer, nombreArchivo);

    // El patrón de cada ficha base: una pieza de cada, sacada del trazo.
    for (const ref of datos.referencias.filter(r => r.nueva)) {
        const texto = dxfDeReferencia(analisis.lectura, ref.estilo);
        ref.nueva.idArchivoDxf = crypto.randomUUID();
        ref.nueva.buffer = Buffer.from(texto, 'utf8');
    }
    // Familias que ya existen con el nombre de la referencia (para las que quedan pendientes).
    const familiaExistente = new Map();
    for (const ref of datos.referencias.filter(r => r.nueva?.modo === 'despues')) {
        const { familiaAsociada } = await asociarCamposDxf({ materiales: [], estiloNombre: ref.estilo });
        if (familiaAsociada) familiaExistente.set(ref.estilo, familiaAsociada);
    }

    const fichasNuevas = [];
    const orden = await db.transaction(async (t) => {
        const corte = await crearConCodigo(OrdenCorte, 'numeroCorte', 'CT-', 'orden_corte', {
            idOrdenCorte,
            estado: 'borrador',
            idMaterial: analisis.tela.idMaterial,
            nombreArchivo: nombreArchivo.slice(0, 255),
            objectKey: keyTrazo,
            shaHash: sha256(buffer),
            largoCm: analisis.trazo.largoCm,
            anchoCm: analisis.trazo.anchoCm,
            areaPiezasCm2: analisis.trazo.areaPiezasCm2,
            fechaRequerida: datos.fechaRequerida,
            notas: datos.notas,
            idUsuarioCreacion: idUsuario
        }, t);

        for (const ref of datos.referencias) {
            let idFicha = ref.ficha?.idFicha;
            if (ref.nueva) idFicha = await crearFichaBase({ ref, corte, analisis, espejos: datos.espejos, familiaExistente, idUsuario, transaction: t });
            if (ref.nueva) fichasNuevas.push(idFicha);
            const fila = await OrdenCorteReferencia.create({
                idOrdenCorte, estilo: ref.estilo.slice(0, 150), idFicha, fichaCreadaEnCorte: Boolean(ref.nueva),
                areaCm2: a4(ref.trazo.areaCm2), prendasPorCapa: ref.resultado.porTalla,
                faltanPiezas: ref.faltanPiezas, piezasSueltas: ref.piezasSueltas, orden: ref.orden + 1
            }, { transaction: t });
            await OrdenCortePieza.bulkCreate(ref.trazo.piezas.map(p => ({
                idReferencia: fila.idReferencia, nombrePieza: p.nombre.slice(0, 120), talla: p.talla.slice(0, 20),
                colocadas: p.colocadas, porPrenda: p.porPrenda, areaCm2: a4(p.areaCm2)
            })), { transaction: t });
        }

        await OrdenCorteRollo.bulkCreate(datos.rollos.map(r => ({
            idOrdenCorte, idRollo: r.idRollo, idAtributoColor: r.idAtributoColor, capas: r.capas,
            cmUsados: a4(dec(analisis.trazo.largoCm).times(r.capas))
        })), { transaction: t });

        await OrdenCorteEstado.create({ idOrdenCorte, accion: 'creada', estadoNuevo: 'borrador', ...columnasActor(actor) }, { transaction: t });
        return corte;
    });
    return { orden, fichasNuevas };
}

/** La ficha base de una referencia que no tenía ficha. Completa (activa) si se creó "ahora". */
async function crearFichaBase({ ref, corte, analisis, espejos, familiaExistente, idUsuario, transaction }) {
    const { nueva } = ref;
    const idFamilia = nueva.modo === 'ahora'
        ? await resolverIdFamilia(nueva.nombreFamilia, transaction)
        : familiaExistente.get(ref.estilo)?.idFamilia ?? null;
    const familia = idFamilia ? await Familia.findByPk(idFamilia, { attributes: ['idFamilia', 'nombreFamilia'], transaction }) : null;
    const tallas = [...new Set(ref.trazo.piezas.map(p => p.talla))];

    await FichaConfeccionDxf.create({
        idArchivoDxf: nueva.idArchivoDxf,
        idUsuarioCarga: idUsuario,
        nombreOriginal: `${ref.estilo}.dxf`.slice(0, 255),
        pesoBytes: nueva.buffer.length,
        estado: 'listo',
        objectKey: null,   // se arma desde el trazo del corte al pedirlo (dxfDeFichaDeCorte)
        shaHash: sha256(nueva.buffer),
        estiloNombre: ref.estilo,
        talla: tallas.map(tallaAFicha),
        idFamiliaAsociada: idFamilia,
        analizadoEn: new Date()
    }, { transaction });
    await FichaConfeccionDxfMaterial.create({
        idArchivoDxf: nueva.idArchivoDxf, codigoMaterial: analisis.tela.codigo, idMaterial: analisis.tela.idMaterial, orden: 1
    }, { transaction });
    // La receta de la prenda: las piezas del trazo, con los espejos que respondió el operador.
    const receta = recetaConEspejos(recetaDeDxf(nueva.buffer.toString('utf8')), ref.estilo, espejos);
    await FichaConfeccionDxfPieza.bulkCreate(receta.map(p => ({
        idArchivoDxf: nueva.idArchivoDxf, nombrePieza: p.nombre.slice(0, 120), talla: p.talla.slice(0, 20), porPrenda: p.porPrenda,
        codigoMaterial: p.material ?? analisis.tela.codigo
    })), { transaction });

    const completa = nueva.modo === 'ahora';
    const ficha = await FichaConfeccion.create({
        idUsuarioCreacion: idUsuario,
        idDxf: nueva.idArchivoDxf,
        // Creada "ahora": molde, foto, IA, complementos y observaciones, como en el asistente.
        ...(completa ? columnasDatosFicha(nueva.datosFicha) : {}),
        referencia: (familia?.nombreFamilia || ref.estilo).slice(0, 150),
        materialNombre: analisis.tela.nombre,
        precioConfeccion: completa ? nueva.precioConfeccion : 0,
        cantidadTotal: 0,
        estado: completa ? 'activa' : 'pendiente'
    }, { transaction });
    if (completa) await guardarDatosFicha(ficha.idFicha, nueva.datosFicha, transaction);   // insumos y videos
    else {
        await FichaConfeccionEstado.create({
            idFicha: ficha.idFicha, accion: 'creada_pendiente', idUsuario,
            motivo: `Ficha base creada desde el corte ${corte.numeroCorte}: falta ${faltantesFicha({ idMolde: null, dxf: { idFamiliaAsociada: idFamilia } }).join(' y ')}.`
        }, { transaction });
    }
    return ficha.idFicha;
}

// ── Registrar el corte ───────────────────────────────────────────────────────────────────

/**
 * Cantidades de la orden de confección de una referencia: prendas por capa de cada talla ×
 * capas de cada color. Puro.
 * @returns [{ idAtributoColor, talla, cantidad }]
 */
export function cantidadesDeCorte(prendasPorCapa, rollos) {
    const capasPorColor = new Map();
    for (const r of rollos) capasPorColor.set(r.idAtributoColor, (capasPorColor.get(r.idAtributoColor) || 0) + r.capas);
    const cantidades = [];
    for (const [idAtributoColor, capas] of capasPorColor) {
        for (const [talla, n] of Object.entries(prendasPorCapa || {})) {
            if (n > 0) cantidades.push({ idAtributoColor, talla, cantidad: n * capas });
        }
    }
    return cantidades;
}

/**
 * Reparte un total entre partes por su peso, en Decimal, sin perder ni sumar un centavo: la
 * última parte se lleva lo que queda. Puro.
 */
export function repartirPorPeso(total, pesos, decimales) {
    const suma = pesos.reduce((s, p) => s.plus(p), dec(0));
    if (!suma.gt(0)) return pesos.map(() => dec(0));
    const partes = [];
    let usado = dec(0);
    pesos.forEach((p, i) => {
        const parte = i === pesos.length - 1 ? dec(total).minus(usado) : dec(total).times(p).div(suma).toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP);
        partes.push(parte);
        usado = usado.plus(parte);
    });
    return partes;
}

/**
 * Registra el corte: la tela sale de cada rollo elegido (de su capa, a 'consumida'), el rollo
 * baja su metraje, el gasto se reparte entre las referencias por área y nace una orden de
 * confección en borrador por cada referencia que dio prendas. Todo en la transacción del
 * llamador; revisa estado y metraje con FOR UPDATE (§9).
 * @returns { corte, ordenes: [{ idOrdenProduccion, numeroProduccion, referencia }] }
 */
export async function registrarCorte({ idOrdenCorte, actor, idUsuario, transaction, ahora = new Date() }) {
    const corte = await OrdenCorte.findByPk(idOrdenCorte, { transaction, lock: transaction.LOCK.UPDATE });
    if (!corte) throw errorPublico('Esa orden de corte no existe.', 404);
    if (corte.estado !== 'borrador') throw errorPublico('Este corte ya se registró o se canceló: recarga la página.', 409);

    const [filasRollo, referencias] = await Promise.all([
        OrdenCorteRollo.findAll({ where: { idOrdenCorte }, order: [['idDetalle', 'ASC']], transaction }),
        OrdenCorteReferencia.findAll({
            where: { idOrdenCorte }, order: [['orden', 'ASC']], transaction,
            include: [{
                model: FichaConfeccion, as: 'ficha', attributes: ['idFicha', 'referencia', 'estado'],
                include: [{ model: FichaConfeccionInsumo, as: 'insumos', separate: true, order: [['orden', 'ASC'], ['idDetalle', 'ASC']] }]
            }]
        })
    ]);
    const rollos = await InsumoRollo.findAll({ where: { idRollo: filasRollo.map(r => r.idRollo) }, transaction, lock: transaction.LOCK.UPDATE });
    const rolloPorId = new Map(rollos.map(r => [r.idRollo, r]));

    let cmTotal = dec(0);
    let costoTotal = dec(0);
    for (const fila of filasRollo) {
        const rollo = rolloPorId.get(fila.idRollo);
        if (!rollo || rollo.idMaterial !== corte.idMaterial) throw errorPublico('Uno de los rollos ya no es de esta tela.', 409);
        if (estadoVisible(rollo, ahora) !== 'listo') throw errorPublico(`${rollo.codigoRollo} ya no está listo para cortar.`, 409);
        const usa = dec(fila.cmUsados);
        if (usa.gt(dec(rollo.metrajeActualCm))) {
            throw errorPublico(`${rollo.codigoRollo} tiene ${(Number(rollo.metrajeActualCm) / 100).toLocaleString('es-CO')} m: no le alcanzan ${fila.capas} capa(s).`, 409);
        }
        const tomadas = await moverFIFO({
            idMaterial: corte.idMaterial, idCapa: rollo.idCapa, cantidad: usa,
            desde: 'cantidadDisponible', hacia: 'cantidadConsumida', tipo: 'consumo',
            motivo: `Corte ${corte.numeroCorte}: ${rollo.codigoRollo}, ${fila.capas} capa(s)`, actor, transaction
        });
        const costo = tomadas.reduce((s, x) => s.plus(dec(x.cantidad).times(dec(x.costoUnitario))), dec(0));
        const queda = dec(rollo.metrajeActualCm).minus(usa);
        const hacia = queda.gt(0) ? rollo.estado : 'agotado';
        const [ok] = await InsumoRollo.update(
            { metrajeActualCm: a4(queda), estado: hacia },
            { where: { idRollo: rollo.idRollo, estado: rollo.estado, metrajeActualCm: rollo.metrajeActualCm }, transaction });
        if (!ok) throw errorPublico('Un rollo cambió mientras tanto. Intenta de nuevo.', 409);
        await InsumoRolloEstado.create({
            idRollo: rollo.idRollo, accion: 'corte', estadoAnterior: rollo.estado, estadoNuevo: hacia,
            cantidadCm: a4(usa), motivo: `Corte ${corte.numeroCorte}`, ...columnasActor(actor)
        }, { transaction });
        await fila.update({ costo: costo.toDecimalPlaces(2).toFixed(2) }, { transaction });
        cmTotal = cmTotal.plus(usa);
        costoTotal = costoTotal.plus(costo);
    }

    // La tela y su costo, repartidos por el área de las piezas de cada referencia que se
    // cortó. Lo de una referencia excluida no se cortó: su área no pesa.
    const cortadas = referencias.filter(r => r.piezasSueltas !== 'excluir');
    const pesos = cortadas.map(r => dec(r.areaCm2));
    const cms = repartirPorPeso(cmTotal, pesos, 4);
    const costos = repartirPorPeso(costoTotal.toDecimalPlaces(2), pesos, 2);
    for (const [i, r] of cortadas.entries()) {
        await r.update({ cmTela: a4(cms[i]), costoTela: costos[i].toFixed(2) }, { transaction });
    }

    // Una orden de confección por referencia que dio prendas.
    const ordenes = [];
    for (const r of cortadas) {
        const cantidades = cantidadesDeCorte(r.prendasPorCapa, filasRollo);
        if (!cantidades.length) continue;
        const nueva = await crearConCodigo(OrdenProduccion, 'numeroProduccion', 'OP-', 'orden_produccion', {
            idFicha: r.idFicha,
            referencia: r.ficha.referencia,
            estado: 'borrador',
            fechaRequerida: corte.fechaRequerida,
            notas: `Nace del corte ${corte.numeroCorte} (${r.estilo}).`,
            idOrdenCorte,
            idUsuarioCreacion: idUsuario
        }, transaction);
        await escribirDetalleOrden(nueva.idOrdenProduccion, {
            cantidades,
            // La receta arranca como la de la ficha; los colores de los insumos que los
            // manejan se eligen en la orden antes de confirmarla.
            insumos: (r.ficha.insumos || []).map(i => ({ idMaterial: i.idMaterial, nombreMaterial: i.nombreMaterial, cantidadPorPrenda: a4(i.cantidad), colores: [] }))
        }, transaction);
        await OrdenProduccionEstado.create({
            idOrdenProduccion: nueva.idOrdenProduccion, accion: 'creada', estadoNuevo: 'borrador',
            motivo: `Desde el corte ${corte.numeroCorte}`, idUsuario, nombreUsuario: actor.nombreUsuario
        }, { transaction });
        ordenes.push({ idOrdenProduccion: nueva.idOrdenProduccion, numeroProduccion: nueva.numeroProduccion, referencia: r.ficha.referencia });
    }

    await corte.update({ estado: 'cortada', cmTela: a4(cmTotal), costoTela: costoTotal.toDecimalPlaces(2).toFixed(2), cortadaEn: ahora }, { transaction });
    await OrdenCorteEstado.create({ idOrdenCorte, accion: 'cortada', estadoAnterior: 'borrador', estadoNuevo: 'cortada', ...columnasActor(actor) }, { transaction });
    return { corte, ordenes };
}

/** Cancela un corte en borrador (no movió nada). */
export async function cancelarCorte({ idOrdenCorte, motivo, actor, transaction }) {
    const corte = await OrdenCorte.findByPk(idOrdenCorte, { transaction, lock: transaction.LOCK.UPDATE });
    if (!corte) throw errorPublico('Esa orden de corte no existe.', 404);
    if (corte.estado !== 'borrador') throw errorPublico('Solo se cancela un corte que no se ha registrado.', 409);
    await corte.update({ estado: 'cancelada' }, { transaction });
    await OrdenCorteEstado.create({ idOrdenCorte, accion: 'cancelada', estadoAnterior: 'borrador', estadoNuevo: 'cancelada', motivo, ...columnasActor(actor) }, { transaction });
    return corte;
}
