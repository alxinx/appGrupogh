import { Op, fn, col } from 'sequelize';
import db from '../config/bd.js';
import {
    Categorias, BannersWeb, CenefasWeb, SeccionesWeb, PopupWeb, EtiquetasWeb, PaginasWeb, Productos, Imagenes, VisitasProducto,
    PedidosWeb, DetallesPedidoWeb, PagosPedidoWeb, PuntosDeVenta, Municipios, Departamentos, Traslados, DetalleTraslados, Empleados, Stock,
    VisitantesWeb, Entidades, PedidosWebHistorialEstado
} from '../models/index.js';
import { procesarPagoAprobado } from './webApiController.js';
import s3Client from '../config/r2.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import sharp from 'sharp';
import { validarYConvertirImagenWebp } from '../helpers/helpers.js';
import { descontarStockFifo, siguienteCodigoTraslado } from '../helpers/traslados.js';
import { mailPedidoCancelado } from '../helpers/mailPedidoCancelado.js';
import { broadcast } from '../helpers/sseManager.js';
import { inicioDelDiaBogota } from '../helpers/fechas.js';
import { wherePorAtender, whereEsperandoAlCliente } from '../helpers/pedidosWeb.js';
import { invalidarContadoresAdmin } from '../middleware/adminMenuMiddleware.js';

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_BASE   = process.env.R2_PUBLIC_URL;
const WEB_STORE_URL = process.env.WEB_STORE_URL || 'https://www.grupogh.com';

async function subirImagenR2(buffer, key, contentType = 'image/webp') {
    await new Upload({ client: s3Client, params: { Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType } }).done();
    return `${R2_BASE}/${key}`;
}

async function eliminarImagenR2(key) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })).catch(() => {});
}

// ─── DASHBOARD WEB ───────────────────────────────────────────────────────────

export const dashboardWeb = async (req, res) => {
    const currentPath = req.path;
    const [banners, cenefas, secciones, popup, categoriasActivas, paginas, productosActivos, ranking] = await Promise.all([
        BannersWeb.count(),
        CenefasWeb.count({ where: { activo: true } }),
        SeccionesWeb.count({ where: { activo: true } }),
        PopupWeb.findOne({ where: { activo: true } }),
        Categorias.count({ where: { webActiva: true } }),
        PaginasWeb.count({ where: { activa: true } }),
        Productos.count({ where: { activo: true } }),
        VisitasProducto.findAll({
            attributes: ['idProducto', [fn('COUNT', col('idVisita')), 'vistas']],
            group: ['idProducto'],
            order: [[fn('COUNT', col('idVisita')), 'DESC']],
            limit: 5,
            raw: true
        })
    ]);

    // ── Resumen de pedidos (datos reales de PEDIDOS_WEB) ─────────────────────
    // Dos consultas agrupadas en vez de cinco COUNT sueltos.
    //
    // "Completados hoy" y "Cancelados hoy" se miden por fechaCambioEstado, no por createdAt:
    // un pedido que entró ayer y se facturó hoy cuenta como completado hoy, que es lo que la
    // tienda espera ver. El resto son fotos del estado actual, sin filtro de fecha.
    const inicioHoy = inicioDelDiaBogota();

    const [porEstado, cerradosHoy, porAtender, esperandoCliente] = await Promise.all([
        PedidosWeb.findAll({
            attributes: ['estado', [fn('COUNT', col('idPedido')), 'total']],
            where: { estado: { [Op.in]: ['pendiente_pago', 'en_revision', 'trasladado'] } },
            group: ['estado'],
            raw: true
        }),
        PedidosWeb.findAll({
            attributes: ['estado', [fn('COUNT', col('idPedido')), 'total']],
            where: {
                estado: { [Op.in]: ['facturado', 'cancelado'] },
                fechaCambioEstado: { [Op.gte]: inicioHoy }
            },
            group: ['estado'],
            raw: true
        }),
        // Mismo criterio que el badge del menú (helpers/pedidosWeb.js), no un conteo aparte.
        PedidosWeb.count({ where: wherePorAtender() }),
        PedidosWeb.count({ where: whereEsperandoAlCliente() })
    ]);

    const conteo = (filas, estado) => Number(filas.find(f => f.estado === estado)?.total || 0);

    const resumenPedidos = {
        // Esperan acción del admin: pago confirmado sin tienda asignada, o transferencia
        // por QR con comprobante adjunto que hay que verificar.
        nuevos:         porAtender,
        // Ya trasladados a una tienda, esperando que la tienda los facture.
        enProceso:      conteo(porEstado, 'trasladado'),
        // Los que siguen esperando al comprador (sin comprobante ni pago confirmado).
        pendientesPago: esperandoCliente,
        completadosHoy: conteo(cerradosHoy, 'facturado'),
        canceladosHoy:  conteo(cerradosHoy, 'cancelado')
    };

    // "Productos más vistos" — ranking real desde VISITAS_PRODUCTO (tracking de vistas del sitio web).
    const idsRanking = ranking.map(r => r.idProducto);
    const productosDelRanking = idsRanking.length
        ? await Productos.findAll({
            where: { idProducto: { [Op.in]: idsRanking } },
            include: [{ model: Imagenes, as: 'imagenes', attributes: ['nombreImagen', 'tipo'], required: false }]
        })
        : [];
    const productoPorId = Object.fromEntries(productosDelRanking.map(p => [p.idProducto, p]));

    const productosMasVistos = ranking
        .map(r => {
            const producto = productoPorId[r.idProducto];
            if (!producto) return null;
            const imagenPrincipal = producto.imagenes?.find(img => img.tipo === 'principal') || producto.imagenes?.[0];
            return {
                nombre: producto.nombreProducto,
                imagen: imagenPrincipal ? `${R2_BASE}/productos/${imagenPrincipal.nombreImagen}` : null,
                vistas: Number(r.vistas)
            };
        })
        .filter(Boolean);
    const maxVistas = Math.max(...productosMasVistos.map(p => p.vistas), 1);

    // ── Resumen rápido (datos reales) ────────────────────────────────────────
    // Definiciones, para que los números se puedan interpretar sin adivinar:
    //
    // · Visitas hoy  → visitantes ÚNICOS con actividad hoy (VISITANTES_WEB.ultimaVisita), no
    //   páginas vistas. Un mismo visitante que entra diez veces cuenta una sola.
    // · Ventas hoy   → plata efectivamente cobrada hoy por la pasarela (PAGOS_PEDIDO_WEB
    //   APPROVED, por fechaConfirmacion). No se usa 'facturado' porque un pedido pagado hoy y
    //   facturado mañana es venta de hoy. Los contraentrega NO entran: se cobran al entregar,
    //   y un pedido pendiente no se da por cobrado.
    // · Conversión   → pedidos pagados hoy ÷ visitantes únicos hoy.
    const [visitasHoy, ventasHoy, pedidosPagadosHoy] = await Promise.all([
        VisitantesWeb.count({ where: { ultimaVisita: { [Op.gte]: inicioHoy } } }),
        PagosPedidoWeb.sum('monto', {
            where: { estado: 'APPROVED', fechaConfirmacion: { [Op.gte]: inicioHoy } }
        }),
        // DISTINCT por pedido: si un pedido tuvo varios intentos, sigue siendo una conversión.
        PagosPedidoWeb.count({
            where: { estado: 'APPROVED', fechaConfirmacion: { [Op.gte]: inicioHoy } },
            distinct: true,
            col: 'idPedido'
        })
    ]);

    const resumenRapido = {
        productosActivos,
        visitasHoy,
        ventasHoy: Math.round(ventasHoy || 0),
        tasaConversion: visitasHoy > 0
            ? Math.round((pedidosPagadosHoy / visitasHoy) * 1000) / 10
            : 0
    };

    return res.render('./administrador/web/home', {
        currentPath, banners, cenefas, secciones, popup, categoriasActivas, paginas,
        webStoreUrl: WEB_STORE_URL, resumenPedidos, productosMasVistos, maxVistas, resumenRapido
    });
};

