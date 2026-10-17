import multer from 'multer';

// Subida del molde (JPG o PDF) de una ficha de confección — un solo archivo, en memoria,
// nunca a disco. Mismo criterio que uploadDxf.js: no se filtra por mimetype acá (el
// navegador no es confiable para eso), la validación real de contenido ocurre en el
// controlador (controller/fichaConfeccionMoldeController.js subirMolde).
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10MB

const uploadMolde = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANO_MAXIMO_BYTES, files: 1 }
});

export const recibirMolde = (req, res, next) => {
    uploadMolde.single('molde')(req, res, (err) => {
        if (!err) return next();
        const mensaje = err.code === 'LIMIT_FILE_SIZE'
            ? 'El archivo supera el tamaño máximo permitido (10 MB).'
            : err.message || 'No se pudo procesar el archivo.';
        return res.status(422).json({ success: false, mensaje });
    });
};

export default uploadMolde;
