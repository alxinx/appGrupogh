import { Op, fn, col, literal } from 'sequelize';
import db from '../config/bd.js';
import {
    BannersWeb, CenefasWeb, SeccionesWeb, PopupWeb, EtiquetasWeb,
    Categorias, Productos, Imagenes, Stock, Atributos, VariacionesProducto, DetallesFactura,
    Interesados, PaginasWeb, PuntosDeVenta, VisitantesWeb, VisitasProducto,
    PedidosWeb, DetallesPedidoWeb, PagosPedidoWeb, Empleados, Traslados, DetalleTraslados,
    Clientes, ClientesTributario, ClientesUbicacion,
} from '../models/index.js';
import { getPublicKey, getCheckoutBaseUrl, generarFirmaIntegridad, verificarChecksumWebhook } from '../helpers/wompi.js';
import { crearConCodigo, siguienteNumero } from '../helpers/secuencias.js';
import { invalidarContadoresAdmin } from '../middleware/adminMenuMiddleware.js';

const WEB_STORE_URL = process.env.WEB_STORE_URL || 'https://www.grupogh.com';

// Tipos de documento aceptados en el checkout web, con el mismo vocabulario que CLIENTES
// y que el formulario de admin/clientes/nuevo. Una persona jurídica siempre es NIT.
const TIPOS_DOC_NATURAL = ['CC', 'CE', 'TI', 'PP'];
const TIPOS_DOC_JURIDICA = ['NIT'];

// Texto que ve el comprador cuando su documento ya estaba registrado con otro correo/teléfono.
// Los datos de CLIENTES mandan; el comprador no puede cambiarlos desde la web.
function mensajeDatosDifieren() {
    const contacto = process.env.SOPORTE_WHATSAPP || process.env.SOPORTE_EMAIL;
    return `Este documento ya estaba registrado con nosotros, pero con un correo o teléfono diferente al que ingresaste. Tu pedido se procesó con los datos que ya teníamos registrados. Si necesitás actualizarlos, comunicate con la tienda${contacto ? ` al ${contacto}` : ''}.`;
}

// Crea o actualiza el visitante anónimo (cookieId) con los datos de identificación recibidos.
async function upsertVisitante(cookieId, datos) {
    const [visitante] = await VisitantesWeb.findOrCreate({ where: { cookieId }, defaults: datos });
    await visitante.update({ ...datos, ultimaVisita: new Date() });
    return visitante;
}

const R2 = () => `${process.env.R2_PUBLIC_URL}/productos/`;

// Stock vendible desde la web: solo puntos de venta físicos + el punto "web" dedicado.
// Bodega (reserva/no lista para despacho) y Tránsito (mercancía en camino) no cuentan.
const TIPOS_PUNTO_VENDIBLE = ['Punto de venta', 'web'];

