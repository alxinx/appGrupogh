import { check, body } from "express-validator";

const registerValidation = [
    check('nombreUsuario')
    .trim()
    .notEmpty().withMessage('Debes darme tu nombre'),

    check('apellidoUsuario')
        .trim()
        .notEmpty().withMessage('Cuál es tu apellido'),

    check('emailUsuario')
        .trim()
        .isEmail().withMessage('Debe ser un email válido'),

    check('password')
        .trim()
        .isLength({ min: 6 })
        .withMessage('La contraseña debe tener mínimo 6 caracteres')
]


const loginValidation = [
    
    check('emailUsuario')
        .trim()
        .isEmail().withMessage('Debe ser un email válido'),

    // Sin largo mínimo ni trim: eso es una regla para CREAR una contraseña, no para entrar.
    // La contraseña inicial de un empleado es su documento, y una cédula de menos de 6
    // dígitos quedaba rechazada aquí antes de llegar a compararse. Y `.trim()` modificaba
    // lo que se comparaba: lo que escribió la persona se compara tal cual.
    check('password')
        .notEmpty()
        .withMessage('Escribe tu contraseña')
]
 


const productBasicValidation = [
    check("nombreProducto").trim().isLength({min : 2}).withMessage('🚨 Necesito saber como llamarás al producto '),
    // El SKU ya no se valida acá porque ya no llega del formulario: lo asigna el servidor
    // dentro de la transacción del alta (siguienteSkuInterno en helpers/productos.js), uno
    // por producto, también cuando el alta se abre en varias combinaciones talla×color.
    // Opcional: vacía llega como '' y el setter del modelo la guarda como NULL, así todos
    // los productos sin familia quedan fuera de cualquier agrupación en vez de compartir ''.
    // El tope es el mismo que nombreProducto porque la familia se propone desde el nombre.
    check('familia')
        .trim()
        .optional({ checkFalsy: true })
        .isLength({ max: 100 })
        .withMessage('🚨 La familia no puede superar los 100 caracteres.'),
    check('precioVentaMayorista')
        .customSanitizer(value => parseInt(String(value).replace(/\D/g, '')) || 0)
        .custom(value => value > 0)
        .withMessage('🚨 El precio mayorista debe ser mayor a $0.'),
    check('precioVentaPublicoFinal')
        .customSanitizer(value => parseInt(String(value).replace(/\D/g, '')) || 0)
        .custom(value => value > 0)
        .withMessage('🚨 El precio al público debe ser mayor a $0.'),
    // TEMPORAL — costo de la prenda. Opcional: los productos que ya existen no lo tienen
    // y el alta no debe bloquearse por eso. Negativo sí se rechaza: no existe.
    check('costo')
        .customSanitizer(value => parseInt(String(value ?? '').replace(/\D/g, '')) || 0)
        .custom(value => value >= 0)
        .withMessage('🚨 El costo no puede ser negativo.'),
    check('precioVentaMayoristaSurtido')
        .customSanitizer(value => parseInt(String(value).replace(/\D/g, '')) || 0)
        .optional({ checkFalsy: true })
        .custom(value => value >= 0)
        .withMessage('🚨 El precio mayorista surtido no puede ser negativo.'),
    body('precioVentaMayorista')
        .custom((value, { req }) => {
            const mayorista = parseInt(String(value).replace(/\D/g, '')) || 0;
            const publico   = parseInt(String(req.body.precioVentaPublicoFinal).replace(/\D/g, '')) || 0;
            if (mayorista >= publico) throw new Error('🚨 El precio mayorista debe ser menor que el precio al público final.');
            return true;
        }),
]   

// ── CAJAS Y BANCOS ────────────────────────────────────────────────────────────
// Los obligatorios son nombre y tipo. La referencia es opcional (una caja de efectivo
// no tiene número de cuenta), pero si viene se limita a 50 caracteres como la columna.
// Esto corre ADEMÁS de los validadores del modelo: el formulario no es la autoridad.
const cajaBancoValidation = [
    check('nombreCajaBanco')
        .trim()
        .notEmpty().withMessage('El nombre es obligatorio.')
        .isLength({ min: 2, max: 50 }).withMessage('El nombre debe tener entre 2 y 50 caracteres.'),

    check('tipo')
        .trim()
        .notEmpty().withMessage('El tipo es obligatorio.')
        .isIn(['caja', 'banco', 'billetera']).withMessage('El tipo debe ser caja, banco o billetera.'),

    check('referencia')
        .optional({ nullable: true })
        .trim()
        .isLength({ max: 50 }).withMessage('La referencia no puede superar los 50 caracteres.'),
]


// Edición de una caja o banco. NO reutiliza cajaBancoValidation porque allá `tipo` es
// obligatorio: al editar una cuenta que ya tiene movimientos el formulario ni siquiera
// manda ese campo, y exigirlo rechazaría un cambio de nombre perfectamente válido.
// Que `tipo` y `referencia` puedan cambiarse o no lo decide el controlador contra la base,
// no este validador: acá solo se comprueba la forma de lo que llega.
const cajaBancoEditValidation = [
    check('nombreCajaBanco')
        .trim()
        .notEmpty().withMessage('El nombre es obligatorio.')
        .isLength({ min: 2, max: 50 }).withMessage('El nombre debe tener entre 2 y 50 caracteres.'),

    check('estado')
        .exists().withMessage('El estado es obligatorio.')
        .isBoolean().withMessage('El estado debe ser activo o inactivo.'),

    check('tipo')
        .optional({ nullable: true })
        .trim()
        .isIn(['caja', 'banco', 'billetera']).withMessage('El tipo debe ser caja, banco o billetera.'),

    check('referencia')
        .optional({ nullable: true })
        .trim()
        .isLength({ max: 50 }).withMessage('La referencia no puede superar los 50 caracteres.'),
]


export {    registerValidation,
            loginValidation,
            
            productBasicValidation,
            cajaBancoValidation,
            cajaBancoEditValidation
        }