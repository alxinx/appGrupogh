import sharp from 'sharp';

// ─────────────────────────────────────────────────────────────────────────────
// Validación de imágenes subidas por usuarios, del lado del servidor.
//
// Nunca se confía en el `Content-Type` que manda el navegador ni en la extensión
// del archivo: ambos los controla quien sube. Lo único que cuenta es el contenido
// real del buffer (magic bytes) y que sharp pueda decodificarlo.
//
// Lo usan tanto el QR de pago (helpers/qrPago.js) como el comprobante de
// transferencia del checkout web.
// ─────────────────────────────────────────────────────────────────────────────

export const LADO_MAXIMO_PX = 6000; // corta imágenes desproporcionadas (bombas de descompresión)

// Firmas de los únicos formatos que se aceptan. No hay PDF, SVG ni nada ejecutable.
const FIRMAS = [
    { mime: 'image/jpeg', test: (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
    { mime: 'image/png',  test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) },
    { mime: 'image/webp', test: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
];

/** Mime detectado por magic bytes, o null si no es una imagen soportada. */
export function detectarTipoReal(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    return FIRMAS.find(f => f.test(buffer))?.mime || null;
}

/**
 * Verifica que el buffer sea de verdad una imagen aceptable.
 * @param {Buffer} buffer
 * @param {{ minLado?: number, maxBytes?: number, minBytes?: number }} opciones
 * @returns {Promise<{ ok: boolean, mensaje?: string, mime?: string, width?: number, height?: number }>}
 */
export async function validarImagen(buffer, { minLado = 200, maxBytes = 2 * 1024 * 1024, minBytes = 100 } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length < minBytes)
        return { ok: false, mensaje: 'El archivo está vacío o es demasiado pequeño.' };

    if (buffer.length > maxBytes)
        return { ok: false, mensaje: `La imagen supera el tamaño máximo permitido (${Math.round(maxBytes / 1024 / 1024)} MB).` };

    const mime = detectarTipoReal(buffer);
    if (!mime)
        return { ok: false, mensaje: 'Formato no permitido. Solo se aceptan imágenes JPG, PNG o WebP.' };

    let meta;
    try {
        meta = await sharp(buffer, { limitInputPixels: LADO_MAXIMO_PX * LADO_MAXIMO_PX }).metadata();
    } catch (_) {
        return { ok: false, mensaje: 'No se pudo leer la imagen. Puede estar corrupta.' };
    }

    const { width, height } = meta;
    if (!width || !height)
        return { ok: false, mensaje: 'No se pudieron determinar las dimensiones de la imagen.' };

    if (width < minLado || height < minLado)
        return { ok: false, mensaje: `La imagen es muy pequeña (${width}×${height}). Mínimo ${minLado}×${minLado} px.` };

    if (width > LADO_MAXIMO_PX || height > LADO_MAXIMO_PX)
        return { ok: false, mensaje: `La imagen es demasiado grande (${width}×${height}).` };

    return { ok: true, mime, width, height };
}

/**
 * Convierte a WebP. `anchoMaximo` reduce la imagen sin ampliarla nunca
 * (omitirlo conserva la resolución original, como necesita un QR escaneable).
 */
export async function aWebp(buffer, { calidad = 82, anchoMaximo = null, caja = null } = {}) {
    let img = sharp(buffer, { limitInputPixels: LADO_MAXIMO_PX * LADO_MAXIMO_PX }).rotate();
    if (anchoMaximo) img = img.resize({ width: anchoMaximo, withoutEnlargement: true });
    // Caja fija: `{ ancho, alto, ajuste }` con el `fit` de sharp ('inside' reduce sin
    // recortar, 'cover' llena la caja recortando — la foto de perfil).
    if (caja) img = img.resize(caja.ancho, caja.alto, {
        fit: caja.ajuste ?? 'inside', withoutEnlargement: caja.ajuste !== 'cover',
        ...(caja.posicion && { position: caja.posicion })   // 'attention': recorta hacia lo que más llama la atención
    });
    return img.webp({ quality: calidad, effort: 4 }).toBuffer();
}

/**
 * Valida una imagen subida y la devuelve convertida a WebP, en un paso. Para las que no son
 * documentos (fotos de producto, foto de perfil): esas no pasan por `subirComprobantes`
 * porque se guardan en otras tablas, pero cumplen la misma regla (CLAUDE.md §5.9).
 * @returns `{ ok: true, buffer }` o `{ ok: false, mensaje }`
 */
export async function imagenAWebpSegura(buffer, { maxBytes = 5 * 1024 * 1024, minLado = 200, calidad = 80, caja = null, anchoMaximo = null } = {}) {
    const revision = await validarImagen(buffer, { maxBytes, minLado });
    if (!revision.ok) return revision;
    return { ok: true, buffer: await aWebp(buffer, { calidad, caja, anchoMaximo }) };
}
