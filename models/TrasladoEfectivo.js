import { DataTypes } from "sequelize";
import db from "../config/bd.js";

/**
 * Traslado de efectivo desde la caja de un punto de venta hacia una caja o cuenta
 * bancaria de la empresa.
 *
 * Es el DOCUMENTO del traslado: quién lo envió, cuánto, hacia dónde y en qué estado va.
 * El efecto sobre los saldos lo lleva MOVIMIENTOS_CAJAS_BANCOS, y los dos quedan unidos
 * por `idMovimiento` cuando el traslado se acepta.
 *
 * A diferencia de los movimientos, esta tabla SÍ se actualiza: el estado cambia cuando
 * el responsable de la caja destino acepta, rechaza o acepta parcialmente. Por eso lleva
 * `updatedAt`.
 *
 * `idCajaTienda` ancla el traslado al turno de caja concreto del que salió la plata. Sin
 * ese anclaje, un traslado hecho al filo del cierre podría caer fuera de la ventana del
 * cuadre y no descontarse nunca.
 */
const TrasladoEfectivo = db.define('TRASLADO_EFECTIVO', {
    idTrasladosEfectivo: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
        unique: true
    },

    // De qué tienda salió el efectivo.
    idTiendaOrigen: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'PUNTO_DE_VENTA', key: 'idPuntoDeVenta' }
    },

    // A qué caja o cuenta va dirigido. El destino puede cambiar si quien recibe lo
    // redirige, y ese cambio queda anotado en el historial.
    idCajaBanco: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'CAJAS_Y_BANCOS', key: 'idCajaBanco' }
    },

    idEmpleadoEnvia: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' }
    },

    // Nulo mientras viaja: todavía no se sabe quién lo va a recibir. Se llena al
    // aceptar, rechazar o aceptar parcialmente.
    idEmpleadoRecibe: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'EMPLEADOS', key: 'idEmpleado' }
    },

    // El turno de caja del que salió la plata.
    idCajaTienda: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'CAJA_TIENDA', key: 'idCajaTienda' }
    },

    // El ingreso que se generó en la caja o cuenta destino. Nulo hasta que se acepta:
    // mientras el traslado viaja, la plata no está asentada en ningún saldo.
    idMovimiento: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'MOVIMIENTOS_CAJAS_BANCOS', key: 'idMovimiento' }
    },

    // El movimiento aparte donde se asentó el sobrante. Va separado del principal a
    // propósito: son dos hechos distintos —lo que la tienda mandó y lo que sobró— y
    // sumarlos en una sola línea haría imposible conciliar el traslado contra el extracto.
    idMovimientoExcedente: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'MOVIMIENTOS_CAJAS_BANCOS', key: 'idMovimiento' }
    },

    // Número o referencia del traslado. Libre y opcional: no todo traslado tiene una
    // —de un cajón a otro no hay nada que referenciar—, y cuando la hay es un dato que
    // se transcribe de un comprobante externo, así que no se valida su forma.
    referencia: {
        type: DataTypes.STRING(50),
        allowNull: true
    },

    // DECIMAL, nunca FLOAT: es dinero. Nunca negativo ni cero — trasladar cero no es
    // una operación, y un negativo sería un traslado en sentido contrario disfrazado.
    valorTraslado: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        validate: {
            min: { args: [0.01], msg: 'El valor del traslado debe ser mayor que cero.' }
        }
    },

    // Cuánto llegó DE MÁS a destino. Nulo en la enorme mayoría de los traslados: solo
    // se llena cuando el que recibe contó más de lo que el punto de venta despachó.
    //
    // Vive acá y no dentro de `valorTraslado` porque el traslado NO se reescribe: sigue
    // valiendo lo que la tienda registró, y así el documento y el movimiento principal
    // siguen coincidiendo peso por peso contra el extracto. El sobrante se asienta en su
    // propio movimiento, apuntado por `idMovimientoExcedente`.
    //
    // El tope lo pone la caja menor del turno: los billetes pegados salen del fajo que el
    // operador armó, y ese fajo solo puede llevar de más lo que había en el cajón como
    // fondo de cambio. Un excedente mayor no es un error de conteo — es plata que nunca
    // fue del negocio (un adelanto de un cliente, el bolsillo de un empleado) y meterla
    // acá la volvería un ingreso sin dueño.
    //
    // Del lado del punto de venta el excedente se descuenta con un egreso propio, no
    // tocando `cajaMenor`: la resta del cuadre lo cobra primero contra las ventas en
    // efectivo sin entregar y solo lo que no alcanza llega a la base, que además se
    // repone sola con las ventas siguientes.
    valorExcedente: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        validate: {
            min: { args: [0.01], msg: 'El excedente debe ser mayor que cero.' }
        }
    },

    // Código legible para la trazabilidad: es lo que se imprime en el comprobante y lo
    // que se busca cuando alguien pregunta por un envío.
    codigoTraslado: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true
    },

    // Cuándo el punto de venta se enteró de que este traslado no entró completo.
    //
    // El aviso viaja por SSE, y un evento SSE se pierde si el navegador no está abierto:
    // el administrador resuelve un traslado a las 8 de la noche y el operador, que ya se
    // fue, nunca ve que le quedó un faltante a cargo. Con esta marca el aviso deja de
    // depender de que alguien esté mirando la pantalla: nulo significa "todavía no lo
    // vio" y se le muestra al entrar.
    //
    // Aplica a los traslados que terminaron en 'Rechazado' o 'Controversia', y también a
    // los 'Recibido' que llegaron con excedente: al operador le sobró plata en el fajo y
    // tiene que saberlo antes de contar la base, o va a cerrar sin entender por qué el
    // fondo de cambio no da.
    avisoVistoEn: {
        type: DataTypes.DATE,
        allowNull: true
    },

    // Nace en tránsito: un traslado sin estado no existe como hecho. Los cuatro valores
    // van capitalizados igual — MySQL no distingue mayúsculas al comparar, pero
    // JavaScript sí, y `estado === 'Controversia'` daría false sin que se note.
    estado: {
        type: DataTypes.ENUM('Recibido', 'En Transito', 'Controversia', 'Rechazado'),
        allowNull: false,
        defaultValue: 'En Transito',
        validate: {
            isIn: {
                args: [['Recibido', 'En Transito', 'Controversia', 'Rechazado']],
                msg: 'Estado inválido.'
            }
        }
    }
}, {
    tableName: "TRASLADO_EFECTIVO",
    timestamps: true,   // createdAt / updatedAt
    indexes: [
        { name: 'idx_traslado_efectivo_tienda',    fields: ['idTiendaOrigen'] },
        { name: 'idx_traslado_efectivo_cajabanco', fields: ['idCajaBanco'] },
        { name: 'idx_traslado_efectivo_envia',     fields: ['idEmpleadoEnvia'] },
        { name: 'idx_traslado_efectivo_recibe',    fields: ['idEmpleadoRecibe'] },
        { name: 'idx_traslado_efectivo_cajatienda',fields: ['idCajaTienda'] },
        { name: 'idx_traslado_efectivo_movimiento',fields: ['idMovimiento'] },
        // El cuadre pregunta "qué salió de este turno" y el panel "qué falta aceptar
        // de esta cuenta": las dos consultas del día a día.
        { name: 'idx_traslado_efectivo_estado',    fields: ['estado'] }
    ]
});

export default TrasladoEfectivo;
