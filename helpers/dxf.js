import { normalizarCodigoDxf } from './trazo.js';
import DxfParser from 'dxf-parser';
import { Material, Familia } from '../models/index.js';
import { normalizarFamilia } from './helpers.js';

// Archivo DXF de una ficha de confección (admin/procesos/fichas-confeccion/nueva): se valida
// que el contenido sea realmente un DXF (nunca la extensión ni el mimetype, CLAUDE.md §5.9),
// se parsea con `dxf-parser`, se intenta sacar Style Name / Size / Material, y estos dos
// últimos se cruzan contra el catálogo real: Material por código DXF (MATERIAL.
// codigoMaterial — ver el comentario de ese modelo, "el número que trae cada capa del
// DXF") y Style Name por nombre de familia (FAMILIA.nombreFamilia).
//
// IMPORTANTE — la EXTRACCIÓN sigue siendo un HEURÍSTICO provisional: el DXF no tiene un
// campo estándar para "estilo", "talla" o "material" (son datos de negocio, no de AutoCAD).
// Se barren las entidades TEXT/MTEXT buscando una línea con pinta de "Style Name: X" /
// "Size: X" / "Material: X"; si no aparece ningún texto de Material, se cae al nombre de
// capa (igual criterio que MATERIAL.codigoMaterial: la capa lleva el número). Si el software
// de patronaje de Grupo GH lo exporta de otra forma (XDATA propio, bloques con atributos...),
// esto no lo va a encontrar.
//
// `talla` siempre sale como una LISTA (ver normalizarTallas): "Size: S/M" da ["Talla S",
// "Talla M"]; sin texto de talla, o con un solo valor, da ["Talla Única"] — por eso
// FichaConfeccionDxf.talla es JSON y no STRING.
//
// `materiales` TAMBIÉN sale como lista, a diferencia de estiloNombre/talla: una prenda puede
// traer más de una tela en el mismo archivo — el cuerpo en una capa "Material: 1" y el
// puño/elástico en otra "Material: 2" (confirmado contra BLUSA SERENA.dxf, que repite
// "Material: 1" y "Material: 2" en piezas distintas). Por eso el barrido de texto NO se
// detiene en el primer match como estiloNombre/talla: junta todos los códigos DISTINTOS,
// en el orden en que aparecieron por primera vez. Cada código se resuelve por separado
// contra MATERIAL.codigoMaterial (asociarCamposDxf) y queda en FICHAS_CONFECCION_DXF_
// MATERIALES (models/FichaConfeccionDxfMaterial.js), no en una columna de esta fila.

const FIRMA_BINARIA = Buffer.from('AutoCAD Binary DXF\r\n\x1a\x00', 'binary');

/**
 * Magic bytes / estructura real del archivo — nunca la extensión ni el Content-Type que
 * mandó el navegador. Un DXF binario empieza con la firma de AutoCAD; uno ASCII (el 99% de
 * los casos) tiene como primeros tokens no-blancos el código de grupo "0" seguido de
 * "SECTION".
 */
export function esDxfValido(buffer) {
    if (!buffer || buffer.length < 20) return false;
    if (buffer.subarray(0, FIRMA_BINARIA.length).equals(FIRMA_BINARIA)) return true;

    const texto = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
    const lineas = texto.split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lineas.length - 1; i++) {
        if (lineas[i] === '0' && lineas[i + 1].toUpperCase() === 'SECTION') return true;
    }
    return false;
}

// Una línea de TEXT/MTEXT tipo "Style Name: VEST-2026-014" o "Talla - M". Para
// estiloNombre/talla el primer grupo que calza gana y no se pisa; para material se usan
// TODOS los que calzan (ver extraerCamposDxf).
const PATRONES_CAMPO = {
    estiloNombre: /^(?:style\s*name|estilo)\s*[:\-]\s*(.+)$/i,
    talla:        /^(?:size|talla)\s*[:\-]\s*(.+)$/i,
    material:     /^(?:material)\s*[:\-]\s*(.+)$/i
};

// Sin ningún texto "Material: X" en el dibujo, se buscan las capas cuyo nombre sea un
// número puro (ej. una capa literalmente llamada "3") — el criterio que ya documenta
// MATERIAL.codigoMaterial para el archivo de corte. Puede haber más de una (mismo caso que
// el texto: cuerpo en la capa "1", puño en la "2"). Se descarta la capa "0" (la capa por
// defecto de cualquier DXF, nunca es un código de material real).
function materialesPorNombreDeCapa(dxf) {
    const capas = new Set((dxf?.entities || []).map(e => e.layer).filter(Boolean));
    Object.keys(dxf?.tables?.layer?.layers || {}).forEach(nombre => capas.add(nombre));
    const encontradas = [];
    for (const nombre of capas) {
        if (nombre !== '0' && /^\d+([.\-]\d+)?$/.test(nombre.trim())) encontradas.push(nombre.trim());
    }
    return encontradas;
}

// Una ficha es de una sola talla o viene graduada para varias en el mismo DXF (un patrón
// con "S/M/L" nesteado para cortar junto). Si el texto trae más de un valor —separado por
// "/", "-" o ","— se reparte en una talla por valor ("Talla S", "Talla M"...). Con uno solo
// o ninguno no hay graduación que registrar, así que queda en "Talla Única" — el mismo valor
// para "no decía nada" y para "decía un solo valor" a propósito: una ficha con un único
// texto de talla no es una lista de tallas, es la prenda sin graduar.
//
// El patronaje de Grupo GH escribe la primera talla PEGADA a la palabra "TALLA", sin
// separador — "Size: TALLAS/M" es literalmente "TALLA" + "S" + "/" + "M" (Talla S y Talla
// M), no la palabra "tallas" en plural. Por eso se saca el prefijo "TALLA" (sin la "s") y
// NUNCA "TALLAS" como si fuera una sola palabra — comprobado contra un DXF real (BLUSA
// EMILY.dxf) durante esta sesión.
export function normalizarTallas(textoCrudo) {
    const sinPrefijo = String(textoCrudo || '').replace(/^\s*talla\s*/i, '');
    const tokens = sinPrefijo
        .split(/[\/,\-]+/)
        .map(t => t.trim().toUpperCase())
        .filter(Boolean);
    if (tokens.length <= 1) return ['Talla Única'];
    return tokens.map(t => `Talla ${t}`);
}

