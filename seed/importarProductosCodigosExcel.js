import ExcelJS from 'exceljs';
import dotenv from 'dotenv';
import db from '../config/bd.js';
import Productos from '../models/Productos.js';
import Familia from '../models/Familia.js';
import Categorias from '../models/Categorias.js';
import Atributos from '../models/Atributos.js';
import VariacionesProducto from '../models/VariacionesProducto.js';
import { normalizarFamilia, limpiarPrecio } from '../helpers/helpers.js';

dotenv.config();

// Carga masiva de productos desde la hoja CODIGOS de TABLA PRODUCTOS.xlsm (equipo de
// WhatsApp/taller). Cruza cada fila contra FAMILIA, CATEGORIAS (subcategoría) y ATRIBUTOS
// (color/talla), crea el producto y su variación TALLA|COLOR, y deja una copia del Excel
// con las filas que no se pudieron crear resaltadas en azul.
//
// Reglas acordadas con el usuario (2026-08-21):
//   · Fila sin ningún precio (público, mayorista, surtido o costo) → azul, no se crea.
//   · Fila sin SKU (columna B vacía) → no se puede crear (sku es NOT NULL/unique), se omite
//     y queda solo en el reporte de consola (no se marca en azul).
//   · Fila cuyo nombre o código ya existe (en el Excel más arriba, o ya en PRODUCTOS) → azul,
//     no se crea — así no se pisa ni se duplica nada.
//   · Familia: coincidencia EXACTA normalizada (mismo criterio que resolverIdFamilia en
//     adminControllers.js), nunca similitud difusa: el archivo tiene familias que se
//     parecen mucho pero son artículos distintos (TOP CAROLINA / CAROLA / CARO).
//
// El original NUNCA se toca: es un .xlsm con macros y esta librería no garantiza
// preservarlas al reescribir. Se genera una copia .xlsx nueva con las filas problema en azul.
//
//   node ./seed/importarProductosCodigosExcel.js

const RUTA_EXCEL = '/Users/apple/Documents/CLIENTES/grupoGh/taller/productos/whatsapp/TABLA PRODUCTOS.xlsm';
const DRY_RUN = process.argv.includes('--dry-run');
const RUTA_SALIDA = DRY_RUN
    ? '/Users/apple/Documents/CLIENTES/grupoGh/taller/productos/whatsapp/TABLA PRODUCTOS - revisado (dry-run).xlsx'
    : '/Users/apple/Documents/CLIENTES/grupoGh/taller/productos/whatsapp/TABLA PRODUCTOS - revisado.xlsx';
const HOJA = 'CODIGOS';
const AZUL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
const COLUMNAS_FILA = 12; // A..L

const norm = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
};
// Clave de comparación tolerante a acentos/mayúsculas para cruzar contra ATRIBUTOS/CATEGORIAS,
// cuyos valores en el Excel vienen con grafía inconsistente ("CAFE" vs "Café").
const clave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const generarSlugDe = (texto) => texto.toString().toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-');

// Mismo comportamiento que slugUnico() en adminControllers.js: numera -2, -3... si choca.
const slugUnico = async (base, transaction) => {
    const limpio = (base || '').trim() || 'producto';
    let candidato = limpio;
    let n = 2;
    while (n < 50) {
        const choca = await Productos.findOne({ where: { slug: candidato }, attributes: ['idProducto'], transaction });
        if (!choca) return candidato;
        candidato = `${limpio}-${n}`;
        n++;
    }
    return `${limpio}-${Date.now().toString(36)}`;
};