// GET /api/web/config
export const getConfig = async (req, res) => {
    try {
        const [banners, cenefas, secciones, popup, etiquetas] = await Promise.all([
            BannersWeb.findAll({
                where: { activo: true },
                attributes: ['idBanner', 'titulo', 'subtitulo', 'textoBoton', 'linkBoton', 'imagenUrl', 'imagenMovilUrl', 'orden'],
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
            }),
            EtiquetasWeb.findAll({
                where: { activo: true },
                attributes: ['idEtiqueta', 'nombre', 'tipo', 'script', 'posicion'],
                order: [['createdAt', 'ASC']]
            })
        ]);

        return res.json({
            banners,
            cenefas,
            secciones: secciones.map(s => s.toJSON()),
            popup: popup ? popup.toJSON() : null,
            etiquetas: etiquetas.map(e => e.toJSON()),
            wholesaleMinQty: parseInt(process.env.WHOLESALE_PRICE_MIN_PRODUCT) || 6,
            wholesaleGlobal: process.env.WHOLESALE_PRICE_GLOBAL !== 'false'
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
            attributes: ['idCategoria', 'nombreCategoria', 'tipo', 'idPadre', 'imagen'],
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
                // Portada de la categoria para el home; null si no le cargaron ninguna.
                imagen:          c.imagen || null,
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
                    include: [{
                        model: PuntosDeVenta,
                        as: 'ubicacion',
                        attributes: [],
                        where: { tipo: { [Op.in]: TIPOS_PUNTO_VENDIBLE } },
                        required: true
                    }],
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

        // Stock global — solo puntos de venta vendibles (tienda + web), no bodega ni tránsito.
        const stockRow = await Stock.findOne({
            where: { idProducto: producto.idProducto },
            attributes: [[fn('SUM', col('cantidadExistente')), 'total']],
            include: [{
                model: PuntosDeVenta,
                as: 'ubicacion',
                attributes: [],
                where: { tipo: { [Op.in]: TIPOS_PUNTO_VENDIBLE } },
                required: true
            }],
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

// GET /api/web/pagina/:slug
export const getPaginaBySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const pagina = await PaginasWeb.findOne({
            where: { slug, activa: true },
            attributes: ['idPagina', 'nombrePagina', 'slug', 'contenido', 'tags']
        });
        if (!pagina) return res.status(404).json({ success: false, mensaje: 'Página no encontrada' });
        return res.json({ success: true, pagina: pagina.toJSON() });
    } catch (e) {
        console.error('webApi.getPaginaBySlug:', e);
        return res.status(500).json({ error: 'Error al obtener página' });
    }
};

// GET /api/web/puntos-venta
export const getPuntosVenta = async (req, res) => {
    try {
        const puntos = await PuntosDeVenta.findAll({
            where: { tipo: 'Punto de venta', activa: true },
            attributes: ['idPuntoDeVenta', 'nombreComercial', 'direccionPrincipal'],
            order: [['nombreComercial', 'ASC']]
        });
        return res.json({ puntos });
    } catch (e) {
        console.error('webApi.getPuntosVenta:', e);
        return res.status(500).json({ error: 'Error al obtener puntos de venta' });
    }
};

// POST /api/web/interesado
export const postInteresado = async (req, res) => {
    try {
        const { nombreCliente, canalContacto, canal, producto, cookieId, consentimiento } = req.body;
        if (!nombreCliente?.trim() || !canalContacto || !canal?.trim() || !producto) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
        }
        if (!['whatsapp', 'email'].includes(canalContacto)) {
            return res.status(400).json({ success: false, message: 'canalContacto inválido' });
        }
        await Interesados.create({
            nombreCliente: nombreCliente.trim(),
            canalContacto,
            canal: canal.trim(),
            producto,
        });

        // El aviso de "notificarme" solo autoriza ese contacto puntual; solo se liga a
        // remarketing (VisitantesWeb) si el visitante marcó explícitamente el consentimiento.
        if (cookieId && typeof cookieId === 'string' && consentimiento) {
            const datos = { nombre: nombreCliente.trim(), consentimiento: true, consentimientoFecha: new Date() };
            if (canalContacto === 'email') datos.email = canal.trim();
            if (canalContacto === 'whatsapp') datos.telefono = canal.trim();
            await upsertVisitante(cookieId, datos);
        }

        return res.json({ success: true });
    } catch (e) {
        console.error('webApi.postInteresado:', e);
        return res.status(500).json({ success: false, message: 'Error al guardar' });
    }
};

// POST /api/web/visitante/track — registra la visita anónima y, opcionalmente, la vista de un producto.
export const trackVisita = async (req, res) => {
    try {
        const { cookieId, idProducto, utmSource, utmMedium, utmCampaign, referrer } = req.body;
        if (!cookieId || typeof cookieId !== 'string') {
            return res.status(400).json({ success: false, message: 'cookieId requerido' });
        }

        const visitante = await upsertVisitante(cookieId, { utmSource, utmMedium, utmCampaign, referrer });

        if (idProducto) {
            const existe = await Productos.findByPk(idProducto, { attributes: ['idProducto'] });
            if (existe) {
                await VisitasProducto.create({ idProducto, idVisitante: visitante.idVisitante });
            }
        }

        return res.json({ success: true });
    } catch (e) {
        console.error('webApi.trackVisita:', e);
        return res.status(500).json({ success: false, message: 'Error al registrar visita' });
    }
};

// POST /api/web/visitante/identificar — liga el cookieId anónimo a datos de contacto reales.
export const identificarVisitante = async (req, res) => {
    try {
        const { cookieId, nombre, email, telefono, consentimiento } = req.body;
        if (!cookieId || typeof cookieId !== 'string') {
            return res.status(400).json({ success: false, message: 'cookieId requerido' });
        }
        if (!email?.trim() && !telefono?.trim()) {
            return res.status(400).json({ success: false, message: 'Se requiere email o teléfono' });
        }

        const datos = {};
        if (nombre?.trim()) datos.nombre = nombre.trim();
        if (email?.trim()) datos.email = email.trim();
        if (telefono?.trim()) datos.telefono = telefono.trim();
        if (consentimiento) {
            datos.consentimiento = true;
            datos.consentimientoFecha = new Date();
        }

        await upsertVisitante(cookieId, datos);
        return res.json({ success: true });
    } catch (e) {
        console.error('webApi.identificarVisitante:', e);
        return res.status(500).json({ success: false, message: 'Error al guardar' });
    }
};

// POST /api/web/pedidos — crea un pedido web (checkout). No procesa pago todavía
// (eso lo hace la integración con Wompi); solo deja el pedido en 'pendiente_pago'
// con precios y stock validados en el servidor, nunca confiando en lo que mande el cliente.
export const crearPedidoWeb = async (req, res) => {
    try {
        const {
            items, tipoEntrega, cookieId, metodoPago,
            email, telefono, nombreCliente, apellidoCliente, cedula,
            tipoPersona, tipoDocumento, digitoVerif, razonSocial, direccionFacturacion,
            direccion, apto, ciudad, departamento, notasEntrega,
            idPuntoVentaRecogida
        } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'El carrito está vacío.' });
        }
        if (!['domicilio', 'tienda'].includes(tipoEntrega)) {
            return res.status(400).json({ success: false, message: 'Tipo de entrega inválido.' });
        }
        if (!['contraentrega', 'tarjeta', 'pse', 'nequi'].includes(metodoPago)) {
            return res.status(400).json({ success: false, message: 'Método de pago inválido.' });
        }
        if (!email?.trim() || !telefono?.trim() || !nombreCliente?.trim() || !apellidoCliente?.trim()) {
            return res.status(400).json({ success: false, message: 'Faltan datos de contacto.' });
        }
        if (items.some(i => !i.idProducto || !i.cantidad || Number(i.cantidad) <= 0)) {
            return res.status(400).json({ success: false, message: 'Hay productos con cantidad inválida.' });
        }

        if (tipoEntrega === 'domicilio') {
            if (!direccion?.trim() || !ciudad?.trim() || !departamento?.trim()) {
                return res.status(400).json({ success: false, message: 'Faltan datos de la dirección de envío.' });
            }
        } else {
            if (!idPuntoVentaRecogida) {
                return res.status(400).json({ success: false, message: 'Faltan datos para recoger en tienda.' });
            }
            const punto = await PuntosDeVenta.findByPk(idPuntoVentaRecogida);
            if (!punto) return res.status(400).json({ success: false, message: 'El punto de recogida no es válido.' });
        }

        // ── Identificación para facturación ──────────────────────────────────────
        // El número de documento es obligatorio siempre (no solo para recoger en tienda) — sin él
        // no se puede generar la factura electrónica cuando la tienda despache el pedido.
        const esEmpresa = tipoPersona === 'J';
        const tipoDoc = esEmpresa ? 'NIT' : (tipoDocumento || 'CC');
        const tiposValidos = esEmpresa ? TIPOS_DOC_JURIDICA : TIPOS_DOC_NATURAL;
        if (!tiposValidos.includes(tipoDoc)) {
            return res.status(400).json({ success: false, message: 'Tipo de documento inválido.' });
        }
        if (!cedula?.trim()) {
            return res.status(400).json({ success: false, message: 'El número de documento es obligatorio.' });
        }
        if (esEmpresa && !razonSocial?.trim()) {
            return res.status(400).json({ success: false, message: 'La razón social es obligatoria.' });
        }
        // La dirección se necesita para la factura. En domicilio se reusa la de envío;
        // en recogida en tienda hay que pedirla aparte.
        const direccionFactura = tipoEntrega === 'domicilio'
            ? direccion.trim()
            : direccionFacturacion?.trim();
        if (!direccionFactura) {
            return res.status(400).json({ success: false, message: 'La dirección de facturación es obligatoria.' });
        }

        // ¿El documento ya está registrado? Los datos de CLIENTES mandan sobre lo que digitó el
        // comprador (el visitante web no es una fuente confiable). Solo se detecta la diferencia
        // acá para poder avisarle al final; el cliente no se crea ni se actualiza todavía —
        // eso pasa únicamente cuando la pasarela confirma el pago.
        const clienteExistente = await Clientes.findOne({
            where: { numero_doc: cedula.trim() },
            attributes: ['idCliente', 'tipo_documento', 'email', 'telefono']
        });
        const datosClienteDifieren = !!clienteExistente && (
            (clienteExistente.tipo_documento || '') !== tipoDoc ||
            (clienteExistente.email || '').toLowerCase() !== email.trim().toLowerCase() ||
            (clienteExistente.telefono || '') !== telefono.trim()
        );

        // Productos reales (nunca confiar en nombre/precio que venga del cliente)
        const idsProductos = [...new Set(items.map(i => i.idProducto))];
        const productos = await Productos.findAll({
            where: { idProducto: { [Op.in]: idsProductos }, activo: true, web: true }
        });
        const productoPorId = Object.fromEntries(productos.map(p => [p.idProducto, p]));
        const faltante = items.find(i => !productoPorId[i.idProducto]);
        if (faltante) {
            return res.status(400).json({ success: false, message: 'Uno de los productos ya no está disponible.' });
        }

        // Stock vendible real (solo Punto de venta + web, no Bodega/Tránsito)
        const stockRows = await Stock.findAll({
            where: { idProducto: { [Op.in]: idsProductos } },
            attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'total']],
            include: [{
                model: PuntosDeVenta, as: 'ubicacion', attributes: [],
                where: { tipo: { [Op.in]: TIPOS_PUNTO_VENDIBLE } }, required: true
            }],
            group: ['idProducto'],
            raw: true
        });
        const stockPorProducto = Object.fromEntries(stockRows.map(r => [r.idProducto, parseInt(r.total) || 0]));

        const cantidadPorProducto = {};
        for (const item of items) {
            cantidadPorProducto[item.idProducto] = (cantidadPorProducto[item.idProducto] || 0) + Number(item.cantidad);
        }
        for (const [idProducto, cantidadPedida] of Object.entries(cantidadPorProducto)) {
            const disponible = stockPorProducto[idProducto] || 0;
            if (disponible < cantidadPedida) {
                return res.status(400).json({
                    success: false,
                    message: `"${productoPorId[idProducto].nombreProducto}" ya no tiene stock suficiente (disponible: ${disponible}).`
                });
            }
        }

        // Precio efectivo — mismo umbral mayorista que ya usa el frontend, recalculado en el servidor
        const wholesaleMin = parseInt(process.env.WHOLESALE_PRICE_MIN_PRODUCT) || 6;
        const wholesaleGlobal = process.env.WHOLESALE_PRICE_GLOBAL !== 'false';
        const totalUnidades = items.reduce((s, i) => s + Number(i.cantidad), 0);

        const detalles = items.map(item => {
            const producto = productoPorId[item.idProducto];
            const precioMayorista = parseFloat(producto.precioVentaMayorista) || 0;
            const esMayorista = wholesaleGlobal
                ? (wholesaleMin > 0 && totalUnidades >= wholesaleMin)
                : (wholesaleMin > 0 && Number(item.cantidad) >= wholesaleMin);
            const valorUnidad = esMayorista && precioMayorista > 0 ? precioMayorista : (parseFloat(producto.precioVentaPublicoFinal) || 0);
            const subTotal = valorUnidad * Number(item.cantidad);
            return {
                idProducto: item.idProducto,
                talla: item.talla || null,
                color: item.color || null,
                cantidad: item.cantidad,
                valorUnidad,
                subTotal
            };
        });

        const subtotal = detalles.reduce((s, d) => s + d.subTotal, 0);
        const envioCosto = 0; // el cálculo real de envío se define aparte
        const total = subtotal + envioCosto;

        let idVisitante = null;
        if (cookieId) {
            const visitante = await VisitantesWeb.findOne({ where: { cookieId } });
            idVisitante = visitante?.idVisitante ?? null;
        }

        const t = await db.transaction();
        try {
            // El número sale del contador de SECUENCIAS, que serializa a los checkouts
            // simultáneos con un bloqueo de fila. Antes se leía el último pedido con
            // ORDER BY createdAt DESC y se le sumaba 1: dos compras en el mismo segundo
            // calculaban el mismo número y la segunda moría con un 500 (con el cliente ya pagando).
            const numeroPedido = `GH-${await siguienteNumero('pedido_web', t)}`;

            const pedido = await PedidosWeb.create({
                numeroPedido,
                idVisitante,
                tipoEntrega,
                idPuntoVentaRecogida: tipoEntrega === 'tienda' ? idPuntoVentaRecogida : null,
                nombreCliente: nombreCliente.trim(),
                apellidoCliente: apellidoCliente.trim(),
                email: email.trim(),
                telefono: telefono.trim(),
                cedula: cedula.trim(),
                tipoPersona: esEmpresa ? 'J' : 'N',
                tipoDocumento: tipoDoc,
                digitoVerif: esEmpresa ? (digitoVerif?.trim() || null) : null,
                razonSocial: esEmpresa ? razonSocial.trim() : null,
                direccionFacturacion: direccionFactura,
                datosClienteDifieren,
                direccion: tipoEntrega === 'domicilio' ? direccion.trim() : null,
                apto: tipoEntrega === 'domicilio' ? (apto?.trim() || null) : null,
                ciudad: tipoEntrega === 'domicilio' ? ciudad.trim() : null,
                departamento: tipoEntrega === 'domicilio' ? departamento.trim() : null,
                notasEntrega: tipoEntrega === 'domicilio' ? (notasEntrega?.trim() || null) : null,
                metodoPago,
                subtotal,
                envio: envioCosto,
                descuento: 0,
                total,
                estado: 'pendiente_pago',
                fechaCambioEstado: new Date()
            }, { transaction: t });

            for (const d of detalles) {
                await DetallesPedidoWeb.create({ idPedido: pedido.idPedido, ...d }, { transaction: t });
            }

            await t.commit();
            return res.json({
                success: true,
                idPedido: pedido.idPedido,
                numeroPedido: pedido.numeroPedido,
                total,
                avisoCliente: datosClienteDifieren ? mensajeDatosDifieren() : null
            });
        } catch (e) {
            await t.rollback();
            throw e;
        }
    } catch (e) {
        console.error('webApi.crearPedidoWeb:', e);
        return res.status(500).json({ success: false, message: 'Error al crear el pedido.' });
    }
};

