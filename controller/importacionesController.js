import ExcelJS from 'exceljs';
import db from '../config/bd.js';
import { Productos, Familia, Categorias, Atributos, VariacionesProducto, Clientes, Municipios, Departamentos } from '../models/index.js';
import { montoNoNegativo } from '../helpers/helpers.js';
import { generarSlugDe, slugUnico, resolverIdFamilia, siguienteSkuInterno } from '../helpers/productos.js';
import { crearClienteCompleto, toPascal, TIPOS_DOC_CLIENTE, REGIMEN_RESPONSABLE_IVA, REGIMEN_NO_RESPONSABLE_IVA } from '../helpers/clientes.js';

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

// ── IMPORTACIÓN DE CLIENTES ──────────────────────────────────────────────────
// Pantalla aparte de la de productos: comparten la forma —subir un Excel, revisar, crear—
// pero no los datos ni las reglas. Un cliente escribe en tres tablas (CLIENTES,
// CLIENTES_TRIBUTARIO y CLIENTES_UBICACION) y su documento es único; un producto no.
const formularioImportarClientes = async (req, res) => {
    return res.status(200).render('./administrador/configuracion/importarClientes', {
        pagina: 'Configuración',
        subPagina: 'Importar clientes',
        // El menú lateral marca la sección por la carpeta del recurso, no por la URL
        // exacta: con '/configuracion' queda activa como en las demás pantallas de acá.
        currentPath: '/configuracion',
        csrfToken: req.csrfToken()
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


// ─────────────────────────────────────────────────────────────────────────────
// IMPORTACIÓN DE CLIENTES
// ─────────────────────────────────────────────────────────────────────────────
//
// El Excel es el export de EFFI ya limpiado (Clientes_EFFI_limpio.xlsx). Dos hojas:
//
//   Clientes          una fila por cliente — es la única de la que se importa
//   Verificación NIT  una fila por cada NIT del archivo, con la razón social que devuelve
//                     el RUT y una "Observación" cuando no coincide con el nombre de EFFI
//
// Las demás hojas del archivo (cédulas largas, nombres dañados, registros inválidos, notas)
// son bitácora de la limpieza y se ignoran: sus filas ya se sacaron de `Clientes`.
//
// Reglas de negocio de esta importación, decididas con el operador:
//
//  1. `tipo_persona` se toma literal de la columna (N/J). Una persona natural puede tener
//     NIT —un RUT de régimen simplificado— así que NO se deduce de que el documento sea NIT.
//     Por eso este importador no usa TIPOS_DOC_CLIENTE_NATURAL: el formulario del panel sí
//     lo restringe, acá el dato viene de un sistema que ya lo tenía así.
//  2. Un NIT con observación en "Verificación NIT" NO se importa: la razón social del RUT no
//     coincide con el nombre de EFFI, o el número tiene un reparo. Va al informe.
//  3. El régimen se mapea literal: "Régimen común" → 48 (responsable de IVA). Vacío → 49.
//     No se infiere de otras columnas.
//  4. El teléfono sale SOLO de la columna "Celular". "Teléfono 1" y "Teléfono 2" del export
//     traen fijos viejos y repetidos de la sede, no del cliente.
//  5. Un documento que ya existe en CLIENTES no se carga, y un documento repetido dentro del
//     Excel se carga una sola vez (la primera fila). `numero_doc` es único.
//  6. Los correos de Grupo GH y los de relleno se dejan en blanco: no son del cliente.
//  7. Las direcciones se importan tal como vienen, con los caracteres dañados incluidos —
//     se corrigen después, contra la base, no acá.
//  8. La fila es sólo un cliente: no se crea crédito, ni cupo, ni documentos en R2.

const HOJA_CLIENTES = 'Clientes';
const HOJA_NIT = 'Verificación NIT';

// Columnas del export de EFFI, por posición. El encabezado se verifica al leer: si el
// archivo viene con otro orden, mejor cortar que importar 2.500 clientes corridos.
const COL_CLI = {
    tipoDocumento: 1,
    numeroDoc: 2,
    digitoVerif: 3,
    primerNombre: 4,
    segundoNombre: 5,
    primerApellido: 6,
    segundoApellido: 7,
    celular: 10,
    email: 11,
    codDepartamento: 13,
    codCiudad: 15,
    direccion: 17,
    tipoPersona: 18,
    regimen: 19,
    ciiu: 21,
    vigencia: 27
};

// Lo mínimo que tiene que decir el encabezado para dar por bueno el orden de columnas.
const ENCABEZADO_ESPERADO = {
    1: 'tipo de identificación',
    2: 'número de identificación',
    10: 'celular',
    15: 'cod ciudad',
    17: 'dirección',
    18: 'tipo de persona'
};

// Correos que están en el export pero no son del cliente: los de Grupo GH, que el operador
// usaba para poder guardar la ficha, y los de relleno explícito.
const CORREOS_DE_LA_CASA = new Set([
    'graficogh@gmail.com', 'ghgrafico@gmail.com', 'grupogh@gmail.com',
    'ghuvitactg@gmail.com', 'notiene@correo.com', 'notiene@gmail.com',
    'sincorreo@gmail.com', 'noaplica@gmail.com'
]);

// Un correo que aparece en tres o más clientes distintos tampoco identifica a nadie
// ("carolina@gmail.com" en seis fichas). Con dos se conserva: es la pareja o el familiar
// que comparte el correo de verdad.
const MAX_CLIENTES_POR_CORREO = 2;

const ES_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Celda a texto plano: sirve para las celdas con fórmula o con hipervínculo del export. */
const texto = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
        if (v.result !== undefined) return String(v.result).trim();
        if (v.text !== undefined) return String(v.text).trim();
        if (v.richText) return v.richText.map((r) => r.text).join('').trim();
        return '';
    }
    return String(v).trim();
};

/** Código DIVIPOLA: 5 dígitos para municipio, 2 para departamento, con el cero adelante. */
const codigoDivipola = (v, largo) => {
    const solo = texto(v).replace(/\D/g, '');
    return solo ? solo.padStart(largo, '0') : '';
};

const descargarPlantillaClientes = async (req, res) => {
    try {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet(HOJA_CLIENTES);

        // Mismo orden y mismos títulos que el export de EFFI: la plantilla existe para que
        // alguien que no tiene ese export pueda armar el archivo a mano, no para proponer
        // un formato distinto del que el importador ya lee.
        const columnas = [
            ['Tipo de identificación', 18], ['Número de identificación', 22], ['DV', 6],
            ['Primer Nombre', 18], ['Segundo Nombre', 18], ['Primer Apellido', 18], ['Segundo Apellido', 18],
            ['Teléfono 1', 14], ['Teléfono 2', 14], ['Celular', 14], ['Email', 30],
            ['País', 12], ['Cod Departamento', 16], ['Departamento', 20],
            ['Cod Ciudad', 12], ['Ciudad', 22], ['Dirección', 40],
            ['Tipo de persona', 15], ['Régimen tributario', 18], ['Tipo de cliente', 15],
            ['Actividad económica CIIU', 34], ['Forma de pago', 14], ['Moneda principal', 20],
            ['Sucursal', 14], ['Responsable asignado', 22], ['Fecha última venta', 20],
            ['Vigencia', 12], ['Fecha de creación', 20], ['Responsable de creación', 26],
            ['Fecha de modificación', 20], ['Responsable de modificación', 26],
            ['Fecha de anulación', 20], ['Responsable de anulación', 26]
        ];
        ws.columns = columnas.map(([, ancho]) => ({ width: ancho }));
        const cabecera = ws.getRow(1);
        columnas.forEach(([titulo], i) => { cabecera.getCell(i + 1).value = titulo; });
        cabecera.font = { bold: true };
        cabecera.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE7F2' } }; });
        ws.views = [{ state: 'frozen', ySplit: 1 }];

        // Documento, celular y los códigos DIVIPOLA como texto: los ceros a la izquierda de
        // '05001' son parte del código, y Excel se los come si la columna es numérica.
        [COL_CLI.numeroDoc, COL_CLI.digitoVerif, 8, 9, COL_CLI.celular,
            COL_CLI.codDepartamento, COL_CLI.codCiudad].forEach((c) => { ws.getColumn(c).numFmt = '@'; });

        const hojaNit = wb.addWorksheet(HOJA_NIT);
        hojaNit.columns = [
            { header: 'Fila en Clientes', width: 16 }, { header: 'NIT', width: 18 },
            { header: 'DV', width: 6 }, { header: 'Nombre en EFFI', width: 34 },
            { header: 'Razón social en RUT (sipos.com.co)', width: 38 },
            { header: 'Observación', width: 60 }
        ];
        hojaNit.getRow(1).font = { bold: true };

        const guia = wb.addWorksheet('INSTRUCCIONES');
        guia.columns = [{ width: 4 }, { width: 120 }];
        const lineas = [
            'Cómo llenar este archivo',
            '',
            '1. Una fila por cliente en la hoja "Clientes". El encabezado no se cambia ni se reordena.',
            '2. "Tipo de identificación": CC, CE, TI, NIT, PP, PPT o PEP.',
            '3. "Tipo de persona": N (natural) o J (jurídica). Una persona natural también puede tener NIT.',
            '4. "Número de identificación" es único: si ya existe un cliente con ese número, la fila no se carga.',
            '5. "Cod Departamento" (2 dígitos) y "Cod Ciudad" (5 dígitos) son códigos DIVIPOLA del DANE, como texto.',
            '   Sin "Cod Ciudad" válido no se crea la ubicación del cliente, pero el cliente sí se crea.',
            '6. El teléfono se toma SOLO de la columna "Celular". "Teléfono 1" y "Teléfono 2" no se importan.',
            '7. "Régimen tributario": escribir "Régimen común" para responsable de IVA. Vacío = no responsable.',
            '8. "Actividad económica CIIU" es la descripción de la actividad, no el código.',
            '',
            'Hoja "Verificación NIT" (opcional)',
            '',
            'Una fila por cada NIT del archivo. Si la columna "Observación" tiene texto, ese NIT NO se importa:',
            'quiere decir que la razón social del RUT no coincide con el nombre, o que el número tiene un reparo.',
            'Dejar la observación vacía es autorizar que ese NIT se cargue.',
            '',
            'Al terminar se descarga un informe con dos hojas: CREADOS y NO IMPORTADOS, con el motivo de cada fila.'
        ];
        lineas.forEach((linea, i) => {
            const fila = guia.getRow(i + 1);
            fila.getCell(2).value = linea;
            if (i === 0 || linea === 'Hoja "Verificación NIT" (opcional)') fila.getCell(2).font = { bold: true, size: 12 };
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="plantilla-clientes.xlsx"');
        const buffer = await wb.xlsx.writeBuffer();
        return res.send(Buffer.from(buffer));
    } catch (error) {
        console.error('descargarPlantillaClientes:', error);
        return res.status(500).send('No se pudo generar la plantilla.');
    }
};

const procesarImportacionClientes = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, mensaje: 'No se recibió ningún archivo.' });
        }

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(req.file.buffer);
        const ws = wb.getWorksheet(HOJA_CLIENTES);
        if (!ws) {
            return res.status(400).json({ success: false, mensaje: `El Excel no tiene una hoja llamada "${HOJA_CLIENTES}".` });
        }

        // ── 1. El encabezado tiene que ser el que este importador sabe leer ──
        const encabezado = ws.getRow(1);
        const desalineadas = Object.entries(ENCABEZADO_ESPERADO)
            .filter(([col, esperado]) => !texto(encabezado.getCell(Number(col)).value).toLowerCase().includes(esperado))
            .map(([col, esperado]) => `columna ${col} debería ser "${esperado}"`);
        if (desalineadas.length) {
            return res.status(400).json({
                success: false,
                mensaje: `El encabezado de "${HOJA_CLIENTES}" no coincide con el formato esperado (${desalineadas.join('; ')}). Descargá la plantilla y usá ese orden de columnas.`
            });
        }

        // ── 2. NIT observados: los que no se importan (decisión 2) ───────────
        // La hoja es opcional. Si no viene, no hay NIT vetado y entran todos.
        const nitObservados = new Map(); // numero_doc → observación
        const hojaNit = wb.getWorksheet(HOJA_NIT);
        if (hojaNit) {
            hojaNit.eachRow({ includeEmpty: false }, (fila, n) => {
                if (n === 1) return;
                const nit = texto(fila.getCell(2).value).replace(/\D/g, '');
                const observacion = texto(fila.getCell(6).value);
                if (nit && observacion) nitObservados.set(nit, observacion);
            });
        }

        // ── 3. Leer las filas ────────────────────────────────────────────────
        const filas = [];
        ws.eachRow({ includeEmpty: false }, (fila, n) => {
            if (n === 1) return;
            const get = (c) => texto(fila.getCell(c).value);
            const numeroDoc = get(COL_CLI.numeroDoc).replace(/\s/g, '');
            // Una fila sin documento y sin nombre es una fila vacía que quedó en la hoja.
            if (!numeroDoc && !get(COL_CLI.primerNombre)) return;
            filas.push({
                rowNumber: n,
                tipoDocumento: get(COL_CLI.tipoDocumento).toUpperCase(),
                numeroDoc,
                digitoVerif: get(COL_CLI.digitoVerif).replace(/\D/g, ''),
                primerNombre: get(COL_CLI.primerNombre),
                segundoNombre: get(COL_CLI.segundoNombre),
                primerApellido: get(COL_CLI.primerApellido),
                segundoApellido: get(COL_CLI.segundoApellido),
                celular: get(COL_CLI.celular),
                email: get(COL_CLI.email).toLowerCase(),
                codDepartamento: codigoDivipola(fila.getCell(COL_CLI.codDepartamento).value, 2),
                codCiudad: codigoDivipola(fila.getCell(COL_CLI.codCiudad).value, 5),
                direccion: get(COL_CLI.direccion),
                tipoPersona: get(COL_CLI.tipoPersona).toUpperCase(),
                regimen: get(COL_CLI.regimen),
                ciiu: get(COL_CLI.ciiu),
                vigencia: get(COL_CLI.vigencia)
            });
        });

        if (!filas.length) {
            return res.status(400).json({ success: false, mensaje: `La hoja "${HOJA_CLIENTES}" no tiene filas con datos.` });
        }

        // ── 4. Catálogos y documentos ya existentes, en consultas fijas ──────
        // Tres consultas para todo el archivo: ni una dentro del bucle (CLAUDE.md §7).
        const [documentosEnBase, municipios, departamentos] = await Promise.all([
            Clientes.findAll({ attributes: ['numero_doc'], raw: true }),
            Municipios.findAll({ attributes: ['id', 'nombre'], raw: true }),
            Departamentos.findAll({ attributes: ['id', 'nombre'], raw: true })
        ]);
        const yaExisten = new Set(documentosEnBase.map((c) => String(c.numero_doc).trim()));
        const mapaMunicipio = new Map(municipios.map((m) => [String(m.id), m.nombre]));
        const mapaDepartamento = new Map(departamentos.map((d) => [String(d.id), d.nombre]));

        // Correos compartidos por más de dos clientes: se resuelve antes del bucle porque
        // depende del archivo entero, no de la fila.
        const vecesPorCorreo = new Map();
        filas.forEach((f) => {
            if (f.email) vecesPorCorreo.set(f.email, (vecesPorCorreo.get(f.email) || 0) + 1);
        });

        // ── 5. Clasificar cada fila ──────────────────────────────────────────
        const rechazadas = []; // { rowNumber, documento, nombre, motivo }
        const aCrear = [];
        const documentosVistos = new Set();
        let correosDescartados = 0;
        let ubicacionIncompleta = 0;

        for (const f of filas) {
            const nombreVisible = [f.primerNombre, f.segundoNombre, f.primerApellido, f.segundoApellido]
                .filter(Boolean).join(' ');
            const rechazar = (motivo) => rechazadas.push({
                rowNumber: f.rowNumber, documento: f.numeroDoc, nombre: nombreVisible, motivo
            });

            if (!f.numeroDoc) { rechazar('Falta el número de identificación'); continue; }
            if (!/^\d+$/.test(f.numeroDoc)) { rechazar(`El número de identificación no es numérico: "${f.numeroDoc}"`); continue; }
            if (f.numeroDoc.length > 20) { rechazar(`El número de identificación tiene ${f.numeroDoc.length} dígitos (máximo 20)`); continue; }
            if (!nombreVisible) { rechazar('Falta el nombre o la razón social'); continue; }
            if (!TIPOS_DOC_CLIENTE.includes(f.tipoDocumento)) {
                rechazar(f.tipoDocumento ? `Tipo de identificación no reconocido: "${f.tipoDocumento}"` : 'Falta el tipo de identificación');
                continue;
            }
            if (f.tipoPersona && !['N', 'J'].includes(f.tipoPersona)) {
                rechazar(`Tipo de persona no reconocido: "${f.tipoPersona}" (se espera N o J)`);
                continue;
            }

            // Decisión 2: el NIT con reparo en el RUT no entra.
            const observacion = nitObservados.get(f.numeroDoc);
            if (observacion) { rechazar(`NIT con observación en "${HOJA_NIT}": ${observacion}`); continue; }

            // Decisión 5: un documento, un cliente.
            if (yaExisten.has(f.numeroDoc)) { rechazar('Ya existe un cliente con ese número de identificación'); continue; }
            if (documentosVistos.has(f.numeroDoc)) { rechazar('Número de identificación repetido en el Excel (se cargó la primera vez que aparece)'); continue; }
            documentosVistos.add(f.numeroDoc);

            // Un NIT lleva la razón social completa en "Primer Nombre" —así lo exporta EFFI,
            // sin separar— y no se parte en nombres y apellidos.
            const esNit = f.tipoDocumento === 'NIT';

            // Decisión 6: el correo de la casa o el compartido por muchos no es del cliente.
            let email = f.email;
            if (email && (!ES_EMAIL.test(email) || CORREOS_DE_LA_CASA.has(email)
                || (vecesPorCorreo.get(email) || 0) > MAX_CLIENTES_POR_CORREO)) {
                email = '';
                correosDescartados++;
            }

            // Decisión 4: el teléfono es el celular, tal como quedó normalizado en el
            // archivo (algunos son extranjeros y traen +). Se recorta a lo que entra en la
            // columna en vez de perder el dato entero.
            const telefono = f.celular ? f.celular.replace(/[^\d+]/g, '').slice(0, 20) : '';

            // Decisión 3: el régimen se mapea literal, sin inferir de otras columnas.
            const regimenFiscal = /r[eé]gimen\s+com[uú]n/i.test(f.regimen)
                ? REGIMEN_RESPONSABLE_IVA
                : REGIMEN_NO_RESPONSABLE_IVA;

            // CLIENTES_UBICACION.idMunicipio y .idDepartamento son FK con RESTRICT: un
            // código que no esté en la tabla no se puede guardar. En ese caso se guarda la
            // ubicación con lo que sí resolvió (la dirección y el departamento, por ejemplo)
            // y el código que falló queda anotado en la columna AVISO del informe. Nunca se
            // rechaza el cliente por la ubicación: el cliente importa más que su dirección.
            const nombreMunicipio = f.codCiudad ? mapaMunicipio.get(f.codCiudad) : undefined;
            const nombreDepartamento = f.codDepartamento ? mapaDepartamento.get(f.codDepartamento) : undefined;
            const municipioValido = Boolean(nombreMunicipio);
            const departamentoValido = Boolean(nombreDepartamento);
            const avisoUbicacion = [];
            if (f.codCiudad && !municipioValido) avisoUbicacion.push(`municipio ${f.codCiudad} no existe`);
            if (f.codDepartamento && !departamentoValido) avisoUbicacion.push(`departamento ${f.codDepartamento} no existe`);
            if (avisoUbicacion.length) ubicacionIncompleta++;

            aCrear.push({
                rowNumber: f.rowNumber,
                documento: f.numeroDoc,
                nombre: nombreVisible,
                aviso: avisoUbicacion.join(', '),
                datos: {
                    // Decisión 1: el tipo de persona es el de la columna, no se deduce del NIT.
                    tipo_persona: f.tipoPersona || 'N',
                    tipoDocumento: f.tipoDocumento,
                    numero_doc: f.numeroDoc,
                    digito_verif: esNit ? (f.digitoVerif.slice(-1) || null) : null,
                    razon_social: esNit ? toPascal(f.primerNombre) : null,
                    primer_nombre: esNit ? null : toPascal(f.primerNombre),
                    segundo_nombre: esNit ? null : toPascal(f.segundoNombre),
                    primer_apellido: esNit ? null : toPascal(f.primerApellido),
                    segundo_apellido: esNit ? null : toPascal(f.segundoApellido),
                    email: email || null,
                    telefono: telefono || null,
                    genero: null, // el export no lo trae y no se adivina del nombre
                    regimen_fiscal: regimenFiscal,
                    // Las cuatro condiciones tributarias no están en el export: quedan en
                    // false, que es el default de la tabla. Inventarlas sería facturar con
                    // una retención que nadie declaró.
                    ciiu: null, // la columna del Excel es la DESCRIPCIÓN, no el código DIAN
                    descripcion_ciiu: f.ciiu ? f.ciiu.slice(0, 200) : null,
                    ubicacion: {
                        idDepartamento: departamentoValido ? f.codDepartamento : null,
                        nombreDepartamento: departamentoValido ? nombreDepartamento : null,
                        idMunicipio: municipioValido ? f.codCiudad : null,
                        nombreMunicipio: municipioValido ? nombreMunicipio : null,
                        // Decisión 7: la dirección entra tal cual, sin normalizar ni
                        // reparar los caracteres dañados del export.
                        direccion: f.direccion ? f.direccion.slice(0, 250) : null
                    }
                }
            });
        }

        // ── 6. Crear: una transacción por cliente ────────────────────────────
        // Una transacción por fila y no una sola para todo el archivo: son 2.500 clientes
        // independientes, y que la fila 1.800 tenga un dato raro no puede deshacer las
        // 1.799 que sí estaban bien. Cada cliente son tres tablas, y esas tres sí van juntas.
        const creados = [];
        for (const c of aCrear) {
            const t = await db.transaction();
            try {
                const idCliente = await crearClienteCompleto(c.datos, t);
                await t.commit();
                creados.push({
                    rowNumber: c.rowNumber,
                    documento: c.documento,
                    nombre: c.nombre,
                    idCliente,
                    aviso: c.aviso
                });
            } catch (e) {
                if (!t.finished) await t.rollback().catch(() => {});
                rechazadas.push({
                    rowNumber: c.rowNumber, documento: c.documento, nombre: c.nombre,
                    motivo: `Error al crear: ${e.message}`
                });
            }
        }

        // ── 7. Informe descargable ───────────────────────────────────────────
        const informe = new ExcelJS.Workbook();

        const hojaCreados = informe.addWorksheet('CREADOS');
        hojaCreados.columns = [
            { header: 'FILA', key: 'rowNumber', width: 8 },
            { header: 'DOCUMENTO', key: 'documento', width: 20 },
            { header: 'NOMBRE', key: 'nombre', width: 40 },
            { header: 'ID CLIENTE', key: 'idCliente', width: 38 },
            { header: 'AVISO', key: 'aviso', width: 44 }
        ];
        hojaCreados.getRow(1).font = { bold: true };
        hojaCreados.getColumn('documento').numFmt = '@';
        creados.forEach((c) => hojaCreados.addRow(c));

        const hojaMalas = informe.addWorksheet('NO IMPORTADOS');
        hojaMalas.columns = [
            { header: 'FILA', key: 'rowNumber', width: 8 },
            { header: 'DOCUMENTO', key: 'documento', width: 20 },
            { header: 'NOMBRE', key: 'nombre', width: 40 },
            { header: 'MOTIVO', key: 'motivo', width: 70 }
        ];
        hojaMalas.getRow(1).font = { bold: true };
        hojaMalas.getColumn('documento').numFmt = '@';
        rechazadas.sort((a, b) => a.rowNumber - b.rowNumber).forEach((m) => hojaMalas.addRow(m));

        const buffer = await informe.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="informe-importacion-clientes.xlsx"');
        res.setHeader('X-Importacion-Total', String(filas.length));
        res.setHeader('X-Importacion-Creados', String(creados.length));
        res.setHeader('X-Importacion-Malos', String(rechazadas.length));
        res.setHeader('X-Importacion-Ubicacion-Incompleta', String(ubicacionIncompleta));
        res.setHeader('X-Importacion-Correos-Descartados', String(correosDescartados));
        return res.send(Buffer.from(buffer));
    } catch (error) {
        console.error('procesarImportacionClientes:', error);
        return res.status(500).json({ success: false, mensaje: `Error al procesar el archivo: ${error.message}` });
    }
};

export {
    formularioImportaciones, procesarImportacionExcel, descargarPlantillaImportacion,
    formularioImportarClientes, procesarImportacionClientes, descargarPlantillaClientes
};
