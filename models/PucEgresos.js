import { DataTypes } from "sequelize";
import db from "../config/bd.js";

// Plan Único de Cuentas para clasificar los egresos: cuentas y, colgando de ellas, sus
// subcuentas. Es un árbol de un solo nivel de profundidad por fila: `padre` apunta al `id`
// de la cuenta de la que cuelga una subcuenta, y vale 0 en una cuenta raíz.
//
// Por ese 0 `padre` no lleva llave foránea: no hay ninguna fila con id 0 a la que apuntar.
// La relación existe solo del lado de Sequelize (ver models/index.js, con constraints: false).
//
// La tabla se crea con seed/migracionPucEgresos.js (npm run db:migrar-puc-egresos).
const PucEgresos = db.define('PUC_EGRESOS', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    // Código del PUC colombiano: 4 dígitos una cuenta (5105), 6 una subcuenta (510506).
    // Es lo único que identifica una cuenta sin ambigüedad; el nombre se puede repetir
    // entre cuentas distintas.
    codigo: {
        type: DataTypes.STRING(6),
        allowNull: false,
        unique: true
    },
    nombre: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    tipo: {
        type: DataTypes.ENUM('cuenta', 'subcuenta'),
        allowNull: false
    },
    padre: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    naturaleza: {
        type: DataTypes.ENUM('debito', 'credito'),
        allowNull: false
    },
    // Una cuenta en desuso se desactiva, no se borra: los egresos ya clasificados en ella
    // tienen que seguir apuntando a algo.
    activo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
}, {
    tableName: "PUC_EGRESOS",
    timestamps: false
});

export default PucEgresos;
