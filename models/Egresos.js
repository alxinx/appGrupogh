import { DataTypes } from "sequelize";
import db from "../config/bd.js"
import { validarDescripcionEgreso } from "../helpers/descripcionEgreso.js";

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

    // A qué caja o cuenta propia se envió el efectivo, cuando el registro es un traslado.
    // No se reutiliza `idEntidad`: ENTIDADES son los medios con los que la tienda COBRA,
    // y una consignación no va a un medio de cobro sino a una cuenta del negocio.
    idCajaBanco: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'CAJAS_Y_BANCOS', key: 'idCajaBanco' }
    },

    // El documento del traslado al que pertenece este egreso, cuando lo es.
    //
    // El egreso es lo que descuenta el cajón en el cuadre; TRASLADO_EFECTIVO es el
    // documento que viaja —con su código, su estado y su bitácora— hasta que el
    // responsable de la cuenta destino lo acepta. Son dos hechos distintos sobre la
    // misma plata y esta columna es la que los mantiene unidos: sin ella no habría
    // forma de saber qué egreso corresponde a qué traslado cuando uno se rechaza.
    idTrasladoEfectivo: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'TRASLADO_EFECTIVO', key: 'idTrasladosEfectivo' }
    },

    referencia: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    descripcion: {
        type: DataTypes.STRING(255),
        // La columna sigue admitiendo NULL en la base y así se queda: los egresos que se
        // registraron cuando el campo era opcional existen y no se les puede inventar un
        // motivo. La obligatoriedad se aplica de acá en adelante, sobre lo que se escribe.
        //
        // Sequelize valida solo los campos que cambian en un `update`, así que ajustar el
        // valor de un egreso viejo —lo que hace la resolución de una controversia— no se
        // topa con esta regla por una descripción nula que ya venía así.
        allowNull: false,
        validate: {
            conMotivoReal(valor) {
                const r = validarDescripcionEgreso(valor);
                if (!r.ok) throw new Error(r.mensaje);
            }
        }
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
    updatedAt: false,
    indexes: [
        // El listado recorre los egresos de una tienda en orden (createdAt, idEgreso) y
        // filtra por rango de fechas sobre esa misma columna, así que un solo índice
        // sirve para el filtro y para la paginación por cursor. El id va adentro porque
        // es el desempate del orden: dos egresos pueden compartir el mismo segundo, y
        // sin él la paginación por cursor repetiría o saltearía filas.
        { name: 'idx_egresos_pdv_orden', fields: ['idPuntoDeVenta', 'createdAt', 'idEgreso'] },
        // El cuadre de caja y el total del día suman por estado dentro de una tienda.
        { name: 'idx_egresos_pdv_estado', fields: ['idPuntoDeVenta', 'estado'] },
        // "¿Qué egreso generó este traslado?", que es la pregunta al rechazarlo.
        { name: 'idx_egresos_traslado', fields: ['idTrasladoEfectivo'] }
    ]
});

export default Egresos