// ─── CATEGORÍAS WEB ──────────────────────────────────────────────────────────

export const categoriasWeb = async (req, res) => {
    const currentPath = req.path;
    const categorias = await Categorias.findAll({
        where: { tipo: 'CATEGORIA' },
        include: [{ model: Categorias, as: 'Subcategorias', attributes: ['idCategoria', 'nombreCategoria', 'webActiva'] }],
        order: [['nombreCategoria', 'ASC']]
    });
    return res.render('./administrador/web/categorias', { currentPath, categorias, csrfToken: req.csrfToken() });
};

export const toggleCategoriaWeb = async (req, res) => {
    const { idCategoria } = req.params;
    const cat = await Categorias.findByPk(idCategoria);
    if (!cat) return res.status(404).json({ success: false, mensaje: 'Categoría no encontrada.' });
    await cat.update({ webActiva: !cat.webActiva });
    return res.json({ success: true, webActiva: cat.webActiva });
};

// POST /admin/web/categorias/:idCategoria/imagen — portada de la categoría para el home web.
// Formato vertical (3:4) porque las tarjetas de "Comprá por estilo" son altas.
export const subirImagenCategoria = async (req, res) => {
    try {
        const { idCategoria } = req.params;
        const cat = await Categorias.findByPk(idCategoria);
        if (!cat) return res.status(404).json({ success: false, mensaje: 'Categoría no encontrada.' });
        if (!req.file) return res.status(400).json({ success: false, mensaje: 'No se recibió ninguna imagen.' });

        // validarYConvertirImagenWebp decodifica de verdad el archivo: no basta con el
        // mimetype que declara el navegador.
        await validarYConvertirImagenWebp(req.file.buffer);

        const buffer = await sharp(req.file.buffer)
            .resize(800, 1066, { fit: 'cover', position: 'attention' })
            .webp({ quality: 82 })
            .toBuffer();

        const key = `web/categorias/${idCategoria}-${Date.now()}.webp`;
        const url = await subirImagenR2(buffer, key, 'image/webp');

        // La anterior se borra después de que la nueva ya subió, para no dejar la categoría
        // sin imagen si la subida falla.
        const keyAnterior = cat.imagenKey;
        await cat.update({ imagen: url, imagenKey: key });
        if (keyAnterior) await eliminarImagenR2(keyAnterior);

        return res.json({ success: true, imagen: url, mensaje: 'Imagen actualizada.' });
    } catch (e) {
        console.error('subirImagenCategoria:', e);
        const esImagenInvalida = e.message?.includes('imagen válida');
        return res.status(esImagenInvalida ? 400 : 500).json({
            success: false,
            mensaje: esImagenInvalida ? e.message : 'Error al subir la imagen.'
        });
    }
};

// DELETE lógico: quita la portada y vuelve al recuadro con degradado en la web.
export const quitarImagenCategoria = async (req, res) => {
    try {
        const { idCategoria } = req.params;
        const cat = await Categorias.findByPk(idCategoria);
        if (!cat) return res.status(404).json({ success: false, mensaje: 'Categoría no encontrada.' });

        const keyAnterior = cat.imagenKey;
        await cat.update({ imagen: null, imagenKey: null });
        if (keyAnterior) await eliminarImagenR2(keyAnterior);

        return res.json({ success: true, mensaje: 'Imagen eliminada.' });
    } catch (e) {
        console.error('quitarImagenCategoria:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al eliminar la imagen.' });
    }
};

// ─── BANNERS ─────────────────────────────────────────────────────────────────

export const listaBanners = async (req, res) => {
    const currentPath = req.path;
    const banners = await BannersWeb.findAll({ order: [['orden', 'ASC'], ['createdAt', 'DESC']] });
    return res.render('./administrador/web/banners', { currentPath, banners, csrfToken: req.csrfToken() });
};

// Convierte y sube a R2 el archivo de un campo de multer (`.fields()`), validando primero
// que sea realmente una imagen decodificable — nunca confiar solo en el mimetype del cliente.
async function procesarImagenBanner(file, sufijo) {
    const buffer = await validarYConvertirImagenWebp(file.buffer);
    const key = `web/banners/${Date.now()}-${sufijo}.webp`;
    const url = await subirImagenR2(buffer, key, 'image/webp');
    return { url, key };
}

export const crearBanner = async (req, res) => {
    try {
        const { titulo, subtitulo, textoBoton, linkBoton, orden } = req.body;
        let imagenUrl = null, imagenKey = null;
        let imagenMovilUrl = null, imagenMovilKey = null;

        const archivoDesktop = req.files?.imagen?.[0];
        const archivoMovil = req.files?.imagenMovil?.[0];

        if (archivoDesktop) {
            ({ url: imagenUrl, key: imagenKey } = await procesarImagenBanner(archivoDesktop, 'desktop'));
        }
        if (archivoMovil) {
            ({ url: imagenMovilUrl, key: imagenMovilKey } = await procesarImagenBanner(archivoMovil, 'movil'));
        }

        await BannersWeb.create({ titulo, subtitulo, textoBoton, linkBoton, orden: orden || 0, imagenUrl, imagenKey, imagenMovilUrl, imagenMovilKey });
        return res.json({ success: true, mensaje: 'Banner creado correctamente.' });
    } catch (e) {
        console.error('crearBanner:', e);
        return res.status(400).json({ success: false, mensaje: e.message?.includes('imagen válida') ? e.message : 'Error al crear el banner.' });
    }
};

export const actualizarBanner = async (req, res) => {
    try {
        const { idBanner } = req.params;
        const banner = await BannersWeb.findByPk(idBanner);
        if (!banner) return res.status(404).json({ success: false, mensaje: 'Banner no encontrado.' });

        const { titulo, subtitulo, textoBoton, linkBoton, orden, activo } = req.body;
        let imagenUrl = banner.imagenUrl, imagenKey = banner.imagenKey;
        let imagenMovilUrl = banner.imagenMovilUrl, imagenMovilKey = banner.imagenMovilKey;

        const archivoDesktop = req.files?.imagen?.[0];
        const archivoMovil = req.files?.imagenMovil?.[0];

        if (archivoDesktop) {
            ({ url: imagenUrl, key: imagenKey } = await procesarImagenBanner(archivoDesktop, 'desktop'));
            if (banner.imagenKey) await eliminarImagenR2(banner.imagenKey).catch(() => {});
        }
        if (archivoMovil) {
            ({ url: imagenMovilUrl, key: imagenMovilKey } = await procesarImagenBanner(archivoMovil, 'movil'));
            if (banner.imagenMovilKey) await eliminarImagenR2(banner.imagenMovilKey).catch(() => {});
        }

        await banner.update({
            titulo, subtitulo, textoBoton, linkBoton, orden: orden || 0,
            activo: activo === 'true' || activo === true,
            imagenUrl, imagenKey, imagenMovilUrl, imagenMovilKey
        });
        return res.json({ success: true, mensaje: 'Banner actualizado correctamente.' });
    } catch (e) {
        console.error('actualizarBanner:', e);
        return res.status(400).json({ success: false, mensaje: e.message?.includes('imagen válida') ? e.message : 'Error al actualizar el banner.' });
    }
};

