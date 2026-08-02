import { Op, fn, col } from 'sequelize';
import { Categorias, BannersWeb, CenefasWeb, SeccionesWeb, PopupWeb, EtiquetasWeb, PaginasWeb, Productos, Imagenes, VisitasProducto } from '../models/index.js';
import s3Client from '../config/r2.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import sharp from 'sharp';
import { validarYConvertirImagenWebp } from '../helpers/helpers.js';

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

    // "Resumen de pedidos" sigue simulado: aún no existe un módulo de pedidos web — se define en una segunda fase.
    const resumenPedidos = {
        nuevos: 8,
        enProceso: 15,
        pendientesPago: 6,
        completadosHoy: 32,
        canceladosHoy: 2
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

    const resumenRapido = {
        productosActivos,
        visitasHoy: 1248,
        ventasHoy: 2450000,
        tasaConversion: 2.8
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
