import { Upload } from '@aws-sdk/lib-storage';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import s3Client from '../config/r2.js';
import { validarImagen, aWebp } from './imagenSegura.js';

// Comprobantes que respaldan una entrada o salida de dinero: los del movimiento manual
// de una caja/banco y los del abono a una factura de crédito. Vivía entero dentro de
// adminControllers.js `crearMovimientoCuenta`; el abono necesitaba exactamente lo mismo,
// así que la lógica se mudó acá en vez de copiarse.
//
// El mismo tope que aplica multer en middlewares/uploadComprobantes.js. Se repite porque
// la validación del contenido tiene que conocerlo: multer corta por tamaño de petición,
// esto corta por tamaño del archivo ya en memoria.
export const MAX_BYTES_COMPROBANTE = (parseInt(process.env.MAX_MB_COMPROBANTE) || 5) * 1024 * 1024;

// Un PDF puede llevar código: JavaScript, acciones que lanzan programas, archivos adjuntos
// o formularios XFA. Ningún comprobante, RUT ni documento legítimo que recibimos necesita
// eso, así que un PDF que lo declare se rechaza entero. Los nombres PDF pueden venir con
// caracteres escapados en hexadecimal (/J#61vaScript), por eso se decodifican antes de
// buscar. No es un antivirus: es un filtro de lo que un documento de oficina nunca trae.
const MARCAS_PDF_ACTIVO = ['/javascript', '/js', '/launch', '/embeddedfile', '/embeddedfiles',
    '/richmedia', '/xfa', '/submitform', '/importdata', '/gotoe'];

const pdfSinContenidoActivo = (buffer) => {
    const texto = buffer.toString('latin1')
        .replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .toLowerCase();
    // Nombre PDF seguido de un delimitador: '/js' no debe coincidir con '/jsonfoo'.
    return !MARCAS_PDF_ACTIVO.some(m => new RegExp(`${m.replace('/', '\\/')}(?![a-z0-9])`).test(texto));
};

/** Mismo criterio que usa `subirComprobantes`, expuesto para validar antes de subir. */
export const esPdfSeguro = (buffer) =>
    buffer.slice(0, 5).toString('ascii') === '%PDF-'
    && buffer.lastIndexOf('%%EOF') > 0
    && pdfSinContenidoActivo(buffer);

/**
 * Sube los comprobantes a R2 y devuelve las filas de DOCUMENTACION listas para insertar.
 *
 * Se llama SIEMPRE antes de abrir la transacción: mantenerla abierta mientras los
 * archivos viajan bloquea filas por segundos. Si la escritura posterior falla, el
 * llamador borra con `borrarComprobantes(subidos)` lo que alcanzó a subir.
 *
 * @param archivos      req.files?.comprobantes || []
 * @param idPropietario id de la entidad dueña (el movimiento o el abono)
 * @param pertenece     valor de DOCUMENTACION.pertenece
 * @param prefijo       prefijo del Key en R2 ('mov', 'abono'...)
 * @returns { docs, subidos } — filas a insertar y Keys ya subidas
 */
export async function subirComprobantes({ archivos = [], idPropietario, pertenece, prefijo = 'mov', carpeta = 'transacciones' }) {
    const subidos = [];
    const docs = [];

    for (const [idx, file] of archivos.entries()) {
        // El mimetype y la extensión los controla quien sube: no son evidencia de nada.
        // Lo que decide es el contenido real del buffer. El fileFilter de multer ya
        // descartó lo obvio; esto es la verificación que cuenta.
        const esPdf = file.buffer.slice(0, 5).toString('ascii') === '%PDF-';

        let cuerpo, contentType, extension;
        if (esPdf) {
            if (!esPdfSeguro(file.buffer)) {
                throw Object.assign(new Error(`"${file.originalname}": el PDF está dañado o trae contenido no permitido (scripts, adjuntos o formularios activos).`), { publico: true });
            }
            cuerpo      = file.buffer;
            contentType = 'application/pdf';
            extension   = 'pdf';
        } else {
            const revision = await validarImagen(file.buffer, {
                minLado:  150,                     // una foto de voucher siempre supera esto
                maxBytes: MAX_BYTES_COMPROBANTE
            });
            if (!revision.ok) {
                // El motivo le sirve a quien sube: no es información interna.
                throw Object.assign(new Error(`"${file.originalname}": ${revision.mensaje}`), { publico: true });
            }
            // Se persiste siempre convertido a WebP, nunca el archivo tal como llegó.
            cuerpo      = await aWebp(file.buffer, { anchoMaximo: 1600 });
            contentType = 'image/webp';
            extension   = 'webp';
        }

        const r2Key = `documentacion/${carpeta}/${prefijo}-${idPropietario}-${Date.now()}-${idx}.${extension}`;

        await new Upload({
            client: s3Client,
            params: { Bucket: process.env.R2_BUCKET_NAME, Key: r2Key, Body: cuerpo, ContentType: contentType }
        }).done();

        subidos.push(r2Key);
        docs.push({
            idPropietario,
            nombreDocumento: file.originalname,
            keyName:         r2Key,
            formato:         extension.toUpperCase(),
            pertenece
        });
    }

    return { docs, subidos };
}

/** Borra de R2 lo que se subió cuando la escritura en base de datos terminó fallando. */
export async function borrarComprobantes(keys = []) {
    await Promise.all(keys.map(k =>
        s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: k })).catch(() => {})
    ));
}

/** URL pública de un comprobante ya subido, para devolverla en la respuesta. */
export const urlComprobante = (keyName) => `${process.env.R2_PUBLIC_URL}/${keyName}`;
