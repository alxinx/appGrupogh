import { Op, fn, col, literal } from 'sequelize';
import {
    BannersWeb, CenefasWeb, SeccionesWeb, PopupWeb,
    Categorias, Productos, Imagenes, Stock, Atributos, VariacionesProducto, DetallesFactura
} from '../models/index.js';

const R2 = () => `${process.env.R2_PUBLIC_URL}/productos/`;

// GET /api/web/config
export const getConfig = async (req, res) => {
    try {
        const [banners, cenefas, secciones, popup] = await Promise.all([
            BannersWeb.findAll({
                where: { activo: true },
                attributes: ['idBanner', 'titulo', 'subtitulo', 'textoBoton', 'linkBoton', 'imagenUrl', 'orden'],
                order: [['orden', 'ASC'], ['createdAt', 'DESC']]
            }),
            CenefasWeb.findAll({
                where: { activo: true },
                attributes: ['idCenefa', 'texto', 'link', 'colorFondo', 'colorTexto', 'animacion'],
                order: [['createdAt', 'ASC']]
            }),
            SeccionesWeb.findAll({
                where: { activo: true },
                attributes: ['idSeccion', 'titulo', 'imagenUrl', 'idCategoria', 'orden'],
                include: [{
                    model: Categorias,
                    as: 'categoria',
                    attributes: ['idCategoria', 'nombreCategoria'],
                    required: false
                }],
                order: [['orden', 'ASC']]
            }),
            PopupWeb.findOne({
                where: { activo: true },
                attributes: ['idPopup', 'titulo', 'imagenUrl', 'link', 'delaySegundos']
            })
        ]);

        return res.json({
            banners,
            cenefas,
            secciones: secciones.map(s => s.toJSON()),
            popup: popup ? popup.toJSON() : null
        });
    } catch (e) {
        console.error('webApi.getConfig:', e);
        return res.status(500).json({ error: 'Error al obtener configuración' });
    }
};

// GET /api/web/categorias
export const getCategorias = async (req, res) => {
    try {
        const todas = await Categorias.findAll({
            where: { webActiva: true },
            attributes: ['idCategoria', 'nombreCategoria', 'tipo', 'idPadre'],
            order: [['nombreCategoria', 'ASC']]
        });

        // Contar productos por categoría padre
        const [conteoRows] = await Productos.sequelize.query(`
            SELECT idCategoria, COUNT(idProducto) AS total
            FROM PRODUCTOS WHERE activo = 1 AND web = 1
            GROUP BY idCategoria
        `);
        const mapaConteo = {};
        for (const row of conteoRows) {
            const padre = String(row.idCategoria).split('|')[0];
            if (!mapaConteo[padre]) mapaConteo[padre] = 0;
            mapaConteo[padre] += parseInt(row.total) || 0;
        }

        const subs = todas.filter(c => c.tipo === 'SUBCATEGORIA');
        const categorias = todas
            .filter(c => c.tipo === 'CATEGORIA')
            .map(c => ({
                idCategoria:     c.idCategoria,
                nombreCategoria: c.nombreCategoria,
                tipo:            c.tipo,
                idPadre:         c.idPadre,
                totalProductos:  mapaConteo[String(c.idCategoria)] ?? 0,
                subcategorias:   subs
                    .filter(s => s.idPadre === c.idCategoria)
                    .map(s => ({ idCategoria: s.idCategoria, nombreCategoria: s.nombreCategoria }))
            }));

        return res.json({ categorias });
    } catch (e) {
        console.error('webApi.getCategorias:', e);
        return res.status(500).json({ error: 'Error al obtener categorías' });
    }
};

