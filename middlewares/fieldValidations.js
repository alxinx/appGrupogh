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
        .isLength({ min: 8 })
        .withMessage('La contraseña debe tener mínimo 8 caracteres')
]



const loginValidation = [
    
    check('emailUsuario')
        .trim()
        .isEmail().withMessage('Debe ser un email válido'),

    check('password')
        .trim()
        .isLength({ min: 8 })
        .withMessage('La contraseña debe tener mínimo 8 caracteres')
]
 

const storeRegisterValidation =  [

    check("razonSocial").trim().notEmpty().withMessage('Es necesario que me des la razón social.'),
    check("tipo").trim().isIn(['Punto de venta', 'Bodega', 'Transito']).withMessage('Debe ser alguna de las opciones del campo.'),
    check("nombreComercial").trim().notEmpty().withMessage('Debes darme el nombre comercial.'),
    check("direccionPrincipal").trim().notEmpty().withMessage('La dirección del punto de venta es importante.'),
    check("departamento").trim().isInt().withMessage('El departamento debe ser uno de los de la lista.'),
    check("ciudad").trim().isInt().withMessage('La ciudad debe ser uno de los de la lista.'),
    
]

const storeBasicTaxDataValidation = [
    check("taxId").trim().isInt().optional({checkFalsy: true}).withMessage('El numero del RUT es importante'),
    check("DV").trim().isLength({min:1, max: 1}).optional({checkFalsy: true}).withMessage('El código de verificación es importante'),
    check("emailRut").isEmail().optional({checkFalsy: true}).withMessage('Es necesario el email que tienes registrado ante la DIAN.'),
]


const productBasicValidation = [
    check("nombreProducto").trim().isLength({min : 2}).withMessage('🚨 Necesito saber como llamarás al producto '),
    // Cuántas combinaciones talla×color trae el alta. Con más de una, cada combinación se
    // guarda como un producto aparte con SU PROPIO SKU (el que se digita en el modal), así
    // que el SKU de la cabecera queda de sobra: solo se usa como base para sugerirlos.
    check('sku')
        .trim()
        .customSanitizer(value => String(value || '').toUpperCase().replace(/[^A-Z0-9-_]/g, '').slice(0, 20))
        .custom((valor, { req }) => {
            let combos = 0;
            try {
                const sel = JSON.parse(req.body?.variantes_finales || '{}');
                combos = Object.values(sel).reduce((n, colores) => n + (colores?.length || 0), 0);
            } catch { combos = 0; }

            // Producto único: el SKU es obligatorio, es su identificador.
            if (combos <= 1 && valor.length < 2) {
                throw new Error('🚨 El Sku debe ser válido o mayor a 2 caracteres. ');
            }
            return true;
        }),
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
            storeRegisterValidation,
            storeBasicTaxDataValidation,
            productBasicValidation,
            cajaBancoValidation,
            cajaBancoEditValidation
        }