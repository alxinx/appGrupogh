import { PedidosWeb } from '../models/index.js';
import { wherePorAtender } from '../helpers/pedidosWeb.js';
import { resumenPendientes } from '../helpers/trasladosPendientes.js';

// El menú lateral del admin (views/partials/leftMenu.pug) se renderiza en todas las páginas del
// panel y muestra un contador de pedidos web por atender. Como el partial no recibe los datos de
// cada controlador, el contador se expone acá en res.locals para que esté disponible en todos.
//
// El criterio de "por atender" vive en helpers/pedidosWeb.js y lo comparte con la tarjeta
// "Pedidos nuevos" del dashboard, para que los dos números coincidan siempre. Incluye los
// pedidos por QR que ya tienen comprobante adjunto: ésos también esperan una acción del admin.
//
// Cache corto: son muchas páginas y el dato no necesita ser exacto al segundo. Se invalida solo
// por tiempo; el dashboard sí consulta en vivo.
const TTL_MS = 30 * 1000;
let cache = { pedidos: 0, traslados: 0, expira: 0 };

export const cargarContadoresAdmin = async (req, res, next) => {
    try {
        const ahora = Date.now();
        if (ahora >= cache.expira) {
            // Las dos consultas van juntas: son independientes y el menú no tiene por qué
            // esperar una después de la otra.
            const [pedidos, traslados] = await Promise.all([
                PedidosWeb.count({ where: wherePorAtender() }),
                resumenPendientes()
            ]);
            cache = { pedidos, traslados: traslados.total, expira: ahora + TTL_MS };
        }
        res.locals.pedidosWebNuevos     = cache.pedidos;
        res.locals.trasladosPendientes  = cache.traslados;
    } catch (e) {
        // El menú no puede tumbar una página del panel: si falla la consulta, se ocultan
        // los badges.
        console.error('cargarContadoresAdmin:', e);
        res.locals.pedidosWebNuevos    = 0;
        res.locals.trasladosPendientes = 0;
    }
    return next();
};

// Para invalidar el cache desde donde cambie el estado de un pedido (asignar tienda, cancelar)
// o el de un traslado (crearlo, aceptarlo, rechazarlo), y que el badge no quede
// desactualizado hasta 30 s. El aviso en vivo va por SSE; esto es para la próxima carga.
export const invalidarContadoresAdmin = () => { cache.expira = 0; };
