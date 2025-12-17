import { check , validationResult } from "express-validator";

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

export {registerValidation}