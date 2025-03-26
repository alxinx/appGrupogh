import { Sequelize } from "sequelize";
import dotenv from "dotenv";
const db = new Sequelize(DB_NAME,DB_USER, DB_PASS, {
    host : DB_HOST,
    port : DB_PORT,
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
    minifyAliases : true
    
})

export default db;