import { Op } from 'sequelize';
import { Pack, DetallesPack, Productos, Stock, Imagenes } from '../models/index.js';

// Venta de un pack completo en el POS.
//
// Un pack NO es un artículo: es un atajo de captura. Se escanea su código de etiqueta,
// pero se factura como N líneas reales —una por producto— a precio mayorista. La factura
// queda idéntica a si esas prendas se hubieran vendido sueltas, que es lo correcto:
// eso es lo que salió de la tienda. Por eso no se inventa un producto ficticio ni se
// vuelve nullable DETALLES_FACTURA.idProducto, que es NOT NULL con FK a PRODUCTOS.
//
// El precio sale SIEMPRE de Productos.precioVentaMayorista al momento de la venta, no de
// DETALLES_PACK.valorUnidad: ese campo es opcional en el formulario de dosificación y hoy
// viene en 0 en las corridas recientes; y aun lleno, sería el precio del día del empaque.

/**
 * Resuelve packs para venderlos, validando que de verdad se puedan vender.
 *
 * @param claves           códigos de etiqueta y/o idPack (se acepta cualquiera de los dos)
 * @param idPuntoDeVenta   la tienda que está vendiendo
 * @param transaction      opcional; con `bloquear` toma la fila de stock en exclusiva
 * @param bloquear         true al facturar, para que dos cajas no vendan el mismo bulto
 *
 * @returns [{ idPack, codigoEtiqueta, numLote, tipo, idStock, lineas, total }]
 * @throws  Error con `publico: true` y un mensaje que se le puede mostrar al cajero
 */
/**
 * Busca packs vendibles cuyo código EMPIECE por el término.
 *
 * El cajero escribe los primeros dígitos de la etiqueta ("D3E17") y ve los bultos que
 * tiene disponibles, igual que al buscar una prenda por nombre. Un código completo
 * devuelve un solo resultado, así que la misma búsqueda sirve para escanear.
 *
 * Devuelve packs ya resueltos (con sus prendas y precios), no filas crudas: lo que se
 * muestra tiene que ser lo mismo que se va a cobrar.
 */
export async function buscarPacksVendibles({ termino, idPuntoDeVenta, limite = 12 }) {
    const q = String(termino || '').trim();
    if (q.length < 2) return [];

    // Solo los que esta tienda tiene sellados: el stock manda sobre el estado del pack
    // (hay packs en TRASLADADO con su fila ya CERRADO en el destino).
    const disponibles = await Stock.findAll({
        where: {
            idPuntoVenta: idPuntoDeVenta,
            idPack: { [Op.ne]: null },
            estadoInterno: 'CERRADO',
            cantidadExistente: { [Op.gt]: 0 }
        },
        attributes: ['idPack'],
        raw: true
    });
    if (!disponibles.length) return [];

    const packs = await Pack.findAll({
        where: {
            idPack: { [Op.in]: disponibles.map(d => d.idPack) },
            codigoEtiqueta: { [Op.like]: `${q}%` },
            estado: { [Op.notIn]: ['VENDIDO', 'DESEMPACADO', 'ANULADO'] }
        },
        attributes: ['codigoEtiqueta'],
        order: [['codigoEtiqueta', 'ASC']],
        limit: limite,
        raw: true
    });
    if (!packs.length) return [];

    // Se reutiliza el resolvedor: mismas validaciones, mismos precios que al facturar.
    return resolverPacksParaVenta({
        claves: packs.map(p => p.codigoEtiqueta),
        idPuntoDeVenta
    });
}

