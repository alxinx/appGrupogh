import {validationResult } from "express-validator";
//import bcrypt from "bcrypt";
import {Usuarios} from '../models/index.js'
import { generarId, generarJwt } from '../helpers/genToken.js'
import { redireccion } from "../helpers/redireccion.js";


const dashboardStores = async (req, res)=>{

    return res.status(201).render('./tienda/layout', {
        pagina: `Panel principal de ${req.usuario.nombreUsuario}`,
        csrfToken : req.csrfToken(),
        currentPath: req.path
        
    })}

export {
    dashboardStores
}