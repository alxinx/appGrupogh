import multer from "multer";

const storage = multer.memoryStorage();

const filtroArchivo = (req, file, cb) => {
    // Lista de tipos MIME permitidos
    const allowedMimes = [
        'image/jpeg', 
        'image/png', 
        'image/webp', 
        'application/pdf',
        'application/msword', // .doc
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        'application/vnd.ms-excel', // .xls
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // .xlsx
    ];

    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de archivo no permitido. Solo se permiten imágenes, PDF, Word y Excel.'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 10 }, // 5MB por archivo, máx 10 archivos
    fileFilter: filtroArchivo
});

export default upload;
