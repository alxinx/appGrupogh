import { PutObjectCommand } from '@aws-sdk/client-s3';

import db from '../config/bd.js';
import {
    FichaConfeccion, FichaConfeccionInsumo, FichaConfeccionTaller, FichaConfeccionEstado,
    FichaConfeccionDxf, FichaConfeccionDxfMaterial, FichaConfeccionMolde, FichaConfeccionMoldeIaIntento, FichaConfeccionVideo,
    Material, Familia, OrdenProduccion, OrdenCorteReferencia
} from '../models/index.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { keyDocumento, urlDocumento } from '../helpers/almacenamientoDocumentos.js';
import { montoPositivo } from '../helpers/helpers.js';
import { validarInsumosBody, validarDatosFicha, columnasDatosFicha, guardarDatosFicha } from '../helpers/fichaConfeccionDatos.js';
import { generarPdfFichaConfeccion } from '../helpers/fichaConfeccionPdf.js';
import { presentarMaterial } from '../helpers/insumos.js';
import { faltantesFicha, promoverFichaSiCompleta } from '../helpers/ordenesCorte.js';
import { resolverIdFamilia } from '../helpers/productos.js';
import { urlIframeVideo, urlMiniaturaVideo, duracionesVideosCloudflare, eliminarVideoCloudflare } from '../helpers/cloudflareStream.js';

// Último paso del asistente "Nueva ficha de confección" — junta lo que el DXF, el molde y
// los videos venían subiendo sueltos (FichaConfeccionDxf/Molde/MoldeIaIntento/Video, todos
// creados en pasos anteriores) en un solo registro, y genera el PDF. No hay "guardar
// borrador": el asistente vive solo en el navegador hasta este POST (CLAUDE.md — no
// inventar persistencia a medias que nadie pidió).

