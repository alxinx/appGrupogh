import express from "express";
import csrf from "csurf";
import dotenv from 'dotenv';
import multer from "multer";
import cookieParser from "cookie-parser";
import loginRoutes from "./routes/loginRoutes.js";
import db from "./config/bd.js"
dotenv.config();

const app = express();
const port = process.env.APP_PORT;

try {
    
    if(process.env.DB_SYNC === "true"){
        db.sync()
    }
    await db.authenticate();
} catch (error) {
    console.log(`No se pudo conectar a la base de datos ${error}`)
    
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use( express.static('public'));
app.set("view engine", "pug");
app.set("views", "./views");
//app.use(upload.any());
app.use (cookieParser());
app.use (csrf({ cookie : true}))

//Admin
//app.use("/admin", adminRoutes);
app.use("/", loginRoutes);





app.listen(port, ()=>{
    console.log(`this server run in ${process.env.APP_URL}:${port}`)
})