export const eliminarBanner = async (req, res) => {
    const { idBanner } = req.params;
    const banner = await BannersWeb.findByPk(idBanner);
    if (!banner) return res.status(404).json({ success: false, mensaje: 'Banner no encontrado.' });
    if (banner.imagenKey) await eliminarImagenR2(banner.imagenKey).catch(() => {});
    if (banner.imagenMovilKey) await eliminarImagenR2(banner.imagenMovilKey).catch(() => {});
    await banner.destroy();
    return res.json({ success: true, mensaje: 'Banner eliminado.' });
};

// ─── CENEFAS ─────────────────────────────────────────────────────────────────

export const listaCenefas = async (req, res) => {
    const currentPath = req.path;
    const cenefas = await CenefasWeb.findAll({ order: [['createdAt', 'DESC']] });
    return res.render('./administrador/web/cenefas', { currentPath, cenefas, csrfToken: req.csrfToken() });
};

export const crearCenefa = async (req, res) => {
    try {
        const { texto, link, colorFondo, colorTexto, animacion } = req.body;
        await CenefasWeb.create({ texto, link, colorFondo: colorFondo || '#EC5FA3', colorTexto: colorTexto || '#FFFFFF', animacion: animacion || 'ninguna' });
        return res.json({ success: true, mensaje: 'Cenefa creada correctamente.' });
    } catch (e) {
        console.error('crearCenefa:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al crear la cenefa.' });
    }
};

export const actualizarCenefa = async (req, res) => {
    try {
        const { idCenefa } = req.params;
        const cenefa = await CenefasWeb.findByPk(idCenefa);
        if (!cenefa) return res.status(404).json({ success: false, mensaje: 'Cenefa no encontrada.' });
        const { texto, link, colorFondo, colorTexto, animacion, activo } = req.body;
        await cenefa.update({ texto, link, colorFondo, colorTexto, animacion: animacion || 'ninguna', activo: activo === 'true' || activo === true });
        return res.json({ success: true, mensaje: 'Cenefa actualizada correctamente.' });
    } catch (e) {
        console.error('actualizarCenefa:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar la cenefa.' });
    }
};

export const eliminarCenefa = async (req, res) => {
    const { idCenefa } = req.params;
    const cenefa = await CenefasWeb.findByPk(idCenefa);
    if (!cenefa) return res.status(404).json({ success: false, mensaje: 'Cenefa no encontrada.' });
    await cenefa.destroy();
    return res.json({ success: true, mensaje: 'Cenefa eliminada.' });
};

// ─── SECCIONES ───────────────────────────────────────────────────────────────

export const listaSecciones = async (req, res) => {
    const currentPath = req.path;
    const [secciones, categorias] = await Promise.all([
        SeccionesWeb.findAll({
            include: [{ model: Categorias, as: 'categoria', attributes: ['idCategoria', 'nombreCategoria'] }],
            order: [['orden', 'ASC']]
        }),
        Categorias.findAll({ where: { webActiva: true }, order: [['nombreCategoria', 'ASC']] })
    ]);
    return res.render('./administrador/web/secciones', { currentPath, secciones, categorias, csrfToken: req.csrfToken() });
};

export const crearSeccion = async (req, res) => {
    try {
        const { titulo, idCategoria, orden } = req.body;
        let imagenUrl = null, imagenKey = null;

        if (req.file) {
            const buffer = await sharp(req.file.buffer).resize(800, 600, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
            const key = `web/secciones/${Date.now()}.webp`;
            imagenUrl = await subirImagenR2(buffer, key, 'image/webp');
            imagenKey = key;
        }

        await SeccionesWeb.create({ titulo, idCategoria: idCategoria || null, orden: orden || 0, imagenUrl, imagenKey });
        return res.json({ success: true, mensaje: 'Sección creada correctamente.' });
    } catch (e) {
        console.error('crearSeccion:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al crear la sección.' });
    }
};

export const actualizarSeccion = async (req, res) => {
    try {
        const { idSeccion } = req.params;
        const seccion = await SeccionesWeb.findByPk(idSeccion);
        if (!seccion) return res.status(404).json({ success: false, mensaje: 'Sección no encontrada.' });

        const { titulo, idCategoria, orden, activo } = req.body;
        let imagenUrl = seccion.imagenUrl, imagenKey = seccion.imagenKey;

        if (req.file) {
            if (seccion.imagenKey) await eliminarImagenR2(seccion.imagenKey).catch(() => {});
            const buffer = await sharp(req.file.buffer).resize(800, 600, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
            const key = `web/secciones/${Date.now()}.webp`;
            imagenUrl = await subirImagenR2(buffer, key, 'image/webp');
            imagenKey = key;
        }

        await seccion.update({ titulo, idCategoria: idCategoria || null, orden: orden || 0, activo: activo === 'true' || activo === true, imagenUrl, imagenKey });
        return res.json({ success: true, mensaje: 'Sección actualizada correctamente.' });
    } catch (e) {
        console.error('actualizarSeccion:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar la sección.' });
    }
};

export const eliminarSeccion = async (req, res) => {
    const { idSeccion } = req.params;
    const seccion = await SeccionesWeb.findByPk(idSeccion);
    if (!seccion) return res.status(404).json({ success: false, mensaje: 'Sección no encontrada.' });
    if (seccion.imagenKey) await eliminarImagenR2(seccion.imagenKey).catch(() => {});
    await seccion.destroy();
    return res.json({ success: true, mensaje: 'Sección eliminada.' });
};

// ─── POPUP ───────────────────────────────────────────────────────────────────

export const gestionPopup = async (req, res) => {
    const currentPath = req.path;
    const popup = await PopupWeb.findOne({ order: [['createdAt', 'DESC']] }) || await PopupWeb.create({ activo: false });
    return res.render('./administrador/web/popup', { currentPath, popup, csrfToken: req.csrfToken() });
};

