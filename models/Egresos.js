import { DataTypes } from "sequelize";
import db from "../config/bd.js"

const Egresos = db.define('EGRESOS', {
    idEgreso: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    idPuntoDeVenta: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PUNTO_DE_VENTA', key: 'idPuntoDeVenta' }
    },
    idCajaTienda :{
        type : DataTypes.INTEGER,
        allowNull : true,
        references: { model: 'CAJA_TIENDA', key: 'idCajaTienda' }
    },
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' }
    },
    valorEgreso: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    // De dónde salió la plata. Sin esto, todo egreso se descontaba del cajón: pagarle a
    // un proveedor por transferencia dejaba mal el efectivo esperado de la tienda.
    // Por defecto 'Efectivo' porque es lo que se asumía hasta ahora — los registros
    // viejos quedan como estaban.
    metodoPago: {
        type: DataTypes.ENUM('Efectivo', 'Electronico'),
        allowNull: false,
        defaultValue: 'Efectivo'
    },

    // Con qué cuenta se pagó, cuando fue electrónico. Es la misma tabla que usan los
    // pagos de las facturas, para que el cuadre hable de las mismas entidades.
    idEntidad: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'ENTIDADES', key: 'idEntidad' }
    },

    referencia: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    descripcion: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    estado: {
        type: DataTypes.ENUM('pendiente', 'liquidada'),
        allowNull: false,
        defaultValue: 'pendiente'
    },

    // Distingue un gasto real de un traslado de efectivo hacia una caja o banco. Sin
    // esto, consignar la venta del día aparecería en los reportes como si el negocio
    // hubiera gastado esa plata.
    tipo: {
        type: DataTypes.ENUM('Egreso', 'Traslado'),
        allowNull: false,
        defaultValue: 'Egreso',
        validate: {
            isIn: { args: [['Egreso', 'Traslado']], msg: 'El tipo debe ser Egreso o Traslado.' }
        }
    }
}, {
    tableName: "EGRESOS",
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: false
});

export default Egresos