const INCLUDES_PDF = [
    { model: FichaConfeccionDxf, as: 'dxf' },
    { model: FichaConfeccionMolde, as: 'molde' },
    { model: FichaConfeccionMolde, as: 'moldeReferencia' },
    { model: FichaConfeccionMoldeIaIntento, as: 'moldeIaIntento' },
    { model: FichaConfeccionVideo, as: 'videos' },
    { model: FichaConfeccionInsumo, as: 'insumos' }
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

// Validaciones compartidas entre finalizarFicha (ficha nueva) y actualizarFichaConfeccion
// (ficha ya creada) — las dos reciben la MISMA forma de body para los insumos
// y tienen que aplicar las MISMAS reglas (CLAUDE.md DRY). Nunca lanzan: devuelven
// `{ error }` para que el controlador decida el status/mensaje de la respuesta.

// Insumos, molde, foto, IA, videos y textos: helpers/fichaConfeccionDatos.js (una sola copia
// para el asistente y para la ficha que se crea desde un corte).

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
                {
                    model: FichaConfeccionDxfMaterial, as: 'materialesDetalle',
                    separate: true, order: [['orden', 'ASC']],
                    include: [{ model: Material, as: 'material' }]
                },
                { model: Familia, as: 'familiaAsociada' }
            ]
        });
        if (!dxf || dxf.estado !== 'listo') return res.status(422).json({ success: false, mensaje: 'El DXF no está listo todavía.' });

        // Puede haber más de un material en el mismo DXF (helpers/dxf.js) — se exige que
        // TODOS los códigos detectados tengan insumo en el catálogo, no solo el primero:
        // una ficha con una tela sin resolver quedaría con una lista de materiales a medias.
        const materialesDetalle = dxf.materialesDetalle || [];
        if (!materialesDetalle.length) {
            return res.status(422).json({ success: false, mensaje: 'No se identificó ningún material del DXF — revisa el código en el archivo.' });
        }
        const materialesSinInsumo = materialesDetalle.filter((m) => !m.material);
        if (materialesSinInsumo.length) {
            return res.status(422).json({
                success: false,
                mensaje: `No hay insumo para el código de material ${materialesSinInsumo.map((m) => m.codigoMaterial).join(', ')} del DXF.`
            });
        }
        if (!dxf.familiaAsociada) return res.status(422).json({ success: false, mensaje: 'No se identificó la referencia (Style Name) del DXF.' });

        // Sin colores ni cantidad: la ficha describe la prenda (el QUÉ). Cuántas y en qué
        // colores lo dice la orden de producción (wiki "Proceso de confección").
        const cantidadTotal = 0;

        const { datos: datosFicha, error: errorDatos } = await validarDatosFicha(req.body, idUsuario);
        if (errorDatos) return res.status(422).json({ success: false, mensaje: errorDatos });

        let t = null;
        let idFicha = null;
        try {
            t = await db.transaction();

            const ficha = await FichaConfeccion.create({
                idUsuarioCreacion: idUsuario,
                idDxf: dxf.idArchivoDxf,
                ...columnasDatosFicha(datosFicha),
                referencia: dxf.familiaAsociada.nombreFamilia,
                // Foto del/los material(es) en el momento de guardar — "Mayatext, Polilicra"
                // si el DXF traía más de un código (CLAUDE.md §3: mismo criterio que
                // `referencia`, un texto congelado, no solo la FK).
                materialNombre: materialesDetalle.map((m) => m.material.nombre).join(', '),
                precioConfeccion,
                cantidadTotal,
                estado: 'activa'
            }, { transaction: t });
            idFicha = ficha.idFicha;

            await guardarDatosFicha(idFicha, datosFicha, t);

            await t.commit();
        } catch (e) {
            if (t && !t.finished) await t.rollback().catch(() => {});
            if (e?.publico) return res.status(e.status || 400).json({ success: false, mensaje: e.message });
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

// GET /admin/procesos/fichas-confeccion/:idFicha/dxf — descarga el DXF original (firmado,
// de corta vida), mismo patrón que verFichaPdf. La tela/familia NO se re-edita desde acá
// (ver el aviso de homeFichaConfeccionEditar) pero el patronista sigue necesitando bajar el
// archivo de corte.
const verFichaDxf = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findByPk(req.params.idFicha, {
            attributes: ['idFicha'],
            include: [{ model: FichaConfeccionDxf, as: 'dxf', attributes: ['objectKey', 'nombreOriginal'] }]
        });
        if (!ficha || !ficha.dxf?.objectKey) return res.status(404).send('Esa ficha no tiene un DXF para descargar.');

        const url = await urlDocumento(ficha.dxf.objectKey, { nombre: ficha.dxf.nombreOriginal });
        return res.redirect(url);
    } catch (e) {
        console.error('fichaConfeccionController(verDxf):', e);
        return res.status(500).send('No se pudo descargar el DXF.');
    }
};

