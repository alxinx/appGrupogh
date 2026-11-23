// Lectura de un trazo DXF exportado de Optitex (decidido con el dueño el 2026-11-20/21: el
// trazo lo arma el operador en Optitex, el sistema lo LEE). Puro: recibe el texto del DXF,
// no toca la base. Lo usan la orden de corte (helpers/ordenesCorte.js) y la lista de piezas
// de una ficha (FICHAS_CONFECCION_DXF_PIEZAS).
//
// Cómo viene el archivo (comprobado con taller/CORTES/alejo emvoar.dxf, R12, en cm):
//   - cada pieza colocada es una POLYLINE cerrada (su contorno);
//   - encima lleva un bloque de TEXT que arranca en "Style Name:" y sigue con "Piece Name:",
//     "Size:", "Material:", "Rotation:", "Flip:", "Quality:" y "Annotation:";
//   - cuántas piezas de ese molde lleva una prenda va en "Quality: 2XT": es el campo "Calidad"
//     de las propiedades de la pieza en Optitex (wiki "Flujo de producción planeado", sección
//     Optitex). Una pieza con "Par" sale como dos piezas con el MISMO nombre y su Calidad
//     cuenta las dos (SEUL: MANGA con Par y 2XT = 6 "MANGA" para 3 prendas). Si la Calidad está
//     vacía se lee la "Descripción" ("Annotation"), que algunas piezas usan para el 2XT; sin
//     ninguna, 1;
//   - textos sin "Clave:" son rótulos dibujados dentro de la pieza ("FRENTE").
// Si el archivo se volvió a guardar en AutoCAD (BLUSA EMILY EDITADA.dxf), los contornos son
// LWPOLYLINE y los textos MTEXT con códigos de formato: se leen igual.
// Una etiqueta se asigna a UNA pieza: la que la contiene y cuyo centro le queda más cerca,
// sin repetir (en un trazo las piezas se encajan y una etiqueta puede caer sobre la vecina).
// El largo y el ancho del trazo salen de los contornos de las piezas.

// Código de material del DXF en su forma canónica (separador punto): "1-23" → "1.23", "1" →
// "1"; null si no es un código. Una sola copia: la usan este archivo y helpers/dxf.js.
export const normalizarCodigoDxf = (crudo) => {
    const str = String(crudo ?? '').trim();
    const compuesto = str.match(/^(\d{1,10})[.\-](\d{1,10})$/);
    if (compuesto) return `${compuesto[1]}.${compuesto[2]}`;
    if (/^\d{1,10}$/.test(str)) return str;
    return null;
};

const CLAVES = { 'Style Name': 'estilo', 'Piece Name': 'nombre', Size: 'talla', Material: 'material', Quality: 'calidad', Annotation: 'anotacion' };

/** Pares (código, valor) del DXF ASCII. */
const paresDe = (texto) => {
    const l = String(texto).replace(/\r\n?/g, '\n').split('\n');
    const pares = [];
    for (let i = 0; i + 1 < l.length; i += 2) pares.push([l[i].trim(), l[i + 1]]);
    return pares;
};

/** Entidades de la sección ENTITIES; una POLYLINE se lleva sus VERTEX y su SEQEND. */
function entidadesDe(pares) {
    const inicio = pares.findIndex(([c, v], i) => c === '2' && v.trim() === 'ENTITIES' && pares[i - 1]?.[1].trim() === 'SECTION');
    if (inicio < 0) return { cabecera: [], entidades: [] };
    const fin = pares.findIndex(([c, v], i) => i > inicio && c === '0' && v.trim() === 'ENDSEC');
    const entidades = [];
    let actual = null;
    for (const par of pares.slice(inicio + 1, fin < 0 ? undefined : fin)) {
        const [c, v] = par;
        const tipo = v.trim();
        if (c === '0' && !(actual?.tipo === 'POLYLINE' && (tipo === 'VERTEX' || tipo === 'SEQEND') && !actual.cerrada)) {
            actual = { tipo, pares: [] };
            entidades.push(actual);
        }
        if (!actual) continue;
        if (c === '0' && actual.tipo === 'POLYLINE' && tipo === 'SEQEND') actual.cerrada = true;
        actual.pares.push(par);
    }
    return { cabecera: pares.slice(0, inicio + 1), entidades };
}

