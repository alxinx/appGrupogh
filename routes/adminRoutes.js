import express from "express";
import {registerValidation, loginValidation} from '../middlewares/fieldValidations.js';
import { dashboard} from "../controller/adminControllers.js"
const routes = express.Router();

routes.get("/", dashboard);

export default routes