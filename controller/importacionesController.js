import ExcelJS from 'exceljs';
import db from '../config/bd.js';
import { Productos, Familia, Categorias, Atributos, VariacionesProducto } from '../models/index.js';
import { montoNoNegativo } from '../helpers/helpers.js';
import { generarSlugDe, slugUnico, resolverIdFamilia, siguienteSkuInterno } from '../helpers/productos.js';

// Importador masivo de productos desde el Excel del proveedor (mismo formato de columnas
// que TABLA PRODUCTOS.xlsm, hoja CODIGOS, que ya se usó para la carga inicial vía
// seed/importarProductosCodigosExcel.js). Esta es la versión "botón en el panel" de esa
// misma lógica: la diferencia de fondo es que acá corre contra la base real de la app con
// Sequelize (transacción de verdad por producto), no un script suelto contra una copia
// local que después hay que sincronizar a mano.
//
// Reglas de negocio (acordadas 2026-08-22):
//   · La base de datos SIEMPRE gana: si el nombre o el SKU ya existen, esa fila no se toca.
//   · Obligatorios siempre, sin excepción del checklist: nombre, color, talla. Si el
//     color o la talla no vacíos no matchean ningún ATRIBUTOS existente, tampoco se crea.
//   · SKU vacío (2026-09-26): no se importa nada hasta que el usuario confirme que el
//     sistema genere los códigos faltantes con siguienteSkuInterno(). Si no confirma,
//     tiene que llenarlos en el Excel.
//   · Familia: coincidencia exacta por nombre: si no existe, se crea sola. Nunca bloquea.
//   · El resto (los 4 precios, la categoría) se puede dejar vacío/0/null SOLO si el
//     checklist lo permite explícitamente para esa importación — por defecto, si falta,
//     la fila no se crea.
//   · Al final se genera un informe descargable con toda fila que no se creó y por qué.

const HOJA = 'CODIGOS';

// Layout de la hoja CODIGOS: número de columna y título, tal como viene en TABLA
// PRODUCTOS.xlsm. Lo comparten el lector (procesarImportacionExcel) y la plantilla
// descargable (descargarPlantillaImportacion), para que el archivo que se entrega sea
// siempre el que el importador sabe leer. CATEGORIA (I) está en el Excel original pero
// no se lee: la categoría padre sale de la subcategoría.
const COLUMNAS = {
    nombre:       { col: 1,  titulo: 'NOMBRE DEL PRODUCTO', ancho: 38 },
    codigo:       { col: 2,  titulo: 'CODIGO',              ancho: 22 },
    familia:      { col: 3,  titulo: 'FAMILIA',             ancho: 24 },
    color:        { col: 4,  titulo: 'COLOR',               ancho: 16 },
    precio:       { col: 5,  titulo: 'PRECIO',              ancho: 13 },
    mayorista:    { col: 6,  titulo: 'PRECIO MAYORISTA',    ancho: 18 },
    surtido:      { col: 7,  titulo: 'PRECIO SURTIDO',      ancho: 16 },
    costo:        { col: 8,  titulo: 'COSTOS',              ancho: 12 },
    categoria:    { col: 9,  titulo: 'CATEGORIA',           ancho: 16 },
    subcategoria: { col: 10, titulo: 'SUBCATEGORIA',        ancho: 20 },
    talla:        { col: 11, titulo: 'TALLA',               ancho: 10 }
};