// GET /api/web/productos?categoria&q&orden&pagina&limite&talla&color&precioMin&precioMax
export const getCatalogo = async (req, res) => {
    try {
        const { categoria, q, orden = 'nombre_asc', pagina = '1', limite = '15', talla, color, precioMin, precioMax } = req.query;
        const page  = Math.max(1, parseInt(pagina) || 1);
        const limit = Math.min(60, Math.max(1, parseInt(limite) || 15));
        const offset = (page - 1) * limit;

        const where = { activo: true, web: true };
        if (categoria) {
            where[Op.and] = [
                literal(`(idCategoria = '${String(categoria)}' OR idCategoria LIKE '${String(categoria)}|%')`)
            ];
        }
        if (q) {
            const term = `%${q.trim()}%`;
            where[Op.or] = [
                { nombreProducto: { [Op.like]: term } },
                { sku:            { [Op.like]: term } },
                { tags:           { [Op.like]: term } },
                { descripcion:    { [Op.like]: term } }
            ];
        }

        // Precio range filter
        if (precioMin || precioMax) {
            const precioWhere = {};
            if (precioMin) precioWhere[Op.gte] = parseFloat(precioMin);
            if (precioMax) precioWhere[Op.lte] = parseFloat(precioMax);
            where.precioVentaPublicoFinal = precioWhere;
        }

        // Talla filter via VARIACION_PRODUCTO + ATRIBUTOS
        if (talla) {
            const [tallaRows] = await Atributos.sequelize.query(
                'SELECT idAtributo FROM ATRIBUTOS WHERE tipo = ? AND valor = ?',
                { replacements: ['TALLA', String(talla)] }
            );
            const tallaIds = tallaRows.map(r => r.idAtributo).filter(Boolean);
            if (!tallaIds.length) return res.json({ productos: [], total: 0, paginas: 0, paginaActual: page });
            where[Op.and] = [
                ...(where[Op.and] ?? []),
                literal(`idProducto IN (SELECT idProducto FROM VARIACION_PRODUCTO WHERE idAtributos IN (${tallaIds.join(',')}))`)
            ];
        }

        // Color filter via VARIACION_PRODUCTO + ATRIBUTOS
        if (color) {
            const [colorRows] = await Atributos.sequelize.query(
                'SELECT idAtributo FROM ATRIBUTOS WHERE tipo = ? AND valor = ?',
                { replacements: ['COLOR', String(color)] }
            );
            const colorIds = colorRows.map(r => r.idAtributo).filter(Boolean);
            if (!colorIds.length) return res.json({ productos: [], total: 0, paginas: 0, paginaActual: page });
            where[Op.and] = [
                ...(where[Op.and] ?? []),
                literal(`idProducto IN (SELECT idProducto FROM VARIACION_PRODUCTO WHERE idAtributos IN (${colorIds.join(',')}))`)
            ];
        }

        // Novedades: productos creados o actualizados en los últimos 30 días
        if (orden === 'nuevo') {
            const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            where[Op.and] = [
                ...(where[Op.and] ?? []),
                { [Op.or]: [{ createdAt: { [Op.gte]: hace30 } }, { updatedAt: { [Op.gte]: hace30 } }] }
            ];
        }

        const ordenMap = {
            'nombre_asc': [
                // Suma de unidades vendidas en los últimos 30 días
                literal(`(
                    SELECT COALESCE(SUM(df.cantidad), 0)
                    FROM DETALLES_FACTURA df
                    WHERE df.idProducto = PRODUCTOS.idProducto
                    AND df.createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                ) DESC`),
                ['nombreProducto', 'ASC']
            ],
            'nombre_desc': [['nombreProducto', 'DESC']],
            'precio_asc':  [['precioVentaPublicoFinal', 'ASC']],
            'precio_desc': [['precioVentaPublicoFinal', 'DESC']],
            'nuevo':       [['createdAt', 'DESC']]
        };
        const order = ordenMap[orden] ?? ordenMap['nombre_asc'];

        const { count, rows } = await Productos.findAndCountAll({
            where,
            attributes: ['idProducto', 'nombreProducto', 'slug', 'precioVentaPublicoFinal', 'precioVentaMayorista', 'idCategoria'],
            include: [{
                model: Imagenes,
                as: 'imagenes',
                attributes: ['nombreImagen'],
                where: { tipo: 'principal' },
                required: false,
                limit: 1
            }],
            order,
            limit,
            offset,
            distinct: true
        });

        // Stock global por producto
        const ids = rows.map(p => p.idProducto);
        let mapaStock = {};
        let mapaVentas = {};
        if (ids.length) {
            const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const [stocks, ventas] = await Promise.all([
                Stock.findAll({
                    where: { idProducto: { [Op.in]: ids } },
                    attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'total']],
                    group: ['idProducto'],
                    raw: true
                }),
                DetallesFactura.findAll({
                    where: { idProducto: { [Op.in]: ids }, createdAt: { [Op.gte]: hace30 } },
                    attributes: ['idProducto', [fn('SUM', col('cantidad')), 'total']],
                    group: ['idProducto'],
                    raw: true
                })
            ]);
            mapaStock  = Object.fromEntries(stocks.map(r => [r.idProducto, parseInt(r.total) || 0]));
            mapaVentas = Object.fromEntries(ventas.map(r => [r.idProducto, parseFloat(r.total) || 0]));
        }

        const r2 = R2();
        const productos = rows.map(p => {
            const img = p.imagenes?.[0]?.nombreImagen;
            return {
                idProducto:       p.idProducto,
                nombreProducto:   p.nombreProducto,
                slug:             p.slug,
                precio:           parseFloat(p.precioVentaPublicoFinal) || 0,
                precioMayorista:  parseFloat(p.precioVentaMayorista)    || 0,
                idCategoria:      p.idCategoria,
                imagen:           img ? `${r2}${img}` : null,
                stockGlobal:      mapaStock[p.idProducto]  ?? 0,
                unidadesVendidas: mapaVentas[p.idProducto] ?? 0
            };
        });

        return res.json({
            productos,
            total:        count,
            paginas:      Math.ceil(count / limit),
            paginaActual: page
        });
    } catch (e) {
        console.error('webApi.getCatalogo:', e);
        return res.status(500).json({ error: 'Error al obtener catálogo' });
    }
};

