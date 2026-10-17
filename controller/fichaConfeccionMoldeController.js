import crypto from 'crypto';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

import { FichaConfeccionMolde, FichaConfeccionMoldeIaIntento, FichaConfeccionDxf, Material } from '../models/index.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { keyDocumento, urlDocumento } from '../helpers/almacenamientoDocumentos.js';
import { validarImagen, detectarTipoReal, aWebp } from '../helpers/imagenSegura.js';
import { esPdfSeguro } from '../helpers/comprobantesMovimiento.js';
import { construirPromptMolde } from '../helpers/moldeIa.js';
import { encolarGeneracionMoldeIa } from '../helpers/colaMoldeIa.js';

// Molde (JPG/PDF) de una ficha de confección y sus intentos de generación de imagen con IA
// (admin/procesos/fichas-confeccion/nueva, paso "Carga el molde"). El trabajo pesado
// (bajar el molde, llamar a OpenAI, subir el resultado) vive en helpers/moldeIa.js
// procesarIntentoMoldeIa — este archivo solo valida, arma la fila y avisa a la cola
// (helpers/colaMoldeIa.js). Nunca manda el prompt al navegador, solo el resultado.

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// POST /admin/procesos/fichas-confeccion/molde — sube el molde original. Mismo criterio de
// "nunca confiar en la extensión ni el Content-Type" que el resto del proyecto (CLAUDE.md
// §5.9): se decide JPG o PDF por el contenido real.
const subirMolde = async (req, res) => {
    try {
        if (!req.file?.buffer?.length) {
            return res.status(422).json({ success: false, mensaje: 'No se recibió ningún archivo.' });
        }

        const buffer = req.file.buffer;
        const esImagen = detectarTipoReal(buffer) === 'image/jpeg';
        const esPdf = !esImagen && esPdfSeguro(buffer);

        if (!esImagen && !esPdf) {
            return res.status(422).json({ success: false, mensaje: 'Sube un JPG o un PDF del molde.' });
        }
        if (esImagen) {
            const validacion = await validarImagen(buffer, { maxBytes: 10 * 1024 * 1024 });
            if (!validacion.ok) return res.status(422).json({ success: false, mensaje: validacion.mensaje });
        }

        const tipoArchivo = esImagen ? 'jpg' : 'pdf';
        const idMolde = crypto.randomUUID();
        const objectKey = keyDocumento({
            carpeta: 'moldes',
            prefijo: 'molde',
            idPropietario: idMolde,
            idx: 0,
            extension: tipoArchivo
        });

        await r2PrivateClient.send(new PutObjectCommand({
            Bucket: R2_PRIVATE_BUCKET,
            Key: objectKey,
            Body: buffer,
            ContentType: esImagen ? 'image/jpeg' : 'application/pdf',
            CacheControl: 'no-store'
        }));

        const molde = await FichaConfeccionMolde.create({
            idMolde,
            idUsuarioCarga: req.usuario.idUsuario,
            nombreOriginal: req.file.originalname.slice(0, 255),
            pesoBytes: buffer.length,
            tipoArchivo,
            objectKey,
            shaHash: sha256(buffer)
        });

        return res.status(201).json({ success: true, idMolde: molde.idMolde, tipoArchivo });
    } catch (e) {
        console.error('fichaConfeccionMoldeController(subirMolde):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo recibir el molde. Intenta de nuevo.' });
    }
};

