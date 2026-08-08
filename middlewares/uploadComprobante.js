import multer from "multer";

// Comprobante de transferencia del checkout web: una sola imagen, en memoria.
// El filtro por mimetype solo descarta lo obvio antes de gastar ancho de banda;
// la verificación real (magic bytes + dimensiones) la hace el controlador con
// helpers/imagenSegura.js, porque el navegador puede declarar cualquier cosa.
const uploadComprobante = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5MB — una foto de celular pesa más que un QR
    fileFilter: (req, file, cb) => {
        const permitidos = ['image/jpeg', 'image/png', 'image/webp'];
        if (permitidos.includes(file.mimetype)) return cb(null, true);
        cb(new Error('Solo se aceptan imágenes JPG, PNG o WebP.'), false);
    }
});

// Traduce los errores de multer a JSON; si no, Express responde un 500 en HTML.
export const recibirComprobante = (req, res, next) => {
    uploadComprobante.single('comprobante')(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'La imagen supera el tamaño máximo permitido (5 MB).'
            : err.message || 'No se pudo procesar el archivo.';
        return res.status(422).json({ success: false, message });
    });
};

export default uploadComprobante;
