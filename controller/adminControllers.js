import {validationResult } from "express-validator";

import bcrypt from "bcrypt";
import {Usuarios} from '../models/index.js'
import {registerValidation} from '../middlewares/fieldValidations.js'


const adminLogin = (req, res)=>{
    res.render("./auth/login", {
        pagina: "Login Page",
        csrfToken : req.csrfToken()
    })
}

const registerLogin = (req, res)=>{
    res.render("./auth/register", {
        pagina: "Register Pages",
        csrfToken : req.csrfToken()
    })
    
}

const forgotLogin = (req, res)=>{
    res.render("./auth/forgot", {
        pagina: "Forgot Your Password",
        csrfToken : req.csrfToken()
    })
    
}



//-----------------------------[POST]--------------------------------//

const registerLoginPost = async (req,res)=>{

    const erroresValidacion = validationResult(req);
    const { nombreUsuario, apellidoUsuario, emailUsuario, password } = req.body;
    const errores= erroresValidacion.array()
    const errsPorCampo = {};
    errores.forEach(err => 
        {
            if (!errsPorCampo[err.path]) {
                errsPorCampo[err.path] = err.msg;
            }
    });

    if (!erroresValidacion.isEmpty()) {
       return res.status(200).render("./auth/register",{
            pagina: "Register Pages",
            csrfToken : req.csrfToken(),
            errores : errsPorCampo,
            usuario : {
                nombreUsuario : nombreUsuario,
                apellidoUsuario : apellidoUsuario,
                emailUsuario : emailUsuario,    
            }
       }) 
    }


    //Verifico que no hayan emails duplicados

    const duplicados = await Usuarios.findOne({ where :{emailUsuario}})

    if(duplicados){
        return res.render('./auth/register', {
            titulo : 'Login',
            csrfToken : req.csrfToken(),
            errores : {
                msg : 'El usuario ya existe 🧐'
            }
        })
    }



    //ingreso el usuario
    const usuario = await Usuarios.create({
        nombreUsuario,
        apellidoUsuario,
        emailUsuario,
        password,
        permisos : 'ADMIN'
    })

    return res.status(200).render("./auth/register",{
            pagina: "Registro de Admins",
            csrfToken : req.csrfToken(),
            success : {msg : "Creado Con exito"}
        })

}


export {
            adminLogin,
            registerLogin, 
            forgotLogin,
            registerLoginPost,
    }