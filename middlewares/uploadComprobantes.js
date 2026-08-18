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
