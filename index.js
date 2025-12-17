import express from "express";
import adminRoutes from "./routes/adminRoutes.js";
const app = express();
const port = 9091;

app.set("view engine", "pug");
app.set("views", "./views/");

app.use(express.static("public"))

//Admin
app.use("/admin", adminRoutes);
app.use("/", adminRoutes);





app.listen(port, ()=>{
    console.log(`this server run in http://localhost:${port}`)
})