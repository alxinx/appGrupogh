import ExcelJS from 'exceljs';
import db from '../config/bd.js';
import { Productos, Familia, Categorias, Atributos, VariacionesProducto } from '../models/index.js';
import { limpiarPrecio } from '../helpers/helpers.js';
import { generarSlugDe, slugUnico, resolverIdFamilia } from '../helpers/productos.js';

// Importador masivo de productos desde el Excel del proveedor (mismo formato de columnas
// que TABLA PRODUCTOS.xlsm, hoja CODIGOS, que ya se usó para la carga inicial vía
// seed/importarProductosCodigosExcel.js). Esta es la versión "botón en el panel" de esa
// misma lógica: la diferencia de fondo es que acá corre contra la base real de la app con
// Sequelize (transacción de verdad por producto), no un script suelto contra una copia
// local que después hay que sincronizar a mano.
//
// Reglas de negocio (acordadas 2026-08-22):
//   · La base de datos SIEMPRE gana: si el nombre o el SKU ya existen, esa fila no se toca.
//   · Obligatorios siempre, sin excepción del checklist: nombre, SKU, color, talla. Si el
//     color o la talla no vacíos no matchean ningún ATRIBUTOS existente, tampoco se crea.
//   · Familia: coincidencia exacta por nombre: si no existe, se crea sola. Nunca bloquea.
//   · El resto (los 4 precios, la categoría) se puede dejar vacío/0/null SOLO si el
//     checklist lo permite explícitamente para esa importación — por defecto, si falta,
//     la fila no se crea.
//   · Al final se genera un informe descargable con toda fila que no se creó y por qué.

const HOJA = 'CODIGOS';

const norm = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
};
// Tolerante a acentos/mayúsculas: el Excel trae grafía inconsistente ("CAFE" vs "Café").
const clave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const tituloDesdeNombre = (raw) => raw.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const formularioImportaciones = async (req, res) => {
    return res.status(200).render('./administrador/configuracion/importaciones', {
        pagina: 'Configuración',
        subPagina: 'Importaciones',
        csrfToken: req.csrfToken(),
        currentPath: '/configuracion'
    });
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

        // ── 2. Precargar catálogos (sin consultas dentro del for) ────────────
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

            // Obligatorios sin excepción: nombre, sku, color y talla resueltos.
            if (!f.nombre || !f.codigo) {
                malos.push({ rowNumber: f.rowNumber, nombre: f.nombre || '', sku: f.codigo || '', motivo: 'Falta el nombre del producto o el SKU' });
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
            if (skusExistentes.has(f.codigo) || nombresExistentes.has(claveNombre)) {
                malos.push({ rowNumber: f.rowNumber, nombre: nombreFinal, sku: f.codigo, motivo: 'Ya existe en la base de datos (no se modifica)' });
                continue;
            }
            if (skusVistos.has(f.codigo) || nombresVistos.has(claveNombre)) {
                malos.push({ rowNumber: f.rowNumber, nombre: nombreFinal, sku: f.codigo, motivo: 'Nombre o SKU duplicado dentro del mismo Excel' });
                continue;
            }

            // Categoría: obligatoria salvo que el checklist permita dejarla vacía.
            let idCategoriaFinal = null;
            const matches = mapaSubcategoria.get(clave(f.subcategoria));
            if (matches && matches.length === 1) {
                idCategoriaFinal = `${matches[0].idPadre}|${matches[0].idCategoria}`;
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
            const valoresPrecio = {};
            for (const [colExcel, campoDB, etiqueta] of camposPrecio) {
                const valor = f[colExcel];
                const vacio = valor === null || valor === undefined || valor === '';
                if (vacio && !permitirVacio[campoDB]) { faltaPrecio = etiqueta; break; }
                valoresPrecio[campoDB] = vacio ? 0 : (parseInt(limpiarPrecio(valor)) || 0);
            }
            if (faltaPrecio) {
                malos.push({ rowNumber: f.rowNumber, nombre: nombreFinal, sku: f.codigo, motivo: `${faltaPrecio} vacío` });
                continue;
            }

            skusVistos.add(f.codigo);
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
        let creados = 0;
        for (const p of aCrear) {
            const t = await db.transaction();
            try {
                const idFamiliaFinal = await resolverIdFamilia(p.familiaTexto, t);
                const slug = await slugUnico(generarSlugDe(p.nombreProducto), { transaction: t });
                const producto = await Productos.create({
                    nombreProducto: p.nombreProducto,
                    slug,
                    sku: p.sku,
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
                creados++;
            } catch (e) {
                if (!t.finished) await t.rollback().catch(() => {});
                malos.push({ rowNumber: p.rowNumber, nombre: p.nombreProducto, sku: p.sku, motivo: `Error al crear: ${e.message}` });
            }
        }

        // ── 5. Informe descargable con todo lo que no se creó ────────────────
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
        const buffer = await informe.xlsx.writeBuffer();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="informe-importacion.xlsx"');
        res.setHeader('X-Importacion-Creados', String(creados));
        res.setHeader('X-Importacion-Malos', String(malos.length));
        res.setHeader('X-Importacion-Total', String(filas.length));
        return res.send(Buffer.from(buffer));
    } catch (error) {
        console.error('procesarImportacionExcel:', error);
        return res.status(500).json({ success: false, mensaje: `Error al procesar el archivo: ${error.message}` });
    }
};

export { formularioImportaciones, procesarImportacionExcel };
