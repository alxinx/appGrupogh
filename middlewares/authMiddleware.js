import jwt from "jsonwebtoken"
import dotenv from "dotenv"
import {Usuarios} from '../models/index.js';
dotenv.config();
const rutaProtegida = async (req, res, next)=>{
    const token = req.cookies?._token //Capturo el token en la cookie
    if(!token){
        return res.status(401).json({ error: 'No autorizado' });
    }
    try {
        const decoded = jwt.verify(token, process.env.APP_PRIVATEKEY);
        //
        const usuario = await Usuarios.findByPk(decoded.id.id);
        console.log(usuario)
        if (!usuario){
            return res.redirect('/');
        }

        // Disponibles para controladores y vistas
        req.admin = usuario.nombreUsuario;
        res.locals.usuario = usuario.nombreUsuario;
        res.set('Cache-Control', 'no-store');
        next();

    } catch (e) {
        console.error('Error en protegerRuta:', e.message);
       // return res.redirect('/admin');
      }

}


export {
    rutaProtegida
}