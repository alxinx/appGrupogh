import { DataTypes } from "sequelize";
import db from "../config/bd.js";
import { uuidV7 } from "../helpers/uuidV7.js";

// Dónde entra y de dónde sale el dinero del negocio: cajas de efectivo, cuentas
// bancarias y billeteras virtuales.
//
// Reemplaza a la vieja tabla CAJAS, que se eliminó por no haberse usado nunca
// (seed/migracionEliminarCajas.js).
//
// No lleva `paranoid`: el borrado lógico acá es `estado`. Una caja no se elimina, se
// desactiva — así deja de aparecer para registrar movimientos pero su historial sigue
// siendo consultable, que es lo que pide el manejo de registros financieros.
const CajasYBancos = db.define('CAJAS_Y_BANCOS', {
    // UUID v7: el timestamp va en los primeros 48 bits, así que los ids se ordenan por
    // fecha de creación y las inserciones caen al final del índice primario en vez de
    // dispersarse como con v4.
    idCajaBanco: {
        type: DataTypes.UUID,
        defaultValue: () => uuidV7(),
        primaryKey: true,
        allowNull: false,
        unique: true
    },

    nombreCajaBanco: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        // El trim va en el setter y no en el controlador: así ninguna otra vía de escritura
        // (seed, migración, consola) puede colar " Bancolombia " como un nombre distinto.
        set(valor) {
            this.setDataValue('nombreCajaBanco', typeof valor === 'string' ? valor.trim() : valor);
        },
        validate: {
            notEmpty: { msg: 'El nombre no puede estar vacío.' },
            len: { args: [2, 50], msg: 'El nombre debe tener entre 2 y 50 caracteres.' }
        }
    },

    tipo: {
        type: DataTypes.ENUM('caja', 'banco', 'billetera'),
        allowNull: false,
        validate: {
            isIn: { args: [['caja', 'banco', 'billetera']], msg: 'Tipo inválido.' }
        }
    },

    // Número de cuenta, celular de la billetera o el código interno de la caja.
    // Es único, pero opcional: una caja de efectivo no tiene ninguna referencia.
    referencia: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
        // Vacío se guarda como NULL, nunca como ''. MySQL admite muchos NULL bajo un índice
        // único pero un solo '': sin esto, la segunda caja sin referencia sería rechazada.
        set(valor) {
            const limpio = typeof valor === 'string' ? valor.trim() : valor;
            this.setDataValue('referencia', limpio === '' || limpio === undefined ? null : limpio);
        },
        validate: {
            len: { args: [0, 50], msg: 'La referencia no puede superar los 50 caracteres.' }
        }
    },

    estado: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
}, {
    tableName: "CAJAS_Y_BANCOS",
    timestamps: true   // createdAt / updatedAt
});

export default CajasYBancos;