// GET /api/web/filtros — mismos params que getCatalogo para reflejar productos filtrados
export const getFiltros = async (req, res) => {
    try {
        const { categoria, q, orden, talla, precioMin, precioMax } = req.query;

        const conds = ['p.activo = 1', 'p.web = 1'];
        const replacements = [];

        if (categoria) {
            const safe = String(categoria).replace(/[^0-9|]/g, '');
            conds.push(`(p.idCategoria = '${safe}' OR p.idCategoria LIKE '${safe}|%')`);
        }
        if (q) {
            const term = `%${q.trim()}%`;
            conds.push(`(p.nombreProducto LIKE ? OR p.sku LIKE ? OR p.tags LIKE ? OR p.descripcion LIKE ?)`);
            replacements.push(term, term, term, term);
        }
        if (orden === 'nuevo') {
            conds.push(`(p.createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY) OR p.updatedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY))`);
        }
        if (precioMin) { conds.push(`p.precioVentaPublicoFinal >= ?`); replacements.push(parseFloat(precioMin)); }
        if (precioMax) { conds.push(`p.precioVentaPublicoFinal <= ?`); replacements.push(parseFloat(precioMax)); }
        if (talla) {
            const [tallaRows] = await Atributos.sequelize.query(
                'SELECT idAtributo FROM ATRIBUTOS WHERE tipo = ? AND valor = ?',
                { replacements: ['TALLA', String(talla)] }
            );
            const ids = tallaRows.map(r => r.idAtributo).filter(Boolean);
            if (!ids.length) return res.json({ tallas: [], colores: [], precioMin: 0, precioMax: 0 });
            conds.push(`p.idProducto IN (SELECT idProducto FROM VARIACION_PRODUCTO WHERE idAtributos IN (${ids.join(',')}))`);
        }

        const where = conds.join(' AND ');

        const [atribRows] = await Atributos.sequelize.query(`
            SELECT DISTINCT a.idAtributo, a.tipo, a.valor, a.codigo1, a.codigo2
            FROM ATRIBUTOS a
            INNER JOIN VARIACION_PRODUCTO vp ON CAST(vp.idAtributos AS UNSIGNED) = a.idAtributo
            INNER JOIN PRODUCTOS p ON p.idProducto = vp.idProducto
            WHERE ${where}
            ORDER BY a.tipo, a.valor
        `, { replacements });

        const [[precioRow]] = await Atributos.sequelize.query(
            `SELECT MIN(precioVentaPublicoFinal) as minP, MAX(precioVentaPublicoFinal) as maxP FROM PRODUCTOS WHERE activo = 1 AND web = 1`
        );

        return res.json({
            tallas:    atribRows.filter(r => r.tipo === 'TALLA').map(r => ({ idAtributo: r.idAtributo, valor: r.valor })),
            colores:   atribRows.filter(r => r.tipo === 'COLOR').map(r => ({ idAtributo: r.idAtributo, valor: r.valor, codigo1: r.codigo1, codigo2: r.codigo2 ?? null })),
            precioMin: parseFloat(precioRow?.minP) || 0,
            precioMax: parseFloat(precioRow?.maxP) || 100000
        });
    } catch (e) {
        console.error('webApi.getFiltros:', e);
        return res.status(500).json({ error: 'Error al obtener filtros' });
    }
};

