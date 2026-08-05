import { DataTypes } from "sequelize";
import db from "../config/bd.js";

// Contadores de códigos correlativos (números de pedido web, códigos de traslado, etc.).
//
// Existe para que dos procesos simultáneos no calculen el mismo número. Antes cada flujo leía
// el último registro con ORDER BY createdAt DESC y le sumaba 1; con dos operaciones en el mismo
// segundo —típicamente la tienda facturando en el POS mientras entra un pago web— ambas
// calculaban el mismo código y la segunda moría contra el índice único.
//
// Acá el número se pide con un UPDATE sobre una única fila: InnoDB la bloquea, así que las
// transacciones concurrentes hacen fila en vez de chocar. Como el UPDATE va dentro de la misma
// transacción del registro, si esta se revierte el número también se libera (no deja huecos).
const Secuencias = db.define('SECUENCIAS', {
    nombre: {
        type: DataTypes.STRING(50),
        primaryKey: true,
        allowNull: false,
        comment: 'Identificador del contador, ej. pedido_web / traslado'
    },
    valor: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
        comment: 'Último número entregado'
    }
}, {
    tableName: 'SECUENCIAS',
    timestamps: false
});

export default Secuencias;
