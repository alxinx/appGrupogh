import { Sequelize } from "sequelize";
import dotenv from "dotenv";
const db = new Sequelize(process.env.DB_NAME,process.env.DB_USER, process.env.DB_PASS, {
    host : process.env.DB_HOST,
    port : process.env.DB_PORT,
    dialect : "mysql",
    define : {
        timestamps : true,
    },
    pool : {
        min : 1,
        max : 0,
        acquire : 30000,
        idle : 10000,
    },
    logging : false,
    minifyAliases : true,
    
})

export default db;