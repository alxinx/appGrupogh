import { DataTypes, UUIDV4 } from "sequelize";
import bcrypt from "bcrypt";
import db from "../config/bd.js"

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
        allowNull : false,
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
            const salt = await bcrypt.genSalt(10);
            usuario.password = await bcrypt.hash(usuario.password, salt)
        },
        beforeUpdate: async (usuario) => {
            if (usuario.changed('password')) {
                const salt = await bcrypt.genSalt(10);
                usuario.password = await bcrypt.hash(usuario.password, salt);
            }
}
    }

}

)
//PROTOTYPES FOR PASSWORD
Usuarios.prototype.checkPassword = function(password){
    return bcrypt.compareSync(password, this.password);
}

export default Usuarios;