export const actualizarPopup = async (req, res) => {
    try {
        const { idPopup } = req.params;
        const popup = await PopupWeb.findByPk(idPopup);
        if (!popup) return res.status(404).json({ success: false, mensaje: 'Popup no encontrado.' });

        const { titulo, link, delaySegundos, activo } = req.body;
        let imagenUrl = popup.imagenUrl, imagenKey = popup.imagenKey;

        if (req.file) {
            if (popup.imagenKey) await eliminarImagenR2(popup.imagenKey).catch(() => {});
            const buffer = await sharp(req.file.buffer).resize(600, 600, { fit: 'inside' }).webp({ quality: 85 }).toBuffer();
            const key = `web/popup/${Date.now()}.webp`;
            imagenUrl = await subirImagenR2(buffer, key, 'image/webp');
            imagenKey = key;
        }

        await popup.update({ titulo, link, delaySegundos: delaySegundos || 3, activo: activo === 'true' || activo === true, imagenUrl, imagenKey });
        return res.json({ success: true, mensaje: 'Popup actualizado correctamente.' });
    } catch (e) {
        console.error('actualizarPopup:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar el popup.' });
    }
};

// ─── TRACKING Y ETIQUETAS ─────────────────────────────────────────────────────

export const listaEtiquetas = async (req, res) => {
    const currentPath = req.path;
    const etiquetas = await EtiquetasWeb.findAll({ order: [['createdAt', 'DESC']] });
    return res.render('./administrador/web/tracking', { currentPath, etiquetas, csrfToken: req.csrfToken() });
};

export const crearEtiqueta = async (req, res) => {
    try {
        const { nombre, tipo, script, activo, posicion } = req.body;
        if (!nombre?.trim()) return res.status(400).json({ success: false, mensaje: 'El nombre es obligatorio.' });
        const posicionValida = ['header', 'body', 'footer'].includes(posicion) ? posicion : 'body';
        await EtiquetasWeb.create({ nombre: nombre.trim(), tipo: tipo || 'otro', script: script || null, activo: activo === 'true' || activo === true, posicion: posicionValida });
        return res.json({ success: true, mensaje: 'Etiqueta creada correctamente.' });
    } catch (e) {
        console.error('crearEtiqueta:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al crear la etiqueta.' });
    }
};

export const actualizarEtiqueta = async (req, res) => {
    try {
        const { idEtiqueta } = req.params;
        const etiqueta = await EtiquetasWeb.findByPk(idEtiqueta);
        if (!etiqueta) return res.status(404).json({ success: false, mensaje: 'Etiqueta no encontrada.' });
        const { nombre, tipo, script, activo, posicion } = req.body;
        const posicionValida = ['header', 'body', 'footer'].includes(posicion) ? posicion : 'body';
        await etiqueta.update({ nombre: nombre.trim(), tipo: tipo || 'otro', script: script || null, activo: activo === 'true' || activo === true, posicion: posicionValida });
        return res.json({ success: true, mensaje: 'Etiqueta actualizada correctamente.' });
    } catch (e) {
        console.error('actualizarEtiqueta:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar la etiqueta.' });
    }
};

export const eliminarEtiqueta = async (req, res) => {
    const { idEtiqueta } = req.params;
    const etiqueta = await EtiquetasWeb.findByPk(idEtiqueta);
    if (!etiqueta) return res.status(404).json({ success: false, mensaje: 'Etiqueta no encontrada.' });
    await etiqueta.destroy();
    return res.json({ success: true, mensaje: 'Etiqueta eliminada.' });
};

// ─── PÁGINAS SECUNDARIAS ─────────────────────────────────────────────────────

export const listaPaginas = async (req, res) => {
    const currentPath = req.path;
    const paginas = await PaginasWeb.findAll({ order: [['nombrePagina', 'ASC']] });
    return res.render('./administrador/web/paginas', { currentPath, paginas, csrfToken: req.csrfToken() });
};

export const nuevaPaginaForm = async (req, res) => {
    return res.render('./administrador/web/paginas-form', {
        pagina: null, csrfToken: req.csrfToken(), accion: 'crear'
    });
};

export const editarPaginaForm = async (req, res) => {
    const pagina = await PaginasWeb.findByPk(req.params.idPagina);
    if (!pagina) return res.redirect('/admin/web/paginas');
    return res.render('./administrador/web/paginas-form', {
        pagina: pagina.toJSON(), csrfToken: req.csrfToken(), accion: 'editar'
    });
};

export const crearPagina = async (req, res) => {
    try {
        const { nombrePagina, slug, contenido, tags, activa } = req.body;
        const slugClean = slug.trim().toLowerCase();
        const existente = await PaginasWeb.findOne({ where: { slug: slugClean } });
        if (existente) return res.status(400).json({ success: false, mensaje: 'Ya existe una página con ese slug.' });
        await PaginasWeb.create({
            nombrePagina: nombrePagina.trim(),
            slug: slugClean,
            contenido: contenido || '',
            tags: tags?.trim() || null,
            activa: activa === 'true' || activa === true
        });
        return res.json({ success: true, mensaje: 'Página creada correctamente.' });
    } catch (e) {
        console.error('crearPagina:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al crear la página.' });
    }
};

export const actualizarPagina = async (req, res) => {
    try {
        const { idPagina } = req.params;
        const { nombrePagina, slug, contenido, tags, activa } = req.body;
        const pagina = await PaginasWeb.findByPk(idPagina);
        if (!pagina) return res.status(404).json({ success: false, mensaje: 'Página no encontrada.' });
        const slugClean = slug.trim().toLowerCase();
        const existente = await PaginasWeb.findOne({ where: { slug: slugClean, idPagina: { [Op.ne]: idPagina } } });
        if (existente) return res.status(400).json({ success: false, mensaje: 'Ya existe una página con ese slug.' });
        await pagina.update({
            nombrePagina: nombrePagina.trim(),
            slug: slugClean,
            contenido: contenido || '',
            tags: tags?.trim() || null,
            activa: activa === 'true' || activa === true
        });
        return res.json({ success: true, mensaje: 'Página actualizada correctamente.' });
    } catch (e) {
        console.error('actualizarPagina:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar la página.' });
    }
};

export const eliminarPagina = async (req, res) => {
    try {
        const pagina = await PaginasWeb.findByPk(req.params.idPagina);
        if (!pagina) return res.status(404).json({ success: false, mensaje: 'Página no encontrada.' });
        await pagina.destroy();
        return res.json({ success: true, mensaje: 'Página eliminada.' });
    } catch (e) {
        console.error('eliminarPagina:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al eliminar la página.' });
    }
};

// ─── PEDIDOS WEB ──────────────────────────────────────────────────────────────

const ESTADOS_PEDIDO_WEB = ['pendiente_pago', 'en_revision', 'trasladado', 'facturado', 'cancelado'];
const TIPOS_ENTREGA_WEB  = ['domicilio', 'tienda'];
const LIMITE_PEDIDOS_WEB = 15;

// El servidor ya corre en America/Bogota (confirmado), por eso Date crudo es seguro aquí — ver CLAUDE.md sección 10.
function rangoFecha(filtro) {
    const ahora = new Date();
    const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
    switch (filtro) {
        case 'hoy': return inicioHoy;
        case '7dias': { const d = new Date(inicioHoy); d.setDate(d.getDate() - 6); return d; }
        case '30dias': { const d = new Date(inicioHoy); d.setDate(d.getDate() - 29); return d; }
        case 'mes': return new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        default: return null; // 'todos' o sin filtro
    }
}

