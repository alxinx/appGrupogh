import { Material, FichaConfeccionMolde, FichaConfeccionMoldeIaIntento, FichaConfeccionVideo, FichaConfeccionInsumo } from '../models/index.js';
import { errorPublico } from './helpers.js';

// Lo que una persona le pone a una ficha además de su DXF: molde, foto de referencia, imagen
// de IA aprobada, videos, insumos por prenda, complementos y observaciones. Una sola copia de
// las reglas para el asistente "Nueva ficha" (finalizarFicha) y para la ficha que se crea
// desde un corte ("Crear la ficha ahora", helpers/ordenesCorte.js). Las validaciones nunca
// lanzan: devuelven `{ error }`.

export const VIDEOS_POR_FICHA_MAX = 3;
export const TEXTO_FICHA_MAX = 2000;

const id = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 36) : null);

/**
 * Insumos por prenda: OPCIONALES. La cantidad es POR PRENDA ("2 botones"): la ficha describe
 * la prenda y la orden multiplica. `nombreMaterial` se congela con el nombre de HOY, nunca
 * con el que mande el navegador.
 */
export async function validarInsumosBody(insumosBody) {
    if (!insumosBody.length) return { insumosLimpios: [] };

    const insumosLimpios = [];
    for (const fila of insumosBody) {
        const cantidad = parseInt(fila?.cantidad, 10);
        if (!fila?.idMaterial || !Number.isInteger(cantidad) || cantidad <= 0) return { error: 'Hay un insumo inválido en la lista.' };
        insumosLimpios.push({ idMaterial: String(fila.idMaterial), cantidad });
    }

    const idsInsumos = [...new Set(insumosLimpios.map((i) => i.idMaterial))];
    const materialesInsumo = await Material.findAll({ where: { idMaterial: idsInsumos, activo: true }, attributes: ['idMaterial', 'nombre'] });
    if (materialesInsumo.length !== idsInsumos.length) return { error: 'Alguno de los insumos elegidos no existe o ya no está activo.' };

    const nombrePorId = new Map(materialesInsumo.map((m) => [m.idMaterial, m.nombre]));
    insumosLimpios.forEach((i) => { i.nombreMaterial = nombrePorId.get(i.idMaterial); });

    return { insumosLimpios };
}

/**
 * Valida todo lo que la persona le pone a la ficha. Molde, foto de referencia e imagen de IA
 * son opcionales acá (quien llama decide si exige el molde). El molde y la foto los tuvo que
 * subir este usuario; la imagen de IA tiene que estar aprobada; los videos, hasta 3, listos,
 * de este usuario y todavía sin ficha (§12: una lista de ids del body nunca basta sola).
 * @returns { datos: { idMolde, idMoldeReferencia, idMoldeIaIntento, insumos, idsVideos, complementos, observaciones } } | { error }
 */
export async function validarDatosFicha(body, idUsuario) {
    const { insumosLimpios, error } = await validarInsumosBody(Array.isArray(body?.insumos) ? body.insumos : []);
    if (error) return { error };

    const idMolde = id(body?.idMolde);
    const idMoldeReferencia = id(body?.idMoldeReferencia);
    const idMoldeIaIntento = id(body?.idMoldeIaIntento);
    const idsVideos = [...new Set((Array.isArray(body?.idsVideos) ? body.idsVideos : []).map(id).filter(Boolean))];
    if (idsVideos.length > VIDEOS_POR_FICHA_MAX) return { error: `Una ficha lleva hasta ${VIDEOS_POR_FICHA_MAX} videos.` };

    const [molde, moldeReferencia, intento, videos] = await Promise.all([
        idMolde ? FichaConfeccionMolde.findOne({ where: { idMolde, idUsuarioCarga: idUsuario }, attributes: ['idMolde'] }) : null,
        idMoldeReferencia ? FichaConfeccionMolde.findOne({ where: { idMolde: idMoldeReferencia, idUsuarioCarga: idUsuario }, attributes: ['idMolde'] }) : null,
        idMoldeIaIntento ? FichaConfeccionMoldeIaIntento.findOne({ where: { idIntento: idMoldeIaIntento, aprobado: true }, attributes: ['idIntento'] }) : null,
        idsVideos.length ? FichaConfeccionVideo.findAll({ where: { idVideo: idsVideos, idUsuarioCarga: idUsuario, estado: 'ready', idFicha: null }, attributes: ['idVideo'] }) : []
    ]);
    if (idMolde && !molde) return { error: 'El molde indicado no existe o no lo subiste tú.' };
    if (idMoldeReferencia && !moldeReferencia) return { error: 'La foto de referencia indicada no existe.' };
    if (idMoldeIaIntento && !intento) return { error: 'La imagen generada con IA no existe o no fue aprobada.' };
    if (videos.length !== idsVideos.length) return { error: 'Algún video todavía no está listo o ya es de otra ficha.' };

    return {
        datos: {
            idMolde, idMoldeReferencia, idMoldeIaIntento,
            insumos: insumosLimpios,
            idsVideos,
            complementos: String(body?.complementos ?? '').trim().slice(0, TEXTO_FICHA_MAX) || null,
            observaciones: String(body?.observaciones ?? '').trim().slice(0, TEXTO_FICHA_MAX) || null
        }
    };
}

/** Las columnas de FICHAS_CONFECCION que salen de validarDatosFicha. */
export const columnasDatosFicha = (datos) => ({
    idMolde: datos.idMolde,
    idMoldeReferencia: datos.idMoldeReferencia,
    idMoldeIaIntento: datos.idMoldeIaIntento,
    complementos: datos.complementos,
    observaciones: datos.observaciones
});

/**
 * Guarda los insumos y liga los videos a la ficha recién creada, en la transacción del
 * llamador. El video se liga solo si sigue sin ficha: si otro lo tomó entre la validación y
 * acá, se revierte todo (§9).
 */
export async function guardarDatosFicha(idFicha, datos, transaction) {
    if (datos.insumos.length) {
        await FichaConfeccionInsumo.bulkCreate(
            datos.insumos.map((i, idx) => ({ idFicha, idMaterial: i.idMaterial, nombreMaterial: i.nombreMaterial, cantidad: i.cantidad, orden: idx + 1 })),
            { transaction }
        );
    }
    if (datos.idsVideos.length) {
        const [filas] = await FichaConfeccionVideo.update({ idFicha }, { where: { idVideo: datos.idsVideos, idFicha: null }, transaction });
        if (filas !== datos.idsVideos.length) throw errorPublico('Algún video ya quedó en otra ficha. Recarga e intenta de nuevo.', 409);
    }
}
