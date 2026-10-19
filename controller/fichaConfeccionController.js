import { PutObjectCommand } from '@aws-sdk/client-s3';

import db from '../config/bd.js';
import {
    FichaConfeccion, FichaConfeccionColor, FichaConfeccionDxf, FichaConfeccionMolde,
    FichaConfeccionMoldeIaIntento, FichaConfeccionVideo, Material, Familia, Atributos
} from '../models/index.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { keyDocumento, urlDocumento } from '../helpers/almacenamientoDocumentos.js';
import { montoPositivo } from '../helpers/helpers.js';
import { generarPdfFichaConfeccion } from '../helpers/fichaConfeccionPdf.js';

// Último paso del asistente "Nueva ficha de confección" — junta lo que el DXF, el molde y
// los videos venían subiendo sueltos (FichaConfeccionDxf/Molde/MoldeIaIntento/Video, todos
// creados en pasos anteriores) en un solo registro, y genera el PDF. No hay "guardar
// borrador": el asistente vive solo en el navegador hasta este POST (CLAUDE.md — no
// inventar persistencia a medias que nadie pidió).

const INCLUDES_PDF = [
    { model: FichaConfeccionDxf, as: 'dxf' },
    { model: FichaConfeccionMolde, as: 'molde' },
    { model: FichaConfeccionMoldeIaIntento, as: 'moldeIaIntento' },
    { model: FichaConfeccionVideo, as: 'videos' },
    { model: FichaConfeccionColor, as: 'colores', include: [{ model: Atributos, as: 'color' }] }
];

/** Genera el PDF, lo sube a R2 y guarda la ruta — lo usan finalizarFicha (recién creada) y
 *  verFichaPdf (por si el primer intento falló y hay que generarlo de nuevo bajo demanda). */
async function generarYGuardarPdf(idFicha) {
    const ficha = await FichaConfeccion.findByPk(idFicha, { include: INCLUDES_PDF });
    if (!ficha) throw new Error('Esa ficha no existe.');

    const pdfBuffer = await generarPdfFichaConfeccion(ficha);
    const objectKey = keyDocumento({ carpeta: 'fichas-confeccion', prefijo: 'ficha', idPropietario: idFicha, idx: 0, extension: 'pdf' });
    await r2PrivateClient.send(new PutObjectCommand({
        Bucket: R2_PRIVATE_BUCKET, Key: objectKey, Body: pdfBuffer, ContentType: 'application/pdf', CacheControl: 'no-store'
    }));
    await FichaConfeccion.update({ objectKeyPdf: objectKey }, { where: { idFicha } });
    return { objectKey, referencia: ficha.referencia };
}