// GET /admin/procesos/fichas-confeccion/:idFicha — "Abrir" desde la Biblioteca: el editor
// completo. La tela (Mayatext, Polilicra…) y la familia/referencia-de-catálogo SIGUEN
// saliendo del DXF y no se re-editan acá — cambiarlas re-dispararía toda la resolución de
// materiales/familia del paso 1 del asistente, que es un flujo aparte. Lo que SÍ es
// editable: referencia, complementos, observaciones, precio, insumos (reemplazar y cantidad
// por prenda, sin agregar ni quitar), las imágenes (foto de referencia e IA) y los videos.
// Los talleres NO se asignan acá: se asignan al iniciar el proceso (orden de producción).
const homeFichaConfeccionEditar = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findByPk(req.params.idFicha, {
            include: [
                {
                    model: FichaConfeccionDxf, as: 'dxf',
                    include: [{
                        model: FichaConfeccionDxfMaterial, as: 'materialesDetalle',
                        separate: true, order: [['orden', 'ASC']],
                        include: [{ model: Material, as: 'material', attributes: ['idMaterial', 'nombre', 'codigoMaterial'] }]
                    }]
                },
                { model: FichaConfeccionMolde, as: 'molde' },
                { model: FichaConfeccionMolde, as: 'moldeReferencia' },
                { model: FichaConfeccionMoldeIaIntento, as: 'moldeIaIntento' },
                { model: FichaConfeccionInsumo, as: 'insumos', separate: true, order: [['orden', 'ASC'], ['idDetalle', 'ASC']] },
                { model: FichaConfeccionVideo, as: 'videos' }
            ]
        });
        if (!ficha) return res.status(404).send('Esa ficha no existe.');

        // Catálogo de insumos activos con foto para "Reemplazar insumo" (helpers/insumos.js
        // presentarMaterial), el mismo que usa el asistente (CLAUDE.md DRY).
        const insumosCatalogo = (await Material.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] })).map(presentarMaterial);

        // Imágenes de "Referencias visuales" — igual que el PDF (helpers/fichaConfeccionPdf.js
        // cajaImagen), pero acá hace falta una URL para un <img>, no los bytes: un molde en
        // PDF no tiene con qué mostrarse (mismo límite de siempre, este proyecto no
        // rasteriza PDF a imagen), y el intento de IA solo cuenta si quedó aprobado.
        // Enriquecer materiales del DXF con nombrePadre para los de código compuesto (ej. 2.1)
        const detalleDxf = ficha.dxf?.materialesDetalle || [];
        const codigosPadreDxf = [...new Set(
            detalleDxf.map(f => f.material?.codigoMaterial).filter(c => c?.includes('.')).map(c => c.split('.')[0])
        )];
        if (codigosPadreDxf.length) {
            const padres = await Material.findAll({ where: { codigoMaterial: codigosPadreDxf }, attributes: ['codigoMaterial', 'nombre'] });
            const padrePorCodigo = new Map(padres.map(p => [p.codigoMaterial, p.nombre]));
            detalleDxf.forEach(f => {
                if (f.material?.codigoMaterial?.includes('.'))
                    f.material.nombrePadre = padrePorCodigo.get(f.material.codigoMaterial.split('.')[0]) || null;
            });
        }

        const [moldeImagenUrl, moldeIaImagenUrl, moldeReferenciaImagenUrl] = await Promise.all([
            ficha.molde?.tipoArchivo === 'jpg' && ficha.molde?.objectKey ? urlDocumento(ficha.molde.objectKey) : null,
            ficha.moldeIaIntento?.aprobado && ficha.moldeIaIntento?.objectKeyFinal ? urlDocumento(ficha.moldeIaIntento.objectKeyFinal) : null,
            ficha.moldeReferencia?.objectKey ? urlDocumento(ficha.moldeReferencia.objectKey) : null
        ]);

        // ¿Se puede borrar? Solo si nunca se usó (fichaTieneUso). Si está anulada, el motivo
        // de la última anulación para el aviso de arriba.
        const usada = await fichaTieneUso(ficha.idFicha);
        const ultimaAnulacion = ficha.estado === 'anulada'
            ? await FichaConfeccionEstado.findOne({ where: { idFicha: ficha.idFicha, accion: 'anulada' }, order: [['createdAt', 'DESC']] })
            : null;

        // Videos listos con su reproductor (modal), miniatura y duración (mm:ss).
        const listos = (ficha.videos || []).filter((v) => v.estado === 'ready').sort((x, y) => x.orden - y.orden);
        const duraciones = await duracionesVideosCloudflare(listos.map((v) => v.cloudflareVideoUid));
        const mmss = (seg) => `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(Math.round(seg % 60)).padStart(2, '0')}`;
        const videos = listos.map((v) => ({
            idVideo: v.idVideo,
            nombre: v.nombreOriginal.replace(/\.(mp4|mov|avi)$/i, ''),
            iframeUrl: urlIframeVideo(v.cloudflareVideoUid),
            miniaturaUrl: urlMiniaturaVideo(v.cloudflareVideoUid),
            duracion: duraciones.has(v.cloudflareVideoUid) ? mmss(duraciones.get(v.cloudflareVideoUid)) : null
        }));

        return res.render('./administrador/produccion/fichaConfeccionEditar', {
            pagina: 'Fichas de confección',
            subPagina: ficha.referencia,
            currentPath: '/procesos',
            ficha,
            usada,
            motivoAnulacion: ultimaAnulacion?.motivo || null,
            insumosCatalogo,
            videos,
            moldeImagenUrl,
            moldeIaImagenUrl,
            moldeReferenciaImagenUrl,
            // Ficha por terminar (base creada desde un corte): lo que le falta para pasar a
            // confección y las familias para elegir (lista de sugerencias).
            faltan: ficha.estado === 'anulada' ? [] : faltantesFicha(ficha),
            familias: (await Familia.findAll({ attributes: ['nombreFamilia'], order: [['nombreFamilia', 'ASC']], raw: true })).map(f => f.nombreFamilia),
            familiaActual: ficha.dxf?.idFamiliaAsociada ? (await Familia.findByPk(ficha.dxf.idFamiliaAsociada, { attributes: ['nombreFamilia'], raw: true }))?.nombreFamilia || null : null
        });
    } catch (e) {
        console.error('fichaConfeccionController(editar):', e);
        return res.status(500).send('No se pudo cargar la ficha.');
    }
};