const norm = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
};
// Tolerante a acentos/mayúsculas: el Excel trae grafía inconsistente ("CAFE" vs "Café").
const clave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const tituloDesdeNombre = (raw) => raw.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Catálogos contra los que se cruza cada fila, en un solo lugar para la plantilla y para
// la importación: si la plantilla ofreciera en su lista un valor que la importación
// después rechaza, el archivo "correcto" fallaría igual.
//
// Las subcategorías se indexan por nombre y las que tienen el nombre repetido entre dos
// categorías se descartan: con solo el nombre no hay forma de saber a cuál va la fila.
// Por eso la plantilla no las ofrece y la importación las trata como no reconocidas.
const cargarCatalogos = async () => {
    const [colores, tallas, subcats] = await Promise.all([
        Atributos.findAll({ where: { tipo: 'COLOR' }, attributes: ['idAtributo', 'valor'], order: [['valor', 'ASC']], raw: true }),
        Atributos.findAll({ where: { tipo: 'TALLA' }, attributes: ['idAtributo', 'valor'], order: [['idAtributo', 'ASC']], raw: true }),
        Categorias.findAll({
            where: { tipo: 'SUBCATEGORIA' },
            attributes: ['idCategoria', 'nombreCategoria', 'idPadre'],
            include: [{ model: Categorias, as: 'Padre', attributes: ['nombreCategoria'] }],
            order: [['nombreCategoria', 'ASC']]
        })
    ]);

    const porNombre = new Map();
    subcats.forEach((c) => {
        const k = clave(c.nombreCategoria);
        porNombre.set(k, porNombre.has(k) ? null : c); // null = ambigua
    });
    const subcategorias = new Map([...porNombre].filter(([, c]) => c));

    return {
        colores,
        tallas,
        subcategorias,                                                  // clave → subcategoría (con Padre)
        mapaColor: new Map(colores.map((a) => [clave(a.valor), a.idAtributo])),
        mapaTalla: new Map(tallas.map((a) => [clave(a.valor), a.idAtributo]))
    };
};

const formularioImportaciones = async (req, res) => {
    return res.status(200).render('./administrador/configuracion/importaciones', {
        pagina: 'Configuración',
        subPagina: 'Importaciones',
        csrfToken: req.csrfToken(),
        currentPath: '/configuracion'
    });
};

// Plantilla vacía con el mismo layout que lee procesarImportacionExcel. Además de los
// títulos, trae una hoja LISTAS con los colores, tallas y subcategorías que existen hoy
// en la base, y listas desplegables en esas columnas: son los tres valores que, mal
// escritos, mandan la fila al informe. Las subcategorías con nombre repetido entre
// categorías no se ofrecen — el importador no sabe a cuál ir y las rechaza igual.
const FILAS_CON_VALIDACION = 2000;

