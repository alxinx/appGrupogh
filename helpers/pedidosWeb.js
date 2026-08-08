import { Op } from 'sequelize';

// ─────────────────────────────────────────────────────────────────────────────
// Qué cuenta como "pedido web por atender".
//
// Lo usan el badge del menú lateral (middleware/adminMenuMiddleware.js) y la tarjeta
// "Pedidos nuevos" del dashboard. Vive acá para que los dos números no puedan
// desincronizarse: si el criterio cambia, cambia en un solo lugar.
//
// Son los pedidos que esperan una acción del admin AHORA:
//   · 'en_revision'                     → la pasarela confirmó el pago, falta asignar tienda.
//   · 'pendiente_pago' + QR + comprobante → el comprador dice que transfirió y adjuntó la
//     captura; alguien tiene que cotejarla contra el extracto y darla por pagada.
//
// Un pedido en 'pendiente_pago' SIN comprobante no cuenta: no hay nada que hacer todavía,
// es el equivalente a un checkout de Wompi que nunca se pagó. Aparece igual en el listado
// de pedidos, solo no infla el badge.
// ─────────────────────────────────────────────────────────────────────────────
export const wherePorAtender = () => ({
    [Op.or]: [
        { estado: 'en_revision' },
        {
            estado: 'pendiente_pago',
            metodoPago: 'qr',
            comprobantePagoKey: { [Op.ne]: null }
        }
    ]
});

// Pedidos que siguen esperando al comprador: eligió pagar y nunca completó ni adjuntó nada.
// Complemento exacto de wherePorAtender dentro de 'pendiente_pago', para que las dos
// tarjetas del dashboard no cuenten el mismo pedido dos veces.
export const whereEsperandoAlCliente = () => ({
    estado: 'pendiente_pago',
    [Op.not]: {
        metodoPago: 'qr',
        comprobantePagoKey: { [Op.ne]: null }
    }
});
