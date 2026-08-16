import multer from "multer";

const storage = multer.memoryStorage();

/**
 * Cuántas imágenes admite un producto en una sola carga.
 *
 * Subió de 10 porque un artículo con muchos colores necesita una foto por color como
 * mínimo: con 13 colores, 10 no alcanzaba y la petición moría con "Too many files".
 *
 * Ojo al subirlo más: multer usa memoryStorage, así que el tope real es
 * MAX_IMAGENES × 2 MB retenidos en memoria por cada petición simultánea.
 */
export const MAX_IMAGENES = parseInt(process.env.MAX_IMAGENES_PRODUCTO) || 30;
export const MAX_BYTES_IMAGEN = 2 * 1024 * 1024;

const filtroArchivo = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        // El mimetype del navegador no es prueba de nada: esto solo descarta lo obvio
        // antes de gastar ancho de banda. La validación real la hace validarImagen()
        // sobre los magic bytes del buffer.
        cb(new Error('El archivo no es una imagen válida.'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_BYTES_IMAGEN, files: MAX_IMAGENES },
    fileFilter: filtroArchivo
});

export default upload;