export const paginaPedidosWeb = async (req, res) => {
    const currentPath = req.path;
    const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
    const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);

    const [pedidosNuevosHoy, canceladosMes, ventasMes] = await Promise.all([
        PedidosWeb.count({ where: { createdAt: { [Op.gte]: inicioHoy } } }),
        PedidosWeb.count({ where: { estado: 'cancelado', createdAt: { [Op.gte]: inicioMes } } }),
        PedidosWeb.sum('total', { where: { estado: 'facturado', createdAt: { [Op.gte]: inicioMes } } })
    ]);

    return res.render('./administrador/web/pedidos', {
        currentPath,
        csrfToken: req.csrfToken(),
        stats: {
            pedidosNuevosHoy,
            canceladosMes,
            ventasMes: ventasMes || 0
        }
    });
};

function construirWherePedidosWeb({ q, estado, tipoEntrega, fecha }) {
    const where = {};
    if (estado && ESTADOS_PEDIDO_WEB.includes(estado)) where.estado = estado;
    if (tipoEntrega && TIPOS_ENTREGA_WEB.includes(tipoEntrega)) where.tipoEntrega = tipoEntrega;

    const desde = rangoFecha(fecha);
    if (desde) where.createdAt = { [Op.gte]: desde };

    if (q?.trim()) {
        const termino = `%${q.trim()}%`;
        where[Op.or] = [
            { numeroPedido: { [Op.like]: termino } },
            { nombreCliente: { [Op.like]: termino } },
            { apellidoCliente: { [Op.like]: termino } },
            { email: { [Op.like]: termino } }
        ];
    }
    return where;
}

// GET /admin/web/pedidos/json — listado filtrado y paginado
export const jsonPedidosWeb = async (req, res) => {
    try {
        const pagina = Math.max(1, parseInt(req.query.pagina) || 1);
        const where = construirWherePedidosWeb(req.query);

        const { rows: pedidos, count: total } = await PedidosWeb.findAndCountAll({
            where,
            include: [{ model: PuntosDeVenta, as: 'puntoRecogida', attributes: ['nombreComercial', 'direccionPrincipal', 'ciudad', 'departamento'], required: false }],
            order: [['createdAt', 'DESC']],
            limit: LIMITE_PEDIDOS_WEB,
            offset: (pagina - 1) * LIMITE_PEDIDOS_WEB,
            distinct: true
        });

        const ids = pedidos.map(p => p.idPedido);

        // Conteo de productos por pedido — una sola consulta agregada, no N+1.
        const conteos = ids.length
            ? await DetallesPedidoWeb.findAll({
                where: { idPedido: { [Op.in]: ids } },
                attributes: ['idPedido', [fn('COUNT', col('idDetallePedido')), 'cantidad']],
                group: ['idPedido'],
                raw: true
            })
            : [];
        const conteoPorPedido = Object.fromEntries(conteos.map(c => [c.idPedido, parseInt(c.cantidad)]));

        // Nombre de ciudad/depto para pedidos de recogida en tienda — resuelto en lote, no por fila.
        const codigosCiudad = [...new Set(pedidos.map(p => p.puntoRecogida?.ciudad).filter(Boolean))];
        const codigosDepto  = [...new Set(pedidos.map(p => p.puntoRecogida?.departamento).filter(Boolean))];
        const [municipios, departamentos] = await Promise.all([
            codigosCiudad.length ? Municipios.findAll({ where: { id: { [Op.in]: codigosCiudad } }, attributes: ['id', 'nombre'], raw: true }) : [],
            codigosDepto.length  ? Departamentos.findAll({ where: { id: { [Op.in]: codigosDepto } }, attributes: ['id', 'nombre'], raw: true }) : []
        ]);
        const nombreMunicipio    = Object.fromEntries(municipios.map(m => [m.id, m.nombre]));
        const nombreDepartamento = Object.fromEntries(departamentos.map(d => [d.id, d.nombre]));

        return res.json({
            success: true,
            paginaActual: pagina,
            totalPaginas: Math.ceil(total / LIMITE_PEDIDOS_WEB),
            total,
            pedidos: pedidos.map(p => ({
                idPedido: p.idPedido,
                numeroPedido: p.numeroPedido,
                nProductos: conteoPorPedido[p.idPedido] || 0,
                nombreCliente: `${p.nombreCliente} ${p.apellidoCliente}`,
                email: p.email,
                telefono: p.telefono,
                tipoEntrega: p.tipoEntrega,
                direccion: p.tipoEntrega === 'domicilio'
                    ? { linea1: [p.direccion, p.apto].filter(Boolean).join(', '), linea2: p.notasEntrega ? `Referencia: ${p.notasEntrega}` : null }
                    : { linea1: p.puntoRecogida?.nombreComercial || '—', linea2: p.puntoRecogida?.direccionPrincipal || null },
                ciudad: p.tipoEntrega === 'domicilio' ? p.ciudad : (nombreMunicipio[p.puntoRecogida?.ciudad] || null),
                departamento: p.tipoEntrega === 'domicilio' ? p.departamento : (nombreDepartamento[p.puntoRecogida?.departamento] || null),
                estado: p.estado,
                total: p.total,
                createdAt: p.createdAt
            }))
        });
    } catch (e) {
        console.error('jsonPedidosWeb:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar los pedidos.' });
    }
};

// GET /admin/web/pedidos/:idPedido/json — detalle completo de un pedido, solo lectura.
const NOMBRE_BODEGA_PEDIDOS_WEB = 'Pedidos Web';
const CODIGO_EMPLEADO_SISTEMA_WEB = '00000';
const TIENDAS_ASIGNABLES = ['Punto de venta'];