// POST /api/web/pedidos/:idPedido/pago — genera el link firmado del Web Checkout de Wompi.
export const iniciarPagoWompi = async (req, res) => {
    try {
        const { idPedido } = req.params;
        const pedido = await PedidosWeb.findByPk(idPedido);
        if (!pedido) return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        if (pedido.estado !== 'pendiente_pago') {
            return res.status(400).json({ success: false, message: 'Este pedido ya no está pendiente de pago.' });
        }

        const intentosPrevios = await PagosPedidoWeb.count({ where: { idPedido } });
        const referenciaWompi = intentosPrevios === 0 ? pedido.numeroPedido : `${pedido.numeroPedido}-${intentosPrevios + 1}`;
        const amountInCents = Math.round(parseFloat(pedido.total) * 100);

        await PagosPedidoWeb.create({
            idPedido,
            referenciaWompi,
            estado: 'PENDING',
            monto: pedido.total,
            metodoPago: pedido.metodoPago
        });

        const firma = generarFirmaIntegridad(referenciaWompi, amountInCents, 'COP');
        const redirectUrl = `${WEB_STORE_URL}/checkout/resultado?pedido=${pedido.numeroPedido}`;

        const params = new URLSearchParams({
            'public-key': getPublicKey(),
            currency: 'COP',
            'amount-in-cents': String(amountInCents),
            reference: referenciaWompi,
            'signature:integrity': firma,
            'redirect-url': redirectUrl,
            'customer-data:email': pedido.email
        });

        return res.json({ success: true, checkoutUrl: `${getCheckoutBaseUrl()}?${params.toString()}` });
    } catch (e) {
        console.error('webApi.iniciarPagoWompi:', e);
        return res.status(500).json({ success: false, message: 'Error al iniciar el pago.' });
    }
};

