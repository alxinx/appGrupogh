import { check } from "express-validator";

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
    check("telefono").trim().isMobilePhone().withMessage('Debe ser un numero celular.'),
    //check("taxId").trim().isInt().withMessage('El numero del RUT es importante'),
    //check("DV").trim().isLength({min:1, max: 1}).withMessage('El código de verificación es importante'),
    //check("resolucionFacturacion").isInt().withMessage('Debes darme un número de resolución válido.'),
    //check("emailRut").trim().isEmail().withMessage('El email es importante.'),
    //check('idDepartamento').trim().notEmpty().withMessage('Debes seleccionar un Departamento'),
    //check('idCiudad').trim().notEmpty().withMessage('Debes seleccionar una ciudad'),


    

]


export {    registerValidation,
            loginValidation,
            storeRegisterValidation
        }