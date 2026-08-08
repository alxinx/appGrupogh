import multer from "multer";

// Subida del QR de pago: un solo archivo, en memoria, nunca a disco.
// El mimetype declarado por el navegador solo sirve para descartar lo obvio;
// la validación real (magic bytes + lectura del QR) ocurre en el controlador.
const uploadQr = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // 2MB, 1 archivo
    fileFilter: (req, file, cb) => {
        const permitidos = ['image/jpeg', 'image/png', 'image/webp'];
        if (permitidos.includes(file.mimetype)) return cb(null, true);
        cb(new Error('Formato no permitido. Sube una imagen JPG, PNG o WebP.'), false);
    }
});

// Los errores de multer (archivo muy grande, mimetype rechazado) llegarían al handler
// global de Express como un 500 en HTML. Este wrapper los traduce a JSON, que es lo que
// espera el panel.
export const recibirQr = (req, res, next) => {
    uploadQr.single('qr')(req, res, (err) => {
        if (!err) return next();
        const mensaje = err.code === 'LIMIT_FILE_SIZE'
            ? 'La imagen supera el tamaño máximo permitido (2 MB).'
            : err.message || 'No se pudo procesar el archivo.';
        return res.status(422).json({ success: false, mensaje });
    });
};

export default uploadQr;