// GET /api/web/pedidos/:numeroPedido/estado — estado público del pedido (para la página de resultado del pago).
export const consultarEstadoPedido = async (req, res) => {
    try {
        const { numeroPedido } = req.params;
        const pedido = await PedidosWeb.findOne({
            where: { numeroPedido },
            attributes: ['idPedido', 'numeroPedido', 'estado', 'total', 'email', 'datosClienteDifieren']
        });
        if (!pedido) return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });

        const ultimoPago = await PagosPedidoWeb.findOne({
            where: { idPedido: pedido.idPedido },
            order: [['createdAt', 'DESC']],
            attributes: ['estado']
        });

        return res.json({
            success: true,
            numeroPedido: pedido.numeroPedido,
            estadoPedido: pedido.estado,
            estadoPago: ultimoPago?.estado ?? null,
            total: pedido.total,
            email: pedido.email,
            avisoCliente: pedido.datosClienteDifieren ? mensajeDatosDifieren() : null
        });
    } catch (e) {
        console.error('webApi.consultarEstadoPedido:', e);
        return res.status(500).json({ success: false, message: 'Error al consultar el pedido.' });
    }
};

const ESTADOS_FINALES_WOMPI = ['APPROVED', 'DECLINED', 'VOIDED', 'ERROR'];

