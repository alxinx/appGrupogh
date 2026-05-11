import { Categorias, Productos, Imagenes, Stock, BannersWeb, CenefasWeb, SeccionesWeb, PopupWeb, VariacionesProducto, Atributos } from '../models/index.js';
import { Op, fn, col, literal } from 'sequelize';

const R2_BASE = process.env.R2_PUBLIC_URL;

function imagenUrl(nombreImagen) {
    return nombreImagen ? `${R2_BASE}/productos/${nombreImagen}` : null;
}

// ─── CONFIG HOME ─────────────────────────────────────────────────────────────
// GET /api/web/config
export const getConfig = async (req, res) => {
    try {
        const [banners, cenefas, secciones, popup] = await Promise.all([
            BannersWeb.findAll({
                where: { activo: true },
                order: [['orden', 'ASC']],
                attributes: ['idBanner', 'titulo', 'subtitulo', 'textoBoton', 'linkBoton', 'imagenUrl', 'orden']
            }),
            CenefasWeb.findAll({
                where: { activo: true },
                attributes: ['idCenefa', 'texto', 'link', 'colorFondo', 'colorTexto', 'animacion']
            }),
            SeccionesWeb.findAll({
                where: { activo: true },
                include: [{ model: Categorias, as: 'categoria', attributes: ['idCategoria', 'nombreCategoria'] }],
                order: [['orden', 'ASC']],
                attributes: ['idSeccion', 'titulo', 'imagenUrl', 'idCategoria', 'orden']
            }),
            PopupWeb.findOne({
                where: { activo: true },
                attributes: ['idPopup', 'titulo', 'imagenUrl', 'link', 'delaySegundos']
            })
        ]);

        const wholesaleMinQty = parseInt(process.env.WHOLESALE_PRICE_MIN_PRODUCT) || 0;
        return res.json({ success: true, banners, cenefas, secciones, popup, wholesaleMinQty });
    } catch (e) {
        console.error('getConfig:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar configuración.' });
    }
};

// ─── CATEGORÍAS PÚBLICAS ──────────────────────────────────────────────────────
// GET /api/web/categorias
export const getCategoriasPublicas = async (req, res) => {
    try {
        const categorias = await Categorias.findAll({
            where: { webActiva: true, tipo: 'CATEGORIA' },
            attributes: ['idCategoria', 'nombreCategoria', 'tipo', 'idPadre'],
            order: [['nombreCategoria', 'ASC']]
        });
        return res.json({ success: true, categorias });
    } catch (e) {
        console.error('getCategoriasPublicas:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar categorías.' });
    }
};

// ─── CATÁLOGO DE PRODUCTOS ────────────────────────────────────────────────────
// GET /api/web/productos?categoria=X&pagina=1&limite=20&q=busqueda&orden=precio_asc
// categoria puede ser ID numérico o nombre de categoría
export const getCatalogoProductos = async (req, res) => {
    try {
        const { categoria, pagina = 1, limite = 20, q, orden = 'nombre_asc' } = req.query;
        const offset = (parseInt(pagina) - 1) * parseInt(limite);

        // Resolver el ID de la categoría principal
        let idCat = null;
        if (categoria) {
            if (!isNaN(categoria)) {
                idCat = parseInt(categoria);
            } else {
                const cat = await Categorias.findOne({
                    where: { nombreCategoria: categoria, webActiva: true, tipo: 'CATEGORIA' },
                    attributes: ['idCategoria'],
                    raw: true
                });
                if (!cat) return res.json({ success: true, productos: [], total: 0, paginas: 0, paginaActual: 1 });
                idCat = cat.idCategoria;
            }
        }

        // idCategoria en productos es string tipo "3" o "3|7|9"
        // el primer número siempre es la categoría principal
        const whereProducto = { activo: true };
        if (q) whereProducto.nombreProducto = { [Op.like]: `%${q}%` };
        if (idCat !== null) {
            whereProducto[Op.or] = [
                { idCategoria: String(idCat) },
                { idCategoria: { [Op.like]: `${idCat}|%` } }
            ];
        }

        const ordenMap = {
            nombre_asc:   [['nombreProducto', 'ASC']],
            nombre_desc:  [['nombreProducto', 'DESC']],
            precio_asc:   [['precioVentaPublicoFinal', 'ASC']],
            precio_desc:  [['precioVentaPublicoFinal', 'DESC']],
            nuevo:        [['createdAt', 'DESC']]
        };
        const orderClause = ordenMap[orden] || ordenMap.nombre_asc;

        // Paso 1: IDs de todos los productos de esta categoría
        const allProdRows = await Productos.findAll({
            where: whereProducto,
            attributes: ['idProducto'],
            raw: true
        });
        const allIds = allProdRows.map(p => p.idProducto);

        if (!allIds.length) {
            return res.json({ success: true, productos: [], total: 0, paginas: 0, paginaActual: parseInt(pagina) });
        }

        // Paso 2: de esos, cuáles tienen stock > 0
        const stockRows = await Stock.findAll({
            where: { idProducto: { [Op.in]: allIds } },
            attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'total']],
            group: ['idProducto'],
            having: literal('SUM(`cantidadExistente`) > 0'),
            raw: true
        });
        const idsConStock = stockRows.map(s => s.idProducto);
        const total = idsConStock.length;

        if (!total) {
            return res.json({ success: true, productos: [], total: 0, paginas: 0, paginaActual: parseInt(pagina) });
        }

        // Paso 3: paginar solo sobre los que tienen stock
        const rows = await Productos.findAll({
            where: { idProducto: { [Op.in]: idsConStock } },
            order: orderClause,
            limit: parseInt(limite),
            offset
        });

        if (!rows.length) {
            return res.json({ success: true, productos: [], total, paginas: Math.ceil(total / parseInt(limite)), paginaActual: parseInt(pagina) });
        }

        // Paso 4: imágenes
        const idProductos = rows.map(p => p.idProducto);
        const imagenes = await Imagenes.findAll({
            where: { idProducto: { [Op.in]: idProductos }, tipo: 'principal' },
            attributes: ['idProducto', 'nombreImagen'],
            raw: true
        });
        const imagenMap = {};
        imagenes.forEach(img => { imagenMap[img.idProducto] = img.nombreImagen; });

        // stockGlobal ya sabemos que es > 0 para todos (filtrado en paso 2)
        const stockMap = {};
        stockRows.forEach(s => { stockMap[s.idProducto] = parseInt(s.total) || 0; });

        const productos = rows.map(p => ({
            idProducto: p.idProducto,
            nombreProducto: p.nombreProducto,
            slug: p.slug,
            precio: parseFloat(p.precioVentaPublicoFinal),
            precioMayorista: parseFloat(p.precioVentaMayorista) || null,
            idCategoria: p.idCategoria,
            imagen: imagenMap[p.idProducto] ? imagenUrl(imagenMap[p.idProducto]) : null,
            stockGlobal: stockMap[p.idProducto] || 0
        }));

        return res.json({
            success: true,
            productos,
            total,
            paginas: Math.ceil(total / parseInt(limite)),
            paginaActual: parseInt(pagina)
        });
    } catch (e) {
        console.error('getCatalogoProductos:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar productos.' });
    }
};