export const jsonDetallePedidoWeb = async (req, res) => {
    try {
        const { idPedido } = req.params;
        const pedido = await PedidosWeb.findByPk(idPedido, {
            include: [
                { model: PuntosDeVenta, as: 'puntoRecogida', attributes: ['nombreComercial', 'direccionPrincipal'], required: false },
                { model: PuntosDeVenta, as: 'tiendaFacturacion', attributes: ['nombreComercial'], required: false },
                { model: PagosPedidoWeb, as: 'pagos', attributes: ['estado', 'metodoPago', 'monto', 'referenciaWompi', 'idTransaccionWompi', 'fechaConfirmacion', 'createdAt'], required: false },
                { model: Entidades, as: 'entidadPagoQr', attributes: ['nombreEntidad', 'tipoEntidad'], required: false },
                {
                    model: PedidosWebHistorialEstado, as: 'historialEstado', required: false,
                    attributes: ['estadoAnterior', 'estadoNuevo', 'nombreEmpleado', 'codigoEmpleado', 'motivo', 'createdAt']
                },
                {
                    model: DetallesPedidoWeb, as: 'detalles', required: false,
                    include: [{
                        model: Productos, as: 'producto', attributes: ['nombreProducto', 'sku', 'slug'],
                        include: [{ model: Imagenes, as: 'imagenes', attributes: ['nombreImagen', 'tipo'], required: false }]
                    }]
                },
                {
                    model: Traslados, as: 'traslados', required: false,
                    include: [
                        { model: PuntosDeVenta, as: 'origen', attributes: ['nombreComercial'] },
                        { model: PuntosDeVenta, as: 'destino', attributes: ['nombreComercial'] },
                        { model: DetalleTraslados, as: 'items', include: [{ model: Productos, as: 'producto', attributes: ['nombreProducto'], required: false }] }
                    ]
                }
            ]
        });
        if (!pedido) return res.status(404).json({ success: false, mensaje: 'Pedido no encontrado.' });

        const bodegaWeb = await PuntosDeVenta.findOne({ where: { nombreComercial: NOMBRE_BODEGA_PEDIDOS_WEB }, attributes: ['idPuntoDeVenta'] });
        const trasladoEntrada = (pedido.traslados || []).find(t => t.idDestino === bodegaWeb?.idPuntoDeVenta);
        const trasladoSalida  = (pedido.traslados || []).find(t => t.idOrigen === bodegaWeb?.idPuntoDeVenta);

        const tiendasAsignables = await PuntosDeVenta.findAll({
            where: { tipo: { [Op.in]: TIENDAS_ASIGNABLES }, activa: true },
            attributes: ['idPuntoDeVenta', 'nombreComercial'],
            order: [['nombreComercial', 'ASC']],
            raw: true
        });

        const mapTraslado = (t) => t && {
            codigoTraslado: t.codigoTraslado,
            estado: t.estado,
            origen: t.origen?.nombreComercial || '—',
            destino: t.destino?.nombreComercial || '—',
            fechaRecepcion: t.fechaRecepcion,
            items: (t.items || []).map(i => ({ nombre: i.producto?.nombreProducto || '(producto eliminado)', cantidad: i.cantidad }))
        };

        return res.json({
            success: true,
            pedido: {
                idPedido: pedido.idPedido,
                numeroPedido: pedido.numeroPedido,
                estado: pedido.estado,
                tipoEntrega: pedido.tipoEntrega,
                metodoPago: pedido.metodoPago,
                // Pago por QR: a qué entidad transfirió y la captura que adjuntó, para
                // que el operador pueda cotejar contra el extracto bancario.
                entidadPagoQr: pedido.entidadPagoQr?.nombreEntidad || null,
                comprobantePago: pedido.comprobantePagoKey ? `${R2_BASE}/${pedido.comprobantePagoKey}` : null,
                comprobantePagoAt: pedido.comprobantePagoAt,
                // Voucher digitado por el operador al confirmar el pago. Es el mismo número
                // que va a ver la tienda en su cuadre de caja cuando facture el pedido.
                pagoQrReferencia: pedido.pagoQrReferencia,
                pagoQrValor: pedido.pagoQrValor,
                fechaRevision: pedido.fechaRevision,
                // Quién movió el pedido a mano y cuándo. Orden cronológico.
                historialEstado: (pedido.historialEstado || [])
                    .slice()
                    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
                    .map(h => ({
                        estadoAnterior: h.estadoAnterior,
                        estadoNuevo:    h.estadoNuevo,
                        empleado:       h.nombreEmpleado,
                        codigoEmpleado: h.codigoEmpleado,
                        motivo:         h.motivo,
                        fecha:          h.createdAt
                    })),
                nombreCliente: `${pedido.nombreCliente} ${pedido.apellidoCliente}`,
                email: pedido.email,
                telefono: pedido.telefono,
                cedula: pedido.cedula,
                tipoDocumento: pedido.tipoDocumento,
                tipoPersona: pedido.tipoPersona,
                razonSocial: pedido.razonSocial,
                digitoVerif: pedido.digitoVerif,
                direccion: pedido.direccion,
                apto: pedido.apto,
                ciudad: pedido.ciudad,
                departamento: pedido.departamento,
                notasEntrega: pedido.notasEntrega,
                puntoRecogida: pedido.puntoRecogida ? { nombre: pedido.puntoRecogida.nombreComercial, direccion: pedido.puntoRecogida.direccionPrincipal } : null,
                subtotal: pedido.subtotal,
                envio: pedido.envio,
                descuento: pedido.descuento,
                total: pedido.total,
                razonRechazo: pedido.razonRechazo,
                createdAt: pedido.createdAt,
                // Alimenta el contador de tiempo en estado actual del header.
                fechaCambioEstado: pedido.fechaCambioEstado || pedido.updatedAt,
                idTiendaFacturacion: pedido.idTiendaFacturacion,
                tiendaFacturacion: pedido.tiendaFacturacion?.nombreComercial || null,
                items: (pedido.detalles || []).map(d => {
                    const img = d.producto?.imagenes?.find(i => i.tipo === 'principal') || d.producto?.imagenes?.[0];
                    return {
                        nombre: d.producto?.nombreProducto || '(producto eliminado)',
                        referencia: d.producto?.sku || '—',
                        imagen: img ? `${R2_BASE}/productos/${img.nombreImagen}` : null,
                        talla: d.talla,
                        color: d.color,
                        cantidad: d.cantidad,
                        valorUnidad: d.valorUnidad,
                        subTotal: d.subTotal
                    };
                }),
                pagos: (pedido.pagos || []).map(pg => ({
                    estado: pg.estado, metodoPago: pg.metodoPago, monto: pg.monto,
                    referencia: pg.referenciaWompi, idTransaccion: pg.idTransaccionWompi,
                    fechaConfirmacion: pg.fechaConfirmacion, createdAt: pg.createdAt
                })),
                trasladoEntrada: mapTraslado(trasladoEntrada) || null,
                trasladoSalida: mapTraslado(trasladoSalida) || null,
                tiendasAsignables
            }
        });
    } catch (e) {
        console.error('jsonDetallePedidoWeb:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al cargar el pedido.' });
    }
};

export const paginaDetallePedidoWeb = async (req, res) => {
    const pedido = await PedidosWeb.findByPk(req.params.idPedido, { attributes: ['idPedido'] });
    if (!pedido) return res.redirect('/admin/web/pedidos');
    return res.render('./administrador/web/pedidoDetalle', {
        currentPath: req.path,
        csrfToken: req.csrfToken(),
        idPedido: req.params.idPedido
    });
};

