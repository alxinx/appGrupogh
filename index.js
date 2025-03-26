import express from "express";
import adminRoutes from "./routes/adminRoutes.js";
const app = express();
const port = 9090;

app.set("view engine", "pug");
app.set("viçews", "./view/");

app.use(express.static("/public"))





app.listen(port, ()=>{
    console.log(`this server run in http://localhost:${port}`)
})