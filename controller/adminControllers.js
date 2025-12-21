import {validationResult } from "express-validator";
import {Usuarios} from '../models/index.js'
import { generarId, generarJwt } from '../helpers/genToken.js'
import { redireccion } from "../helpers/redireccion.js";


const dashboard = async (req, res)=>{

    return res.status(201).render('./administrador/layout', {
        pagina: "Pagina Principal",
        csrfToken : req.csrfToken(),
        currentPath: req.path
        
    })
}

export {
    dashboard
}