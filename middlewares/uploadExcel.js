import multer from "multer";

const storage = multer.memoryStorage();

// .xlsx y .xlsm (el archivo que manda el proveedor trae macros, aunque acá no se ejecutan
// ni se leen — ExcelJS solo lee las hojas de datos).
const MIMES_PERMITIDOS = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel.sheet.macroEnabled.12', // .xlsm
    'application/vnd.ms-excel' // algunos navegadores mandan .xlsm con este mimetype genérico
];

const filtroArchivo = (req, file, cb) => {
    if (MIMES_PERMITIDOS.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos Excel (.xlsx o .xlsm).'), false);
    }
};

// El mimetype declarado por el navegador no prueba nada — la validación real de que es
// un Excel legítimo la hace ExcelJS al intentar abrirlo en el controlador, que falla con
// un mensaje claro si el archivo no es un .xlsx/.xlsm válido.
const uploadExcel = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: filtroArchivo
});

export default uploadExcel;
