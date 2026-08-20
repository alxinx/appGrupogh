import { DataTypes, ENUM } from "sequelize";
import db from "../config/bd.js";

const FacturaClientes = db.define('FACTURA_CLIENTES', {
    idFacturaCliente: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    idCliente: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'CLIENTES',
            key: 'idCliente'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idRegimenFacturacion: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'REGIMEN_FACTURACION',
            key: 'idRegimenFacturacion'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idPuntoDeVenta: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'PUNTO_DE_VENTA',
            key: 'idPuntoDeVenta'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    idEmpleado: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'EMPLEADOS',
            key: 'idEmpleado'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
    },
    cufe: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    qr_code: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    tipoDocumento: {
        type: DataTypes.STRING(2),
        allowNull: false,
        comment: 'FV=Factura venta, NC=Nota crédito, ND=Nota débito, etc.'
    },
    prefijo: {
        type: DataTypes.STRING(10),
        allowNull: true
    },
    numeroFactura: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    fechaEmision: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    fechaVencimiento: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    horaEmision: {
        type: DataTypes.TIME,
        allowNull: true
    },
    estado :{
        type : ENUM('pendiente', 'liquidada'),
        defaultValue : 'pendiente'
    },

    // La factura fue marcada como OF por el punto de venta.
    //
    // Las marcadas salen en su propia hoja del informe de facturación de la tienda, con
    // los datos tributarios del cliente abiertos en columnas. Booleano y no un ENUM
    // porque no hay un tercer estado: está marcada o no lo está.
    //
    // El nombre va en mayúsculas contra la convención `camelCase` del resto: es una sigla,
    // y `of` en minúscula se confunde con la palabra inglesa al leer el código.
    OF: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    }
}, {
    tableName: 'FACTURA_CLIENTES',
    timestamps: true
});

export default FacturaClientes;