// POST /admin/procesos/fichas-confeccion/:idFicha/actualizar — guarda TODO lo editable del
// editor en un solo POST (mismo criterio que finalizarFicha: el front junta el estado
// completo y lo manda de una vez, no hay autosave por campo). Las imágenes y los videos van
// por sus propios endpoints (asignarImagenFicha, eliminarVideoFicha) porque se suben aparte.
const actualizarFichaConfeccion = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findOne({
            where: { idFicha: req.params.idFicha, estado: ['activa', 'pendiente'] },
            include: [{
                model: FichaConfeccionDxf, as: 'dxf',
                include: [{
                    model: FichaConfeccionDxfMaterial, as: 'materialesDetalle',
                    separate: true, order: [['orden', 'ASC']],
                    include: [{ model: Material, as: 'material' }]
                }]
            }]
        });
        if (!ficha) return res.status(404).json({ success: false, mensaje: 'Esa ficha no existe.' });

        const referencia = String(req.body?.referencia ?? '').trim().slice(0, 150);
        if (!referencia) return res.status(422).json({ success: false, mensaje: 'Escribe una referencia.' });

        const precioConfeccion = montoPositivo(req.body?.precioConfeccion);
        if (precioConfeccion === null) {
            return res.status(422).json({ success: false, mensaje: 'El precio de confección debe ser mayor a $0.' });
        }
        // Cantidad y colores ya no se editan acá: la ficha describe la prenda y sus insumos
        // van por prenda (wiki "Proceso de confección"); cuántas y en qué colores lo dirá la
        // orden de producción. Lo que la ficha ya tenía guardado se conserva tal cual.
        const cantidadTotal = ficha.cantidadTotal;
        const complementos = String(req.body?.complementos ?? '').trim().slice(0, 2000) || null;
        const observaciones = String(req.body?.observaciones ?? '').trim().slice(0, 2000) || null;

        // Insumos: en el editor no se agregan ni se quitan — eso cambiaría el diseño, que se
        // decidió al crear la ficha. Sí se puede REEMPLAZAR uno por otro (el original ya no se
        // consigue) y cambiar su cantidad POR PRENDA. Por eso el body trae exactamente las
        // mismas líneas (`idDetalle`) que la ficha ya tiene, ni una más ni una menos.
        const lineasActuales = await FichaConfeccionInsumo.findAll({ where: { idFicha: ficha.idFicha }, attributes: ['idDetalle'] });
        const idsActuales = new Set(lineasActuales.map((l) => l.idDetalle));
        const insumosBody = Array.isArray(req.body?.insumos) ? req.body.insumos : [];
        const idsBody = insumosBody.map((l) => parseInt(l?.idDetalle, 10));
        if (idsBody.length !== idsActuales.size || new Set(idsBody).size !== idsBody.length || !idsBody.every((id) => idsActuales.has(id))) {
            return res.status(422).json({ success: false, mensaje: 'Los insumos de una ficha creada solo se reemplazan o cambian de cantidad: no se agregan ni se quitan.' });
        }
        const { insumosLimpios, error: errorInsumos } = await validarInsumosBody(insumosBody);
        if (errorInsumos) return res.status(422).json({ success: false, mensaje: errorInsumos });

        let t = null;
        try {
            t = await db.transaction();

            await FichaConfeccion.update(
                { referencia, complementos, observaciones, precioConfeccion, cantidadTotal },
                { where: { idFicha: ficha.idFicha }, transaction: t }
            );

            // Línea por línea, en su lugar: conserva el orden y el id de cada insumo.
            for (let i = 0; i < insumosLimpios.length; i++) {
                const ins = insumosLimpios[i];
                await FichaConfeccionInsumo.update(
                    { idMaterial: ins.idMaterial, nombreMaterial: ins.nombreMaterial, cantidad: ins.cantidad },
                    { where: { idDetalle: idsBody[i], idFicha: ficha.idFicha }, transaction: t }
                );
            }

            await t.commit();
        } catch (e) {
            if (t && !t.finished) await t.rollback().catch(() => {});
            console.error('fichaConfeccionController(actualizar) transacción:', e);
            return res.status(500).json({ success: false, mensaje: 'No se pudo guardar los cambios. Intenta de nuevo.' });
        }

        // El PDF va DESPUÉS del commit, en su propio try (CLAUDE.md §9).
        try {
            const { objectKey, referencia: referenciaPdf } = await generarYGuardarPdf(ficha.idFicha);
            const pdfUrl = await urlDocumento(objectKey, { nombre: `ficha-confeccion-${referenciaPdf}.pdf` });
            return res.json({ success: true, pdfUrl, cantidadTotal });
        } catch (e) {
            console.error('fichaConfeccionController(actualizar) pdf:', e);
            return res.json({ success: true, pdfUrl: null, cantidadTotal, avisoPdf: 'Se guardaron los cambios, pero el PDF no se pudo regenerar todavía.' });
        }
    } catch (e) {
        console.error('fichaConfeccionController(actualizar):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar los cambios.' });
    }
};

