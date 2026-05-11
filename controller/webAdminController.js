import { Categorias, BannersWeb, CenefasWeb, SeccionesWeb, PopupWeb } from '../models/index.js';
import s3Client from '../config/r2.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import sharp from 'sharp';

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_BASE   = process.env.R2_PUBLIC_URL;

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
    const [banners, cenefas, secciones, popup, categoriasActivas] = await Promise.all([
        BannersWeb.count(),
        CenefasWeb.count({ where: { activo: true } }),
        SeccionesWeb.count({ where: { activo: true } }),
        PopupWeb.findOne({ where: { activo: true } }),
        Categorias.count({ where: { webActiva: true } })
    ]);
    return res.render('./administrador/web/home', {
        currentPath, banners, cenefas, secciones, popup, categoriasActivas
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

export const crearBanner = async (req, res) => {
    try {
        const { titulo, subtitulo, textoBoton, linkBoton, orden } = req.body;
        let imagenUrl = null, imagenKey = null;

        if (req.file) {
            const buffer = await sharp(req.file.buffer).webp({ quality: 85 }).toBuffer();
            const key = `web/banners/${Date.now()}.webp`;
            imagenUrl = await subirImagenR2(buffer, key, 'image/webp');
            imagenKey = key;
        }

        await BannersWeb.create({ titulo, subtitulo, textoBoton, linkBoton, orden: orden || 0, imagenUrl, imagenKey });
        return res.json({ success: true, mensaje: 'Banner creado correctamente.' });
    } catch (e) {
        console.error('crearBanner:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al crear el banner.' });
    }
};

export const actualizarBanner = async (req, res) => {
    try {
        const { idBanner } = req.params;
        const banner = await BannersWeb.findByPk(idBanner);
        if (!banner) return res.status(404).json({ success: false, mensaje: 'Banner no encontrado.' });

        const { titulo, subtitulo, textoBoton, linkBoton, orden, activo } = req.body;
        let imagenUrl = banner.imagenUrl, imagenKey = banner.imagenKey;

        if (req.file) {
            if (banner.imagenKey) await eliminarImagenR2(banner.imagenKey).catch(() => {});
            const buffer = await sharp(req.file.buffer).webp({ quality: 85 }).toBuffer();
            const key = `web/banners/${Date.now()}.webp`;
            imagenUrl = await subirImagenR2(buffer, key, 'image/webp');
            imagenKey = key;
        }

        await banner.update({ titulo, subtitulo, textoBoton, linkBoton, orden: orden || 0, activo: activo === 'true' || activo === true, imagenUrl, imagenKey });
        return res.json({ success: true, mensaje: 'Banner actualizado correctamente.' });
    } catch (e) {
        console.error('actualizarBanner:', e);
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar el banner.' });
    }
};

export const eliminarBanner = async (req, res) => {
    const { idBanner } = req.params;
    const banner = await BannersWeb.findByPk(idBanner);
    if (!banner) return res.status(404).json({ success: false, mensaje: 'Banner no encontrado.' });
    if (banner.imagenKey) await eliminarImagenR2(banner.imagenKey).catch(() => {});
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
        const { texto, link, colorFondo, colorTexto } = req.body;
        await CenefasWeb.create({ texto, link, colorFondo: colorFondo || '#EC5FA3', colorTexto: colorTexto || '#FFFFFF' });
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
        const { texto, link, colorFondo, colorTexto, activo } = req.body;
        await cenefa.update({ texto, link, colorFondo, colorTexto, activo: activo === 'true' || activo === true });
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