export async function resolverPacksParaVenta({ claves, idPuntoDeVenta, transaction = null, bloquear = false }) {
    const lista = [...new Set((claves || []).map(c => String(c || '').trim()).filter(Boolean))];
    if (!lista.length) return [];

    const packs = await Pack.findAll({
        where: { [Op.or]: [{ codigoEtiqueta: { [Op.in]: lista } }, { idPack: { [Op.in]: lista } }] },
        transaction
    });

    // Qué se pidió y no existe: se nombra tal como lo escribió el cajero.
    const encontrados = new Set(packs.flatMap(p => [p.codigoEtiqueta, p.idPack]));
    const faltante = lista.find(c => !encontrados.has(c));
    if (faltante) throw publico(`No existe ningún paquete con el código "${faltante}".`);

    // El stock manda sobre el estado: un pack solo se vende si su fila CERRADA está en
    // ESTA tienda. Sin este filtro, una caja podría facturar un bulto de otra sede.
    const stocks = await Stock.findAll({
        where: {
            idPack: { [Op.in]: packs.map(p => p.idPack) },
            idPuntoVenta: idPuntoDeVenta,
            estadoInterno: 'CERRADO',
            cantidadExistente: { [Op.gt]: 0 }
        },
        transaction,
        ...(bloquear && transaction ? { lock: transaction.LOCK.UPDATE } : {})
    });
    const stockPorPack = new Map(stocks.map(s => [s.idPack, s]));

    for (const pack of packs) {
        if (pack.estado === 'VENDIDO')     throw publico(`El paquete ${pack.codigoEtiqueta} ya fue vendido.`);
        if (pack.estado === 'DESEMPACADO') throw publico(`El paquete ${pack.codigoEtiqueta} ya fue desempacado: sus prendas se venden sueltas.`);
        if (pack.estado === 'ANULADO')     throw publico(`El paquete ${pack.codigoEtiqueta} está anulado.`);
        if (!stockPorPack.has(pack.idPack)) {
            throw publico(`El paquete ${pack.codigoEtiqueta} no está disponible en esta tienda.`);
        }
    }

    // Líneas y precios: dos consultas para todos los packs, no una por pack (§7).
    const detalles = await DetallesPack.findAll({
        where: { idPack: { [Op.in]: packs.map(p => p.idPack) } },
        transaction
    });
    if (!detalles.length) throw publico('El paquete no tiene productos registrados.');

    // La imagen viaja en el mismo query (no una consulta por prenda): el detalle del pack
    // en el POS muestra la foto de cada una, como el catálogo.
    const productos = await Productos.findAll({
        where: { idProducto: { [Op.in]: [...new Set(detalles.map(d => d.idProducto))] } },
        attributes: ['idProducto', 'nombreProducto', 'sku', 'precioVentaMayorista', 'precioVentaPublicoFinal'],
        include: [{ model: Imagenes, as: 'imagenes', attributes: ['nombreImagen', 'tipo'], required: false }],
        transaction
    });
    const R2 = `${process.env.R2_PUBLIC_URL}/productos/`;
    const fotoDe = (prod) => {
        const img = prod.imagenes?.find(i => i.tipo === 'principal') || prod.imagenes?.[0];
        return img ? R2 + img.nombreImagen : '/img/image-default.webp';
    };
    const prodPorId = new Map(productos.map(p => [p.idProducto, p]));

    return packs.map(pack => {
        const lineas = detalles
            .filter(d => d.idPack === pack.idPack)
            .map(d => {
                const prod = prodPorId.get(d.idProducto);
                if (!prod) throw publico(`El paquete ${pack.codigoEtiqueta} contiene un producto que ya no existe.`);
                const cantidad = parseInt(d.cantidad) || 0;
                const precio   = parseFloat(prod.precioVentaMayorista) || 0;
                return {
                    idProducto: d.idProducto,
                    nombreProducto: prod.nombreProducto,
                    sku: prod.sku,
                    imagen: fotoDe(prod),
                    cantidad,
                    precioMayorista: precio,
                    totalLinea: precio * cantidad
                };
            });

        if (!lineas.length) throw publico(`El paquete ${pack.codigoEtiqueta} no tiene productos registrados.`);

        return {
            idPack: pack.idPack,
            codigoEtiqueta: pack.codigoEtiqueta,
            numLote: pack.numLote,
            tipo: pack.tipo,
            idStock: stockPorPack.get(pack.idPack).idStock,
            lineas,
            unidades: lineas.reduce((s, l) => s + l.cantidad, 0),
            total: lineas.reduce((s, l) => s + l.totalLinea, 0)
        };
    });
}

const publico = (mensaje) => Object.assign(new Error(mensaje), { publico: true });