// POST /admin/procesos/fichas-confeccion/finalizar
const finalizarFicha = async (req, res) => {
    try {
        const idUsuario = req.usuario.idUsuario;
        const precioConfeccion = montoPositivo(req.body?.precioConfeccion);
        if (precioConfeccion === null) {
            return res.status(422).json({ success: false, mensaje: 'El precio de confección debe ser mayor a $0.' });
        }

        const idDxf = req.body?.idDxf;
        if (!idDxf) return res.status(422).json({ success: false, mensaje: 'Falta el archivo DXF del paso 1.' });

        const dxf = await FichaConfeccionDxf.findOne({
            where: { idArchivoDxf: idDxf, idUsuarioCarga: idUsuario },
            include: [
                { model: Material, as: 'materialAsociado' },
                { model: Familia, as: 'familiaAsociada' }
            ]
        });
        if (!dxf || dxf.estado !== 'listo') return res.status(422).json({ success: false, mensaje: 'El DXF no está listo todavía.' });
        if (!dxf.materialAsociado) return res.status(422).json({ success: false, mensaje: 'No se identificó el material del DXF — revisa el código en el archivo.' });
        if (!dxf.familiaAsociada) return res.status(422).json({ success: false, mensaje: 'No se identificó la referencia (Style Name) del DXF.' });

        // Colores: el front manda un array real dentro del JSON del body (Content-Type:
        // application/json), así que express.json() ya lo deja como array — nunca llega
        // como string para volver a JSON.parse (eso rompía con "[object Object]" y vaciaba
        // la lista siempre, aunque el usuario sí hubiera cargado colores). Se valida cada
        // fila igual, nunca se confía en el body a ciegas (CLAUDE.md §12, mass assignment).
        const colores = Array.isArray(req.body?.colores) ? req.body.colores : [];
        if (colores.length === 0) {
            return res.status(422).json({ success: false, mensaje: 'Agrega al menos un color con su cantidad.' });
        }
        const coloresLimpios = [];
        for (const fila of colores) {
            const idAtributoColor = parseInt(fila?.idAtributoColor, 10);
            const cantidad = parseInt(fila?.cantidad, 10);
            if (!Number.isInteger(idAtributoColor) || idAtributoColor <= 0) {
                return res.status(422).json({ success: false, mensaje: 'Hay un color inválido en la lista.' });
            }
            if (!Number.isInteger(cantidad) || cantidad <= 0) {
                return res.status(422).json({ success: false, mensaje: 'Cada color necesita una cantidad mayor a 0.' });
            }
            coloresLimpios.push({ idAtributoColor, cantidad });
        }
        const idsColores = [...new Set(coloresLimpios.map((c) => c.idAtributoColor))];
        const atributosColor = await Atributos.findAll({ where: { idAtributo: idsColores, tipo: 'COLOR' } });
        if (atributosColor.length !== idsColores.length) {
            return res.status(422).json({ success: false, mensaje: 'Alguno de los colores elegidos no es válido.' });
        }

        // Molde / intento de IA: opcionales — ver models/FichaConfeccion.js.
        let molde = null;
        if (req.body?.idMolde) {
            molde = await FichaConfeccionMolde.findOne({ where: { idMolde: req.body.idMolde, idUsuarioCarga: idUsuario } });
            if (!molde) return res.status(422).json({ success: false, mensaje: 'El molde indicado no existe.' });
        }
        let moldeIaIntento = null;
        if (req.body?.idMoldeIaIntento) {
            moldeIaIntento = await FichaConfeccionMoldeIaIntento.findOne({ where: { idIntento: req.body.idMoldeIaIntento, aprobado: true } });
            if (!moldeIaIntento) return res.status(422).json({ success: false, mensaje: 'La imagen generada con IA no existe o no fue aprobada.' });
        }

        // Videos: solo los que de verdad son del usuario, ya están listos, y todavía no
        // pertenecen a otra ficha — una lista de ids del body nunca basta sola (§12).
        const idsVideos = (Array.isArray(req.body?.idsVideos) ? req.body.idsVideos : []).filter((id) => typeof id === 'string' && id);
        const videos = idsVideos.length
            ? await FichaConfeccionVideo.findAll({ where: { idVideo: idsVideos, idUsuarioCarga: idUsuario, estado: 'ready', idFicha: null } })
            : [];

        const complementos = String(req.body?.complementos ?? '').trim().slice(0, 2000) || null;
        const observaciones = String(req.body?.observaciones ?? '').trim().slice(0, 2000) || null;
        const cantidadTotal = coloresLimpios.reduce((suma, c) => suma + c.cantidad, 0);

        let t = null;
        let idFicha = null;
        try {
            t = await db.transaction();

            const ficha = await FichaConfeccion.create({
                idUsuarioCreacion: idUsuario,
                idDxf: dxf.idArchivoDxf,
                idMolde: molde?.idMolde || null,
                idMoldeIaIntento: moldeIaIntento?.idIntento || null,
                referencia: dxf.familiaAsociada.nombreFamilia,
                materialNombre: dxf.materialAsociado.nombre,
                complementos,
                observaciones,
                precioConfeccion,
                cantidadTotal,
                estado: 'activa'
            }, { transaction: t });
            idFicha = ficha.idFicha;

            await FichaConfeccionColor.bulkCreate(
                coloresLimpios.map((c, i) => ({ idFicha, idAtributoColor: c.idAtributoColor, cantidad: c.cantidad, orden: i + 1 })),
                { transaction: t }
            );

            if (videos.length) {
                await FichaConfeccionVideo.update(
                    { idFicha },
                    { where: { idVideo: videos.map((v) => v.idVideo) }, transaction: t }
                );
            }

            await t.commit();
        } catch (e) {
            if (t && !t.finished) await t.rollback().catch(() => {});
            console.error('fichaConfeccionController(finalizar) transacción:', e);
            return res.status(500).json({ success: false, mensaje: 'No se pudo guardar la ficha. Intenta de nuevo.' });
        }

        // El PDF va DESPUÉS del commit, en su propio try (CLAUDE.md §9): si falla, la ficha
        // ya quedó guardada — queda sin `objectKeyPdf` y se genera bajo demanda la próxima
        // vez que alguien la abra (verFichaPdf, abajo).
        try {
            const { objectKey, referencia } = await generarYGuardarPdf(idFicha);
            const pdfUrl = await urlDocumento(objectKey, { nombre: `ficha-confeccion-${referencia}.pdf` });
            return res.status(201).json({ success: true, idFicha, pdfUrl });
        } catch (e) {
            console.error('fichaConfeccionController(finalizar) pdf:', e);
            return res.status(201).json({
                success: true, idFicha, pdfUrl: null,
                avisoPdf: 'La ficha se guardó, pero el PDF no se pudo generar todavía. Ábrela desde la Biblioteca para reintentarlo.'
            });
        }
    } catch (e) {
        console.error('fichaConfeccionController(finalizar):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar la ficha. Intenta de nuevo.' });
    }
};

// GET /admin/procesos/fichas-confeccion/:idFicha/pdf — abre el PDF (firmado, de corta
// vida). Si por lo que sea no se había generado todavía, lo genera acá mismo antes de
// redirigir — así la Biblioteca nunca necesita un botón aparte de "reintentar".
const verFichaPdf = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findByPk(req.params.idFicha, { attributes: ['idFicha', 'referencia', 'objectKeyPdf'] });
        if (!ficha) return res.status(404).send('Esa ficha no existe.');

        const objectKey = ficha.objectKeyPdf || (await generarYGuardarPdf(ficha.idFicha)).objectKey;
        const url = await urlDocumento(objectKey, { nombre: `ficha-confeccion-${ficha.referencia}.pdf` });
        return res.redirect(url);
    } catch (e) {
        console.error('fichaConfeccionController(verPdf):', e);
        return res.status(500).send('No se pudo generar el PDF de la ficha.');
    }
};

export { finalizarFicha, verFichaPdf };