// ─── DETALLE DE PRODUCTO ──────────────────────────────────────────────────────
// GET /api/web/producto/:slug
export const getDetalleProducto = async (req, res) => {
    try {
        const { slug } = req.params;

        const producto = await Productos.findOne({
            where: { slug, activo: true },
            include: [{ model: Imagenes, as: 'imagenes', attributes: ['nombreImagen', 'tipo'] }]
        });

        if (!producto) return res.status(404).json({ success: false, mensaje: 'Producto no encontrado.' });

        // idCategoria es "3" o "3|7" — el primer número es la categoría principal
        const idCatPrincipal = parseInt(producto.idCategoria?.split('|')[0]);
        const catActiva = await Categorias.findOne({ where: { idCategoria: idCatPrincipal, webActiva: true } });
        if (!catActiva) return res.status(404).json({ success: false, mensaje: 'Producto no disponible.' });

        // Stock global
        const stockGlobal = await Stock.sum('cantidadExistente', {
            where: { idProducto: producto.idProducto }
        }) || 0;

        if (stockGlobal <= 0) return res.status(404).json({ success: false, mensaje: 'Producto agotado.' });

        const imagenes = producto.imagenes.map(img => ({
            url: imagenUrl(img.nombreImagen),
            tipo: img.tipo
        }));

        // Variaciones → atributos únicos → colores y tallas
        const variaciones = await VariacionesProducto.findAll({
            where: { idProducto: producto.idProducto },
            attributes: ['idAtributos'],
            raw: true
        });

        const idsAtributos = [...new Set(
            variaciones.flatMap(v => v.idAtributos.split('|').map(Number).filter(Boolean))
        )];

        let colores = [], tallas = [];
        if (idsAtributos.length) {
            const atributos = await Atributos.findAll({
                where: { idAtributo: { [Op.in]: idsAtributos } },
                attributes: ['idAtributo', 'tipo', 'valor', 'codigo1'],
                raw: true
            });
            colores = atributos
                .filter(a => a.tipo === 'COLOR')
                .map(a => ({ idAtributo: a.idAtributo, valor: a.valor, codigo1: a.codigo1 }));
            tallas = atributos
                .filter(a => a.tipo === 'TALLA')
                .map(a => ({ idAtributo: a.idAtributo, valor: a.valor }));
        }

        return res.json({
            success: true,
            producto: {
                idProducto: producto.idProducto,
                nombreProducto: producto.nombreProducto,
                slug: producto.slug,
                descripcion: producto.descripcion,
                precio: parseFloat(producto.precioVentaPublicoFinal),
                precioMayorista: parseFloat(producto.precioVentaMayorista) || null,
                tax: parseFloat(producto.tax),
                sku: producto.sku,
                tags: producto.tags,
                idCategoria: producto.idCategoria,
                categoria: catActiva.nombreCategoria,
                imagenes,
                stockGlobal,
                colores,
                tallas
            }
        });
    } catch (e) {
        console.error('getDetalleProducto:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar el producto.' });
    }
};
