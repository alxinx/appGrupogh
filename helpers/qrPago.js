import crypto from 'crypto';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { validarImagen, aWebp, detectarTipoReal, LADO_MAXIMO_PX } from './imagenSegura.js';

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades para el QR de pago de las entidades bancarias / billeteras.
//
// El orden importa y es deliberado: primero se descarta lo barato (magic bytes,
// tamaño, resolución), después se confirma que la imagen contiene un QR realmente
// legible, y SOLO entonces se paga el costo de convertir a WebP y subir a R2.
// Así una imagen que no es un QR nunca llega a tocar el bucket.
// ─────────────────────────────────────────────────────────────────────────────

export const TAM_MAXIMO_BYTES = 2 * 1024 * 1024; // 2 MB
const LADO_MINIMO_PX          = 200;
const LADO_DETECCION_PX       = 1400;            // techo al que se reduce solo para leer el QR

export { detectarTipoReal };

/**
 * Paso 1 — Pre-filtro de calidad (magic bytes, peso, resolución). No decodifica el QR todavía.
 * @returns {{ ok: boolean, mensaje?: string, mime?: string, width?: number, height?: number }}
 */
export async function prefiltrarImagenQr(buffer) {
    return validarImagen(buffer, { minLado: LADO_MINIMO_PX, maxBytes: TAM_MAXIMO_BYTES });
}

/**
 * Paso 2 — Confirma que la imagen contiene un QR legible.
 * Decodifica a píxeles RGBA en memoria y se los pasa a jsQR. No escribe ningún
 * archivo ni sube nada: si esto falla, el flujo se corta aquí.
 * @returns {{ ok: boolean, mensaje?: string, contenido?: string }}
 */
export async function verificarQrLegible(buffer) {
    // Varias pasadas: la primera con la imagen tal cual (reducida si es enorme),
    // la segunda normalizando contraste, que rescata fotos de pantalla mal iluminadas.
    const pasadas = [
        (img) => img,
        (img) => img.greyscale().normalise(),
    ];

    for (const preparar of pasadas) {
        try {
            const base = sharp(buffer, { limitInputPixels: LADO_MAXIMO_PX * LADO_MAXIMO_PX })
                .rotate() // respeta la orientación EXIF antes de leer
                .resize({
                    width: LADO_DETECCION_PX,
                    height: LADO_DETECCION_PX,
                    fit: 'inside',
                    withoutEnlargement: true
                });

            const { data, info } = await preparar(base)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });

            const codigo = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
                inversionAttempts: 'attemptBoth'
            });

            if (codigo?.data) return { ok: true, contenido: codigo.data };
        } catch (_) {
            // Una pasada fallida no descarta la imagen; se intenta la siguiente.
        }
    }

    return { ok: false, mensaje: 'No se detectó ningún código QR legible en la imagen. Sube una captura más nítida y sin recortes.' };
}

/**
 * Paso 3 — Convierte a WebP el archivo real (no el raw usado para la lectura).
 * Se conserva la resolución original: el QR debe seguir siendo escaneable.
 */
export async function convertirAWebp(buffer) {
    // Sin `anchoMaximo`: reducir un QR puede volverlo ilegible.
    return aWebp(buffer, { calidad: 92 });
}

/** Paso 4 — SHA-256 en hexadecimal del buffer final. */
export function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Ruta del objeto en R2. El timestamp evita pisar la versión anterior de inmediato. */
export function construirObjectKey(idEntidad, ahora = Date.now()) {
    return `entidades/${idEntidad}/qr-${ahora}.webp`;
}
