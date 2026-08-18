import { validarImagen, aWebp, detectarTipoReal } from './imagenSegura.js';

// ─────────────────────────────────────────────────────────────────────────────
// Voucher de un traslado de efectivo hacia un banco o una billetera.
//
// Vive aparte de `helpers/imagenSegura.js` a propósito. Ese helper declara que solo
// acepta JPG, PNG y WebP —nada de PDF ni SVG— y de él dependen el QR de pago y el
// comprobante del checkout web, donde un PDF no tiene sentido y sería superficie de
// ataque gratis. Acá el PDF sí hace falta: el comprobante que entrega un banco suele
// venir en PDF, y obligar al operador a fotografiarlo lo empuja a adjuntar cualquier
// cosa. Extenderlo en su propio archivo deja aquella garantía intacta.
//
// Qué se hace con cada tipo:
//   · Imagen → se valida con `validarImagen` (magic bytes + decodificación real con
//     sharp) y se guarda convertida a WebP. Nunca se guarda el archivo original.
//   · PDF    → se verifica la firma `%PDF-` al inicio del buffer y se guarda tal cual.
//     No se renderiza, no se parsea y no se abre nunca en el navegador desde nuestro
//     dominio: se sirve como descarga.
//
// El `Content-Type` que manda el navegador y la extensión del archivo no son evidencia
// de nada: los dos los controla quien sube. Lo único que cuenta es el contenido.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_VOUCHER_BYTES = 5 * 1024 * 1024;

// Un PDF empieza con "%PDF-" seguido de la versión. Es la firma completa que exige la
// especificación; no alcanza con "%PDF" suelto.
const esPDF = (buffer) =>
    Buffer.isBuffer(buffer) &&
    buffer.length > 5 &&
    buffer.slice(0, 5).toString('ascii') === '%PDF-';

/**
 * Valida el voucher y devuelve el buffer listo para subir.
 *
 * @param {Buffer} buffer  Contenido real del archivo.
 * @returns {Promise<{ok: true, buffer: Buffer, formato: string, contentType: string}
 *                  | {ok: false, mensaje: string}>}
 */
export async function prepararVoucher(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 100)
        return { ok: false, mensaje: 'El archivo está vacío o es demasiado pequeño.' };

    if (buffer.length > MAX_VOUCHER_BYTES)
        return { ok: false, mensaje: `El archivo supera los ${Math.round(MAX_VOUCHER_BYTES / 1024 / 1024)} MB.` };

    if (esPDF(buffer)) {
        return { ok: true, buffer, formato: 'PDF', contentType: 'application/pdf' };
    }

    // Si no es PDF tiene que ser una imagen de las tres que se aceptan. `detectarTipoReal`
    // se consulta antes solo para poder dar un mensaje que diga qué pasó.
    if (!detectarTipoReal(buffer))
        return { ok: false, mensaje: 'Formato no permitido. Adjuntá una imagen JPG, PNG o WebP, o un PDF.' };

    // El voucher se lee con los ojos: 200px de lado mínimo descarta un ícono pegado por
    // error, y 1600px de ancho máximo alcanza para leer un comprobante sin guardar una
    // foto de 12 megapíxeles. Es el mismo tope del comprobante del checkout web.
    const revision = await validarImagen(buffer, { maxBytes: MAX_VOUCHER_BYTES, minLado: 200 });
    if (!revision.ok) return { ok: false, mensaje: revision.mensaje };

    return {
        ok: true,
        buffer: await aWebp(buffer, { anchoMaximo: 1600 }),
        formato: 'WEBP',
        contentType: 'image/webp'
    };
}

export default prepararVoucher;
