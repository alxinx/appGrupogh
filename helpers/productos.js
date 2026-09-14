import { Op } from 'sequelize';
import Productos from '../models/Productos.js';
import Familia from '../models/Familia.js';
import Atributos from '../models/Atributos.js';
import VariacionesProducto from '../models/VariacionesProducto.js';
import { normalizarFamilia } from './helpers.js';

// Compartido entre el alta manual de producto (adminControllers.js#saveProduct) y el
// importador masivo de Excel (importacionesController.js). Antes vivían duplicadas: ya nos
// pasó una vez con el algoritmo de kitting que dos copias del mismo cálculo se
// desalinearon sin que nadie lo notara — un solo lugar evita que vuelva a pasar acá.

export const generarSlugDe = (texto) => texto.toString().toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-');

/**
 * Devuelve un slug libre. Si el base ya existe en otro producto, numera: -2, -3…
 *
 * El slug es la URL pública del producto y la tienda lo resuelve con findOne. Dos productos
 * con el mismo slug no dan error en ningún lado: simplemente uno de los dos deja de ser
 * alcanzable desde la web, en silencio.
 */
export const slugUnico = async (base, { idProductoActual = null, transaction = null } = {}) => {
    const limpio = (base || '').trim() || 'producto';
    let candidato = limpio;
    let n = 2;
    // Bucle acotado: con más de 50 homónimos hay un problema de datos, no de nombres.
    while (n < 50) {
        const donde = { slug: candidato };
        if (idProductoActual) donde.idProducto = { [Op.ne]: idProductoActual };
        const choca = await Productos.findOne({ where: donde, attributes: ['idProducto'], ...(transaction ? { transaction } : {}) });
        if (!choca) return candidato;
        candidato = `${limpio}-${n}`;
        n++;
    }
    // Último recurso: sufijo de tiempo. Feo, pero nunca choca ni pierde el producto.
    return `${limpio}-${Date.now().toString(36)}`;
};

export const normalizarSku13 = (valor) => String(valor || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-_]/g, '')
    .slice(0, 13);
export const normalizarSku50 = (valor) => String(valor || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-_]/g, '')
    .slice(0, 50);

// Resuelve el NOMBRE de una familia a su fila en FAMILIA, creándola si no existe.
// Devuelve null cuando no hay nombre: el producto queda sin agrupar, que es válido.
// El nombre se normaliza en el modelo, así que dos grafías distintas de lo mismo caen
// siempre en la misma fila y no se duplican familias por diferencias de tipeo.
export const resolverIdFamilia = async (nombre, transaction = null) => {
    const limpio = normalizarFamilia(nombre);
    if (!limpio) return null;
    const [fila] = await Familia.findOrCreate({
        where:    { nombreFamilia: limpio },
        defaults: { nombreFamilia: limpio },
        ...(transaction ? { transaction } : {})
    });
    return fila.idFamilia;
};

// Compartido entre el alta (dashboardInventorys) y la edición (editarProducto) de producto:
// los dos arman el mismo modal "Colores para esta Talla" con la misma lista de ATRIBUTOS.
//
// Antes esa lista salía en el orden de creación del atributo, sin relación con cuáles usa
// de verdad el operador — con el catálogo de colores creciendo, el que se usa en casi
// todas las prendas quedaba enterrado entre los que casi nadie elige. Acá se reordenan los
// de tipo COLOR por frecuencia real de uso (cuántas VARIACION_PRODUCTO tiene cada uno), sin
// tocar el orden de las tallas. Es una sola consulta agregada, no una por color (CLAUDE.md §7).
export const obtenerAtributosOrdenadosPorUso = async () => {
    const [atributos, variaciones] = await Promise.all([
        Atributos.findAll(),
        VariacionesProducto.findAll({ attributes: ['idAtributos'], raw: true })
    ]);

    const usosPorColor = new Map();
    variaciones.forEach(({ idAtributos }) => {
        // idAtributos es "idTalla|idColor" (ver saveProduct); el color es la segunda parte.
        const idColor = idAtributos?.split('|')[1];
        if (!idColor) return;
        usosPorColor.set(idColor, (usosPorColor.get(idColor) || 0) + 1);
    });

    const tallas = atributos.filter(a => a.tipo !== 'COLOR');
    const colores = atributos.filter(a => a.tipo === 'COLOR').sort((a, b) => {
        const usoA = usosPorColor.get(String(a.idAtributo)) || 0;
        const usoB = usosPorColor.get(String(b.idAtributo)) || 0;
        if (usoB !== usoA) return usoB - usoA;
        return a.valor.localeCompare(b.valor); // empate en uso: orden alfabético estable
    });

    return [...tallas, ...colores];
};