const tituloDesdeNombre = (raw) => raw.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const run = async () => {
    await db.authenticate();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(RUTA_EXCEL);
    const ws = wb.getWorksheet(HOJA);
    if (!ws) throw new Error(`No se encontró la hoja "${HOJA}" en el Excel`);

    // ── 1. Leer todas las filas ──────────────────────────────────────────────
    const filas = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return; // encabezado
        const get = (c) => row.getCell(c).value;
        filas.push({
            rowNumber,
            nombre: norm(get(1)),
            codigo: norm(get(2)),
            familia: norm(get(3)),
            color: norm(get(4)),
            precio: get(5),
            mayorista: get(6),
            surtido: get(7),
            costo: get(8),
            subcategoria: norm(get(10)),
            talla: norm(get(11))
        });
    });
    console.log(`Filas leídas en ${HOJA}: ${filas.length}`);

    // ── 2. Precargar catálogos (sin consultas dentro del for) ───────────────
    const subcats = await Categorias.findAll({ where: { tipo: 'SUBCATEGORIA' }, attributes: ['idCategoria', 'nombreCategoria', 'idPadre'] });
    const mapaSubcategoria = new Map();
    subcats.forEach((c) => {
        const k = clave(c.nombreCategoria);
        if (!mapaSubcategoria.has(k)) mapaSubcategoria.set(k, []);
        mapaSubcategoria.get(k).push(c);
    });

    const colores = await Atributos.findAll({ where: { tipo: 'COLOR' }, attributes: ['idAtributo', 'valor'] });
    const mapaColor = new Map(colores.map((a) => [clave(a.valor), a.idAtributo]));

    const tallas = await Atributos.findAll({ where: { tipo: 'TALLA' }, attributes: ['idAtributo', 'valor'] });
    const mapaTalla = new Map(tallas.map((a) => [clave(a.valor), a.idAtributo]));

    const familiasExistentes = await Familia.findAll({ attributes: ['idFamilia', 'nombreFamilia'] });
    const mapaFamilia = new Map(familiasExistentes.map((f) => [clave(f.nombreFamilia), f.idFamilia]));

    const productosExistentes = await Productos.findAll({ attributes: ['sku', 'nombreProducto'] });
    const skusExistentes = new Set(productosExistentes.map((p) => p.sku));
    const nombresExistentes = new Set(productosExistentes.map((p) => clave(p.nombreProducto)));

    // ── 3. Clasificar cada fila ──────────────────────────────────────────────
    const skusVistos = new Set();
    const nombresVistos = new Set();

    const sinSku = [];
    const marcarAzul = []; // { rowNumber, motivo }
    const aCrear = [];
    const sinCategoria = [];

    for (const f of filas) {
        if (!f.codigo) { sinSku.push(f); continue; }

        const sinNingunPrecio = (f.precio === null || f.precio === undefined || f.precio === '')
            && (f.mayorista === null || f.mayorista === undefined || f.mayorista === '')
            && (f.surtido === null || f.surtido === undefined || f.surtido === '')
            && (f.costo === null || f.costo === undefined || f.costo === '');
        // precioVentaPublicoFinal es el campo que da sentido a un producto vendible: sin él
        // (columna E vacía) tampoco se crea, aunque tenga costo u otro precio cargado.
        const sinPrecioPublico = f.precio === null || f.precio === undefined || f.precio === '';
        if (sinPrecioPublico) {
            marcarAzul.push({ rowNumber: f.rowNumber, motivo: sinNingunPrecio ? 'SIN NINGÚN PRECIO' : 'SIN PRECIO PÚBLICO (columna E)' });
            continue;
        }

        const nombreFinal = tituloDesdeNombre(f.nombre);
        const claveNombre = clave(nombreFinal);

        if (skusExistentes.has(f.codigo) || nombresExistentes.has(claveNombre)) {
            marcarAzul.push({ rowNumber: f.rowNumber, motivo: 'YA EXISTE EN LA BASE DE DATOS (nombre o código)' });
            continue;
        }
        if (skusVistos.has(f.codigo) || nombresVistos.has(claveNombre)) {
            marcarAzul.push({ rowNumber: f.rowNumber, motivo: 'DUPLICADO DENTRO DEL EXCEL (nombre o código repetido)' });
            continue;
        }
        skusVistos.add(f.codigo);
        nombresVistos.add(claveNombre);

        // Categoría: idPadre|idCategoria a partir de la subcategoría (columna J)
        let idCategoriaFinal = null;
        const matches = mapaSubcategoria.get(clave(f.subcategoria));
        if (matches && matches.length === 1) {
            idCategoriaFinal = `${matches[0].idPadre}|${matches[0].idCategoria}`;
        } else {
            sinCategoria.push({ rowNumber: f.rowNumber, nombre: nombreFinal, subcategoria: f.subcategoria, ambiguo: !!matches });
        }

        // Familia: coincidencia exacta normalizada, se crea si no existe (findOrCreate en memoria)
        let idFamiliaFinal = null;
        if (f.familia) {
            const k = clave(f.familia);
            if (mapaFamilia.has(k)) {
                idFamiliaFinal = mapaFamilia.get(k);
            } else if (DRY_RUN) {
                idFamiliaFinal = `(nueva:${k})`;
                mapaFamilia.set(k, idFamiliaFinal);
            } else {
                const nombreNormalizado = normalizarFamilia(f.familia);
                const [filaFamilia] = await Familia.findOrCreate({ where: { nombreFamilia: nombreNormalizado }, defaults: { nombreFamilia: nombreNormalizado } });
                idFamiliaFinal = filaFamilia.idFamilia;
                mapaFamilia.set(k, idFamiliaFinal);
            }
        }

        const idTalla = mapaTalla.get(clave(f.talla)) || null;
        const idColor = mapaColor.get(clave(f.color)) || null;

        aCrear.push({
            rowNumber: f.rowNumber,
            nombreProducto: nombreFinal,
            sku: f.codigo,
            idCategoria: idCategoriaFinal,
            idFamilia: idFamiliaFinal,
            precioVentaPublicoFinal: parseInt(limpiarPrecio(f.precio)) || 0,
            precioVentaMayorista: parseInt(limpiarPrecio(f.mayorista)) || 0,
            precioVentaMayoristaSurtido: parseInt(limpiarPrecio(f.surtido)) || 0,
            costo: parseInt(limpiarPrecio(f.costo)) || 0,
            idTalla,
            idColor,
            tallaOriginal: f.talla,
            colorOriginal: f.color
        });
    }

    console.log(`\nSin SKU (no se pueden crear): ${sinSku.length}`);
    console.log(`A marcar en azul (sin precio público o duplicado): ${marcarAzul.length}`);
    console.log(`Candidatos a crear: ${aCrear.length}`);
    console.log(`  · de ellos, sin categoría resuelta: ${sinCategoria.length}`);

    // ── 4. Crear productos (una transacción por producto) ───────────────────
    const sinVariacion = [];
    let creados = 0;
    for (const p of aCrear) {
        if (!p.idTalla || !p.idColor) {
            sinVariacion.push({ rowNumber: p.rowNumber, nombre: p.nombreProducto, talla: p.tallaOriginal, color: p.colorOriginal });
        }
        if (DRY_RUN) { creados++; continue; }

        const t = await db.transaction();
        try {
            const slug = await slugUnico(generarSlugDe(p.nombreProducto), t);
            const producto = await Productos.create({
                nombreProducto: p.nombreProducto,
                slug,
                sku: p.sku,
                idCategoria: p.idCategoria,
                idFamilia: p.idFamilia,
                precioVentaPublicoFinal: p.precioVentaPublicoFinal,
                precioVentaMayorista: p.precioVentaMayorista,
                precioVentaMayoristaSurtido: p.precioVentaMayoristaSurtido,
                costo: p.costo,
                web: false
            }, { transaction: t });

            if (p.idTalla && p.idColor) {
                await VariacionesProducto.create({
                    idProducto: producto.idProducto,
                    idAtributos: `${p.idTalla}|${p.idColor}`,
                    valor: 0
                }, { transaction: t });
            }

            await t.commit();
            creados++;
        } catch (e) {
            if (!t.finished) await t.rollback().catch(() => {});
            console.error(`✗ Fila ${p.rowNumber} (${p.nombreProducto}): ${e.message}`);
            marcarAzul.push({ rowNumber: p.rowNumber, motivo: `ERROR AL CREAR: ${e.message}` });
        }
    }
    console.log(`\n✓ Productos ${DRY_RUN ? '(dry-run, no guardados) ' : ''}creados: ${creados}`);

    // ── 5. Copia del Excel con las filas problema en azul ────────────────────
    // Columna 19 (S): la hoja ya usa hasta la 17 (IMAGEN y flags "LISTO" del taller) — no se
    // toca nada de eso. Se deja la 18 como separador y se anota el motivo en la 19.
    const COLUMNA_MOTIVO = 19;
    const motivoPorFila = new Map(marcarAzul.map((m) => [m.rowNumber, m.motivo]));
    ws.getCell(1, COLUMNA_MOTIVO).value = 'MOTIVO (no se creó)';
    for (const [rowNumber, motivo] of motivoPorFila) {
        const row = ws.getRow(rowNumber);
        // ExcelJS puede compartir el objeto de estilo entre celdas que ya tenían el mismo
        // relleno (ej. filas que el taller ya resaltó en amarillo a mano) — mutar `.fill`
        // directo filtra el cambio a columnas que nunca tocamos (IMAGEN, LISTO...). Clonar
        // el estilo por celda antes de tocarlo evita ese efecto secundario.
        for (let c = 1; c <= COLUMNAS_FILA; c++) {
            const cell = row.getCell(c);
            cell.style = { ...cell.style, fill: AZUL };
        }
        const celdaMotivo = row.getCell(COLUMNA_MOTIVO);
        celdaMotivo.value = motivo;
        celdaMotivo.style = { ...celdaMotivo.style, fill: AZUL };
        row.commit();
    }
    await wb.xlsx.writeFile(RUTA_SALIDA);
    console.log(`\n✓ Copia con filas marcadas guardada en: ${RUTA_SALIDA}`);

    // ── 6. Resumen final ──────────────────────────────────────────────────
    console.log('\n──────────── RESUMEN ────────────');
    console.log(`Filas totales en el Excel:        ${filas.length}`);
    console.log(`Sin SKU (omitidas, sin marcar):    ${sinSku.length}`);
    console.log(`Marcadas en azul (sin crear):      ${marcarAzul.length}`);
    console.log(`Productos creados:                 ${creados}`);
    console.log(`Creados sin categoría asignada:    ${sinCategoria.length}`);
    console.log(`Creados sin variación talla/color: ${sinVariacion.length}`);
    if (sinCategoria.length) {
        console.log('\nSubcategorías sin match (revisar manualmente):');
        [...new Set(sinCategoria.map((s) => s.subcategoria))].forEach((s) => console.log('  ·', s));
    }
    if (sinVariacion.length) {
        console.log('\nProductos creados sin variación (talla/color no resuelto):');
        sinVariacion.slice(0, 20).forEach((s) => console.log(`  · fila ${s.rowNumber}: ${s.nombre} (talla="${s.talla}", color="${s.color}")`));
    }

    process.exit(0);
};

run().catch((e) => {
    console.error('Importación fallida:', e);
    process.exit(1);
});
