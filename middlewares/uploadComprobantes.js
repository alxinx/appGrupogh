import multer from 'multer';

// Comprobantes de un movimiento de caja o banco: varios archivos por movimiento.
//
// memoryStorage porque los archivos se procesan (las imágenes se convierten a WebP) y
// se suben a R2 sin tocar el disco del servidor. El límite existe para que una petición
// no pueda retener memoria sin techo: MAX_ARCHIVOS × MAX_MB por petición simultánea.
const MAX_ARCHIVOS = parseInt(process.env.MAX_COMPROBANTES_MOVIMIENTO) || 10;
const MAX_BYTES    = (parseInt(process.env.MAX_MB_COMPROBANTE) || 5) * 1024 * 1024;

const PERMITIDOS = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'application/pdf'
];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: MAX_ARCHIVOS },
    // Filtro barato: descarta lo obvio antes de gastar ancho de banda. Lo que llegue
    // igual se procesa con sharp, que falla si el contenido no es una imagen real.
    fileFilter: (req, file, cb) => {
        if (PERMITIDOS.includes(file.mimetype)) return cb(null, true);
        cb(new Error('Solo se aceptan imágenes (JPG, PNG, WebP) o PDF.'));
    }
});

export const subirComprobantesMovimiento = upload.fields([{ name: 'comprobantes', maxCount: MAX_ARCHIVOS }]);
export default subirComprobantesMovimiento;

// ── Registro público de clientes (formulario web) ────────────────────────────
//
// Mismo filtro de tipos y el mismo tope por archivo que los comprobantes, pero para una
// petición SIN sesión: un solo archivo (el RUT) y topes chicos para los campos de texto,
// así nadie puede retener memoria del servidor mandando formularios inflados. La
// validación que cuenta (magic bytes, PDF sin contenido activo, imagen a WebP) la hace
// después `subirComprobantes`.
const uploadRegistroWeb = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 40, fieldSize: 2 * 1024, parts: 45 },
    fileFilter: (req, file, cb) => {
        if (PERMITIDOS.includes(file.mimetype)) return cb(null, true);
        cb(new Error('Solo se aceptan imágenes (JPG, PNG, WebP) o PDF.'));
    }
});

/** Recibe el RUT del registro web y traduce los errores de multer a JSON (422). */
export const recibirRutRegistroWeb = (req, res, next) => {
    uploadRegistroWeb.single('rut')(req, res, (err) => {
        if (!err) return next();
        const mensaje = err.code === 'LIMIT_FILE_SIZE'
            ? `El archivo supera el tamaño máximo permitido (${MAX_BYTES / 1024 / 1024} MB).`
            : err.code?.startsWith('LIMIT_')
                ? 'La solicitud es demasiado grande.'
                : err.message || 'No se pudo procesar el archivo.';
        return res.status(422).json({ success: false, mensaje });
    });
};
