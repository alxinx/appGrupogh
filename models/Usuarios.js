import { DataTypes, UUIDV4 } from "sequelize";
import bcrypt from "bcrypt";
import db from "../config/bd.js"

// Factor de costo del hash. Las contraseñas ya guardadas con costo 10 siguen validando
// sin tocar nada: bcrypt lleva el costo dentro del propio hash y compare() lo lee de ahí.
// Solo las contraseñas nuevas o cambiadas se guardan con el costo de acá.
const COSTO_BCRYPT = 12;

const Usuarios =  db.define('USUARIOS', {
    idUsuario : {
        type : DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey : true,
    },
    nombreUsuario : {
        type : DataTypes.STRING,
        allowNull : false,
    },
    apellidoUsuario : {
        type : DataTypes.STRING,
    },
    emailUsuario : {
        type : DataTypes.STRING,
        unique : true,
        validate : {
            isEmail : true
        },
        allowNull : false,
    },
    password : {
        type : DataTypes.STRING,
        allowNull : true,
    },
    permisos : {
        type : DataTypes.ENUM('ADMIN', 'STORE', 'EMPLOYER'),
        defaultValue : 'ADMIN'
    }
},
{
    timestamps : true,
    tableName : 'USUARIOS',
    hooks : {
        beforeCreate : async (usuario)=>{
            const salt = await bcrypt.genSalt(COSTO_BCRYPT);
            usuario.password = await bcrypt.hash(usuario.password, salt)
        },
        beforeUpdate: async (usuario) => {
            if (usuario.changed('password')) {
                const salt = await bcrypt.genSalt(COSTO_BCRYPT);
                usuario.password = await bcrypt.hash(usuario.password, salt);
            }
}
    }

}

)
//PROTOTYPES FOR PASSWORD
// Asíncrono a propósito: compareSync bloquea el event loop entre 60 y 100 ms por intento,
// así que bastaba con martillar el login para dejar sin servicio al POS y a la tienda.
Usuarios.prototype.checkPassword = async function(password){
    if (!this.password || this.password === '0') return false; // cuenta bloqueada
    return bcrypt.compare(password, this.password);
}

export default Usuarios;