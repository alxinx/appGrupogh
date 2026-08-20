import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const CajaTienda = db.define('CAJA_TIENDA', {
    idCajaTienda: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        unique: true,
        allowNull: false
    },
    codigo : {
        type : DataTypes.STRING(100),
        defaultValue : null,
        unique : true,

    },
    idEmpleadoApertura: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'EMPLEADOS',
            key: 'idEmpleado'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
    },
    // Nulo mientras la caja está abierta: todavía no se sabe quién la va a cerrar, y el
    // turno lo puede terminar alguien distinto de quien lo abrió. Antes era NOT NULL y la
    // apertura lo llenaba con el mismo empleado como relleno, así que el campo no
    // distinguía "todavía no cerró" de "cerró esta persona" — mismo criterio que
    // `idEmpleadoRecibe` en un traslado en tránsito.
    idEmpleadoCierre: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'EMPLEADOS',
            key: 'idEmpleado'
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
    fechaApertura: {
        type: DataTypes.DATE,
        allowNull: true
    },
    fechaCierre: {
        type: DataTypes.DATE,
        allowNull: true
    },
    cajaMenor: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    cajaMenorRegistrada: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasTotales: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasTotalesRegistradas: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    egresosTotales: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    egresosTotalesRegistrados: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasCredito: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasCreditoRegistradas: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasEfectivo: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasEfectivoRegistradas: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasMediosElectronicos: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    ventasMediosElectronicosRegistradas: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
    },
    estado: {
        type: DataTypes.ENUM('abierto', 'cerrado', 'auditoria'),
        allowNull: false,
        defaultValue: 'abierto'
    },

    // Desde cuándo esta caja está trabada en 'auditoria' — el estado en el que se cuenta
    // el cajón y el POS no factura.
    //
    // El candado se soltaba solo si el navegador alcanzaba a avisar al cerrarse. Si el
    // equipo se apagaba o se caía la red, la caja quedaba trabada indefinidamente y la
    // tienda sin poder facturar, sin nadie que supiera por qué.
    //
    // Con esta marca el candado expira: la pantalla del cuadre la refresca mientras está
    // viva, y si deja de hacerlo, la primera petición que se tope con la caja la libera.
    // Nulo cuando la caja no está en cuadre.
    cuadreDesde: {
        type: DataTypes.DATE,
        allowNull: true
    },
    nota: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    permite_factura_extemporanea :{
        type : DataTypes.BOOLEAN,
        defaultValue : false
    },
    cupo_facturas_extemporaneas : {
        type : DataTypes.INTEGER,
        defaultValue : 0
    }
}, {
    tableName: 'CAJA_TIENDA',
    timestamps: true
});

export default CajaTienda;
