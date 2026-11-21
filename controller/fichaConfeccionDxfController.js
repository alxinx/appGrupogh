import crypto from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';

import db from '../config/bd.js';
import { FichaConfeccionDxf, FichaConfeccionDxfMaterial, Material, Familia } from '../models/index.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { keyDocumento } from '../helpers/almacenamientoDocumentos.js';
import { esDxfValido, analizarDxf, asociarCamposDxf } from '../helpers/dxf.js';
import { urlImagenMaterial } from '../helpers/insumos.js';
import { resolverIdFamilia } from '../helpers/productos.js';

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

        // Los materiales van en su propia tabla (uno por código DISTINTO — helpers/dxf.js),
        // así que el update de la fila principal y el bulkCreate del detalle van juntos en
        // una transacción: si el detalle fallara, la fila no debe quedar en 'listo' sin sus
        // materiales.
        await db.transaction(async (t) => {
            await FichaConfeccionDxf.update({
                estado: 'listo',
                objectKey,
                shaHash: hash,
                estiloNombre: campos.estiloNombre,
                talla: campos.talla,
                idFamiliaAsociada: asociaciones.familiaAsociada?.idFamilia || null,
                analizadoEn: new Date()
            }, { where: { idArchivoDxf }, transaction: t });

            if (asociaciones.materialesAsociados.length) {
                await FichaConfeccionDxfMaterial.bulkCreate(
                    asociaciones.materialesAsociados.map((m, i) => ({
                        idArchivoDxf,
                        codigoMaterial: m.codigoMaterial,
                        idMaterial: m.idMaterial,
                        orden: i + 1
                    })),
                    { transaction: t }
                );
            }
        });
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
            attributes: ['idArchivoDxf', 'nombreOriginal', 'pesoBytes', 'estado', 'estiloNombre', 'talla', 'errorMensaje'],
            include: [
                {
                    model: FichaConfeccionDxfMaterial, as: 'materialesDetalle',
                    attributes: ['idDetalle', 'codigoMaterial', 'orden'],
                    separate: true, order: [['orden', 'ASC']],
                    include: [{ model: Material, as: 'material', attributes: ['idMaterial', 'nombre', 'codigoMaterial', 'imagen'] }]
                },
                { model: Familia, as: 'familiaAsociada', attributes: ['idFamilia', 'nombreFamilia'] }
            ]
        });
        if (!archivo) return res.status(404).json({ success: false, mensaje: 'Ese archivo no existe.' });

        // La foto de cada material (paso "Tela y colores" del asistente) sale del mismo
        // catálogo que ya la sirve en /admin/insumos — mismo helper, nunca una segunda forma
        // de armar la URL (CLAUDE.md DRY). Son pocos materiales por DXF (1 o 2, casi nunca
        // más), así que recorrerlos en memoria acá no es un N+1 — no hay ninguna consulta
        // dentro del loop.
        const respuesta = archivo.toJSON();

        // Para materiales con código compuesto (ej. "2.1"), buscar el nombre del padre ("2")
        // en una sola consulta y adjuntarlo como nombrePadre — sin N+1.
        const codigosPadre = [...new Set(
            (respuesta.materialesDetalle || [])
                .map(f => f.material?.codigoMaterial)
                .filter(c => c?.includes('.'))
                .map(c => c.split('.')[0])
        )];
        const padresPorCodigo = codigosPadre.length
            ? new Map((await Material.findAll({
                where: { codigoMaterial: codigosPadre },
                attributes: ['codigoMaterial', 'nombre']
              })).map(m => [m.codigoMaterial, m.nombre]))
            : new Map();

        respuesta.materialesDetalle = (respuesta.materialesDetalle || []).map((fila) => {
            if (fila.material) {
                fila.material.imagenUrl = urlImagenMaterial(fila.material.imagen);
                delete fila.material.imagen;
                if (fila.material.codigoMaterial?.includes('.')) {
                    const codigoPadre = fila.material.codigoMaterial.split('.')[0];
                    fila.material.nombrePadre = padresPorCodigo.get(codigoPadre) || null;
                }
            }
            return fila;
        });

        return res.json({ success: true, archivo: respuesta });
    } catch (e) {
        console.error('fichaConfeccionDxfController(estado):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo consultar el archivo.' });
    }
};

// POST /admin/procesos/fichas-confeccion/dxf/:idArchivoDxf/familia — cuando el Style Name
// del DXF no matcheó ninguna FAMILIA (asociarCamposDxf no encontró fila, o el heurístico no
// detectó ningún "Style Name" para buscar), el asistente ofrece asignar una ahí mismo en
// vez de bloquear el paso 1 hasta que alguien la cree desde Inventario. El operador puede
// escribir un nombre nuevo o elegir uno de los que ya existen (datalist en la vista,
// fichaConfeccionNueva.pug) — el endpoint resuelve los dos casos igual.
//
// Mismo helper que ya usa el alta de producto (helpers/productos.js resolverIdFamilia,
// findOrCreate por nombre normalizado): si el nombre YA existe (lo haya elegido del
// datalist o lo haya escrito con otra mayúscula/espacio), se asocia esa fila existente en
// vez de duplicarla (CLAUDE.md DRY).
const crearFamiliaDxf = async (req, res) => {
    try {
        const idUsuario = req.usuario.idUsuario;
        const nombre = String(req.body?.nombre ?? '').trim();
        if (!nombre) return res.status(422).json({ success: false, mensaje: 'Escribe el nombre de la familia.' });

        const archivo = await FichaConfeccionDxf.findOne({
            where: { idArchivoDxf: req.params.idArchivoDxf, idUsuarioCarga: idUsuario }
        });
        if (!archivo || archivo.estado !== 'listo') {
            return res.status(422).json({ success: false, mensaje: 'El DXF no está listo todavía.' });
        }

        let idFamilia = null;
        await db.transaction(async (t) => {
            idFamilia = await resolverIdFamilia(nombre, t);
            await FichaConfeccionDxf.update(
                { idFamiliaAsociada: idFamilia },
                { where: { idArchivoDxf: archivo.idArchivoDxf }, transaction: t }
            );
        });

        const familia = await Familia.findByPk(idFamilia, { attributes: ['idFamilia', 'nombreFamilia'] });
        return res.status(201).json({ success: true, familia });
    } catch (e) {
        console.error('fichaConfeccionDxfController(crearFamilia):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo asignar la familia.' });
    }
};

export { subirDxfFicha, estadoDxfFicha, crearFamiliaDxf };
