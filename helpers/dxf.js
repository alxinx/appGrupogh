import DxfParser from 'dxf-parser';
import { Material, Familia } from '../models/index.js';
import { normalizarFamilia } from './helpers.js';

// Archivo DXF de una ficha de confección (admin/procesos/fichas-confeccion/nueva): se valida
// que el contenido sea realmente un DXF (nunca la extensión ni el mimetype, CLAUDE.md §5.9),
// se parsea con `dxf-parser`, se intenta sacar Style Name / Size / Material, y esos dos
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
// esto no lo va a encontrar. Falta un DXF real de muestra para calibrar esto del todo.
//
// `talla` siempre sale como una LISTA (ver normalizarTallas): "Size: S/M" da ["Talla S",
// "Talla M"]; sin texto de talla, o con un solo valor, da ["Talla Única"] — por eso
// FichaConfeccionDxf.talla es JSON y no STRING.

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

// Una línea de TEXT/MTEXT tipo "Style Name: VEST-2026-014" o "Talla - M". El primer grupo
// que calza en cada campo gana; no se pisa si ya se encontró uno antes.
const PATRONES_CAMPO = {
    estiloNombre: /^(?:style\s*name|estilo)\s*[:\-]\s*(.+)$/i,
    talla:        /^(?:size|talla)\s*[:\-]\s*(.+)$/i,
    material:     /^(?:material)\s*[:\-]\s*(.+)$/i
};

// Sin texto "Material: X" en el dibujo, se busca una capa cuyo nombre sea un número puro
// (ej. una capa literalmente llamada "3") — el criterio que ya documenta MATERIAL.
// codigoMaterial para el archivo de corte. Se descarta la capa "0" (la capa por defecto de
// cualquier DXF, nunca es un código de material real).
function materialPorNombreDeCapa(dxf) {
    const capas = new Set((dxf?.entities || []).map(e => e.layer).filter(Boolean));
    Object.keys(dxf?.tables?.layer?.layers || {}).forEach(nombre => capas.add(nombre));
    for (const nombre of capas) {
        if (nombre !== '0' && /^\d+$/.test(nombre.trim())) return nombre.trim();
    }
    return null;
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

/** Barre las entidades de texto del DXF ya parseado. Ver el aviso del heurístico arriba. */
export function extraerCamposDxf(dxf) {
    const resultado = { estiloNombre: null, talla: null, material: null };
    const entidadesTexto = (dxf?.entities || []).filter(e => e.type === 'TEXT' || e.type === 'MTEXT');

    for (const entidad of entidadesTexto) {
        const texto = String(entidad.text || '').trim();
        if (!texto) continue;
        for (const campo of Object.keys(PATRONES_CAMPO)) {
            if (resultado[campo]) continue;
            const coincide = texto.match(PATRONES_CAMPO[campo]);
            if (coincide) resultado[campo] = coincide[1].trim().slice(0, 255);
        }
    }

    if (!resultado.material) resultado.material = materialPorNombreDeCapa(dxf);
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
 * Cruza `material` contra MATERIAL.codigoMaterial (el número que trae el DXF) y
 * `estiloNombre` contra FAMILIA.nombreFamilia (mismo normalizarFamilia que usa la propia
 * tabla al guardar, para que "Vest Emily" y "VEST EMILY" resuelvan igual). Nunca lanza: un
 * campo sin coincidencia queda en null, no es un error del archivo.
 */
export async function asociarCamposDxf({ material, estiloNombre }) {
    const resultado = { materialAsociado: null, familiaAsociada: null };

    if (material) {
        const codigo = parseInt(String(material).replace(/[^0-9]/g, ''), 10);
        if (Number.isFinite(codigo)) {
            const encontrado = await Material.findOne({
                where: { codigoMaterial: codigo },
                attributes: ['idMaterial', 'nombre', 'codigoMaterial']
            });
            if (encontrado) {
                resultado.materialAsociado = {
                    idMaterial: encontrado.idMaterial,
                    nombre: encontrado.nombre,
                    codigoMaterial: encontrado.codigoMaterial
                };
            }
        }
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
