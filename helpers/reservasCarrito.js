import { Op, fn, col } from 'sequelize';
import { ReservasCarrito, PuntosDeVenta, Stock } from '../models/index.js';

// Cuánto vive una intención de compra sin refrescarse. Un carrito abandonado deja de
// alertar pasado este tiempo; si la persona sigue navegando, cada cambio lo renueva.
export const MINUTOS_VIGENCIA = parseInt(process.env.RESERVA_CARRITO_MINUTOS) || 30;

const nuevaExpiracion = () => new Date(Date.now() + MINUTOS_VIGENCIA * 60 * 1000);

// Filtro de vigencia: se aplica SIEMPRE al leer, aunque la purga no haya corrido todavía.
// Depender solo del borrado periódico dejaría contar filas ya vencidas.
const vigentes = () => ({ expiraEn: { [Op.gt]: new Date() } });

// Borra lo vencido. Es oportunista (se llama al escribir), no un cron: con el volumen de
// un solo negocio alcanza, y evita depender de un proceso aparte.
export const purgarVencidas = async () => {
    try {
        await ReservasCarrito.destroy({ where: { expiraEn: { [Op.lte]: new Date() } } });
    } catch (e) {
        // Que falle la limpieza no puede tumbar la petición que la disparó.
        console.error('[reservasCarrito] purga:', e.message);
    }
};

/**
 * Deja registrado que un titular tiene ciertos productos cargados AHORA.
 * Reemplaza por completo lo que ese titular tenía: si sacó algo del carrito, desaparece.
 */
export const sincronizarReservas = async ({ origen, referencia, idPuntoDeVenta = null, items = [] }) => {
    if (!origen || !referencia) return;

    const limpios = items
        .map(i => ({ idProducto: String(i.idProducto || ''), cantidad: Math.max(1, parseInt(i.cantidad) || 1) }))
        .filter(i => i.idProducto);

    const ids = limpios.map(i => i.idProducto);

    // Lo que ya no está en el carrito se libera. Sin esto, quitar un producto seguiría
    // alertando a los demás por una compra que ya nadie está por hacer.
    await ReservasCarrito.destroy({
        where: {
            origen,
            referencia,
            ...(ids.length ? { idProducto: { [Op.notIn]: ids } } : {})
        }
    });

    if (!limpios.length) return;

    // updateOnDuplicate hace un solo INSERT ... ON DUPLICATE KEY UPDATE gracias al índice
    // único (idProducto, origen, referencia): una consulta y no una por producto.
    await ReservasCarrito.bulkCreate(
        limpios.map(i => ({
            idProducto: i.idProducto,
            origen,
            referencia,
            idPuntoDeVenta,
            cantidad: i.cantidad,
            expiraEn: nuevaExpiracion()
        })),
        { updateOnDuplicate: ['cantidad', 'idPuntoDeVenta', 'expiraEn', 'updatedAt'] }
    );

    purgarVencidas();
};

/** Suelta todo lo que tenía un titular (venta confirmada, carrito vaciado, sesión cerrada). */
export const liberarReservas = async ({ origen, referencia }) => {
    if (!origen || !referencia) return;
    await ReservasCarrito.destroy({ where: { origen, referencia } });
};

/**
 * Demanda de OTROS sobre una lista de productos, excluyendo al propio titular.
 *
 * Devuelve un Map idProducto → { unidades, titulares, web, pos, tiendas[] }.
 * Una sola consulta agregada para todos los productos: no crece con la cantidad de ids.
 */
export const demandaDeOtros = async (idsProductos, { origen, referencia } = {}) => {
    const ids = [...new Set((idsProductos || []).map(String).filter(Boolean))];
    if (!ids.length) return new Map();

    const filas = await ReservasCarrito.findAll({
        where: {
            idProducto: { [Op.in]: ids },
            ...vigentes(),
            // Nadie compite consigo mismo: se excluye al titular que pregunta.
            ...(origen && referencia ? { [Op.not]: { origen, referencia } } : {})
        },
        attributes: ['idProducto', 'origen', 'cantidad', 'idPuntoDeVenta'],
        include: [{
            model: PuntosDeVenta,
            as: 'puntoDeVenta',
            attributes: ['nombreComercial'],
            required: false
        }]
    });

    const mapa = new Map();
    for (const f of filas) {
        if (!mapa.has(f.idProducto)) {
            mapa.set(f.idProducto, { unidades: 0, titulares: 0, web: 0, pos: 0, tiendas: [] });
        }
        const d = mapa.get(f.idProducto);
        d.unidades += f.cantidad;
        d.titulares += 1;
        if (f.origen === 'web') d.web += 1;
        else {
            d.pos += 1;
            const nombre = f.puntoDeVenta?.nombreComercial;
            if (nombre && !d.tiendas.includes(nombre)) d.tiendas.push(nombre);
        }
    }
    return mapa;
};

// Los mismos puntos vendibles que usa el resto de la web: bodega y tránsito no se venden.
const TIPOS_PUNTO_VENDIBLE = ['Punto de venta', 'web'];

/**
 * Stock vendible por producto, en una sola consulta agregada.
 * Viaja junto a la demanda porque el aviso al comprador solo tiene sentido comparándolos:
 * "3 personas lo tienen y quedan 2" alarma; "3 personas y quedan 400" es ruido.
 */