// POST /admin/procesos/fichas-confeccion/:idFicha/imagenes — pone (o cambia) la foto de
// referencia o la imagen de IA de una ficha ya creada. Una de cada (decidido con el dueño):
// la nueva reemplaza a la anterior. Las mismas reglas de pertenencia que finalizarFicha: la
// foto la subió este usuario y es JPG; el intento de IA está aprobado y salió del molde de
// ESTA ficha. Después del cambio se regenera el PDF.
const asignarImagenFicha = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findOne({ where: { idFicha: req.params.idFicha, estado: ['activa', 'pendiente'] }, attributes: ['idFicha', 'idMolde'] });
        if (!ficha) return res.status(404).json({ success: false, mensaje: 'Esa ficha no existe.' });

        const tipo = req.body?.tipo;
        let cambio = null;
        if (tipo === 'molde') {
            // El molde de una ficha que no lo tenía (la ficha base que se creó desde un
            // corte). JPG o PDF, subido por este usuario. Con molde y familia la ficha pasa a
            // activa (promoverFichaSiCompleta).
            const molde = await FichaConfeccionMolde.findOne({
                where: { idMolde: String(req.body?.idMolde ?? ''), idUsuarioCarga: req.usuario.idUsuario },
                attributes: ['idMolde']
            });
            if (!molde) return res.status(422).json({ success: false, mensaje: 'Ese molde no existe o no lo subiste tú.' });
            cambio = { idMolde: molde.idMolde };
        } else if (tipo === 'referencia') {
            const molde = await FichaConfeccionMolde.findOne({
                where: { idMolde: String(req.body?.idMolde ?? ''), idUsuarioCarga: req.usuario.idUsuario, tipoArchivo: 'jpg' },
                attributes: ['idMolde']
            });
            if (!molde) return res.status(422).json({ success: false, mensaje: 'Esa foto no existe o no la subiste tú.' });
            cambio = { idMoldeReferencia: molde.idMolde };
        } else if (tipo === 'ia') {
            if (!ficha.idMolde) return res.status(422).json({ success: false, mensaje: 'La ficha no tiene molde para generar con IA.' });
            const intento = await FichaConfeccionMoldeIaIntento.findOne({
                where: { idIntento: String(req.body?.idIntento ?? ''), idMolde: ficha.idMolde, aprobado: true },
                attributes: ['idIntento']
            });
            if (!intento) return res.status(422).json({ success: false, mensaje: 'Esa imagen de IA no está aprobada o no es de esta ficha.' });
            cambio = { idMoldeIaIntento: intento.idIntento };
        } else {
            return res.status(422).json({ success: false, mensaje: 'Tipo de imagen inválido.' });
        }

        await db.transaction(async (t) => {
            await FichaConfeccion.update(cambio, { where: { idFicha: ficha.idFicha }, transaction: t });
            await promoverFichaSiCompleta(ficha.idFicha, req.usuario.idUsuario, t);
        });

        try { await generarYGuardarPdf(ficha.idFicha); } catch (e) {
            console.error('fichaConfeccionController(asignarImagen) pdf:', e);
            return res.json({ success: true, avisoPdf: 'La imagen quedó guardada, pero el PDF no se pudo regenerar todavía.' });
        }
        return res.json({ success: true });
    } catch (e) {
        console.error('fichaConfeccionController(asignarImagen):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar la imagen.' });
    }
};