// Las entidades MTEXT de AutoCAD embeben códigos de formato antes del texto real:
// "\C18;\c0;\FMyriad Pro|b0|i0|c1;\H7.715;Material: 2.1" → "Material: 2.1".
// La forma es siempre \LETRA...;  — sin punto y coma interior en el contenido del código.
// Se aplica solo a MTEXT; TEXT no lleva estos prefijos.
const limpiarMtext = (tipo, raw) =>
    tipo === 'MTEXT' ? raw.replace(/\\[A-Za-z][^;]*;/g, '').trim() : raw;

/** Barre las entidades de texto del DXF ya parseado. Ver el aviso del heurístico arriba. */
export function extraerCamposDxf(dxf) {
    const resultado = { estiloNombre: null, talla: null, materiales: [] };
    const entidadesTexto = (dxf?.entities || []).filter(e => e.type === 'TEXT' || e.type === 'MTEXT');
    const materialesVistos = new Set();

    for (const entidad of entidadesTexto) {
        const texto = limpiarMtext(entidad.type, String(entidad.text || '').trim());
        if (!texto) continue;

        // `material`, a diferencia de estiloNombre/talla, NUNCA se salta aunque ya haya uno
        // encontrado: un DXF puede repetir "Material: 1" y traer también "Material: 2" en
        // otra pieza — se juntan todos los códigos DISTINTOS, en el orden de aparición.
        const coincideMaterial = texto.match(PATRONES_CAMPO.material);
        if (coincideMaterial) {
            const valor = coincideMaterial[1].trim().slice(0, 255);
            if (!materialesVistos.has(valor)) {
                materialesVistos.add(valor);
                resultado.materiales.push(valor);
            }
        }

        for (const campo of ['estiloNombre', 'talla']) {
            if (resultado[campo]) continue;
            const coincide = texto.match(PATRONES_CAMPO[campo]);
            if (coincide) resultado[campo] = coincide[1].trim().slice(0, 255);
        }
    }

    if (resultado.materiales.length === 0) resultado.materiales = materialesPorNombreDeCapa(dxf);
    resultado.talla = normalizarTallas(resultado.talla);

    return resultado;
}

/**
 * Parsea el buffer (ya validado con esDxfValido) y devuelve los campos encontrados.
 * Lanza si el DXF está corrupto o dxf-parser no lo puede leer — lo atrapa el llamador.
 */
export function analizarDxf(buffer) {
    const parser = new DxfParser();
    const dxf = parser.parseSync(buffer.toString('utf8'));
    return extraerCamposDxf(dxf);
}


/**
 * Cruza cada código de `materiales` contra MATERIAL.codigoMaterial y `estiloNombre` contra
 * FAMILIA.nombreFamilia. Nunca lanza: un código o nombre sin coincidencia queda en null.
 *
 * Los códigos del DXF pueden ser simples ("1") o compuestos ("1.23" / "1-23") — normalizarCodigoDxf
 * los lleva al formato canónico antes de la búsqueda. `materialesAsociados` es un array en el
 * MISMO orden que `materiales` (sin duplicados), con una sola consulta a MATERIAL (CLAUDE.md §7).
 */
export async function asociarCamposDxf({ materiales, estiloNombre }) {
    const resultado = { materialesAsociados: [], familiaAsociada: null };

    const codigosUnicos = [];
    const vistos = new Set();
    for (const crudo of (materiales || [])) {
        const normalizado = normalizarCodigoDxf(crudo);
        if (!normalizado || vistos.has(normalizado)) continue;
        vistos.add(normalizado);
        codigosUnicos.push(normalizado);
    }

    if (codigosUnicos.length) {
        const codigosPadre = [...new Set(
            codigosUnicos.filter(c => c.includes('.')).map(c => c.split('.')[0])
        )];
        const todosCodigos = [...new Set([...codigosUnicos, ...codigosPadre])];
        const encontrados = await Material.findAll({
            where: { codigoMaterial: todosCodigos },
            attributes: ['idMaterial', 'nombre', 'codigoMaterial']
        });
        const porCodigo = new Map(encontrados.map((m) => [m.codigoMaterial, m]));
        resultado.materialesAsociados = codigosUnicos.map((normalizado) => {
            const encontrado = porCodigo.get(normalizado);
            const padre = normalizado.includes('.')
                ? porCodigo.get(normalizado.split('.')[0]) || null
                : null;
            return {
                codigoMaterial: normalizado,
                idMaterial: encontrado?.idMaterial || null,
                nombre: encontrado?.nombre || null,
                nombrePadre: padre?.nombre || null,
                codigoPadre: padre?.codigoMaterial || null
            };
        });
    }

    if (estiloNombre) {
        const encontrado = await Familia.findOne({
            where: { nombreFamilia: normalizarFamilia(estiloNombre) },
            attributes: ['idFamilia', 'nombreFamilia']
        });
        if (encontrado) {
            resultado.familiaAsociada = { idFamilia: encontrado.idFamilia, nombreFamilia: encontrado.nombreFamilia };
        }
    }

    return resultado;
}
