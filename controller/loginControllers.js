import {validationResult } from "express-validator";
//import bcrypt from "bcrypt";
import {Usuarios} from '../models/index.js'
import { generarId, generarJwt } from '../helpers/genToken.js'
import { redireccion } from "../helpers/redireccion.js";
import { registrarFalloLogin, limpiarIntentosLogin, intentosRestantes } from "../middlewares/loginRateLimit.js";

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

    // Este endpoint crea usuarios con permisos ADMIN. Queda cerrado salvo que se habilite
    // explícitamente con REGISTRO_ABIERTO=true, que es algo que solo tiene sentido en local
    // para crear el primer administrador.
    if (process.env.REGISTRO_ABIERTO !== 'true') {
        console.warn(`[login] intento de registro con el alta cerrada · ip=${req.ip}`);
        return res.status(404).send('No encontrado');
    }

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


     // Un solo mensaje para "no existe" y "contraseña incorrecta". Distinguirlos permitía
     // enumerar qué correos tienen cuenta, que es el paso previo a un ataque de fuerza bruta.
     const credencialesInvalidas = (motivo) => {
        registrarFalloLogin(req);
        const restantes = intentosRestantes(req);
        console.warn(`[login] intento fallido · ip=${req.ip} · correo=${String(emailUsuario || '').trim().toLowerCase()} · motivo=${motivo} · restantes=${restantes}`);

        return res.status(401).render("./auth/login",{
            titulo : 'Login',
            csrfToken : req.csrfToken(),
            errores  : {
                msg : restantes <= 2 && restantes > 0
                    ? `Correo o contraseña incorrectos. Te queda${restantes !== 1 ? 'n' : ''} ${restantes} intento${restantes !== 1 ? 's' : ''}.`
                    : 'Correo o contraseña incorrectos.'
            },
            usuario : {
                emailUsuario : emailUsuario,
            }
        })
     }

     //Verifico que exista el usuario
     const usuario = await Usuarios.findOne({
        where : {emailUsuario}
     })
     if(!usuario) return credencialesInvalidas('usuario inexistente');

     //Verifico que el usuario si tenga la contraseña correcta.
     if(!(await usuario.checkPassword(password))) return credencialesInvalidas('contraseña incorrecta');

     // Credenciales correctas: se limpian los contadores para que un error anterior
     // no siga penalizando a este usuario ni a su IP.
     limpiarIntentosLogin(req);
     console.info(`[login] sesión iniciada · ip=${req.ip} · correo=${usuario.emailUsuario} · rol=${usuario.permisos}`);


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


const logout = (req, res) => {
    return res.clearCookie('_token').redirect('/');

}



export {
            adminLogin,
            registerLogin, 
            forgotLogin,
            registerLoginPost,
            loginUser,
            logout
    }