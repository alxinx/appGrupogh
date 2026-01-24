import multer from "multer";

const storage = multer.memoryStorage();

const filtroArchivo = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('El archivo no es una imagen válida.'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024, files: 10 }, // 2MB por foto
    fileFilter: filtroArchivo
});

export default upload;