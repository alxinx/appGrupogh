import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const PuntosDeVenta = db.define('PUNTO_DE_VENTA', {
    idPuntoDeVenta: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    tipo: {
        type: DataTypes.ENUM('Punto de venta', 'Bodega', 'Transito'),
        allowNull: false
    },
    razonSocial: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: { msg: "La razón social no puede ir vacia." }
        }
    },
    nombreComercial: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: { msg: "El nombre comercial no puede ir vacio." }
        }
    },
    direccionPrincipal: {
        type: DataTypes.STRING(255), // Especificado para coincidir con tu SQL
        allowNull: false,
        validate: {
            notEmpty: { msg: "La dirección comercial no puede ir vacia." }
        }
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
    telefono: DataTypes.STRING(255),
    activa: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    taxId: {
        type: DataTypes.STRING(20),
        allowNull: true,
        unique: true
    },
    DV: {
        type: DataTypes.STRING(1),
        allowNull: true,
        validate: {
            isNumeric: true,
            len: [1, 1]
        }
    },
    prefijo: DataTypes.STRING(255),
    resolucionFacturacion: {
        type: DataTypes.STRING(255),
    },
    emailRut: {
        type: DataTypes.STRING(255),
        validate: {
            isEmail: true
        }
    },
    footerBill: DataTypes.TEXT
},
{
    tableName: "PUNTO_DE_VENTA",
    timestamps: true,
    hooks: {
        beforeSave: (punto) => {
            if (punto.razonSocial) punto.razonSocial = punto.razonSocial.trim();
            if (punto.nombreComercial) punto.nombreComercial = punto.nombreComercial.trim();
        }
    }
});

export default PuntosDeVenta;