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
export async function subirComprobantes({ archivos = [], idPropietario, pertenece, prefijo = 'mov' }) {
    const subidos = [];
    const docs = [];

    for (const [idx, file] of archivos.entries()) {
        // El mimetype y la extensión los controla quien sube: no son evidencia de nada.
        // Lo que decide es el contenido real del buffer. El fileFilter de multer ya
        // descartó lo obvio; esto es la verificación que cuenta.
        const esPdf = file.buffer.slice(0, 5).toString('ascii') === '%PDF-';

        let cuerpo, contentType, extension;
        if (esPdf) {
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

        const r2Key = `documentacion/transacciones/${prefijo}-${idPropietario}-${Date.now()}-${idx}.${extension}`;

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