// Capitaliza igual que saveCliente (admin) y guardarCliente (POS), para que un cliente creado
// desde la web no quede escrito distinto a uno creado desde el panel.
const aTitulo = (s) => s
    ? s.trim().toLowerCase().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1))
    : null;

// Parte un nombre libre ("juan carlos") en los dos campos que usa CLIENTES, ya capitalizado.
function partirNombre(valor) {
    const partes = (valor || '').trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return [null, null];
    return [aTitulo(partes[0]), aTitulo(partes.slice(1).join(' ')) || null];
}

// Resuelve el cliente de un pedido web y lo deja vinculado en PEDIDOS_WEB.idCliente.
// Se llama ÚNICAMENTE desde procesarPagoAprobado, es decir cuando la pasarela ya confirmó
// el pago — un pedido en 'pendiente_pago', rechazado o contraentrega nunca crea un cliente.
//
// Regla de negocio: si el documento ya existe, los datos de CLIENTES son los que valen y no se
// sobreescriben con lo que digitó el comprador (a diferencia del POS, donde el vendedor sí es
// una fuente confiable y guardarCliente sí actualiza). Solo se crea el cliente si es nuevo.
export async function resolverClienteDePedido(pedido, t) {
    const numeroDoc = (pedido.cedula || '').trim();
    if (!numeroDoc) return null;

    const existente = await Clientes.findOne({
        where: { numero_doc: numeroDoc },
        attributes: ['idCliente'],
        transaction: t
    });
    if (existente) return existente.idCliente;

    const esEmpresa = pedido.tipoPersona === 'J';
    const [primerNombre, segundoNombre] = partirNombre(pedido.nombreCliente);
    const [primerApellido, segundoApellido] = partirNombre(pedido.apellidoCliente);

    const cliente = await Clientes.create({
        tipo_persona:     esEmpresa ? 'J' : 'N',
        tipo_documento:   pedido.tipoDocumento || (esEmpresa ? 'NIT' : 'CC'),
        numero_doc:       numeroDoc,
        digito_verif:     esEmpresa ? (pedido.digitoVerif || null) : null,
        razon_social:     esEmpresa ? aTitulo(pedido.razonSocial) : null,
        primer_nombre:    esEmpresa ? null : primerNombre,
        segundo_nombre:   esEmpresa ? null : segundoNombre,
        primer_apellido:  esEmpresa ? null : primerApellido,
        segundo_apellido: esEmpresa ? null : segundoApellido,
        email:            pedido.email?.trim().toLowerCase() || null,
        telefono:         pedido.telefono?.trim() || null,
        genero:           null, // no se pide en el checkout web
        activo:           true,
        credito:          false
    }, { transaction: t });

    // Régimen por defecto igual al del alta manual de un cliente nuevo en admin (49 = no
    // responsable de IVA). La tienda lo ajusta desde el panel si el cliente resulta ser otro.
    await ClientesTributario.create({
        idCliente:          cliente.idCliente,
        regimen_fiscal:     '49',
        gran_contribuyente: false,
        autorretenedor:     false,
        agente_retencion:   false,
        obligado_aduanero:  false
    }, { transaction: t });

    // La ciudad/departamento del checkout son texto libre (no hay selector de DANE en la web),
    // así que se guardan como nombre y los IDs quedan nulos para que la tienda los normalice.
    if (pedido.direccionFacturacion) {
        await ClientesUbicacion.create({
            idCliente:          cliente.idCliente,
            direccion:          pedido.direccionFacturacion,
            nombreMunicipio:    pedido.ciudad || null,
            nombreDepartamento: pedido.departamento || null,
            es_principal:       true
        }, { transaction: t });
    }

    return cliente.idCliente;
}

