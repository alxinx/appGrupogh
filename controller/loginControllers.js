import {validationResult } from "express-validator";
//import bcrypt from "bcrypt";
import {Usuarios} from '../models/index.js'
import { generarJwt, igualarTiempoBcrypt, OPCIONES_COOKIE_SESION, DURACION_SESION_MS } from '../helpers/genToken.js';
import { redireccion } from "../helpers/redireccion.js";
import { registrarFalloLogin, limpiarIntentosLogin, intentosRestantes, crearLimitador, clavesIpYCorreo, textoEspera } from "../middlewares/loginRateLimit.js";
import { solicitarRecuperacion, enlaceVigente, restablecerConToken, cambiarContrasena, LARGO_MINIMO } from "../helpers/contrasena.js";

const adminLogin = (req, res)=>{
    res.render("./auth/login", {
        pagina: "Login Page",
    })
}

const registerLogin = (req, res)=>{
    res.render("./auth/register", {
        pagina: "Register Pages",
    })
    
}

/** Pone la cookie de sesión. Lo usan el login, restablecer y cambiar contraseña. */
const iniciarSesion = (res, usuario) => {
    const tkn = generarJwt({ id: usuario.idUsuario, name: usuario.nombreUsuario, rol: usuario.permisos });
    return res.cookie('_token', tkn, { ...OPCIONES_COOKIE_SESION, maxAge: DURACION_SESION_MS });
};

// ─── Olvidé mi contraseña ───────────────────────────────────────────────────────────
// Tope propio, distinto al del login: cada pedido manda un correo real. Cuenta TODOS los
// pedidos (no solo los fallidos) por IP y por correo.
const limitadorRecuperar = crearLimitador({ max: 3, ventanaMs: 15 * 60 * 1000, claves: clavesIpYCorreo });

const MENSAJE_ENVIADO = 'Si ese correo tiene una cuenta, te enviamos un enlace para crear una contraseña nueva. Revisa tu bandeja de entrada y la de spam.';

const forgotLogin = (req, res)=>{
    res.render("./auth/forgot", { pagina: "Recuperar contraseña" });
}

const forgotPost = async (req, res) => {
    const emailUsuario = String(req.body?.emailUsuario || '').trim().toLowerCase();
    const pintar = (status, extra) => res.status(status).render('./auth/forgot', { pagina: 'Recuperar contraseña', emailUsuario, ...extra });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailUsuario) || emailUsuario.length > 254) {
        return pintar(400, { error: 'Escribe un correo válido.' });
    }
    const espera = limitadorRecuperar.segundosBloqueo(req);
    if (espera) {
        console.warn(`[recuperar] bloqueado por exceso de pedidos · ip=${req.ip} · correo=${emailUsuario}`);
        res.set('Retry-After', String(espera));
        return pintar(429, { error: `Ya pediste varios enlaces. Vuelve a intentar en ${textoEspera(espera)}.` });
    }
    limitadorRecuperar.registrar(req);

    try {
        await solicitarRecuperacion({ correo: emailUsuario, ip: req.ip });
    } catch (e) {
        // El mismo mensaje que cuando sale bien: un error interno no puede delatar si el
        // correo tiene cuenta. El detalle queda en el log.
        console.error('[recuperar] error:', e);
    }
    return pintar(200, { enviado: MENSAJE_ENVIADO });
};

// ─── Restablecer con el enlace del correo ──────────────────────────────────────────
// El token va en la ruta: no se manda en el Referer a otros sitios (no-referrer acá, y
// strict-origin-when-cross-origin en todo lo demás, middlewares/cabecerasSeguridad.js).
const pintarRestablecer = (res, status, datos) => {
    res.set('Referrer-Policy', 'no-referrer');
    return res.status(status).render('./auth/restablecer', { pagina: 'Nueva contraseña', minimo: LARGO_MINIMO, ...datos });
};

const restablecerGet = async (req, res) => {
    const enlace = await enlaceVigente(req.params.token);
    if (!enlace) return pintarRestablecer(res, 410, { vencido: true });
    return pintarRestablecer(res, 200, { token: req.params.token, emailUsuario: enlace.usuario.emailUsuario });
};

