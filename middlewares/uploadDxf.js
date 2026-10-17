import multer from 'multer';

// Subida del DXF de una ficha de confección: un solo archivo, en memoria, nunca a disco.
// Mismo criterio que uploadQr.js — el navegador no manda un Content-Type confiable para DXF
// (varía entre "application/dxf", "image/vnd.dxf" u "application/octet-stream" según
// sistema operativo), así que no se filtra por mimetype acá: la validación real de
// contenido (esDxfValido, helpers/dxf.js) ocurre en el controlador.
const TAMANO_MAXIMO_BYTES = 20 * 1024 * 1024; // 20MB

const uploadDxf = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANO_MAXIMO_BYTES, files: 1 }
});

// Traduce los errores de multer (archivo muy grande) a JSON — el handler global de Express
// los mandaría como un 500 en HTML, que no es lo que espera el panel.
export const recibirDxf = (req, res, next) => {
    uploadDxf.single('dxf')(req, res, (err) => {
        if (!err) return next();
        const mensaje = err.code === 'LIMIT_FILE_SIZE'
            ? 'El archivo supera el tamaño máximo permitido (20 MB).'
            : err.message || 'No se pudo procesar el archivo.';
        return res.status(422).json({ success: false, mensaje });
    });
};

export default uploadDxf;
