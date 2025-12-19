import express from "express";
import {registerValidation, loginValidation} from '../middlewares/fieldValidations.js';
import { dashboardStores } from '../controller/storeControllers.js'

const routes = express.Router();


routes.get("/", dashboardStores);



export default routes