// POST /admin/procesos/fichas-confeccion/:idFicha/familia — { nombre }. La familia de una
// ficha que no la tenía (ficha base creada desde un corte): se elige o se crea por nombre,
// igual que en el asistente (resolverIdFamilia). La referencia de la ficha toma el nombre de
// la familia, como en una ficha hecha con el asistente. Una ficha que ya tiene familia no la
// cambia acá (la familia sale del DXF y no se re-edita, ver homeFichaConfeccionEditar).
const asignarFamiliaFicha = async (req, res) => {
    try {
        const nombre = String(req.body?.nombre ?? '').trim().slice(0, 150);
        if (!nombre) return res.status(422).json({ success: false, mensaje: 'Escribe el nombre de la familia.' });
        const ficha = await FichaConfeccion.findOne({
            where: { idFicha: req.params.idFicha, estado: ['activa', 'pendiente'] },
            attributes: ['idFicha', 'idDxf'],
            include: [{ model: FichaConfeccionDxf, as: 'dxf', attributes: ['idArchivoDxf', 'idFamiliaAsociada'] }]
        });
        if (!ficha) return res.status(404).json({ success: false, mensaje: 'Esa ficha no existe.' });
        if (ficha.dxf?.idFamiliaAsociada) return res.status(409).json({ success: false, mensaje: 'Esta ficha ya tiene familia.' });

        await db.transaction(async (t) => {
            const idFamilia = await resolverIdFamilia(nombre, t);
            const familia = await Familia.findByPk(idFamilia, { attributes: ['nombreFamilia'], transaction: t });
            await FichaConfeccionDxf.update({ idFamiliaAsociada: idFamilia }, { where: { idArchivoDxf: ficha.idDxf }, transaction: t });
            await FichaConfeccion.update({ referencia: familia.nombreFamilia.slice(0, 150) }, { where: { idFicha: ficha.idFicha }, transaction: t });
            await promoverFichaSiCompleta(ficha.idFicha, req.usuario.idUsuario, t);
        });
        try { await generarYGuardarPdf(ficha.idFicha); } catch (e) {
            console.error('fichaConfeccionController(familia) pdf:', e);
        }
        return res.json({ success: true });
    } catch (e) {
        console.error('fichaConfeccionController(familia):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar la familia.' });
    }
};

// ── Anular, reactivar y borrar ─────────────────────────────────────────────────────────
// Una ficha que ya se usó no se borra: se ANULA (sale de la biblioteca, no inicia procesos
// nuevos, se puede reactivar). Solo una ficha que nunca se usó se BORRA, y con ella sus videos
// (decidido con el dueño el 2026-11-20). Cada cambio deja constancia en
// FICHAS_CONFECCION_ESTADOS (append-only).

/**
 * ¿La ficha ya se usó? Uso = tener talleres asignados (de ellos cuelgan los procesos),
 * alguna orden de producción aunque esté cancelada (sigue apuntando a la ficha) o estar en
 * algún corte. Es el único lugar que decide si se puede borrar.
 */
async function fichaTieneUso(idFicha) {
    const [talleres, ordenes, cortes] = await Promise.all([
        FichaConfeccionTaller.count({ where: { idFicha } }),
        OrdenProduccion.count({ where: { idFicha }, paranoid: false }),
        OrdenCorteReferencia.count({ where: { idFicha } })
    ]);
    return talleres + ordenes + cortes > 0;
}