// POST /admin/web/pedidos/:idPedido/asignar-tienda
// Segunda etapa del traslado: la mercancía ya está en la bodega "Pedidos Web" (traslado automático
// al aprobarse el pago); acá el operador decide qué tienda física se queda con la venta y se
// registra el traslado de vuelta bodega → tienda asignada.
export const asignarTiendaPedidoWeb = async (req, res) => {
    try {
        const { idPedido } = req.params;
        const { idTiendaFacturacion } = req.body;

        const pedido = await PedidosWeb.findByPk(idPedido, { include: [{ model: DetallesPedidoWeb, as: 'detalles' }] });
        if (!pedido) return res.status(404).json({ success: false, mensaje: 'Pedido no encontrado.' });
        if (pedido.estado !== 'en_revision') {
            return res.status(400).json({ success: false, mensaje: 'Solo se puede asignar una tienda a pedidos en revisión (pago ya confirmado).' });
        }
        if (pedido.idTiendaFacturacion) {
            return res.status(400).json({ success: false, mensaje: 'Este pedido ya fue asignado a una tienda.' });
        }

        const tienda = await PuntosDeVenta.findOne({ where: { idPuntoDeVenta: idTiendaFacturacion, tipo: { [Op.in]: TIENDAS_ASIGNABLES }, activa: true } });
        if (!tienda) return res.status(400).json({ success: false, mensaje: 'La tienda seleccionada no es válida.' });

        const [bodegaWeb, sistemaWeb] = await Promise.all([
            PuntosDeVenta.findOne({ where: { nombreComercial: NOMBRE_BODEGA_PEDIDOS_WEB } }),
            Empleados.findOne({ where: { codigoEmpleado: CODIGO_EMPLEADO_SISTEMA_WEB } })
        ]);
        if (!bodegaWeb || !sistemaWeb) {
            return res.status(500).json({ success: false, mensaje: 'Falta configurar la bodega "Pedidos Web" o el empleado "Sistema Web".' });
        }

        const trasladoPrevio = await Traslados.findOne({ where: { idPedidoWeb: idPedido, idOrigen: bodegaWeb.idPuntoDeVenta } });
        if (trasladoPrevio) {
            return res.status(400).json({ success: false, mensaje: 'Ya existe un traslado de salida registrado para este pedido.' });
        }

        // Trazabilidad de quién hizo la asignación, aunque el usuario admin no tenga fila propia en EMPLEADOS.
        const operador = await Empleados.findOne({ where: { idUsuario: req.usuario.idUsuario } });

        const t = await db.transaction();
        try {
            for (const detalle of pedido.detalles) {
                await descontarStockFifo(detalle.idProducto, bodegaWeb.idPuntoDeVenta, detalle.cantidad, t);
                await Stock.create({
                    idPuntoVenta: tienda.idPuntoDeVenta,
                    idProducto: detalle.idProducto,
                    cantidadExistente: detalle.cantidad,
                    cantidadOriginal: detalle.cantidad,
                    valorUnidad: detalle.valorUnidad,
                    estadoInterno: 'SUELTO'
                }, { transaction: t });
            }

            const codigoTraslado = await siguienteCodigoTraslado(t);
            const traslado = await Traslados.create({
                codigoTraslado,
                idOrigen: bodegaWeb.idPuntoDeVenta,
                idDestino: tienda.idPuntoDeVenta,
                idUsuarioDespacha: sistemaWeb.idEmpleado,
                idUsuarioRecibe: sistemaWeb.idEmpleado,
                estado: 'RECIBIDO',
                fechaRecepcion: new Date(),
                idPedidoWeb: pedido.idPedido,
                notas: `Asignado por ${req.usuario.nombreUsuario} (${req.usuario.emailUsuario}) — traslado bodega → tienda del pedido web ${pedido.numeroPedido}`
            }, { transaction: t });

            for (const detalle of pedido.detalles) {
                await DetalleTraslados.create({
                    idTraslado: traslado.idTraslado,
                    idProducto: detalle.idProducto,
                    cantidad: detalle.cantidad,
                    estado: 'RECIBIDO'
                }, { transaction: t });
            }

            await pedido.update({
                idTiendaFacturacion: tienda.idPuntoDeVenta,
                idOperadorRevisor: operador?.idEmpleado || null,
                fechaRevision: new Date(),
                // El pedido ya salió de la bodega web y está físicamente en la tienda.
                estado: 'trasladado',
                fechaCambioEstado: new Date()
            }, { transaction: t });

            await t.commit();
        } catch (e) {
            await t.rollback();
            throw e;
        }

        // El pedido dejó de estar 'en_revision': el badge del menú tiene que reflejarlo ya.
        invalidarContadoresAdmin();

        // Avisa en vivo a la tienda asignada (misma mecánica que "new_traslado") — best-effort,
        // si no hay nadie conectado en ese canal simplemente no llega a nadie.
        try {
            broadcast(tienda.idPuntoDeVenta, 'new_pedido_web', { idPedido: pedido.idPedido, numeroPedido: pedido.numeroPedido });
        } catch (_) {}

        return res.json({ success: true, mensaje: `Pedido asignado a ${tienda.nombreComercial}.` });
    } catch (e) {
        console.error('asignarTiendaPedidoWeb:', e);
        return res.status(500).json({ success: false, mensaje: e.message?.includes('Stock insuficiente') ? e.message : 'Error al asignar la tienda.' });
    }
};

// POST /admin/web/pedidos/:idPedido/cancelar
// Deja constancia de quién movió el pedido y desde qué sesión. Se llama siempre dentro
// de la misma transacción que el cambio de estado: o queda el cambio con su registro, o no
// queda nada.
async function registrarCambioEstado({ pedido, estadoAnterior, estadoNuevo, req, motivo }, transaction) {
    const emp = req.empleadoVerificado;
    return PedidosWebHistorialEstado.create({
        idPedido:       pedido.idPedido,
        estadoAnterior,
        estadoNuevo,
        idEmpleado:     emp?.idEmpleado || null,
        nombreEmpleado: emp?.nombre || null,
        codigoEmpleado: emp?.codigoEmpleado || null,
        idUsuario:      req.usuario?.idUsuario || null,
        motivo:         motivo ? String(motivo).slice(0, 255) : null
    }, { transaction });
}

// POST /admin/web/pedidos/:idPedido/confirmar-pago
// Confirma a mano un pago que ninguna pasarela va a confirmar: transferencia por QR o
// contraentrega. Exige código de empleado — es la persona que dice haber visto la plata.
export const confirmarPagoPedidoWeb = async (req, res) => {
    try {
        const { idPedido } = req.params;
        const nota = req.body?.nota?.trim() || null;

        const pedido = await PedidosWeb.findByPk(idPedido);
        if (!pedido) return res.status(404).json({ success: false, mensaje: 'Pedido no encontrado.' });

        if (pedido.estado !== 'pendiente_pago') {
            return res.status(409).json({
                success: false,
                mensaje: `Solo se puede confirmar el pago de un pedido pendiente. Este está en "${ETIQUETA_ESTADO_PEDIDO[pedido.estado] || pedido.estado}".`
            });
        }

        // Número del voucher y valor transferido. Son obligatorios: sin ellos la tienda que
        // despache no puede conciliar el pago en su cuadre de caja, que es el punto de pedirlos.
        const referencia = String(req.body?.nroTransaccion || '').trim();
        if (!referencia) {
            return res.status(422).json({ success: false, mensaje: 'Indicá el número de transacción del comprobante.' });
        }
        if (referencia.length > 50) {
            return res.status(422).json({ success: false, mensaje: 'El número de transacción es demasiado largo (máx. 50 caracteres).' });
        }

        const valor = Number(req.body?.valor);
        if (!Number.isFinite(valor) || valor <= 0) {
            return res.status(422).json({ success: false, mensaje: 'El valor transferido no es válido.' });
        }

        // procesarPagoAprobado descuenta stock, crea el traslado a la bodega web, resuelve
        // el cliente y deja el pedido en 'en_revision' — todo dentro de su propia transacción.
        // Si algo falla ahí (ej. stock insuficiente) lanza y no se toca nada más.
        await procesarPagoAprobado(pedido);

        await PedidosWeb.update(
            {
                idOperadorRevisor: req.empleadoVerificado?.idEmpleado || null,
                fechaRevision:     new Date(),
                pagoQrReferencia:  referencia,
                pagoQrValor:       valor
            },
            { where: { idPedido } }
        );

        // El monto transferido se anota en la bitácora aunque no coincida con el total: si hay
        // diferencia, tiene que quedar rastro de quién la aceptó.
        const totalPedido = Number(pedido.total);
        const difiere = Math.abs(valor - totalPedido) > 0.01;
        const detalleMonto = difiere
            ? ` · transferido $${valor.toLocaleString('es-CO')} sobre un total de $${totalPedido.toLocaleString('es-CO')}`
            : '';

        await registrarCambioEstado({
            pedido, estadoAnterior: 'pendiente_pago', estadoNuevo: 'en_revision', req,
            motivo: `${nota || 'Pago confirmado manualmente'} · voucher ${referencia}${detalleMonto}`
        });

        invalidarContadoresAdmin();

        return res.json({
            success: true,
            mensaje: `Pago confirmado por ${req.empleadoVerificado?.nombre}. El pedido pasó a revisión.`
        });
    } catch (e) {
        console.error('confirmarPagoPedidoWeb:', e);
        // Los errores de procesarPagoAprobado son informativos para el operador
        // (falta stock, falta la bodega "Pedidos Web" configurada).
        return res.status(500).json({ success: false, mensaje: e.message || 'Error al confirmar el pago.' });
    }
};

