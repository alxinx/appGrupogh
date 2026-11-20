import { verificarJwt, OPCIONES_COOKIE_SESION } from '../helpers/genToken.js';
import dotenv from "dotenv"
import {Usuarios} from '../models/index.js';
import { redireccion } from '../helpers/redireccion.js';
dotenv.config();

const rutaProtegida = async (req, res, next)=>{
   
    const token = req.cookies?._token //Capturo el token en la cookie
    
    if(!token){
        //return res.status(401).json({ error: 'No autorizado' });
        return res.redirect('/');
    }
    try {
       
        const decoded = verificarJwt(token);
        // Excluye el hash de bcrypt: este usuario queda colgado como req.usuario/res.locals.usuario
        // en TODA la sesión autenticada (controladores y vistas). Nada de lo que ya pasó por acá
        // necesita el hash — la contraseña se validó en el login, no en cada request.
        const usuario = await Usuarios.findByPk(decoded.id.id || decoded.id, {
            attributes: { exclude: ['password'] }
        });
        
        if (!usuario){
            return res.redirect('/');
        }

        // Cambió la contraseña después de emitirse este token (la cambió o la recuperó,
        // o la reinició el panel): la sesión vieja ya no vale. iat va en segundos, por eso
        // se compara contra el segundo entero del cambio — el token que se emite en el
        // mismo acto del cambio (loginControllers.iniciarSesion) sigue valiendo.
        if (usuario.passwordCambiadoEn && decoded.iat < Math.floor(new Date(usuario.passwordCambiadoEn).getTime() / 1000)) {
            res.clearCookie('_token', OPCIONES_COOKIE_SESION);
            return res.redirect('/');
        }

        // Disponibles para controladores y vistas
        req.usuario = usuario;
        req.rol = usuario.permisos;
        res.locals.usuario = usuario;
        res.set('Cache-Control', 'no-store');
        return next(); // Pasa al siguiente middleware

    } catch (e) {
        // Token vencido o adulterado, o la consulta del usuario falló. Antes este catch solo
        // logueaba y no respondía: la petición quedaba colgada hasta que el navegador se
        // rendía, y un fetch del panel (validar el código de empleado, por ejemplo) se
        // quedaba esperando para siempre.
        console.error('Error en protegerRuta:', e.message);
        res.clearCookie('_token', OPCIONES_COOKIE_SESION);
        return res.redirect('/');
      }
}

const verificarRol = (...rolesPermitidos) => {
    return (req, res, next) => {
        // req.usuario y req.rol ya existen gracias a 'rutaProtegida'
        
        if (!rolesPermitidos.includes(req.rol)) {
            // Se rebota al área que le corresponde a su rol (la misma que usa el login). Si
            // esa área es justo la que lo está rechazando, o el rol no tiene área, rebotar
            // de nuevo sería un bucle de redirecciones: se cierra la sesión y va al login.
            const destino = redireccion(req.rol);
            if (destino && destino !== req.baseUrl) return res.redirect(destino);

            console.warn(`[auth] rol sin área accesible · rol=${req.rol} · ruta=${req.originalUrl}`);
            res.clearCookie('_token', OPCIONES_COOKIE_SESION);
            return res.redirect('/');
        }
        
        next(); // Tiene el rol correcto, pase.
    }
}

export {
    rutaProtegida,
    verificarRol
}