// Traslado automático tienda → Bodega "Pedidos Web" al aprobarse un pago.
// Descuenta stock real de la(s) tienda(s) origen y lo deja aterrizado en la bodega,
// exactamente con el mismo mecanismo (FIFO sobre STOCKS) que usa el traslado manual de empleados.
async function procesarPagoAprobado(pedido) {
    const [bodegaPedidosWeb, sistemaWeb] = await Promise.all([
        PuntosDeVenta.findOne({ where: { nombreComercial: 'Pedidos Web' } }),
        Empleados.findOne({ where: { codigoEmpleado: '00000' } })
    ]);
    if (!bodegaPedidosWeb || !sistemaWeb) {
        throw new Error('Falta configurar la bodega "Pedidos Web" o el empleado "Sistema Web".');
    }

    const detalles = await DetallesPedidoWeb.findAll({ where: { idPedido: pedido.idPedido } });
    if (detalles.length === 0) throw new Error(`El pedido ${pedido.numeroPedido} no tiene detalles.`);

    // Por cada producto, la tienda con más stock vendible (regla acordada para el traslado automático).
    const idsProductos = detalles.map(d => d.idProducto);
    const stockPorProductoYTienda = await Stock.findAll({
        where: { idProducto: { [Op.in]: idsProductos } },
        attributes: ['idProducto', 'idPuntoVenta', [fn('SUM', col('cantidadExistente')), 'total']],
        include: [{
            model: PuntosDeVenta, as: 'ubicacion', attributes: [],
            where: { tipo: { [Op.in]: TIPOS_PUNTO_VENDIBLE } }, required: true
        }],
        group: ['idProducto', 'idPuntoVenta'],
        raw: true
    });

    const mejorTiendaPorProducto = {};
    for (const fila of stockPorProductoYTienda) {
        const total = parseInt(fila.total) || 0;
        const actual = mejorTiendaPorProducto[fila.idProducto];
        if (!actual || total > actual.total) {
            mejorTiendaPorProducto[fila.idProducto] = { idPuntoVenta: fila.idPuntoVenta, total };
        }
    }

    const gruposPorTienda = {};
    for (const detalle of detalles) {
        const tienda = mejorTiendaPorProducto[detalle.idProducto];
        if (!tienda) throw new Error(`No hay stock vendible registrado para el producto ${detalle.idProducto} (pedido ${pedido.numeroPedido}).`);
        (gruposPorTienda[tienda.idPuntoVenta] ??= []).push(detalle);
    }

    const t = await db.transaction();
    try {
        for (const [idOrigen, detallesGrupo] of Object.entries(gruposPorTienda)) {
            for (const detalle of detallesGrupo) {
                const filasStock = await Stock.findAll({
                    where: { idProducto: detalle.idProducto, idPuntoVenta: idOrigen, cantidadExistente: { [Op.gt]: 0 } },
                    order: [['createdAt', 'ASC']],
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });
                let restante = parseFloat(detalle.cantidad);
                for (const fila of filasStock) {
                    if (restante <= 0) break;
                    const disponible = parseFloat(fila.cantidadExistente);
                    if (disponible <= restante) {
                        await fila.update({ cantidadExistente: 0 }, { transaction: t });
                        restante -= disponible;
                    } else {
                        await fila.update({ cantidadExistente: disponible - restante }, { transaction: t });
                        restante = 0;
                    }
                }
                if (restante > 0) {
                    throw new Error(`Stock insuficiente para el producto ${detalle.idProducto} al procesar el pago del pedido ${pedido.numeroPedido}.`);
                }
            }

            const traslado = await crearConCodigo(Traslados, 'codigoTraslado', 'TR-', 'traslado', {
                idOrigen,
                idDestino: bodegaPedidosWeb.idPuntoDeVenta,
                idUsuarioDespacha: sistemaWeb.idEmpleado,
                idUsuarioRecibe: sistemaWeb.idEmpleado,
                estado: 'RECIBIDO',
                fechaRecepcion: new Date(),
                idPedidoWeb: pedido.idPedido,
                notas: `Traslado automático — pago aprobado del pedido web ${pedido.numeroPedido}`
            }, t);

            for (const detalle of detallesGrupo) {
                await DetalleTraslados.create({
                    idTraslado: traslado.idTraslado,
                    idProducto: detalle.idProducto,
                    cantidad: detalle.cantidad,
                    estado: 'RECIBIDO'
                }, { transaction: t });

                await Stock.create({
                    idPuntoVenta: bodegaPedidosWeb.idPuntoDeVenta,
                    idProducto: detalle.idProducto,
                    cantidadExistente: detalle.cantidad,
                    cantidadOriginal: detalle.cantidad,
                    valorUnidad: detalle.valorUnidad,
                    estadoInterno: 'SUELTO'
                }, { transaction: t });
            }
        }

        // El pago está confirmado: recién acá el comprador se convierte en cliente.
        const idCliente = await resolverClienteDePedido(pedido, t);

        await pedido.update({ estado: 'en_revision', idCliente, fechaCambioEstado: new Date() }, { transaction: t });
        await t.commit();

        // Entró un pedido nuevo por atender: que el badge del menú admin lo muestre enseguida.
        invalidarContadoresAdmin();
    } catch (e) {
        await t.rollback();
        throw e;
    }
}

