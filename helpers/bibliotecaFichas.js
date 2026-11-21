import { FichaConfeccionTaller, FichaConfeccionProceso, FichaConfeccionMolde, FichaConfeccionMoldeIaIntento, Provedores, Usuarios } from '../models/index.js';

// Biblioteca de fichas de confección (admin/procesos/fichas-confeccion/biblioteca): lo que
// cada fila muestra además de los datos propios de la ficha — imagen de la prenda, talleres
// y en qué etapa va cada uno. Sin colores ni cantidades: eso es de la orden de producción.
// Todo sale de consultas fijas por página (CLAUDE.md §7):
// la ficha con sus includes de un solo registro, y los talleres de todas las fichas de la
// página de una vez.

// Etapas del proceso de un taller, en el orden del flujo (fichaConfeccionProcesoController.js).
export const ETIQUETA_ESTADO_PROCESO = {
    asignado: 'Asignado',
    entregado_taller: 'Entregado al taller',
    en_revision: 'En revisión',
    entregada: 'Entregada'
};

// Imagen que representa la prenda, de la mejor a la peor: el molde generado con IA (solo si
// quedó aprobado), el molde subido (solo JPG: este proyecto no rasteriza PDF) y la foto de
// referencia. Misma prioridad que el editor de la ficha.
export const INCLUDES_IMAGEN_FICHA = [
    { model: FichaConfeccionMoldeIaIntento, as: 'moldeIaIntento', attributes: ['aprobado', 'objectKeyFinal'] },
    { model: FichaConfeccionMolde, as: 'molde', attributes: ['tipoArchivo', 'objectKey'] },
    { model: FichaConfeccionMolde, as: 'moldeReferencia', attributes: ['objectKey'] }
];

export const INCLUDE_CREADOR_FICHA = { model: Usuarios, as: 'usuarioCreacion', attributes: ['nombreUsuario'] };

export const keyImagenFicha = (ficha) => {
    if (ficha.moldeIaIntento?.aprobado && ficha.moldeIaIntento?.objectKeyFinal) return ficha.moldeIaIntento.objectKeyFinal;
    if (ficha.molde?.tipoArchivo === 'jpg' && ficha.molde?.objectKey) return ficha.molde.objectKey;
    return ficha.moldeReferencia?.objectKey || null;
};

const agrupar = (filas) => {
    const m = new Map();
    filas.forEach(f => { if (!m.has(f.idFicha)) m.set(f.idFicha, []); m.get(f.idFicha).push(f); });
    return m;
};

/** Talleres de varias fichas a la vez: una consulta, sin importar cuántas sean. */
export async function detalleBibliotecaFichas(ids) {
    if (!ids.length) return { talleres: new Map() };
    const talleres = await FichaConfeccionTaller.findAll({
        where: { idFicha: ids },
        attributes: ['idFicha', 'orden'],
        include: [
            { model: Provedores, as: 'proveedor', attributes: ['razonSocial'] },
            { model: FichaConfeccionProceso, as: 'proceso', attributes: ['idProceso', 'estado'] }
        ],
        order: [['orden', 'ASC'], ['idDetalle', 'ASC']]
    });
    return { talleres: agrupar(talleres) };
}

/** Lo que pinta una fila (src/js/fichaConfeccionBiblioteca.js). Nada de rutas de objeto. */
export function presentarFichaBiblioteca(ficha, { talleres }) {
    const listaTalleres = (talleres.get(ficha.idFicha) || []).map(t => ({
        nombre: t.proveedor?.razonSocial || 'Taller',
        idProceso: t.proceso?.idProceso || null,
        estado: t.proceso?.estado || null,
        estadoEtiqueta: ETIQUETA_ESTADO_PROCESO[t.proceso?.estado] || null
    }));
    return {
        idFicha: ficha.idFicha,
        referencia: ficha.referencia,
        anulada: ficha.estado === 'anulada',
        telas: String(ficha.materialNombre || '').split(',').map(s => s.trim()).filter(Boolean),
        // DECIMAL(15,2): Sequelize ya lo entrega como texto con sus dos decimales.
        precioConfeccion: String(ficha.precioConfeccion ?? '0'),
        createdAt: ficha.createdAt,
        creadaPor: ficha.usuarioCreacion?.nombreUsuario || null,
        tieneImagen: Boolean(keyImagenFicha(ficha)),
        talleres: listaTalleres,
        entregados: listaTalleres.filter(t => t.estado === 'entregada').length
    };
}
