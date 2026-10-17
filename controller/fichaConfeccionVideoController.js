import { FichaConfeccionVideo } from '../models/index.js';
import { crearSubidaDirecta, crearSubidaTus, obtenerEstadoVideoCloudflare } from '../helpers/cloudflareStream.js';

// Cloudflare le pone un tope DURO de 200MB al POST simple (helpers/cloudflareStream.js) —
// un video de celular grabando el proceso de confección lo pasa fácil, así que a partir de
// acá (con margen) se usa TUS en vez de dejar que Cloudflare lo rechace con un 4xx.
const LIMITE_SUBIDA_SIMPLE = 190 * 1024 * 1024;

const crearSesionSubida = async ({ pesoBytes, nombreOriginal }) => {
    if (pesoBytes && pesoBytes > LIMITE_SUBIDA_SIMPLE) {
        const { uid, uploadURL } = await crearSubidaTus({ uploadLength: pesoBytes, nombreArchivo: nombreOriginal });
        return { uid, uploadURL, modo: 'tus' };
    }
    const { uid, uploadURL } = await crearSubidaDirecta();
    return { uid, uploadURL, modo: 'simple' };
};

// Videos del proceso de confección (admin/procesos/fichas-confeccion/nueva, paso "Carga el
// video del proceso") — Direct Creator Uploads de Cloudflare Stream: el navegador nunca
// manda el archivo a este servidor, así que no hay multer ni validación de contenido acá
// (helpers/cloudflareStream.js explica por qué). Máximo 3 videos — sin `idFicha` todavía
// (ver models/FichaConfeccionVideo.js) no hay una ficha contra la que contar, así que el
// tope de 3 lo cuenta el propio navegador por `idUsuarioCarga` + los `idVideo` que ya tiene
// en su estado local; el front es el único que sabe cuáles de sus 3 slots son de ESTA ficha.

// POST /admin/procesos/fichas-confeccion/video/solicitar-subida — le pide a Cloudflare una
// URL de subida de un solo uso y crea la fila en 'uploading'. El front sube el archivo
// DIRECTO a `uploadURL` (o simula el progreso si viene null — modo sin credenciales reales,
// ver helpers/cloudflareStream.js) y recién después avisa con /confirmar.
const solicitarSubidaVideo = async (req, res) => {
    try {
        const orden = Number(req.body?.orden);
        const nombreOriginal = String(req.body?.nombreOriginal ?? '').trim().slice(0, 255);
        const pesoBytes = Number(req.body?.pesoBytes) || null;

        if (![1, 2, 3].includes(orden)) {
            return res.status(422).json({ success: false, mensaje: 'Orden de video inválido.' });
        }
        if (!nombreOriginal) {
            return res.status(422).json({ success: false, mensaje: 'Falta el nombre del archivo.' });
        }

        const { uid, uploadURL, modo } = await crearSesionSubida({ pesoBytes, nombreOriginal });

        const video = await FichaConfeccionVideo.create({
            idUsuarioCarga: req.usuario.idUsuario,
            nombreOriginal,
            pesoBytes,
            orden,
            cloudflareVideoUid: uid,
            estado: 'uploading'
        });

        return res.status(201).json({ success: true, idVideo: video.idVideo, uploadURL, modo, simulado: !uploadURL });
    } catch (e) {
        console.error('fichaConfeccionVideoController(solicitarSubida):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo iniciar la subida del video. Intenta de nuevo.' });
    }
};

// POST /admin/procesos/fichas-confeccion/video/:idVideo/confirmar — el front avisa que ya
// terminó de subir los bytes a Cloudflare (o terminó la simulación). Consulta el estado real
// en Cloudflare antes de marcar 'ready': recién subido puede seguir transcodeando.
const confirmarSubidaVideo = async (req, res) => {
    try {
        const video = await FichaConfeccionVideo.findOne({
            where: { idVideo: req.params.idVideo, idUsuarioCarga: req.usuario.idUsuario }
        });
        if (!video) return res.status(404).json({ success: false, mensaje: 'Ese video no existe.' });

        const { estado, errorMensaje } = await obtenerEstadoVideoCloudflare(video.cloudflareVideoUid);

        await video.update({
            estado,
            errorMensaje: estado === 'error' ? errorMensaje : null,
            listoEn: estado === 'ready' ? new Date() : null
        });

        return res.json({ success: true, idVideo: video.idVideo, estado: video.estado, errorMensaje: video.errorMensaje });
    } catch (e) {
        console.error('fichaConfeccionVideoController(confirmarSubida):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo confirmar el video.' });
    }
};