const valor = (e, codigo) => e.pares.find(([c]) => c === codigo)?.[1]?.trim();
const CONTORNOS = new Set(['POLYLINE', 'LWPOLYLINE']);
const TEXTOS = new Set(['TEXT', 'MTEXT']);
// El texto de una entidad. MTEXT lo parte en códigos 3 + 1 y le antepone formato
// ("\\C18;\\FMyriad Pro|b0;\\H7.7;Size: M"): se quita, igual que helpers/dxf.js limpiarMtext.
const textoDe = (e) => {
    if (e.tipo !== 'MTEXT') return valor(e, '1') || '';
    const crudo = e.pares.filter(([c]) => c === '3' || c === '1').map(([, v]) => v).join('');
    return crudo.replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim();
};
const puntos = (e) => {
    const xs = [], ys = [];
    e.pares.forEach(([c, v]) => { if (c === '10' || c === '11') xs.push(+v); if (c === '20' || c === '21') ys.push(+v); });
    return xs.map((x, i) => ({ x, y: ys[i] }));
};

// Punto dentro del contorno real, no del rectángulo que lo encierra.
const dentro = (pt, vs) => {
    let adentro = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const a = vs[i], b = vs[j];
        if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) adentro = !adentro;
    }
    return adentro;
};

/** "2XT" → 2; sin anotación o algo que no se entiende → 1. */
export const porPrendaDeAnotacion = (anotacion) => {
    const m = String(anotacion ?? '').trim().match(/^(\d{1,2})\s*X\s*T$/i);
    return m && Number(m[1]) > 0 ? Number(m[1]) : 1;
};