const restablecerPost = async (req, res) => {
    const { token } = req.params;
    const r = await restablecerConToken({ token, nueva: req.body?.password, confirmacion: req.body?.confirmacion, ip: req.ip });
    if (r.vencido) return pintarRestablecer(res, 410, { vencido: true });
    if (r.error) {
        const enlace = await enlaceVigente(token);
        return pintarRestablecer(res, 400, { token, emailUsuario: enlace?.usuario.emailUsuario, error: r.error });
    }
    console.info(`[recuperar] contraseña restablecida · ip=${req.ip} · correo=${r.usuario.emailUsuario}`);
    // Entra de una vez: acaba de demostrar que es dueño del correo.
    const destino = redireccion(r.usuario.permisos);
    if (!destino) return res.redirect('/');
    return iniciarSesion(res, r.usuario).redirect(destino);
};

// ─── Cambiar contraseña con la sesión abierta ──────────────────────────────────────
// Freno a quien prueba contraseñas actuales con una sesión robada: por usuario.
const limitadorCambio = crearLimitador({ max: 5, ventanaMs: 15 * 60 * 1000, claves: (req) => [`usuario:${req.usuario?.idUsuario}`] });

const pintarCambio = (req, res, status, datos) => res.status(status).render('./auth/cambiarContrasena', {
    pagina: 'Cambiar contraseña', minimo: LARGO_MINIMO, volver: redireccion(req.usuario?.permisos) || '/', ...datos
});

const cambiarContrasenaGet = (req, res) => pintarCambio(req, res, 200, {});

const cambiarContrasenaPost = async (req, res) => {
    const espera = limitadorCambio.segundosBloqueo(req);
    if (espera) {
        res.set('Retry-After', String(espera));
        return pintarCambio(req, res, 429, { error: `Demasiados intentos. Vuelve a intentar en ${textoEspera(espera)}.` });
    }
    const r = await cambiarContrasena({
        idUsuario: req.usuario.idUsuario, actual: req.body?.actual, nueva: req.body?.password, confirmacion: req.body?.confirmacion
    });
    if (r.error) {
        if (r.actualMal) limitadorCambio.registrar(req);
        return pintarCambio(req, res, 400, { error: r.error });
    }
    limitadorCambio.limpiar(req);
    console.info(`[cuenta] contraseña cambiada · ip=${req.ip} · correo=${r.usuario.emailUsuario}`);
    // Las demás sesiones de esta persona se cierran solas (passwordCambiadoEn); ésta sigue
    // con un token nuevo.
    iniciarSesion(res, r.usuario);
    return pintarCambio(req, res, 200, { exito: true });
};


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
            errores : {
                msg : 'El usuario ya existe 🧐'
            }
        })
    }
    //ingreso el usuario
    await Usuarios.create({
        nombreUsuario,
        apellidoUsuario,
        emailUsuario,
        password,
        permisos : 'ADMIN'
    })

    return res.status(200).render("./auth/register",{
            pagina: "Registro de Admins",
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
     // Un correo inexistente también paga una comparación de bcrypt. Sin esto, la respuesta
     // de "no existe" llegaba en ~2 ms y la de "contraseña mala" en ~250 ms (costo 12): el
     // mensaje era el mismo, pero el cronómetro delataba qué correos tienen cuenta.
     if(!usuario) {
        await igualarTiempoBcrypt(password);
        return credencialesInvalidas('usuario inexistente');
     }

     //Verifico que el usuario si tenga la contraseña correcta.
     if(!(await usuario.checkPassword(password))) return credencialesInvalidas('contraseña incorrecta');

     // Un rol sin área (no debería existir: es un ENUM) no puede terminar en redirect(null).
     const urlRedireccion = redireccion(usuario.permisos);
     if (!urlRedireccion) return credencialesInvalidas(`rol sin área: ${usuario.permisos}`);

     // Credenciales correctas: se limpian los contadores para que un error anterior
     // no siga penalizando a este usuario ni a su IP.
     limpiarIntentosLogin(req);
     console.info(`[login] sesión iniciada · ip=${req.ip} · correo=${usuario.emailUsuario} · rol=${usuario.permisos}`);


     return iniciarSesion(res, usuario).redirect(urlRedireccion);


}


const logout = (req, res) => {
    // Mismas opciones con las que se creó: algunos navegadores no borran una cookie
    // `secure`/`sameSite` si el Set-Cookie de borrado no las repite.
    return res.clearCookie('_token', OPCIONES_COOKIE_SESION).redirect('/');

}


export {
            adminLogin,
            registerLogin, 
            forgotLogin,
            forgotPost,
            restablecerGet,
            restablecerPost,
            cambiarContrasenaGet,
            cambiarContrasenaPost,
            registerLoginPost,
            loginUser,
            logout
    }