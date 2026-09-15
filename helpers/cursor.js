import { Op } from 'sequelize';

// Paginación por cursor (keyset) sobre un orden (fecha DESC, id DESC), para listados que crecen
// sin techo (CLAUDE.md §8). La fecha sola admite empates y el id los desempata, así que el
// cursor lleva los dos: "<epoch ms>.<id>".
export const armarCursor = (fecha, id) => `${new Date(fecha).getTime()}.${id}`;

export const leerCursor = (cursor) => {
    if (!cursor) return null;
    const texto = String(cursor);
    const corte = texto.indexOf('.');
    if (corte < 1) return null;
    const ms = Number(texto.slice(0, corte));
    const id = texto.slice(corte + 1);
    if (!Number.isFinite(ms) || !id) return null;
    return { fecha: new Date(ms), id };
};

// Lo que va después del cursor en ese orden descendente. Escrito como OR de dos ramas porque
// MySQL no aprovecha el índice con una comparación de tuplas en Sequelize.
export const despuesDelCursor = ({ fecha, id }, campoFecha, campoId) => ({
    [Op.or]: [
        { [campoFecha]: { [Op.lt]: fecha } },
        { [campoFecha]: fecha, [campoId]: { [Op.lt]: id } }
    ]
});