// POST /admin/procesos/fichas-confeccion/molde/:idMolde/generar — abre un intento nuevo
// (la primera vez, o un "Repetir" con los mismos valores u otros) y lo encola. Responde
// de inmediato: la generación real corre después (helpers/colaMoldeIa.js).
const iniciarGeneracionMolde = async (req, res) => {
    try {
        const molde = await FichaConfeccionMolde.findByPk(req.params.idMolde);
        if (!molde) return res.status(404).json({ success: false, mensaje: 'Ese molde no existe.' });
        if (molde.tipoArchivo !== 'jpg') {
            return res.status(422).json({ success: false, mensaje: 'La generación con IA solo está disponible hoy para moldes en JPG — sube un JPG del molde.' });
        }

        const pattern = String(req.body?.pattern ?? '').trim().slice(0, 255) || null;
        const colors = String(req.body?.colors ?? '').trim().slice(0, 255) || null;
        const idDxf = req.body?.idDxf || null;

        // El Fabric sale del material ya resuelto en el análisis del DXF (helpers/dxf.js
        // asociarCamposDxf, paso anterior del asistente) — nunca se vuelve a preguntar.
        let fabric = null;
        if (idDxf) {
            const dxf = await FichaConfeccionDxf.findByPk(idDxf, {
                include: [{ model: Material, as: 'materialAsociado', attributes: ['nombre'] }]
            });
            fabric = dxf?.materialAsociado?.nombre || null;
        }

        const promptFinal = construirPromptMolde({ fabric, pattern, colors });

        const numeroIntento = 1 + await FichaConfeccionMoldeIaIntento.count({ where: { idMolde: molde.idMolde } });

        const intento = await FichaConfeccionMoldeIaIntento.create({
            idMolde: molde.idMolde,
            idDxf,
            idUsuarioSolicita: req.usuario.idUsuario,
            numeroIntento,
            pattern,
            colors,
            fabricUsado: fabric,
            promptFinal,
            estado: 'procesando'
        });

        await encolarGeneracionMoldeIa(intento.idIntento);

        return res.status(202).json({ success: true, idIntento: intento.idIntento, estado: 'procesando', numeroIntento });
    } catch (e) {
        console.error('fichaConfeccionMoldeController(iniciarGeneracion):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo iniciar la generación. Intenta de nuevo.' });
    }
};

// GET /admin/procesos/fichas-confeccion/molde/intento/:idIntento — estado del intento +
// una URL firmada de corta vida para ver el resultado, si ya está listo. El front llega
// acá tanto por polling de respaldo como apenas recibe el push de SSE (molde_ia_listo) —
// el push solo avisa que cambió algo, esto trae el dato real.
const estadoIntentoMolde = async (req, res) => {
    try {
        const intento = await FichaConfeccionMoldeIaIntento.findByPk(req.params.idIntento, {
            attributes: ['idIntento', 'idMolde', 'numeroIntento', 'pattern', 'colors', 'fabricUsado', 'estado', 'errorMensaje', 'objectKeyBorrador', 'aprobado', 'objectKeyFinal']
        });
        if (!intento) return res.status(404).json({ success: false, mensaje: 'Ese intento no existe.' });

        let previewUrl = null;
        const key = intento.objectKeyFinal || intento.objectKeyBorrador;
        // El borrador es PNG (lo que devuelve la IA) y el final es WebP (recién convertido
        // al aprobar, aprobarMoldeIa más abajo) — el nombre de descarga sigue la extensión
        // real del objeto en vez de asumir una.
        if (key) previewUrl = await urlDocumento(key, { nombre: `molde-ia-${intento.idIntento}.${key.split('.').pop()}` });

        return res.json({
            success: true,
            intento: {
                idIntento: intento.idIntento,
                idMolde: intento.idMolde,
                numeroIntento: intento.numeroIntento,
                pattern: intento.pattern,
                colors: intento.colors,
                fabricUsado: intento.fabricUsado,
                estado: intento.estado,
                errorMensaje: intento.errorMensaje,
                aprobado: intento.aprobado,
                previewUrl
            }
        });
    } catch (e) {
        console.error('fichaConfeccionMoldeController(estadoIntento):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo consultar el intento.' });
    }
};

