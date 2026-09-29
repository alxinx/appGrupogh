import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import s3Client from '../config/r2.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';

// Dónde vive cada documento en R2 y cómo se abre.
//
// Hay dos buckets (CLAUDE.md §2): el público `grupo-gh`, con URL directa, y el privado
// `gh-pay-assets`, que solo se lee con presigned URLs de vida corta. Los documentos de
// identidad de un proveedor (cédula, RUT, certificación bancaria, fotos de su taller) van al
// PRIVADO, en la carpeta `provedores/`: con una URL pública, cualquiera que tuviera el
// enlace vería la cédula de una persona, sin sesión y para siempre.
//
// El bucket se deduce de la ruta (keyName), no de una columna: una ruta que empieza por una
// carpeta privada está en el privado. Así DOCUMENTACION no cambia y los documentos viejos
// —en `documentacion/…` del público— se siguen abriendo igual mientras se migran
// (seed/migracionDocumentosProveedorPrivado.js).

export const CARPETAS_PRIVADAS = ['provedores'];

// Vida del enlace firmado: alcanza para abrir el documento, no para compartirlo.
const VIDA_URL_SEG = 5 * 60;

export const esKeyPrivada = (key) => CARPETAS_PRIVADAS.some(c => String(key ?? '').startsWith(`${c}/`));

/** Cliente y bucket donde vive (o va a vivir) esa ruta. */
export const destinoDe = (key) => esKeyPrivada(key)
    ? { client: r2PrivateClient, Bucket: R2_PRIVATE_BUCKET }
    : { client: s3Client, Bucket: process.env.R2_BUCKET_NAME };

/**
 * Ruta de un documento nuevo. En el privado cada dueño tiene su carpeta
 * (`provedores/{idProveedor}/rut-….pdf`); en el público se conserva el esquema de siempre.
 */
export function keyDocumento({ carpeta, prefijo, idPropietario, idx, extension }) {
    const marca = `${Date.now()}-${idx}`;
    return CARPETAS_PRIVADAS.includes(carpeta)
        ? `${carpeta}/${idPropietario}/${prefijo}-${marca}.${extension}`
        : `documentacion/${carpeta}/${prefijo}-${idPropietario}-${marca}.${extension}`;
}

/**
 * Enlace para abrir un documento: firmado y de vida corta si es privado, la URL pública si
 * no. `nombre` es el nombre con el que se descarga (el navegador lo muestra en la pestaña).
 */
export async function urlDocumento(key, { nombre } = {}) {
    if (!esKeyPrivada(key)) return `${process.env.R2_PUBLIC_URL}/${key}`;
    return getSignedUrl(
        r2PrivateClient,
        new GetObjectCommand({
            Bucket: R2_PRIVATE_BUCKET,
            Key: key,
            ...(nombre && { ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(nombre)}` })
        }),
        { expiresIn: VIDA_URL_SEG }
    );
}

/** Borra objetos de R2, cada uno de su bucket. Nunca lanza: es limpieza. */
export async function borrarObjetos(keys = []) {
    await Promise.all(keys.map(k => {
        const { client, Bucket } = destinoDe(k);
        return client.send(new DeleteObjectCommand({ Bucket, Key: k })).catch(() => {});
    }));
}
