import {validationResult } from "express-validator";
//import bcrypt from "bcrypt";
import {Usuarios} from '../models/index.js'
import { generarId, generarJwt } from '../helpers/genToken.js'
import { redireccion } from "../helpers/redireccion.js";

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

const loginUser = async (req, res)=>{


    //Validacion de los campos de texto.
    const erroresValidacion = validationResult(req);
    const errores = erroresValidacion.array()
    const errsPorCampo = {};
    errores.forEach(err => 
        {
            if (!errsPorCampo[err.path]) {
                errsPorCampo[err.path] = err.msg;
            }
    });


    const {emailUsuario, password}= req.body
    //Valido que todos los campos esten llenos. 
     if (!erroresValidacion.isEmpty()) {
        return res.status(200).render("./auth/login",{
            titulo : 'Login',
            csrfToken : req.csrfToken(),
            errores  : errsPorCampo,
            usuario : {
                emailUsuario : emailUsuario,
            }
        })
     }


     //Verifico que exista el usuario
     const usuario = await Usuarios.findOne({
        where : {emailUsuario}
     })
     if(!usuario){
        return res.status(200).render("./auth/login",{
            titulo : 'Login',
            csrfToken : req.csrfToken(),
            errores  : {msg : 'No encuentro el usuario 🤔'}
        })
     }


     //Verifico que el usuario si tenga la contraseña correcta. 
     if(!usuario.checkPassword(password)){
        return res.status(200).render("./auth/login",{
            titulo : 'Login',
            csrfToken : req.csrfToken(),
            errores  : {msg : 'la contraseña no es correcta 🚨'},
            usuario : {
                emailUsuario : emailUsuario,
            }
        })
     }


     //Inicio la sesion con jwt
    const tkn = generarJwt({id : usuario.idUsuario, name : usuario.nombreUsuario, rol : usuario.permisos});
    const urlRedireccion = redireccion(usuario.permisos);
     console.log(redireccion)
     return res.cookie('_token', tkn, {
         httpOnly : true,
         secure : process.env.COOKIE_SECURE === 'true',
         sameSite: 'strict',
         maxAge: 1000 * 60 * 60 * 8
     }).redirect(urlRedireccion)



}



export {
            adminLogin,
            registerLogin, 
            forgotLogin,
            registerLoginPost,
            loginUser
    }