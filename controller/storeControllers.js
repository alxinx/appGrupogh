import {validationResult } from "express-validator";
//import bcrypt from "bcrypt";
import {Usuarios} from '../models/index.js'
import { generarId, generarJwt } from '../helpers/genToken.js'
import { redireccion } from "../helpers/redireccion.js";


const dashboardStores = async (req, res)=>{

    console.log('Estoy en dashboar del STORE')
    res.send('Hola  TIENDA')
}

export {
    dashboardStores
}