/**
 * Pasa la ficha de un estado a otro y deja la constancia, en una transacción. El update va
 * condicionado al estado de partida (CLAUDE.md §9): dos clics a la vez no dejan dos
 * constancias. Devuelve false si la ficha no estaba en `desde`.
 */
async function cambiarEstadoFicha({ idFicha, desde, hacia, accion, motivo = null, idUsuario }) {
    return db.transaction(async (t) => {
        const [filas] = await FichaConfeccion.update({ estado: hacia }, { where: { idFicha, estado: desde }, transaction: t });
        if (!filas) return false;
        await FichaConfeccionEstado.create({ idFicha, accion, motivo, idUsuario }, { transaction: t });
        return true;
    });
}

// POST /admin/procesos/fichas-confeccion/:idFicha/anular — { motivo }
const anularFicha = async (req, res) => {
    try {
        const motivo = String(req.body?.motivo ?? '').trim().slice(0, 500);
        if (motivo.length < 3) return res.status(422).json({ success: false, mensaje: 'Escribe el motivo de la anulación.' });
        const ok = await cambiarEstadoFicha({ idFicha: req.params.idFicha, desde: 'activa', hacia: 'anulada', accion: 'anulada', motivo, idUsuario: req.usuario.idUsuario });
        if (!ok) return res.status(409).json({ success: false, mensaje: 'La ficha no existe o ya estaba anulada.' });
        return res.json({ success: true });
    } catch (e) {
        console.error('fichaConfeccionController(anular):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo anular la ficha.' });
    }
};

// POST /admin/procesos/fichas-confeccion/:idFicha/reactivar
const reactivarFicha = async (req, res) => {
    try {
        const ok = await cambiarEstadoFicha({ idFicha: req.params.idFicha, desde: 'anulada', hacia: 'activa', accion: 'reactivada', idUsuario: req.usuario.idUsuario });
        if (!ok) return res.status(409).json({ success: false, mensaje: 'La ficha no existe o no estaba anulada.' });
        return res.json({ success: true });
    } catch (e) {
        console.error('fichaConfeccionController(reactivar):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo reactivar la ficha.' });
    }
};

// POST /admin/procesos/fichas-confeccion/:idFicha/borrar — solo si nunca se usó. Primero se
// borran los videos en el servicio de videos (si alguno falla, no se toca nada más: se puede
// reintentar); después, en una transacción, las filas de video, la constancia y la ficha
// (borrado lógico: `paranoid`). El PDF y las imágenes quedan guardados como respaldo.
const borrarFicha = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findByPk(req.params.idFicha, { attributes: ['idFicha'] });
        if (!ficha) return res.status(404).json({ success: false, mensaje: 'Esa ficha no existe.' });
        if (await fichaTieneUso(ficha.idFicha)) {
            return res.status(409).json({ success: false, mensaje: 'Esta ficha ya tiene uso: anúlala en vez de borrarla.' });
        }

        const videos = await FichaConfeccionVideo.findAll({ where: { idFicha: ficha.idFicha }, attributes: ['idVideo', 'cloudflareVideoUid'] });
        try {
            for (const v of videos) await eliminarVideoCloudflare(v.cloudflareVideoUid);
        } catch (e) {
            console.error('fichaConfeccionController(borrar) videos:', e);
            return res.status(502).json({ success: false, mensaje: 'No se pudieron borrar los videos. Intenta de nuevo en un momento.' });
        }

        await db.transaction(async (t) => {
            await FichaConfeccionVideo.destroy({ where: { idFicha: ficha.idFicha }, transaction: t });
            await FichaConfeccionEstado.create({ idFicha: ficha.idFicha, accion: 'borrada', idUsuario: req.usuario.idUsuario }, { transaction: t });
            await FichaConfeccion.destroy({ where: { idFicha: ficha.idFicha }, transaction: t });
        });
        return res.json({ success: true });
    } catch (e) {
        console.error('fichaConfeccionController(borrar):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo borrar la ficha.' });
    }
};

export { finalizarFicha, verFichaPdf, verFichaDxf, homeFichaConfeccionEditar, actualizarFichaConfeccion, asignarImagenFicha, asignarFamiliaFicha, generarYGuardarPdf, anularFicha, reactivarFicha, borrarFicha };