export const stockVendiblePorProducto = async (ids) => {
    if (!ids?.length) return {};
    const filas = await Stock.findAll({
        where: { idProducto: { [Op.in]: ids } },
        attributes: ['idProducto', [fn('SUM', col('cantidadExistente')), 'total']],
        include: [{
            model: PuntosDeVenta, as: 'ubicacion', attributes: [],
            where: { tipo: { [Op.in]: TIPOS_PUNTO_VENDIBLE } }, required: true
        }],
        group: ['STOCKS.idProducto'],
        raw: true
    });
    return Object.fromEntries(filas.map(f => [f.idProducto, parseInt(f.total) || 0]));
};

/**
 * Versión serializable para respuestas JSON, con el stock de cada producto.
 *
 * `incluirTiendas` va en false por defecto a propósito: en qué local se está vendiendo una
 * prenda es información operativa interna y no tiene por qué llegar a un cliente de la web.
 * Ocultarlo solo en la pantalla no bastaría — el nombre viajaría igual en la respuesta y se
 * vería en las herramientas del navegador. Solo el POS lo pide en true.
 */
export const demandaDeOtrosJson = async (idsProductos, titular, { incluirTiendas = false } = {}) => {
    const ids = [...new Set((idsProductos || []).map(String).filter(Boolean))];
    const [mapa, stock] = await Promise.all([
        demandaDeOtros(ids, titular),
        stockVendiblePorProducto(ids)
    ]);
    const salida = {};
    for (const id of ids) {
        const d = mapa.get(id);
        if (!d) continue;
        const { tiendas, ...resto } = d;
        salida[id] = { ...resto, stock: stock[id] ?? 0, ...(incluirTiendas ? { tiendas } : {}) };
    }
    return salida;
};

// ─── Reconciliación tras una venta ────────────────────────────────────────────
// Cuando alguien confirma (pago web aprobado o factura del POS) el stock baja y los demás
// carritos pueden haber quedado pidiendo más de lo que existe. Acá se corrigen.
//
// El ajuste se calcula SIEMPRE contra el stock real, no aplicando un delta de la venta:
// así el sistema se autocorrige aunque se pierda un aviso, se reinicie el servidor o el
// stock cambie por una vía que este módulo no conoce (un traslado, un ajuste manual).

/**
 * Recorta lo que un titular pide al stock que hay hoy.
 * Devuelve los items ya corregidos y el detalle de qué cambió, para poder explicarlo.
 */
export const ajustarPorStock = async (items = []) => {
    const limpios = (items || [])
        .map(i => ({ idProducto: String(i.idProducto || ''), cantidad: Math.max(0, parseInt(i.cantidad) || 0) }))
        .filter(i => i.idProducto && i.cantidad > 0);

    if (!limpios.length) return { items: [], ajustes: [] };

    const stock = await stockVendiblePorProducto(limpios.map(i => i.idProducto));
    const ajustados = [];
    const ajustes = [];

    for (const item of limpios) {
        const disponible = stock[item.idProducto] ?? 0;
        if (item.cantidad <= disponible) {
            ajustados.push(item);
            continue;
        }
        // Se registra qué pasó para que el cliente o el operador entiendan el cambio;
        // una cantidad que baja sola sin explicación se lee como un error del sitio.
        ajustes.push({
            idProducto: item.idProducto,
            cantidadAnterior: item.cantidad,
            cantidadNueva: disponible,
            motivo: disponible === 0 ? 'agotado' : 'stock_insuficiente',
            disponible
        });
        if (disponible > 0) ajustados.push({ ...item, cantidad: disponible });
    }

    return { items: ajustados, ajustes };
};

/**
 * Poda las reservas vivas de unos productos para que ninguna pida más de lo que queda.
 * Se llama después de consumir stock (pago web aprobado, factura del POS) para que la
 * demanda que ven los demás sea honesta desde el instante siguiente a la venta.
 *
 * No avisa por sí sola: el aviso le llega a cada titular en su próxima sincronización,
 * que es cuando además se corrige su carrito.
 */
export const reconciliarPorVenta = async (idsProductos = []) => {
    const ids = [...new Set(idsProductos.map(String).filter(Boolean))];
    if (!ids.length) return { podadas: 0, eliminadas: 0 };

    try {
        const stock = await stockVendiblePorProducto(ids);
        let podadas = 0, eliminadas = 0;

        for (const id of ids) {
            const disponible = stock[id] ?? 0;

            if (disponible <= 0) {
                eliminadas += await ReservasCarrito.destroy({ where: { idProducto: id, ...vigentes() } });
                continue;
            }
            // Solo las que se pasaron: el resto queda intacto.
            const [filas] = await ReservasCarrito.update(
                { cantidad: disponible },
                { where: { idProducto: id, cantidad: { [Op.gt]: disponible }, ...vigentes() } }
            );
            podadas += filas || 0;
        }
        return { podadas, eliminadas };
    } catch (e) {
        // Una venta jamás puede fallar porque la reconciliación tuvo un problema.
        console.error('[reservasCarrito] reconciliarPorVenta:', e.message);
        return { podadas: 0, eliminadas: 0, error: true };
    }
};