const descargarPlantillaImportacion = async (req, res) => {
    try {
        const [{ colores, tallas, subcategorias }, familias] = await Promise.all([
            cargarCatalogos(),
            Familia.findAll({ attributes: ['nombreFamilia'], order: [['nombreFamilia', 'ASC']], raw: true })
        ]);
        const subcatsUnicas = [...subcategorias.values()];

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="plantilla-importacion-productos.xlsx"');

        // Streaming directo sobre la respuesta (CLAUDE.md §2 y §11).
        const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
        wb.creator = 'Grupo GH';
        wb.created = new Date();

        // ── CODIGOS: la hoja que se llena y se sube ──────────────────────────
        const ws = wb.addWorksheet(HOJA, { views: [{ state: 'frozen', ySplit: 1 }] });
        const defs = Object.values(COLUMNAS);
        ws.columns = defs.map((d) => ({ width: d.ancho }));
        ws.getColumn(COLUMNAS.codigo.col).numFmt = '@'; // SKU de solo dígitos: sin esto Excel se come los ceros

        // Colores del encabezado: obligatorio siempre / obligatorio salvo checklist / no se lee.
        const OBLIGATORIAS = [COLUMNAS.nombre, COLUMNAS.codigo, COLUMNAS.color, COLUMNAS.talla];
        const encabezado = ws.getRow(1);
        defs.forEach((d) => {
            const celda = encabezado.getCell(d.col);
            celda.value = d.titulo;
            const obligatoria = OBLIGATORIAS.includes(d);
            const ignorada = d === COLUMNAS.categoria;
            celda.font = { bold: true, color: { argb: obligatoria ? 'FFFFFFFF' : ignorada ? 'FF9CA3AF' : 'FF1F2937' } };
            celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: obligatoria ? 'FFE24C95' : ignorada ? 'FFF3F4F6' : 'FFFDE7F2' } };
            celda.alignment = { vertical: 'middle' };
        });
        encabezado.height = 22;
        encabezado.commit();

        const rango = (d) => { const l = ws.getColumn(d.col).letter; return `${l}2:${l}${FILAS_CON_VALIDACION}`; };
        const lista = (d, colLista, total, nombre) => {
            if (!total) return;
            ws.dataValidations.add(rango(d), {
                type: 'list',
                allowBlank: true,
                formulae: [`LISTAS!$${colLista}$2:$${colLista}$${total + 1}`],
                showErrorMessage: true,
                errorStyle: 'stop',
                errorTitle: `${nombre} no reconocido`,
                error: `Elegí un valor de la lista (hoja LISTAS). Si falta, hay que crearlo primero en el sistema.`
            });
        };
        lista(COLUMNAS.color, 'A', colores.length, 'Color');
        lista(COLUMNAS.talla, 'B', tallas.length, 'Talla');
        lista(COLUMNAS.subcategoria, 'C', subcatsUnicas.length, 'Subcategoría');
        [COLUMNAS.precio, COLUMNAS.mayorista, COLUMNAS.surtido, COLUMNAS.costo].forEach((d) => {
            ws.dataValidations.add(rango(d), {
                type: 'decimal',
                operator: 'greaterThanOrEqual',
                allowBlank: true,
                formulae: [0],
                showErrorMessage: true,
                errorStyle: 'stop',
                errorTitle: 'Valor no válido',
                error: 'Solo números, sin signos ni puntos de miles, y no negativos.'
            });
        });
        ws.commit();

        // ── LISTAS: valores válidos hoy en la base ───────────────────────────
        const wl = wb.addWorksheet('LISTAS', { views: [{ state: 'frozen', ySplit: 1 }] });
        wl.columns = [{ width: 18 }, { width: 10 }, { width: 22 }, { width: 22 }, { width: 3 }, { width: 30 }];
        const tituloListas = wl.addRow(['COLOR', 'TALLA', 'SUBCATEGORIA', 'CATEGORIA', null, 'FAMILIAS EXISTENTES']);
        tituloListas.font = { bold: true };
        tituloListas.commit();
        const largo = Math.max(colores.length, tallas.length, subcatsUnicas.length, familias.length);
        for (let i = 0; i < largo; i++) {
            wl.addRow([
                colores[i]?.valor ?? null,
                tallas[i]?.valor ?? null,
                subcatsUnicas[i]?.nombreCategoria ?? null,
                subcatsUnicas[i]?.Padre?.nombreCategoria ?? null,
                null,
                familias[i]?.nombreFamilia ?? null
            ]).commit();
        }
        wl.commit();

        // ── INSTRUCCIONES ────────────────────────────────────────────────────
        const wi = wb.addWorksheet('INSTRUCCIONES');
        wi.columns = [{ width: 24 }, { width: 90 }];
        const instrucciones = [
            ['CÓMO SE LEE ESTE ARCHIVO', null],
            ['Hoja', `Solo se lee la hoja "${HOJA}", desde la fila 2. No cambies el nombre de la hoja ni el orden de las columnas.`],
            ['Encabezado rosa fuerte', 'Obligatorio siempre: nombre, código (SKU), color y talla. Sin eso la fila no se crea.'],
            ['Código (SKU) vacío', 'Si alguna fila no tiene código, al importar el sistema pregunta si querés que lo genere. Si decís que no, no se importa nada hasta que llenes los códigos.'],
            ['Encabezado rosa claro', 'Obligatorio salvo que lo marques en "Campos que se pueden dejar vacíos" al importar (precios, costo, subcategoría). La familia es opcional: si no existe, se crea sola.'],
            ['Encabezado gris', 'CATEGORIA no se lee: la categoría sale de la subcategoría.'],
            ['Color, talla, subcategoría', 'Tienen que existir en el sistema. Usá la lista desplegable (sale de la hoja LISTAS).'],
            ['Precios y costo', 'Números sin signo $ ni puntos de miles. No negativos.'],
            ['Productos existentes', 'Si el nombre o el SKU ya existen en el sistema, la fila no se toca.'],
            ['Informe', 'Al importar se descarga un informe con cada fila que no se creó y el motivo.']
        ];
        instrucciones.forEach((fila, i) => {
            const r = wi.addRow(fila);
            if (i === 0) r.font = { bold: true, size: 13 };
            else r.getCell(1).font = { bold: true };
            r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
            r.commit();
        });
        wi.commit();

        await wb.commit();
    } catch (error) {
        console.error('descargarPlantillaImportacion:', error);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, mensaje: 'No se pudo generar la plantilla.' });
        }
        res.end();
    }
};

