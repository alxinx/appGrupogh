import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import OpenAI, { toFile } from 'openai';
import openaiClient, { OPENAI_CONFIGURADO } from '../config/openai.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { FichaConfeccionMoldeIaIntento, FichaConfeccionMolde } from '../models/index.js';
import { broadcast } from './sseManager.js';

// Generación de la vista previa fotorealista del molde con IA (admin/procesos/
// fichas-confeccion/nueva, paso "Carga el molde"). Este archivo es el ÚNICO punto que lee
// promptsIA.json y el ÚNICO que llama a la API de imágenes de OpenAI — ni el prompt crudo
// ni la clave salen de acá. controller/fichaConfeccionMoldeController.js nunca manda el
// texto del prompt al navegador, solo el resultado (la imagen) o un mensaje de error.
//
// promptsIA.json es JSON plano leído con fs, no un `import` — un import de un .json queda
// en el grafo de módulos de Node igual, pero así es explícito que nadie de src/js/ (el
// código que webpack empaqueta para el navegador) puede traerlo por accidente: ese árbol
// de imports nunca toca `helpers/`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'promptsIA.json'), 'utf8'));

const MODEL = process.env.MODEL_IA_IMAGE_OPENAI || 'gpt-image-1';
const SIZE = process.env.SIZE_IA_IMAGE_OPENAI || '1024x1024';
const QUALITY = process.env.QUALITY_IA_IMAGE_OPENAI || 'medium';
const N = parseInt(process.env.NUMBER_IA_IMAGE_OPENAI) || 1;

/**
 * Arma el prompt final sustituyendo {fabric}/{pattern}/{colors} en la plantilla
 * `garment_render` de promptsIA.json. Un campo sin valor se avisa como tal en el propio
 * prompt — mejor que mandarle a la IA un hueco en blanco sin que se note.
 */
export function construirPromptMolde({ fabric, pattern, colors }) {
    return PROMPTS.garment_render
        .replaceAll('{fabric}', fabric || 'not specified')
        .replaceAll('{pattern}', pattern || 'not specified')
        .replaceAll('{colors}', colors || 'not specified');
}

/**
 * Llama a la API de edición de imágenes de OpenAI con el molde como referencia. Devuelve
 * el buffer PNG resultante (la API de los modelos GPT Image siempre contesta en base64,
 * nunca con una URL — helpers/moldeIa.js no guarda nada: eso lo hace el controlador).
 *
 * MODO SIMULADO — sin OPENAI_API_KEY (OPENAI_CONFIGURADO=false) no se llama a la API real:
 * se espera un momento y se devuelve el propio molde como si fuera el resultado. Así todo
 * el resto del flujo (modal, cola, SSE, Repetir/Aprobar) se puede probar de punta a punta
 * sin la clave y sin gastar nada — mismo criterio que REDIS_CONFIGURADO en helpers/
 * colaEmailProducto.js. En cuanto haya OPENAI_API_KEY en .env, esta misma función empieza a
 * llamar a la API real sin tocar nada más.
 */
export async function generarImagenMoldeIA({ buffer, nombreArchivo, prompt }) {
    if (!OPENAI_CONFIGURADO) {
        await new Promise((r) => setTimeout(r, 1500));
        return buffer;
    }

    // `toFile` sin `type` manda 'application/octet-stream' — la API lo rechaza con 400
    // (probado contra la API real): el molde siempre es un JPG en este punto (subirMolde ya
    // lo validó), así que el mimetype es fijo.
    const archivo = await toFile(buffer, nombreArchivo, { type: 'image/jpeg' });
    const resultado = await openaiClient.images.edit({
        model: MODEL,
        image: archivo,
        prompt,
        size: SIZE,
        quality: QUALITY,
        n: N
    });

    const b64 = resultado.data?.[0]?.b64_json;
    if (!b64) throw new Error('La API de OpenAI no devolvió ninguna imagen.');
    return Buffer.from(b64, 'base64');
}

/**
 * El trabajo de fondo completo de un intento: baja el molde de R2, genera la imagen,
 * sube el resultado a la carpeta de BORRADORES (nunca a moldesIa/ — eso es solo al
 * aprobar, controller/fichaConfeccionMoldeController.js aprobarMoldeIa) y avisa por SSE
 * al canal del usuario que lo pidió (helpers/sseManager.js, mismo canal que permisos en
 * vivo — CLAUDE.md §13). Firma estable a propósito: es lo mismo que llama tanto
 * helpers/colaMoldeIa.js (con o sin Redis) como un reintento manual futuro.
 */
export async function procesarIntentoMoldeIa(idIntento) {
    const intento = await FichaConfeccionMoldeIaIntento.findByPk(idIntento, {
        include: [{ model: FichaConfeccionMolde, as: 'molde' }]
    });
    if (!intento) return;

    try {
        if (intento.molde.tipoArchivo !== 'jpg') {
            throw new Error('La generación con IA solo está disponible hoy para moldes en JPG.');
        }

        const original = await r2PrivateClient.send(new GetObjectCommand({
            Bucket: R2_PRIVATE_BUCKET,
            Key: intento.molde.objectKey
        }));
        const partes = [];
        for await (const parte of original.Body) partes.push(parte);
        const bufferMolde = Buffer.concat(partes);

        const resultado = await generarImagenMoldeIA({
            buffer: bufferMolde,
            nombreArchivo: intento.molde.nombreOriginal,
            prompt: intento.promptFinal
        });

        // Carpeta aparte de moldesIa/ a propósito — el resultado es un borrador hasta que
        // se aprueba explícitamente.
        const objectKeyBorrador = `moldes-ia-borradores/${idIntento}.png`;
        await r2PrivateClient.send(new PutObjectCommand({
            Bucket: R2_PRIVATE_BUCKET,
            Key: objectKeyBorrador,
            Body: resultado,
            ContentType: 'image/png',
            CacheControl: 'no-store'
        }));

        await intento.update({ estado: 'listo', objectKeyBorrador, generadoEn: new Date() });
        broadcast(intento.idUsuarioSolicita, 'molde_ia_listo', { idIntento, estado: 'listo' });
    } catch (e) {
        console.error('moldeIa(procesarIntentoMoldeIa):', e);
        await intento.update({ estado: 'error', errorMensaje: e.message || 'No se pudo generar la imagen.' }).catch(() => {});
        broadcast(intento.idUsuarioSolicita, 'molde_ia_listo', { idIntento, estado: 'error', errorMensaje: e.message });
    }
}