// POST /admin/procesos/fichas-confeccion/molde/intento/:idIntento/aprobar — recién acá el
// resultado pasa a moldesIa/{timestamp}.webp. Antes de esto no existe ningún archivo en esa
// carpeta (el requerimiento lo pide así, tal cual). Condicional a estado='listo' y
// aprobado=false en el WHERE (CLAUDE.md §9): dos aprobaciones a la vez no duplican el
// archivo final.
const aprobarMoldeIa = async (req, res) => {
    try {
        const intento = await FichaConfeccionMoldeIaIntento.findByPk(req.params.idIntento);
        if (!intento) return res.status(404).json({ success: false, mensaje: 'Ese intento no existe.' });
        if (intento.aprobado) {
            return res.json({ success: true, mensaje: 'Ya estaba aprobado.', objectKeyFinal: intento.objectKeyFinal });
        }
        if (intento.estado !== 'listo' || !intento.objectKeyBorrador) {
            return res.status(400).json({ success: false, mensaje: 'Todavía no hay una imagen generada para aprobar.' });
        }

        const nombreFinal = `moldesIa/${Date.now()}.webp`;
        // Descarga + sube de nuevo, no CopyObjectCommand: este bucket de R2 lo rechaza con
        // "NoSuchKey" aunque el objeto exista (probado en sesión — mismo resultado con
        // ListObjectsV2, así que es una limitación del token/la cuenta, no de la ruta).
        // Get/Put/Delete sobre un objeto puntual sí funcionan siempre, así que el "copy" se
        // arma con esos tres en vez de depender de la operación de copia del lado del
        // servidor.
        const original = await r2PrivateClient.send(new GetObjectCommand({ Bucket: R2_PRIVATE_BUCKET, Key: intento.objectKeyBorrador }));
        const partes = [];
        for await (const parte of original.Body) partes.push(parte);

        // La IA siempre devuelve PNG (helpers/moldeIa.js) — se convierte a WebP recién al
        // aprobar, que es cuando la imagen deja de ser un borrador descartable y pasa a ser
        // la que de verdad se guarda. Mismo criterio que el resto del proyecto (CLAUDE.md
        // §5.9: "toda imagen se persiste convertida a WebP, nunca el archivo original tal
        // como llegó") — acá "el original" es el PNG que mandó OpenAI, no un archivo que
        // subió un usuario, pero la regla es la misma.
        const webp = await aWebp(Buffer.concat(partes));

        await r2PrivateClient.send(new PutObjectCommand({
            Bucket: R2_PRIVATE_BUCKET,
            Key: nombreFinal,
            Body: webp,
            ContentType: 'image/webp',
            CacheControl: 'no-store'
        }));

        const [filas] = await FichaConfeccionMoldeIaIntento.update(
            { aprobado: true, objectKeyFinal: nombreFinal, aprobadoEn: new Date() },
            { where: { idIntento: intento.idIntento, aprobado: false } }
        );
        if (!filas) {
            // Otra pestaña lo aprobó en el medio — no se duplica el archivo final, se borra
            // la copia que se acaba de hacer.
            await r2PrivateClient.send(new DeleteObjectCommand({ Bucket: R2_PRIVATE_BUCKET, Key: nombreFinal })).catch(() => {});
            const actual = await FichaConfeccionMoldeIaIntento.findByPk(intento.idIntento, { attributes: ['objectKeyFinal'] });
            return res.json({ success: true, mensaje: 'Ya estaba aprobado.', objectKeyFinal: actual.objectKeyFinal });
        }

        await r2PrivateClient.send(new DeleteObjectCommand({ Bucket: R2_PRIVATE_BUCKET, Key: intento.objectKeyBorrador })).catch(() => {});

        return res.json({ success: true, objectKeyFinal: nombreFinal });
    } catch (e) {
        console.error('fichaConfeccionMoldeController(aprobar):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo aprobar la imagen. Intenta de nuevo.' });
    }
};

export { subirMolde, iniciarGeneracionMolde, estadoIntentoMolde, aprobarMoldeIa };
