import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Entidades = db.define('ENTIDADES', {
    idEntidad: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        unique: true,
        allowNull: false
    },
    nombreEntidad: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    tipoEntidad: {
        type: DataTypes.ENUM('Banco', 'Billetera Virtual', 'Entidad Crediticia', 'Tarjeta Credito'),
        allowNull: false
    },
    recibirPagosPos: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    }
}, {
    tableName: 'ENTIDADES',
    timestamps: true,
    createdAt: 'create_at',
    updatedAt: false,
    hooks: {
        afterSync: async () => {
            const count = await Entidades.count();
            if (count === 0) {
                await Entidades.bulkCreate([
                    { nombreEntidad: 'Bancolombia',  tipoEntidad: 'Banco' },
                    { nombreEntidad: 'Nequi',        tipoEntidad: 'Billetera Virtual' },
                    { nombreEntidad: 'Davivienda',   tipoEntidad: 'Banco' }
                ]);
            }
        }
    }
});

export default Entidades;