// GET /admin/procesos/fichas-confeccion/video/:idVideo — estado actual, para el indicador
// persistente entre pasos (polling de respaldo mientras sigue en 'uploading'/transcodeando).
const estadoVideo = async (req, res) => {
    try {
        const video = await FichaConfeccionVideo.findOne({
            where: { idVideo: req.params.idVideo, idUsuarioCarga: req.usuario.idUsuario },
            attributes: ['idVideo', 'nombreOriginal', 'orden', 'estado', 'errorMensaje']
        });
        if (!video) return res.status(404).json({ success: false, mensaje: 'Ese video no existe.' });

        if (video.estado === 'uploading') {
            const { estado, errorMensaje } = await obtenerEstadoVideoCloudflare(video.cloudflareVideoUid);
            if (estado !== video.estado) {
                await video.update({ estado, errorMensaje: estado === 'error' ? errorMensaje : null, listoEn: estado === 'ready' ? new Date() : null });
            }
        }

        return res.json({
            success: true,
            video: { idVideo: video.idVideo, nombreOriginal: video.nombreOriginal, orden: video.orden, estado: video.estado, errorMensaje: video.errorMensaje }
        });
    } catch (e) {
        console.error('fichaConfeccionVideoController(estado):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo consultar el video.' });
    }
};

// POST /admin/procesos/fichas-confeccion/video/:idVideo/reintentar — un video en 'error'
// pide una URL de subida nueva sin afectar los otros slots. Mismo `idVideo` y `orden`: es
// el mismo slot, solo cambia a qué UID de Cloudflare apunta.
const reintentarVideo = async (req, res) => {
    try {
        const video = await FichaConfeccionVideo.findOne({
            where: { idVideo: req.params.idVideo, idUsuarioCarga: req.usuario.idUsuario }
        });
        if (!video) return res.status(404).json({ success: false, mensaje: 'Ese video no existe.' });
        if (video.estado !== 'error') {
            return res.status(400).json({ success: false, mensaje: 'Solo se puede reintentar un video en error.' });
        }

        const { uid, uploadURL, modo } = await crearSesionSubida({ pesoBytes: video.pesoBytes, nombreOriginal: video.nombreOriginal });
        await video.update({ cloudflareVideoUid: uid, estado: 'uploading', errorMensaje: null, listoEn: null });

        return res.json({ success: true, idVideo: video.idVideo, uploadURL, modo, simulado: !uploadURL });
    } catch (e) {
        console.error('fichaConfeccionVideoController(reintentar):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo reintentar la subida. Intenta de nuevo.' });
    }
};

// POST /admin/procesos/fichas-confeccion/video/:idVideo/marcar-error — el front llama acá
// cuando la subida directa a Cloudflare falla del lado del navegador (red cortada, XHR
// error) antes de que Cloudflare llegue a tener nada que reportar.
const marcarErrorVideo = async (req, res) => {
    try {
        const video = await FichaConfeccionVideo.findOne({
            where: { idVideo: req.params.idVideo, idUsuarioCarga: req.usuario.idUsuario }
        });
        if (!video) return res.status(404).json({ success: false, mensaje: 'Ese video no existe.' });

        const mensaje = String(req.body?.mensaje ?? '').trim().slice(0, 500) || 'La subida falló.';
        await video.update({ estado: 'error', errorMensaje: mensaje });

        return res.json({ success: true, idVideo: video.idVideo, estado: 'error' });
    } catch (e) {
        console.error('fichaConfeccionVideoController(marcarError):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo registrar el error.' });
    }
};

export { solicitarSubidaVideo, confirmarSubidaVideo, estadoVideo, reintentarVideo, marcarErrorVideo };
