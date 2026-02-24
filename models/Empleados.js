import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Empleados = db.define('EMPLEADOS', {
    idEmpleado: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4, // UUIDV4 es el generador, UUID es el tipo
        primaryKey: true
    },
    idPuntoDeVenta: {
        type: DataTypes.UUID,
        allowNull: false // Todo empleado debe pertenecer a una sede
    },
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: true, // Tu lógica: Solo si tiene acceso al sistema
        defaultValue: null
    },
    TipoDocumento: {
        type: DataTypes.ENUM('CC', 'CE', 'TI', 'NIT', 'PP'),
        defaultValue: 'CC'
    },
    NumeroDocumento: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    PrimerNombre: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    OtrosNombres: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    PrimerApellido: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    SegundoApellido: {
        type: DataTypes.STRING(100),
        allowNull: true, // Es mejor dejarlo true por si algún empleado solo tiene un apellido
    },
    telefonoContacto: {
        type: DataTypes.STRING(10),
        allowNull: true
    },
    emailEmpleado: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isEmail: { msg: "Debe ser un correo electrónico válido" }
        }
    },
    fechaIngreso: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    tipoContrato: {
        type: DataTypes.ENUM('1', '2', '3', '4', '5', '6'),
        defaultValue: '1'
    },
    cargo: {
        type: DataTypes.ENUM('vendedor', 'bodega', 'administrativo', 'operario', 'otro'),
        defaultValue: 'otro'
    },
    salarioBase: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
    },
    comisiones: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    codigoEmpleado: {
        type: DataTypes.STRING(4), // String(4) para conservar ceros a la izquierda como "0045"
        allowNull: false
    },
    estado: {
        type: DataTypes.ENUM('activo', 'suspendido', 'despedido', 'vacaciones', 'enfermedad', 'licencia', 'otro'),
        defaultValue: 'activo'
    }
}, {
    tableName: "EMPLEADOS",
    timestamps: true,
    paranoid: true // Borrado lógico para auditoría
});

export default Empleados;