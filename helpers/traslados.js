import { Op } from 'sequelize';
import { Stock, Traslados } from '../models/index.js';
import { siguienteNumero } from './secuencias.js';

// Descuenta `cantidad` de un producto en un punto de venta usando FIFO sobre los lotes de STOCK
// (los más antiguos primero) — mismo mecanismo que usa el traslado manual de empleados.
// Lanza si no hay stock suficiente. Debe llamarse dentro de una transacción.
export async function descontarStockFifo(idProducto, idPuntoVenta, cantidad, transaction) {
    const filasStock = await Stock.findAll({
        where: { idProducto, idPuntoVenta, cantidadExistente: { [Op.gt]: 0 } },
        order: [['createdAt', 'ASC']],
        lock: transaction.LOCK.UPDATE,
        transaction
    });
    let restante = parseFloat(cantidad);
    for (const fila of filasStock) {
        if (restante <= 0) break;
        const disponible = parseFloat(fila.cantidadExistente);
        if (disponible <= restante) {
            await fila.update({ cantidadExistente: 0 }, { transaction });
            restante -= disponible;
        } else {
            await fila.update({ cantidadExistente: disponible - restante }, { transaction });
            restante = 0;
        }
    }
    if (restante > 0) {
        throw new Error(`Stock insuficiente para el producto ${idProducto} en el punto de venta ${idPuntoVenta}.`);
    }
}

// Siguiente código correlativo de traslado (TR-1000, TR-1001, ...).
// Sale del contador de SECUENCIAS, no de leer el último traslado: dos traslados creados en el
// mismo segundo —la tienda facturando en el POS mientras entra un pago web— calculaban el mismo
// código y el segundo moría contra el índice único de codigoTraslado.
export async function siguienteCodigoTraslado(transaction) {
    return `TR-${await siguienteNumero('traslado', transaction)}`;
}
