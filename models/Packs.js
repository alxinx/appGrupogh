import { DataTypes,  } from "sequelize";
import db from "../config/bd.js"
const Pack = db.define('PACKS', {
    idPack: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true // Identificador del bulto
    },
    idDosificacion: {
        type: DataTypes.UUID, // Llave foránea explícita
        allowNull: false
    },
    codigoEtiqueta: {
        type: DataTypes.STRING,
        unique: true, // Código único por bulto
        allowNull: false
    },
    numLote: {
        type: DataTypes.INTEGER, // Agrupa por configuración
        allowNull: false
    },
    tipo: {
        type: DataTypes.ENUM('ESTANDAR', 'RESIDUO'),
        defaultValue: 'ESTANDAR'
    },
    // EMPACADO   recién armado, en fábrica/bodega
    // TRASLADADO enviado a otra sede
    // DESEMPACADO abierto en tienda: su contenido pasó a stock suelto
    // VENDIDO    facturado entero en el POS, sin abrirse
    // ANULADO    rechazado al recibirlo (resolución de controversia)
    // SEPARADO / DESPACHADO están declarados de antes y hoy no los asigna nadie.
    estado: {
        type: DataTypes.ENUM('EMPACADO', 'SEPARADO', 'DESPACHADO', 'TRASLADADO', 'DESEMPACADO', 'ANULADO', 'VENDIDO'),
        defaultValue: 'EMPACADO'
    },
    contadorReimpresiones: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    }
},
{
    tableName: 'PACKS'
});


export default Pack;