// POST /api/web/webhooks/wompi
export const webhookWompi = async (req, res) => {
    try {
        const payload = req.body;

        if (!verificarChecksumWebhook(payload)) {
            console.warn('webhookWompi: checksum inválido, evento descartado.', payload?.data?.transaction?.reference);
            return res.status(400).json({ success: false, message: 'Firma inválida.' });
        }

        const transaccion = payload?.data?.transaction;
        if (!transaccion?.reference || !transaccion?.id || !transaccion?.status) {
            return res.status(400).json({ success: false, message: 'Payload incompleto.' });
        }

        const pago = await PagosPedidoWeb.findOne({ where: { referenciaWompi: transaccion.reference } });
        if (!pago) {
            // No reconocemos esta referencia — no tiene sentido que Wompi reintente algo que nunca vamos a procesar.
            console.warn('webhookWompi: referencia no encontrada.', transaccion.reference);
            return res.status(200).json({ success: true });
        }

        // Idempotencia: mismo evento (misma transacción, mismo estado) ya procesado.
        if (pago.idTransaccionWompi === transaccion.id && pago.estado === transaccion.status) {
            return res.json({ success: true });
        }

        await pago.update({
            idTransaccionWompi: transaccion.id,
            estado: transaccion.status,
            metodoPago: transaccion.payment_method_type || pago.metodoPago,
            payloadWebhook: JSON.stringify(payload),
            fechaConfirmacion: ESTADOS_FINALES_WOMPI.includes(transaccion.status) ? new Date() : null
        });

        const pedido = await PedidosWeb.findByPk(pago.idPedido);
        if (pedido && pedido.estado === 'pendiente_pago') {
            if (transaccion.status === 'APPROVED') {
                await procesarPagoAprobado(pedido);
            } else if (['DECLINED', 'VOIDED', 'ERROR'].includes(transaccion.status)) {
                await pedido.update({ estado: 'cancelado', fechaCambioEstado: new Date() });
            }
        }

        return res.json({ success: true });
    } catch (e) {
        console.error('webApi.webhookWompi:', e);
        // 500 (no 200): si fue un error transitorio nuestro, que Wompi reintente más tarde.
        return res.status(500).json({ success: false });
    }
};