export const cancelarPedidoWeb = async (req, res) => {
    try {
        const { idPedido } = req.params;
        const razonRechazo = req.body.razonRechazo?.trim();

        // El motivo es obligatorio: lo lee el cliente en el correo de cancelación.
        if (!razonRechazo) {
            return res.status(400).json({ success: false, mensaje: 'Tenés que indicar el motivo de la cancelación.' });
        }

        const pedido = await PedidosWeb.findByPk(idPedido, {
            attributes: ['idPedido', 'numeroPedido', 'email', 'nombreCliente', 'apellidoCliente', 'total', 'createdAt', 'estado'],
            include: [{
                model: DetallesPedidoWeb, as: 'detalles', required: false,
                include: [{
                    model: Productos, as: 'producto', attributes: ['nombreProducto', 'sku', 'slug'],
                    include: [{ model: Imagenes, as: 'imagenes', attributes: ['nombreImagen', 'tipo'], required: false }]
                }]
            }]
        });
        if (!pedido) return res.status(404).json({ success: false, mensaje: 'Pedido no encontrado.' });

        // update condicionado al estado actual — evita carreras con otro proceso (ej. webhook de Wompi)
        // que cambie el pedido al mismo tiempo (ver CLAUDE.md sección 9).
        const [filasAfectadas] = await PedidosWeb.update(
            { estado: 'cancelado', razonRechazo, fechaCambioEstado: new Date() },
            { where: { idPedido, estado: { [Op.notIn]: ['facturado', 'cancelado'] } } }
        );

        invalidarContadoresAdmin();

        if (filasAfectadas === 0) {
            return res.status(400).json({ success: false, mensaje: 'El pedido ya está facturado o cancelado, o no existe.' });
        }

        // Quién canceló y por qué. Va después del update condicional: solo se registra si
        // la cancelación efectivamente ocurrió.
        await PedidosWeb.update(
            { idOperadorRevisor: req.empleadoVerificado?.idEmpleado || null, fechaRevision: new Date() },
            { where: { idPedido } }
        );
        await registrarCambioEstado({
            pedido, estadoAnterior: pedido.estado, estadoNuevo: 'cancelado', req, motivo: razonRechazo
        });

        // El correo es informativo — si falla el envío no se revierte la cancelación, solo se registra.
        try {
            await mailPedidoCancelado({
                emailCliente: pedido.email,
                nombreCliente: `${pedido.nombreCliente} ${pedido.apellidoCliente}`,
                numeroPedido: pedido.numeroPedido,
                razones: [razonRechazo],
                total: pedido.total,
                fechaPedido: pedido.createdAt,
                fechaCancelacion: new Date(),
                items: (pedido.detalles || []).map(d => {
                    const img = d.producto?.imagenes?.find(i => i.tipo === 'principal') || d.producto?.imagenes?.[0];
                    return {
                        nombre: d.producto?.nombreProducto || '(producto eliminado)',
                        referencia: d.producto?.sku || '—',
                        slug: d.producto?.slug || null,
                        imagen: img ? `${R2_BASE}/productos/${img.nombreImagen}` : null,
                        cantidad: d.cantidad,
                        valorUnidad: d.valorUnidad,
                        subTotal: d.subTotal
                    };
                })
            });
        } catch (mailError) {
            console.error('cancelarPedidoWeb: fallo el envío del correo de cancelación:', mailError);
        }

        return res.json({ success: true, mensaje: 'Pedido cancelado.' });
    } catch (e) {
        console.error('cancelarPedidoWeb:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al cancelar el pedido.' });
    }
};

const ETIQUETA_ESTADO_PEDIDO = {
    pendiente_pago: 'Pendiente de pago',
    en_revision: 'En revisión',
    trasladado: 'Trasladado a tienda',
    facturado: 'Facturado / Despachado',
    cancelado: 'Cancelado'
};
const ETIQUETA_ENTREGA = { domicilio: 'Domicilio', tienda: 'Punto de venta' };

function celdaCsv(valor) {
    const texto = valor === null || valor === undefined ? '' : String(valor);
    return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// GET /admin/web/pedidos/exportar — CSV de los pedidos que coinciden con los filtros activos.
// Limitado a 5000 filas (ver CLAUDE.md sección 11: nunca findAll sin límite para un reporte).
export const exportarPedidosWeb = async (req, res) => {
    try {
        const where = construirWherePedidosWeb(req.query);
        const pedidos = await PedidosWeb.findAll({
            where,
            include: [{ model: PuntosDeVenta, as: 'puntoRecogida', attributes: ['nombreComercial'], required: false }],
            order: [['createdAt', 'DESC']],
            limit: 5000
        });

        const encabezado = ['Número de pedido', 'Cliente', 'Email', 'Teléfono', 'Entrega', 'Dirección / Punto de venta', 'Ciudad', 'Departamento', 'Estado', 'Total', 'Fecha'];
        const filas = pedidos.map(p => [
            p.numeroPedido,
            `${p.nombreCliente} ${p.apellidoCliente}`,
            p.email,
            p.telefono,
            ETIQUETA_ENTREGA[p.tipoEntrega] || p.tipoEntrega,
            p.tipoEntrega === 'domicilio' ? p.direccion : (p.puntoRecogida?.nombreComercial || ''),
            p.tipoEntrega === 'domicilio' ? (p.ciudad || '') : '',
            p.tipoEntrega === 'domicilio' ? (p.departamento || '') : '',
            ETIQUETA_ESTADO_PEDIDO[p.estado] || p.estado,
            p.total,
            new Date(p.createdAt).toLocaleString('es-CO')
        ]);

        const csv = [encabezado, ...filas].map(fila => fila.map(celdaCsv).join(',')).join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="pedidos-web-${Date.now()}.csv"`);
        return res.send('﻿' + csv); // BOM para que Excel detecte UTF-8 correctamente
    } catch (e) {
        console.error('exportarPedidosWeb:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al exportar los pedidos.' });
    }
};