// GET /api/web/producto/:slug
export const getProducto = async (req, res) => {
    try {
        const { slug } = req.params;

        const producto = await Productos.findOne({
            where: {
                [Op.or]: [{ slug }, { idProducto: slug }],
                activo: true,
                web: true
            },
            attributes: [
                'idProducto', 'nombreProducto', 'slug', 'idCategoria',
                'precioVentaPublicoFinal', 'precioVentaMayorista', 'tax', 'sku', 'tags', 'descripcion'
            ],
            include: [{
                model: Imagenes,
                as: 'imagenes',
                attributes: ['nombreImagen', 'tipo'],
                required: false
            }]
        });

        if (!producto) return res.status(404).json({ success: false, mensaje: 'Producto no encontrado' });

        // Stock global
        const stockRow = await Stock.findOne({
            where: { idProducto: producto.idProducto },
            attributes: [[fn('SUM', col('cantidadExistente')), 'total']],
            raw: true
        });
        const stockGlobal = parseInt(stockRow?.total) || 0;

        // Variaciones → ids de atributos únicos
        const variaciones = await VariacionesProducto.findAll({
            where: { idProducto: producto.idProducto },
            attributes: ['idAtributos'],
            raw: true
        });
        const atributoIds = [...new Set(variaciones.map(v => parseInt(v.idAtributos)).filter(Boolean))];

        let colores = [];
        let tallas  = [];
        if (atributoIds.length) {
            const atributos = await Atributos.findAll({
                where: { idAtributo: { [Op.in]: atributoIds } },
                attributes: ['idAtributo', 'tipo', 'valor', 'codigo1'],
                raw: true
            });
            colores = atributos.filter(a => a.tipo === 'COLOR').map(a => ({ idAtributo: a.idAtributo, valor: a.valor, codigo1: a.codigo1 }));
            tallas  = atributos.filter(a => a.tipo === 'TALLA').map(a => ({ idAtributo: a.idAtributo, valor: a.valor }));
        }

        // Nombre de categoría — idCategoria puede ser "padre|hijo", tomamos el hijo si existe
        const catId = parseInt(String(producto.idCategoria).split('|').pop()) || parseInt(producto.idCategoria);
        const categoriaObj = await Categorias.findByPk(catId, {
            attributes: ['nombreCategoria'],
            raw: true
        }).catch(() => null);

        const r2 = R2();
        return res.json({
            success: true,
            producto: {
                idProducto:     producto.idProducto,
                nombreProducto: producto.nombreProducto,
                slug:           producto.slug,
                idCategoria:    producto.idCategoria,
                categoria:      categoriaObj?.nombreCategoria ?? '',
                precio:          parseFloat(producto.precioVentaPublicoFinal) || 0,
                precioMayorista: parseFloat(producto.precioVentaMayorista) || 0,
                tax:             parseFloat(producto.tax) || 0,
                sku:            producto.sku,
                tags:           producto.tags,
                descripcion:    producto.descripcion,
                imagenes:       producto.imagenes.map(i => ({ url: `${r2}${i.nombreImagen}`, tipo: i.tipo })),
                imagen:         producto.imagenes[0] ? `${r2}${producto.imagenes[0].nombreImagen}` : null,
                stockGlobal,
                colores,
                tallas
            }
        });
    } catch (e) {
        console.error('webApi.getProducto:', e);
        return res.status(500).json({ error: 'Error al obtener producto' });
    }
};
