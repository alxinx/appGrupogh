import express from "express";
import {registerValidation, loginValidation} from '../middlewares/fieldValidations.js';
import { dashboardStores, getTraslados } from '../controller/storeControllers.js'

const routes = express.Router();


routes.get("/", dashboardStores);
routes.get("/traslados/get", getTraslados)



export default routes