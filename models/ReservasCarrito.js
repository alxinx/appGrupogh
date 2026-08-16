import { DataTypes, UUIDV4 } from "sequelize";
import db from "../config/bd.js";

// Intención de compra viva: un producto que alguien tiene cargado AHORA en su carrito web
// o en la orden de un POS. No bloquea stock — la unidad sigue siendo del primero que
// confirme. Solo sirve para avisar a los demás que hay competencia por esa prenda.
//
// Por eso cada fila vence: un carrito abandonado no puede alertar para siempre. Sin la
// expiración, a los pocos días todos los productos aparecerían "con demanda" y el aviso
// dejaría de significar nada.
const ReservasCarrito = db.define('RESERVAS_CARRITO', {
    idReserva: {
        type: DataTypes.UUID,
        defaultValue: UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    idProducto: {
        type: DataTypes.UUID,
        allowNull: false
    },
    origen: {
        type: DataTypes.ENUM('web', 'pos'),
        allowNull: false
    },
    // Quién la tiene cargada: cookieId del visitante (web) o idUsuario del vendedor (pos).
    // Permite excluir al propio interesado del conteo — nadie compite consigo mismo.
    referencia: {
        type: DataTypes.STRING(64),
        allowNull: false
    },
    // Solo en POS: para poder decir desde qué tienda la están por vender.
    idPuntoDeVenta: {
        type: DataTypes.UUID,
        allowNull: true
    },
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    expiraEn: {
        type: DataTypes.DATE,
        allowNull: false
    }
}, {
    tableName: "RESERVAS_CARRITO",
    timestamps: true,
    indexes: [
        {
            // Una sola fila por producto y titular: volver a agregarlo actualiza la que ya
            // existe en vez de acumular duplicados.
            name: 'reservas_carrito_titular_unq',
            unique: true,
            fields: ['idProducto', 'origen', 'referencia']
        },
        {
            // El conteo siempre filtra por producto y por vigencia.
            name: 'reservas_carrito_producto_idx',
            fields: ['idProducto', 'expiraEn']
        }
    ]
});

export default ReservasCarrito;