const procesarImportacionExcel = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, mensaje: 'No se recibió ningún archivo.' });
        }

        // Checklist: qué campos se pueden dejar vacíos (se guardan en 0/null) para ESTA
        // importación. Por defecto (checkbox sin marcar) el campo es obligatorio y su
        // ausencia manda la fila al informe. EAN/descripción/tags no tienen columna en este
        // formato de Excel, así que no hay nada que decidir sobre ellos — siempre van null.
        const permitirVacio = {
            precioVentaPublicoFinal: req.body.permitirVacio_precioVentaPublicoFinal === 'true',
            precioVentaMayorista: req.body.permitirVacio_precioVentaMayorista === 'true',
            precioVentaMayoristaSurtido: req.body.permitirVacio_precioVentaMayoristaSurtido === 'true',
            costo: req.body.permitirVacio_costo === 'true',
            categoria: req.body.permitirVacio_categoria === 'true'
        };
        // El SKU vacío no está en el checklist: se decide en un paso aparte (ver 1.1),
        // después de que el usuario vio cuántas filas vienen sin código.
        const generarSku = req.body.generarSku === 'true';

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(req.file.buffer);
        const ws = wb.getWorksheet(HOJA);
        if (!ws) {
            return res.status(400).json({ success: false, mensaje: `El Excel no tiene una hoja llamada "${HOJA}".` });
        }

        // ── 1. Leer todas las filas ──────────────────────────────────────────
        const filas = [];
        ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // encabezado
            const get = (c) => row.getCell(c).value;
            filas.push({
                rowNumber,
                nombre: norm(get(COLUMNAS.nombre.col)),
                codigo: norm(get(COLUMNAS.codigo.col)),
                familia: norm(get(COLUMNAS.familia.col)),
                color: norm(get(COLUMNAS.color.col)),
                precio: get(COLUMNAS.precio.col),
                mayorista: get(COLUMNAS.mayorista.col),
                surtido: get(COLUMNAS.surtido.col),
                costo: get(COLUMNAS.costo.col),
                subcategoria: norm(get(COLUMNAS.subcategoria.col)),
                talla: norm(get(COLUMNAS.talla.col))
            });
        });

        // ── 1.1 Filas sin SKU: se pregunta antes de tocar nada ───────────────
        // Si hay filas con nombre pero sin código y el usuario todavía no autorizó que el
        // sistema los genere, se corta acá SIN crear ningún producto: el navegador le
        // pregunta y, si acepta, reenvía el mismo archivo con generarSku=true. Así una
        // columna B vacía por error nunca termina en productos con códigos que nadie pidió.
        const filasSinSku = filas.filter((f) => f.nombre && !f.codigo).map((f) => f.rowNumber);
        if (filasSinSku.length && !generarSku) {
            return res.status(409).json({
                success: false,
                requiereConfirmacionSku: true,
                filasSinSku: filasSinSku.length,
                ejemploFilas: filasSinSku.slice(0, 10),
                mensaje: `${filasSinSku.length} fila(s) no tienen SKU.`
            });
        }

        // ── 2. Precargar catálogos (sin consultas dentro del for) ────────────
        const { subcategorias, mapaColor, mapaTalla } = await cargarCatalogos();

        const productosExistentes = await Productos.findAll({ attributes: ['sku', 'nombreProducto'] });
        const skusExistentes = new Set(productosExistentes.map((p) => p.sku));
        const nombresExistentes = new Set(productosExistentes.map((p) => clave(p.nombreProducto)));

        // ── 3. Clasificar cada fila ───────────────────────────────────────────
        const skusVistos = new Set();
        const nombresVistos = new Set();
        const malos = []; // { rowNumber, nombre, sku, motivo }
        const aCrear = [];

        for (const f of filas) {
            const nombreFinal = f.nombre ? tituloDesdeNombre(f.nombre) : null;

            // Obligatorios sin excepción: nombre, color y talla resueltos. El SKU también,
            // salvo que el usuario haya autorizado generarlo (1.1): si llegamos acá sin
            // código es porque lo autorizó, y se pide en el paso 4 dentro de la transacción.
            if (!f.nombre) {
                malos.push({ rowNumber: f.rowNumber, nombre: '', sku: f.codigo || '', motivo: 'Falta el nombre del producto' });
                continue;
            }
            const idColor = f.color ? mapaColor.get(clave(f.color)) : null;
            if (!f.color || !idColor) {
                malos.push({ rowNumber: f.rowNumber, nombre: nombreFinal, sku: f.codigo, motivo: f.color ? `Color no reconocido: "${f.color}"` : 'Falta el color' });
                continue;
            }
            const idTalla = f.talla ? mapaTalla.get(clave(f.talla)) : null;
            if (!f.talla || !idTalla) {
                malos.push({ rowNumber: f.rowNumber, nombre: nombreFinal, sku: f.codigo, motivo: f.talla ? `Talla no reconocida: "${f.talla}"` : 'Falta la talla' });
                continue;
            }

            // La base de datos siempre gana: si ya existe, esta fila no se toca.
            const claveNombre = clave(nombreFinal);
            if ((f.codigo && skusExistentes.has(f.codigo)) || nombresExistentes.has(claveNombre)) {
                malos.push({ rowNumber: f.rowNumber, nombre: nombreFinal, sku: f.codigo, motivo: 'Ya existe en la base de datos (no se modifica)' });
                continue;
            }
            if ((f.codigo && skusVistos.has(f.codigo)) || nombresVistos.has(claveNombre)) {
                malos.push({ rowNumber: f.rowNumber, nombre: nombreFinal, sku: f.codigo, motivo: 'Nombre o SKU duplicado dentro del mismo Excel' });
                continue;
            }

            // Categoría: obligatoria salvo que el checklist permita dejarla vacía.
            let idCategoriaFinal = null;
            const subcategoria = subcategorias.get(clave(f.subcategoria));
            if (subcategoria) {
                idCategoriaFinal = `${subcategoria.idPadre}|${subcategoria.idCategoria}`;
            } else if (!permitirVacio.categoria) {
                malos.push({ rowNumber: f.rowNumber, nombre: nombreFinal, sku: f.codigo, motivo: f.subcategoria ? `Subcategoría no reconocida: "${f.subcategoria}"` : 'Falta la subcategoría' });
                continue;
            }

            // Precios y costo: obligatorios salvo que el checklist los permita vacíos.
            const camposPrecio = [
                ['precio', 'precioVentaPublicoFinal', 'Precio público'],
                ['mayorista', 'precioVentaMayorista', 'Precio mayorista'],
                ['surtido', 'precioVentaMayoristaSurtido', 'Precio mayorista surtido'],
                ['costo', 'costo', 'Costo']
            ];
            let faltaPrecio = null;
            let precioInvalido = null;
            const valoresPrecio = {};
            for (const [colExcel, campoDB, etiqueta] of camposPrecio) {
                const valor = f[colExcel];
                const vacio = valor === null || valor === undefined || valor === '';
                if (vacio && !permitirVacio[campoDB]) { faltaPrecio = etiqueta; break; }
                // `montoNoNegativo` devuelve null para un negativo o para algo que no es un
                // número. Con `limpiarPrecio` a secas, una celda con -8000 entraba como
                // 8000 y una con texto como 0 — sin que nadie se enterara.
                const limpio = vacio ? 0 : montoNoNegativo(valor);
                if (limpio === null) { precioInvalido = etiqueta; break; }
                valoresPrecio[campoDB] = limpio;
            }
            if (faltaPrecio) {
                malos.push({ rowNumber: f.rowNumber, nombre: nombreFinal, sku: f.codigo, motivo: `${faltaPrecio} vacío` });
                continue;
            }
            if (precioInvalido) {
                malos.push({ rowNumber: f.rowNumber, nombre: nombreFinal, sku: f.codigo, motivo: `${precioInvalido} negativo o no numérico` });
                continue;
            }

            if (f.codigo) skusVistos.add(f.codigo);
            nombresVistos.add(claveNombre);

            aCrear.push({
                rowNumber: f.rowNumber,
                nombreProducto: nombreFinal,
                sku: f.codigo,
                idCategoria: idCategoriaFinal,
                familiaTexto: f.familia,
                idTalla,
                idColor,
                ...valoresPrecio
            });
        }

        // ── 4. Crear productos (una transacción por producto) ────────────────
        const creados = []; // { rowNumber, nombre, sku, generado, origen }
        for (const p of aCrear) {
            const t = await db.transaction();
            try {
                // Mismo generador que el alta del panel: el número sale del contador dentro
                // de esta transacción, así que si la fila falla el correlativo no se pierde.
                const sku = p.sku || await siguienteSkuInterno(t);
                const idFamiliaFinal = await resolverIdFamilia(p.familiaTexto, t);
                const slug = await slugUnico(generarSlugDe(p.nombreProducto), { transaction: t });
                const producto = await Productos.create({
                    nombreProducto: p.nombreProducto,
                    slug,
                    sku,
                    idCategoria: p.idCategoria,
                    idFamilia: idFamiliaFinal,
                    precioVentaPublicoFinal: p.precioVentaPublicoFinal,
                    precioVentaMayorista: p.precioVentaMayorista,
                    precioVentaMayoristaSurtido: p.precioVentaMayoristaSurtido,
                    costo: p.costo,
                    web: false
                }, { transaction: t });

                await VariacionesProducto.create({
                    idProducto: producto.idProducto,
                    idAtributos: `${p.idTalla}|${p.idColor}`,
                    valor: 0
                }, { transaction: t });

                await t.commit();
                creados.push({ rowNumber: p.rowNumber, nombre: p.nombreProducto, sku, generado: !p.sku, origen: p.sku ? 'Del Excel' : 'Generado por el sistema' });
            } catch (e) {
                if (!t.finished) await t.rollback().catch(() => {});
                malos.push({ rowNumber: p.rowNumber, nombre: p.nombreProducto, sku: p.sku, motivo: `Error al crear: ${e.message}` });
            }
        }

        // ── 5. Informe descargable: lo que no se creó y lo que sí, con su SKU ──
        // La hoja CREADOS es la única forma de saber qué código recibió cada producto
        // cuando lo generó el sistema (para etiquetas o para pasarlos a otro sistema).
        const informe = new ExcelJS.Workbook();
        const hoja = informe.addWorksheet('INFORME');
        hoja.columns = [
            { header: 'FILA', key: 'rowNumber', width: 8 },
            { header: 'NOMBRE', key: 'nombre', width: 40 },
            { header: 'SKU', key: 'sku', width: 20 },
            { header: 'MOTIVO', key: 'motivo', width: 50 }
        ];
        hoja.getRow(1).font = { bold: true };
        malos.sort((a, b) => a.rowNumber - b.rowNumber).forEach((m) => hoja.addRow(m));

        const hojaCreados = informe.addWorksheet('CREADOS');
        hojaCreados.columns = [
            { header: 'FILA', key: 'rowNumber', width: 8 },
            { header: 'NOMBRE', key: 'nombre', width: 40 },
            { header: 'SKU', key: 'sku', width: 20 },
            { header: 'ORIGEN DEL SKU', key: 'origen', width: 24 }
        ];
        hojaCreados.getRow(1).font = { bold: true };
        hojaCreados.getColumn('sku').numFmt = '@';
        creados.forEach((c) => hojaCreados.addRow(c));
        const buffer = await informe.xlsx.writeBuffer();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="informe-importacion.xlsx"');
        res.setHeader('X-Importacion-Creados', String(creados.length));
        res.setHeader('X-Importacion-Generados', String(creados.filter((c) => c.generado).length));
        res.setHeader('X-Importacion-Malos', String(malos.length));
        res.setHeader('X-Importacion-Total', String(filas.length));
        return res.send(Buffer.from(buffer));
    } catch (error) {
        console.error('procesarImportacionExcel:', error);
        return res.status(500).json({ success: false, mensaje: `Error al procesar el archivo: ${error.message}` });
    }
};

export { formularioImportaciones, procesarImportacionExcel, descargarPlantillaImportacion };