/** Talla del trazo al código del catálogo (src/json/tallasCorte.json): "UNICA", "M". */
export const tallaDeTrazo = (texto) => {
    const t = String(texto ?? '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    // "BASE" es la talla base del patrón en Optitex: un patrón sin graduar es talla única.
    return !t || ['UNICA', 'TALLA UNICA', 'BASE'].includes(t) ? 'UNICA' : t.replace(/^TALLA\s*/, '');
};

/**
 * Lee el trazo. Lanza si no es un DXF con piezas etiquetadas.
 * @returns { largoCm, anchoCm, areaPiezasCm2, piezas: [{ estilo, nombre, talla, material, porPrenda, areaCm2, indice }],
 *            sinEtiqueta, interno: { cabecera, polis } }
 */
export function leerTrazo(texto) {
    const { cabecera, entidades } = entidadesDe(paresDe(texto));
    const polis = entidades.filter(e => CONTORNOS.has(e.tipo)).map(e => {
        // El primer 10/20 de una POLYLINE es 0,0 (sus vértices vienen después); una
        // LWPOLYLINE trae los vértices directo.
        const vertices = e.tipo === 'POLYLINE' ? puntos(e).slice(1) : puntos(e);
        const xs = vertices.map(q => q.x), ys = vertices.map(q => q.y);
        const area = Math.abs(vertices.reduce((acc, a, i) => { const b = vertices[(i + 1) % vertices.length]; return acc + a.x * b.y - b.x * a.y; }, 0)) / 2;
        return {
            e, vertices, area,
            minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
            cx: xs.reduce((s, x) => s + x, 0) / (xs.length || 1), cy: ys.reduce((s, y) => s + y, 0) / (ys.length || 1),
            textos: [], lineas: [], campos: {}
        };
    }).filter(p => p.vertices.length >= 3 && p.area > 0);
    if (!polis.length) throw Object.assign(new Error('El archivo no trae piezas: no parece un trazo exportado de Optitex.'), { publico: true, status: 422 });

    const masCercana = (pt) => polis.filter(p => dentro(pt, p.vertices)).sort((a, b) => a.area - b.area)[0]
        || polis.slice().sort((a, b) => Math.hypot(a.cx - pt.x, a.cy - pt.y) - Math.hypot(b.cx - pt.x, b.cy - pt.y))[0];

    // Bloques de etiqueta. Un bloque es una racha de textos "Clave: valor" seguidos, en la
    // misma columna (misma x), y sin una clave repetida. NO se fía del orden de las claves:
    // Optitex escribe "Style Name" primero, pero un archivo vuelto a guardar en AutoCAD lo
    // deja al final. Un bloque sin "Piece Name" no es la etiqueta de una pieza (el título
    // del trazo, por ejemplo) y se descarta.
    const bloques = [];
    let actual = null;
    const cerrar = () => { if (actual) bloques.push(actual); actual = null; };
    for (const e of entidades) {
        if (!TEXTOS.has(e.tipo)) { cerrar(); continue; }
        const t = textoDe(e);
        const pt = { x: +valor(e, '10'), y: +valor(e, '20') };
        const i = t.indexOf(':');
        // Sin "Clave:" es un rótulo dibujado dentro de la pieza ("FRENTE", "Sample Size"): va
        // con la pieza que lo contiene y no corta el bloque.
        if (i < 0 || !/^[A-Za-z ]+$/.test(t.slice(0, i))) { masCercana(pt).textos.push(e); continue; }
        const clave = CLAVES[t.slice(0, i).trim()];
        const repetida = clave && actual?.campos[clave] !== undefined;
        if (!actual || repetida || Math.abs(actual.pt.x - pt.x) > 1) { cerrar(); actual = { pt, textos: [], campos: {} }; }
        actual.textos.push(e);
        if (clave) actual.campos[clave] = t.slice(i + 1).trim();
    }
    cerrar();
    const etiquetas = bloques.filter(b => b.campos.estilo && b.campos.nombre);
    if (!etiquetas.length) throw Object.assign(new Error('Las piezas del trazo no traen etiqueta "Style Name" / "Piece Name": expórtalo desde Optitex con las anotaciones de pieza.'), { publico: true, status: 422 });

    // Una etiqueta por pieza, de la asignación más barata a la más cara.
    const costos = [];
    etiquetas.forEach((bl, i) => polis.forEach((p, j) => {
        costos.push({ i, j, costo: (dentro(bl.pt, p.vertices) ? 0 : 1e6) + Math.hypot(p.cx - bl.pt.x, p.cy - bl.pt.y) });
    }));
    costos.sort((a, b) => a.costo - b.costo);
    const usadoB = new Set(), usadoP = new Set();
    for (const { i, j } of costos) {
        if (usadoB.has(i) || usadoP.has(j)) continue;
        usadoB.add(i); usadoP.add(j);
        polis[j].textos.push(...etiquetas[i].textos);
        polis[j].campos = etiquetas[i].campos;
    }
    for (const e of entidades.filter(x => x.tipo === 'LINE')) {
        const [a, b] = puntos(e);
        if (a && b) masCercana({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }).lineas.push(e);
    }

    const conEtiqueta = polis.filter(p => p.campos.estilo);
    const piezas = conEtiqueta.map((p, indice) => ({
        indice,
        estilo: p.campos.estilo,
        nombre: String(p.campos.nombre ?? '').trim() || 'SIN NOMBRE',
        talla: tallaDeTrazo(p.campos.talla),
        material: String(p.campos.material ?? '').trim() || null,
        porPrenda: porPrendaDeAnotacion(p.campos.calidad ?? p.campos.anotacion),
        areaCm2: p.area
    }));

    const minX = Math.min(...conEtiqueta.map(p => p.minX)), maxX = Math.max(...conEtiqueta.map(p => p.maxX));
    const minY = Math.min(...conEtiqueta.map(p => p.minY)), maxY = Math.max(...conEtiqueta.map(p => p.maxY));
    // El trazo arranca en el origen (Optitex lo exporta así): el largo se mide desde 0, no
    // desde la primera pieza, porque ese margen también se tiende. Corre a lo largo de la
    // tela: el lado mayor es el largo; el menor, el ancho.
    const ladoX = maxX - Math.min(0, minX), ladoY = maxY - Math.min(0, minY);
    return {
        largoCm: Math.max(ladoX, ladoY),
        anchoCm: Math.min(ladoX, ladoY),
        areaPiezasCm2: piezas.reduce((s, p) => s + p.areaCm2, 0),
        piezas,
        sinEtiqueta: polis.length - conEtiqueta.length,
        interno: { cabecera, polis: conEtiqueta }
    };
}

// ── Espejos ("@MANGA" junto a "MANGA") ───────────────────────────────────────────────────
// Optitex marca con "@" una pieza que puede ser la misma volteada. Si lo es, cuentan juntas;
// si no, son piezas distintas. No se adivina: se le pregunta al operador (decidido con el
// dueño el 2026-11-21). "@MANGA" no lo pone el Par de Optitex: es otra pieza, con nombre y
// Calidad propios (AGATA: MANGA 1XT + @MANGA 1XT). Al juntarlas, la prenda lleva la SUMA de lo
// que pide cada nombre: 2 mangas (visto con el dueño en Optitex el 2026-11-22).

const base = (nombre) => String(nombre).replace(/^@+/, '').trim();

/** Las piezas "@X" que tienen una "X" en la misma referencia: [{ estilo, pieza: 'X' }]. */
export function preguntasEspejo(piezas) {
    const nombres = new Map();
    for (const p of piezas) {
        if (!nombres.has(p.estilo)) nombres.set(p.estilo, new Set());
        nombres.get(p.estilo).add(p.nombre);
    }
    const preguntas = [];
    for (const [estilo, set] of nombres) {
        for (const n of set) if (n.startsWith('@') && set.has(base(n))) preguntas.push({ estilo, pieza: base(n) });
    }
    return preguntas;
}

/** Junta "@X" con "X" para las piezas que el operador dijo que son espejo. `espejos`: Set de "estilo|X". */
export const aplicarEspejos = (piezas, espejos) => piezas.map(p => (
    p.nombre.startsWith('@') && espejos.has(`${p.estilo}|${base(p.nombre)}`) ? { ...p, nombre: base(p.nombre), nombreOriginal: p.nombre } : p
));

// Por prenda de una pieza que viene de uno o dos nombres (espejo): lo de cada nombre, sumado.
const sumarPorNombre = (porNombre) => [...porNombre.values()].reduce((s, n) => s + n, 0);

/**
 * Las piezas de la receta que se cortan en la tela del trazo (un trazo, una tela): las demás se
 * cortan en otro trazo. Una pieza sin material (ficha vieja) va en cualquiera.
 * @returns { receta, otrosMateriales: ['2', …] }
 */
export function recetaDeTela(receta, codigoTela) {
    const tela = normalizarCodigoDxf(codigoTela);
    const deEsta = (r) => !r.material || !tela || r.material === tela;
    return {
        receta: receta.filter(deEsta),
        otrosMateriales: [...new Set(receta.filter(r => !deEsta(r)).map(r => r.material))].sort()
    };
}

/** "@X" y "X" en la receta de una ficha, cuando el operador dijo que son la misma pieza (sin repetir). */
export const recetaConEspejos = (receta, estilo, espejos) => {
    const unidas = new Map();
    for (const r of aplicarEspejos(receta.map(p => ({ ...p, estilo })), espejos)) {
        const clave = `${r.nombre}|${r.talla}`;
        if (!unidas.has(clave)) unidas.set(clave, { nombre: r.nombre, talla: r.talla, material: r.material ?? null, porNombre: new Map() });
        unidas.get(clave).porNombre.set(r.nombreOriginal || r.nombre, r.porPrenda);
    }
    return [...unidas.values()].map(({ porNombre, ...r }) => ({ ...r, porPrenda: sumarPorNombre(porNombre) }));
};

// ── Resumen por referencia ───────────────────────────────────────────────────────────────

/**
 * Agrupa las piezas colocadas por referencia → pieza × talla.
 * @returns [{ estilo, materiales: [...], areaCm2, piezas: [{ nombre, talla, colocadas, porPrenda, areaCm2 }] }]
 */
export function referenciasDeTrazo(piezas) {
    const refs = new Map();
    for (const p of piezas) {
        if (!refs.has(p.estilo)) refs.set(p.estilo, { estilo: p.estilo, materiales: new Set(), areaCm2: 0, piezas: new Map() });
        const r = refs.get(p.estilo);
        if (p.material) r.materiales.add(p.material);
        r.areaCm2 += p.areaCm2;
        const clave = `${p.nombre}|${p.talla}`;
        if (!r.piezas.has(clave)) r.piezas.set(clave, { nombre: p.nombre, talla: p.talla, colocadas: 0, porNombre: new Map(), areaCm2: 0 });
        const q = r.piezas.get(clave);
        q.colocadas += 1;
        q.areaCm2 += p.areaCm2;
        const nombre = p.nombreOriginal || p.nombre;
        q.porNombre.set(nombre, Math.max(q.porNombre.get(nombre) || 0, p.porPrenda));
    }
    return [...refs.values()].map(r => ({
        ...r,
        materiales: [...r.materiales],
        piezas: [...r.piezas.values()].map(({ porNombre, ...q }) => ({ ...q, porPrenda: sumarPorNombre(porNombre) })).sort((a, b) => a.talla.localeCompare(b.talla) || a.nombre.localeCompare(b.nombre, 'es'))
    })).sort((a, b) => a.estilo.localeCompare(b.estilo, 'es'));
}

/**
 * Prendas completas por capa y talla, y lo que sobra de cada pieza.
 *   prendas(talla) = la menor, entre las piezas que lleva la prenda en esa talla, de
 *                    colocadas ÷ por prenda (redondeado hacia abajo)
 * @param colocadas  piezas del trazo de UNA referencia: [{ nombre, talla, colocadas }]
 * @param receta     piezas que lleva la prenda: [{ nombre, talla, porPrenda }] (las de su ficha;
 *                   sin ficha, las mismas del trazo)
 * @returns { porTalla: { talla: prendas }, faltantes: [{ nombre, talla }], sobrantes: [{ nombre, talla, cantidad }] }
 */
export function prendasPorCapa(colocadas, receta) {
    const hay = new Map(colocadas.map(p => [`${p.nombre}|${p.talla}`, p.colocadas]));
    const tallas = [...new Set(colocadas.map(p => p.talla))];
    const porTalla = {};
    const faltantes = [];
    for (const talla of tallas) {
        // Una receta en talla única sirve para cualquier talla que traiga el trazo.
        let lleva = receta.filter(r => r.talla === talla);
        if (!lleva.length) lleva = receta.filter(r => r.talla === 'UNICA').map(r => ({ ...r, talla }));
        if (!lleva.length) { porTalla[talla] = 0; continue; }
        let min = Infinity;
        for (const r of lleva) {
            const n = hay.get(`${r.nombre}|${talla}`) || 0;
            if (!n) faltantes.push({ nombre: r.nombre, talla });
            min = Math.min(min, Math.floor(n / Math.max(1, r.porPrenda)));
        }
        porTalla[talla] = Number.isFinite(min) ? min : 0;
    }
    const sobrantes = [];
    for (const p of colocadas) {
        const r = receta.find(x => x.nombre === p.nombre && (x.talla === p.talla || x.talla === 'UNICA'));
        const usadas = r ? (porTalla[p.talla] || 0) * Math.max(1, r.porPrenda) : 0;
        if (p.colocadas > usadas) sobrantes.push({ nombre: p.nombre, talla: p.talla, cantidad: p.colocadas - usadas });
    }
    return { porTalla, faltantes, sobrantes };
}

/**
 * Lo que da una referencia del trazo por capa, con lo que respondió el operador. Una sola
 * copia: la pantalla "Nuevo corte" la muestra mientras se responde y el servidor la vuelve a
 * calcular al guardar.
 *   faltanPiezas   la prenda lleva piezas que este trazo no trae (lo dice el operador): no
 *                  salen prendas, todo queda como piezas sueltas
 *   piezasSueltas  'pendientes' (se cortan y esperan otro corte) | 'excluir' (no se corta)
 * @returns { porTalla, prendasPorCapa, faltantes, sueltas, necesitaDecision, excluida }
 */
export function resultadoReferencia({ colocadas, receta, faltanPiezas = false, piezasSueltas = null }) {
    const calc = prendasPorCapa(colocadas, receta?.length ? receta : colocadas);
    const ceros = () => Object.fromEntries(Object.keys(calc.porTalla).map(t => [t, 0]));
    const sueltas = faltanPiezas ? colocadas.map(p => ({ nombre: p.nombre, talla: p.talla, cantidad: p.colocadas })) : calc.sobrantes;
    const excluida = piezasSueltas === 'excluir';
    const porTalla = faltanPiezas || excluida ? ceros() : calc.porTalla;
    return {
        porTalla,
        prendasPorCapa: Object.values(porTalla).reduce((s, n) => s + n, 0),
        faltantes: calc.faltantes,
        sueltas,
        necesitaDecision: sueltas.length > 0 || calc.faltantes.length > 0,
        excluida
    };
}

/**
 * La receta de piezas de un DXF de ficha (un patrón, una pieza de cada):
 * [{ nombre, talla, porPrenda, material }]. Una prenda puede ir en varios materiales (SEUL:
 * espalda y mangas en el 1, frente y sesgo en el 2): cada pieza lleva el suyo, y una misma
 * pieza puede repetirse en dos materiales (frente de tela y frente de forro).
 */
export function recetaDeDxf(texto) {
    const { piezas } = leerTrazo(texto);
    const receta = new Map();
    for (const p of piezas) {
        // Un patrón graduado trae las tallas anidadas en la misma pieza ("Size: TALLAS/M" =
        // S y M, como lo lee helpers/dxf.js normalizarTallas): la pieza va en cada una.
        for (const talla of p.talla.split(/[\/,]+/).map(t => t.trim()).filter(Boolean)) {
            const material = normalizarCodigoDxf(p.material);
            const clave = `${p.nombre}|${talla}|${material}`;
            if (!receta.has(clave)) receta.set(clave, { nombre: p.nombre, talla, porPrenda: p.porPrenda, material });
        }
    }
    return [...receta.values()];
}

/**
 * El DXF de UNA referencia sacado del trazo: una pieza de cada nombre y talla, tal cual
 * venían (mismo formato que el original). Es el patrón de la ficha base que se crea desde
 * un corte cuando la referencia no tiene ficha.
 */
export function dxfDeReferencia(lectura, estilo) {
    const { cabecera, polis } = lectura.interno;
    const vistas = new Set();
    const cuerpo = [];
    for (const p of polis) {
        if (p.campos.estilo !== estilo) continue;
        const clave = `${p.campos.nombre}|${p.campos.talla}`;
        if (vistas.has(clave)) continue;
        vistas.add(clave);
        cuerpo.push(...p.e.pares, ...p.textos.flatMap(t => t.pares), ...p.lineas.flatMap(l => l.pares));
    }
    const aTexto = (lista) => lista.map(([c, v]) => `${c.padStart(3)}\n${v}`).join('\n');
    return `${aTexto(cabecera)}\n${aTexto(cuerpo)}\n  0\nENDSEC\n  0\nEOF\n`;
}
