import jwt from "jsonwebtoken"
import dotenv from "dotenv"
import {Usuarios} from '../models/index.js';
dotenv.config();

const rutaProtegida = async (req, res, next)=>{
   
    const token = req.cookies?._token //Capturo el token en la cookie
    
    if(!token){
        //return res.status(401).json({ error: 'No autorizado' });
        return res.redirect('/');
    }
    try {
       
        const decoded = jwt.verify(token, process.env.APP_PRIVATEKEY);
        const usuario = await Usuarios.findByPk(decoded.id.id || decoded.id);
        
        if (!usuario){
            return res.redirect('/');
        }

        // Disponibles para controladores y vistas
        req.usuario = usuario;
        req.rol = usuario.permisos;
        res.locals.usuario = usuario;
        res.set('Cache-Control', 'no-store');
        return next(); // Pasa al siguiente middleware

    } catch (e) {
        console.error('Error en protegerRuta:', e.message);
       // return res.redirect('/admin');
      }
}

const verificarRol = (...rolesPermitidos) => {
    return (req, res, next) => {
        // req.usuario y req.rol ya existen gracias a 'rutaProtegida'
        
        if (!rolesPermitidos.includes(req.rol)) {
            // LÓGICA DE REBOTE INTELIGENTE
            
            // Si es TIENDA intentando entrar a ADMIN -> Mándalo a su tienda
            if (req.rol === 'STORE' || req.rol === 'EMPLOYER') {
                return res.redirect('/store/');
            }
            
            // Si es ADMIN intentando entrar a TIENDA (Opcional, a veces los admin pueden ver todo)
            if (req.rol === 'ADMIN') {
               // Puedes dejarlo pasar o mandarlo al admin dashboard
               // return res.redirect('/admin/dashboard'); 
            }

            // Si no cuadra nada, al home o login
            return res.redirect('/');
        }
        
        next(); // Tiene el rol correcto, pase.
    }
}

export {
    rutaProtegida,
    verificarRol
}

