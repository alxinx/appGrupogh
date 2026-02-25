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
        allowNull: false
    },
    idUsuario: {
        type: DataTypes.UUID,
        allowNull: true, // Solo si es administrativo o vendedor
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
    fechaNacimiento: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    departamento: {
        type: DataTypes.STRING(5),
        allowNull: false,
        references: {
            model: 'DEPARTAMENTOS', // Asegúrate que el nombre de la tabla sea exacto
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT' // Corregido: antes tenías doble onUpdate
    },
    ciudad: {
        type: DataTypes.STRING(5),
        allowNull: false,
        references: {
            model: 'MUNICIPIOS', // Asegúrate que el nombre de la tabla sea exacto
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    direccionResidencia: DataTypes.STRING(100),
    contactoEmergencia: DataTypes.STRING(100),
    telefonoEmergencia: DataTypes.STRING(100),
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
        type: DataTypes.STRING(5), // String(5) para conservar ceros a la izquierda como "00045"
        allowNull: false,
        unique : true,
    },
    imagen: {
        type: DataTypes.STRING(100),
        allowNull: true
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