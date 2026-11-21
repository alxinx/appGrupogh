import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Un enlace de "Olvidé mi contraseña". Solo se guarda el SHA-256 del token: el token en sí
// viaja únicamente en el correo, así que quien lea la base no puede usar un enlace vigente.
// Un enlace sirve una vez (estado 'usado'), vence en minutos, y pedir uno nuevo anula los
// anteriores del mismo usuario. Lo escribe solo helpers/contrasena.js.
// Tabla creada por seed/migracionRecuperarContrasena.js.
const RecuperacionContrasena = db.define('USUARIOS_RECUPERACION', {
    idRecuperacion: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    idUsuario:      { type: DataTypes.UUID, allowNull: false },
    tokenHash:      { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    estado:         { type: DataTypes.ENUM('pendiente', 'usado', 'anulado'), allowNull: false, defaultValue: 'pendiente' },
    expiraEn:       { type: DataTypes.DATE, allowNull: false },
    usadoEn:        { type: DataTypes.DATE, allowNull: true },
    ipSolicitud:    { type: DataTypes.STRING(64), allowNull: true },
    ipUso:          { type: DataTypes.STRING(64), allowNull: true }
}, {
    tableName: 'USUARIOS_RECUPERACION',
    timestamps: true
});

export default RecuperacionContrasena;
