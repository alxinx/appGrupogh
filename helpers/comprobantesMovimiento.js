import { Upload } from '@aws-sdk/lib-storage';
import { validarImagen, aWebp, detectarTipoReal } from './imagenSegura.js';
import { destinoDe, keyDocumento, borrarObjetos } from './almacenamientoDocumentos.js';

// Único camino para subir un documento a R2 desde cualquier formulario: comprobantes de
// caja/banco y de abonos, documentos de clientes, empleados, proveedores, tiendas y órdenes
// de compra, y los registros web. Antes cada controlador tenía su propia copia —con sharp a
// mano y decidiendo por el tipo que declaraba el navegador—, y los PDF y archivos de Office
// subían tal cual llegaban.
//
// Lo que se decide acá, igual para todos: el tipo REAL del archivo (por su contenido), PDF
// sin contenido activo, Office sin macros, imagen verificada y guardada siempre en WebP, y
// el bucket según la carpeta (helpers/almacenamientoDocumentos.js).
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

// ── Office ────────────────────────────────────────────────────────────────────
// Word, Excel y PowerPoint, solo donde el formulario los acepta (`permitirOffice`). Se
// reconocen por su firma: los modernos (.docx/.xlsx/.pptx) son un ZIP con
// [Content_Types].xml; los viejos (.doc/.xls/.ppt), un contenedor OLE. Un documento con
// macros se rechaza: una macro es un programa, y ningún documento que recibimos la
// necesita. Los formatos habilitados para macros (.docm, .xlsm) ni siquiera se aceptan.
const OFFICE_MODERNO = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};
const OFFICE_VIEJO = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' };
const FIRMA_ZIP = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
const FIRMA_OLE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const MARCAS_MACRO = [Buffer.from('vbaProject.bin'), Buffer.from('_VBA_PROJECT', 'utf16le'), Buffer.from('Macros', 'utf16le')];

/** `{ contentType, extension }` si el buffer es un documento de Office sin macros; si no, null. */
export function documentoOffice(buffer, nombreOriginal) {
    const extension = String(nombreOriginal ?? '').split('.').pop().toLowerCase();
    if (MARCAS_MACRO.some(m => buffer.includes(m))) return null;
    if (buffer.slice(0, 4).equals(FIRMA_ZIP) && OFFICE_MODERNO[extension] && buffer.includes(Buffer.from('[Content_Types].xml'))) {
        return { contentType: OFFICE_MODERNO[extension], extension };
    }
    if (buffer.slice(0, 8).equals(FIRMA_OLE) && OFFICE_VIEJO[extension]) return { contentType: OFFICE_VIEJO[extension], extension };
    return null;
}

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
 * @param carpeta       carpeta en R2; las de CARPETAS_PRIVADAS van al bucket privado
 * @param soloImagenes  rechaza los PDF (fotos del lugar de trabajo de un proveedor)
 * @param permitirOffice acepta Word, Excel y PowerPoint sin macros, tal como llegan
 * @param anchoMaximo   ancho máximo de una imagen al convertirla a WebP
 * @returns { docs, subidos } — filas a insertar y Keys ya subidas
 */
export async function subirComprobantes({
    archivos = [], idPropietario, pertenece, prefijo = 'mov', carpeta = 'transacciones',
    soloImagenes = false, permitirOffice = false, anchoMaximo = 1600
}) {
    const subidos = [];
    const docs = [];

    // Si un archivo falla a mitad de camino, los que ya subieron se borran acá mismo: el
    // llamador solo recibe `subidos` cuando todo salió bien, así que no podría limpiarlos.
    try {
        for (const [idx, file] of archivos.entries()) {
            // El mimetype y la extensión los controla quien sube: no son evidencia de nada.
            // Lo que decide es el contenido real del buffer. El fileFilter de multer ya
            // descartó lo obvio; esto es la verificación que cuenta.
            const esPdf = file.buffer.slice(0, 5).toString('ascii') === '%PDF-';
            const office = !esPdf && !soloImagenes && permitirOffice ? documentoOffice(file.buffer, file.originalname) : null;

            let cuerpo, contentType, extension;
            if (esPdf && soloImagenes) {
                throw Object.assign(new Error(`"${file.originalname}": acá van fotos (JPG, PNG o WebP), no un PDF.`), { publico: true });
            }
            if (office) {
                cuerpo      = file.buffer;
                contentType = office.contentType;
                extension   = office.extension;
            } else if (esPdf) {
                if (!esPdfSeguro(file.buffer)) {
                    throw Object.assign(new Error(`"${file.originalname}": el PDF está dañado o trae contenido no permitido (scripts, adjuntos o formularios activos).`), { publico: true });
                }
                cuerpo      = file.buffer;
                contentType = 'application/pdf';
                extension   = 'pdf';
            } else if (permitirOffice && !detectarTipoReal(file.buffer)) {
                // Ni PDF, ni imagen, ni un Office aceptable (otro formato, o uno con macros).
                throw Object.assign(new Error(`"${file.originalname}": solo se aceptan PDF, imágenes (JPG, PNG, WebP) y documentos de Word, Excel o PowerPoint sin macros.`), { publico: true });
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
                cuerpo      = await aWebp(file.buffer, { anchoMaximo });
                contentType = 'image/webp';
                extension   = 'webp';
            }

            const r2Key = keyDocumento({ carpeta, prefijo, idPropietario, idx, extension });
            const { client, Bucket } = destinoDe(r2Key);

            await new Upload({
                client,
                params: { Bucket, Key: r2Key, Body: cuerpo, ContentType: contentType }
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
    } catch (e) {
        await borrarObjetos(subidos);
        throw e;
    }

    return { docs, subidos };
}

/** Borra de R2 lo que se subió cuando la escritura en base de datos terminó fallando. */
export const borrarComprobantes = borrarObjetos;

/** URL pública de un comprobante ya subido, para devolverla en la respuesta. */
export const urlComprobante = (keyName) => `${process.env.R2_PUBLIC_URL}/${keyName}`;
