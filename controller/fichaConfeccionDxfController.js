import crypto from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';

import { FichaConfeccionDxf, Material, Familia } from '../models/index.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { keyDocumento } from '../helpers/almacenamientoDocumentos.js';
import { esDxfValido, analizarDxf, asociarCamposDxf } from '../helpers/dxf.js';
import { urlImagenMaterial } from '../helpers/insumos.js';

// Subida + análisis del DXF de una ficha de confección (admin/procesos/fichas-confeccion/
// nueva, paso 1). Asíncrono a propósito: el navegador no espera a que termine el parseo ni
// la subida a R2 — recibe un 202 con la fila en 'procesando' apenas se valida el archivo, y
// el trabajo real corre después, sin bloquear la respuesta (procesarDxfEnSegundoPlano,
// abajo). El front hace polling a GET .../dxf/:idArchivoDxf hasta ver 'listo' o 'error'
// (src/js/fichaConfeccionNueva.js).
//
// Hoy esto corre en el mismo proceso de Express (un `await` suelto, sin cola) — un DXF de
// patronaje es liviano (unos cientos de KB a pocos MB) y parsearlo es rápido, así que no
// hace falta BullMQ todavía (CLAUDE.md: es la única cola del proyecto, para el reintento de
// notificaciones de producto — no se reutiliza para otra cosa sin discutirlo antes). El
// terreno SÍ queda preparado para cuando haga falta: `procesarDxfEnSegundoPlano` es la única
// función que tendría que pasar a ser un job de BullMQ, nada del endpoint ni del polling del
// front cambiaría. El video del proceso (siguiente paso del asistente) va a necesitar ese
// cambio — es mucho más pesado que un DXF.

/** SHA-256 en hexadecimal — mismo criterio que helpers/qrPago.js para el QR de pago. */
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// POST /admin/procesos/fichas-confeccion/dxf
const subirDxfFicha = async (req, res) => {
    try {
        if (!req.file?.buffer?.length) {
            return res.status(422).json({ success: false, mensaje: 'No se recibió ningún archivo.' });
        }

        // Validación real de contenido — nunca la extensión ni el Content-Type del navegador.
        if (!esDxfValido(req.file.buffer)) {
            return res.status(422).json({ success: false, mensaje: 'El archivo no parece ser un DXF válido.' });
        }

        const archivo = await FichaConfeccionDxf.create({
            idUsuarioCarga: req.usuario.idUsuario,
            nombreOriginal: req.file.originalname.slice(0, 255),
            pesoBytes: req.file.buffer.length,
            estado: 'procesando'
        });

        // No se espera — el navegador ya tiene con qué hacer polling. Un error acá lo deja
        // la propia función en la fila ('error' + errorMensaje), nunca tumba el proceso.
        procesarDxfEnSegundoPlano(archivo.idArchivoDxf, req.file.buffer, req.file.originalname);

        return res.status(202).json({
            success: true,
            idArchivoDxf: archivo.idArchivoDxf,
            estado: 'procesando'
        });
    } catch (e) {
        console.error('fichaConfeccionDxfController(subir):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo recibir el archivo. Intenta de nuevo.' });
    }
};

// El trabajo de fondo: analiza el DXF, lo sube a R2 y deja la fila en 'listo' o 'error'.
// Firma estable a propósito (idArchivoDxf, buffer, nombreOriginal) — es el punto donde esto
// se convertiría en un job de BullMQ más adelante.
async function procesarDxfEnSegundoPlano(idArchivoDxf, buffer, nombreOriginal) {
    try {
        // 1 — Heurístico de Style Name / Size / Material (ver el aviso en helpers/dxf.js:
        //     puede no encontrar nada si el patronaje no exporta esas etiquetas como texto).
        const campos = analizarDxf(buffer);

        // 1.5 — Cruce contra el catálogo real: Material por código DXF, Style Name por
        //       nombre de familia (helpers/dxf.js asociarCamposDxf). Sin coincidencia queda
        //       en null — no es un error del archivo, es "no se encontró".
        const asociaciones = await asociarCamposDxf(campos);

        // 2 — Hash del archivo final (el mismo que se sube).
        const hash = sha256(buffer);

        // 3 — Subida al bucket PRIVADO, carpeta dxf/ (helpers/almacenamientoDocumentos.js
        //     CARPETAS_PRIVADAS ya incluye 'dxf' — la ruta nunca llega a tener URL pública).
        const objectKey = keyDocumento({
            carpeta: 'dxf',
            prefijo: 'dxf',
            idPropietario: idArchivoDxf,
            idx: 0,
            extension: 'dxf'
        });
        await r2PrivateClient.send(new PutObjectCommand({
            Bucket: R2_PRIVATE_BUCKET,
            Key: objectKey,
            Body: buffer,
            ContentType: 'application/dxf',
            CacheControl: 'no-store',
            Metadata: { sha256: hash, nombreOriginal: encodeURIComponent(nombreOriginal) }
        }));

        await FichaConfeccionDxf.update({
            estado: 'listo',
            objectKey,
            shaHash: hash,
            estiloNombre: campos.estiloNombre,
            talla: campos.talla,
            material: campos.material,
            idMaterialAsociado: asociaciones.materialAsociado?.idMaterial || null,
            idFamiliaAsociada: asociaciones.familiaAsociada?.idFamilia || null,
            analizadoEn: new Date()
        }, { where: { idArchivoDxf } });
    } catch (e) {
        console.error('fichaConfeccionDxfController(procesar):', e);
        await FichaConfeccionDxf.update({
            estado: 'error',
            errorMensaje: 'No se pudo leer el archivo DXF. Verifica que no esté dañado.'
        }, { where: { idArchivoDxf } }).catch(() => {});
    }
}

// GET /admin/procesos/fichas-confeccion/dxf/:idArchivoDxf — el front hace polling acá
// mientras estado === 'procesando'. Nunca devuelve objectKey: es la ruta privada en R2, no
// hay por qué mandarla al navegador (si algún día hace falta volver a ver el archivo, se
// abre con una URL firmada de corta vida, como el resto de los documentos privados —
// helpers/almacenamientoDocumentos.js urlDocumento).
const estadoDxfFicha = async (req, res) => {
    try {
        const archivo = await FichaConfeccionDxf.findByPk(req.params.idArchivoDxf, {
            attributes: ['idArchivoDxf', 'nombreOriginal', 'pesoBytes', 'estado', 'estiloNombre', 'talla', 'material', 'errorMensaje'],
            include: [
                { model: Material, as: 'materialAsociado', attributes: ['idMaterial', 'nombre', 'codigoMaterial', 'imagen'] },
                { model: Familia, as: 'familiaAsociada', attributes: ['idFamilia', 'nombreFamilia'] }
            ]
        });
        if (!archivo) return res.status(404).json({ success: false, mensaje: 'Ese archivo no existe.' });

        // La foto del material (paso "Tela y colores" del asistente) sale del mismo catálogo
        // que ya la sirve en /admin/insumos — mismo helper, nunca una segunda forma de armar
        // la URL (CLAUDE.md DRY).
        const respuesta = archivo.toJSON();
        if (respuesta.materialAsociado) {
            respuesta.materialAsociado.imagenUrl = urlImagenMaterial(respuesta.materialAsociado.imagen);
            delete respuesta.materialAsociado.imagen;
        }

        return res.json({ success: true, archivo: respuesta });
    } catch (e) {
        console.error('fichaConfeccionDxfController(estado):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo consultar el archivo.' });
    }
};

export { subirDxfFicha, estadoDxfFicha };
