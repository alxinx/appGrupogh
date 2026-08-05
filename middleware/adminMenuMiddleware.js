import { PedidosWeb } from '../models/index.js';

// El menú lateral del admin (views/partials/leftMenu.pug) se renderiza en todas las páginas del
// panel y muestra un contador de pedidos web por atender. Como el partial no recibe los datos de
// cada controlador, el contador se expone acá en res.locals para que esté disponible en todos.
//
// "Por atender" = 'en_revision': el pago ya está confirmado pero al pedido todavía no se le
// asignó tienda, que es justo la acción que le toca al admin. Mismo criterio que la tarjeta
// "Pedidos nuevos" del dashboard, para que los dos números coincidan siempre.
//
// Cache corto: son muchas páginas y el dato no necesita ser exacto al segundo. Se invalida solo
// por tiempo; el dashboard sí consulta en vivo.
const TTL_MS = 30 * 1000;
let cache = { valor: 0, expira: 0 };

export const cargarContadoresAdmin = async (req, res, next) => {
    try {
        const ahora = Date.now();
        if (ahora >= cache.expira) {
            cache = {
                valor: await PedidosWeb.count({ where: { estado: 'en_revision' } }),
                expira: ahora + TTL_MS
            };
        }
        res.locals.pedidosWebNuevos = cache.valor;
    } catch (e) {
        // El menú no puede tumbar una página del panel: si falla la consulta, se oculta el badge.
        console.error('cargarContadoresAdmin:', e);
        res.locals.pedidosWebNuevos = 0;
    }
    return next();
};

// Para invalidar el cache desde donde cambie el estado de un pedido (asignar tienda, cancelar),
// y que el badge no quede desactualizado hasta 30 s.
export const invalidarContadoresAdmin = () => { cache.expira = 0; };
