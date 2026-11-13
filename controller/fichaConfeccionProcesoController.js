import { FichaConfeccionProceso, FichaConfeccionProcesoHistorial, FichaConfeccionProcesoBitacora, FichaConfeccionTaller, FichaConfeccionTallerColor, FichaConfeccion, Provedores, Atributos, Usuarios } from '../models/index.js';

// Seguimiento de producción por taller (admin/procesos) — nace solo cuando se asigna un
// confeccionista a una ficha (controller/fichaConfeccionController.js
// actualizarFichaConfeccion). Flujo confirmado con el usuario, sin saltos ni retrocesos:
//   asignado → entregado_taller → en_revision → entregada
// "entregada" es el cierre: desde ahí la ficha queda lista para Dosificaciones (un sistema
// aparte que ya existe, CLAUDE.md §6 — acá solo se marca el estado, no se toca esa tabla).
export const ORDEN_ESTADOS = ['asignado', 'entregado_taller', 'en_revision', 'entregada'];

const ETIQUETA_ESTADO = {
    asignado: 'Asignado',
    entregado_taller: 'Entregado al taller',
    en_revision: 'En revisión',
    entregada: 'Entregada'
};

const INCLUDES_PROCESO = [
    {
        model: FichaConfeccionTaller, as: 'taller',
        include: [
            { model: FichaConfeccion, as: 'ficha', attributes: ['idFicha', 'referencia', 'materialNombre'] },
            { model: Provedores, as: 'proveedor', attributes: ['idProveedor', 'razonSocial'] },
            { model: FichaConfeccionTallerColor, as: 'colores', include: [{ model: Atributos, as: 'color', attributes: ['idAtributo', 'valor', 'codigo1'] }] }
        ]
    }
];

// GET /admin/procesos — listado real (antes era la pantalla vacía de paginaBase,
// controller/produccionController.js). Volumen de un solo negocio, sin paginación todavía
// (CLAUDE.md §8 — se agrega cuando haga falta, igual que la Biblioteca de fichas antes de
// tener buscador).
const homeProcesosListado = async (req, res) => {
    try {
        const procesos = await FichaConfeccionProceso.findAll({
            include: INCLUDES_PROCESO,
            order: [['updatedAt', 'DESC']]
        });
        return res.render('./administrador/produccion/procesosListado', {
            pagina: 'Procesos',
            subPagina: 'Listado de procesos',
            csrfToken: req.csrfToken(),
            currentPath: '/procesos',
            procesos,
            etiquetaEstado: ETIQUETA_ESTADO
        });
    } catch (e) {
        console.error('fichaConfeccionProcesoController(listado):', e);
        return res.status(500).send('No se pudo cargar el listado de procesos.');
    }
};

// GET /admin/procesos/:idProceso — detalle: estado actual, historial de etapas y bitácora
// de novedades, con la acción de avanzar a la siguiente etapa.
const verProceso = async (req, res) => {
    try {
        const proceso = await FichaConfeccionProceso.findByPk(req.params.idProceso, {
            include: [
                ...INCLUDES_PROCESO,
                { model: FichaConfeccionProcesoHistorial, as: 'historial', separate: true, order: [['createdAt', 'ASC']], include: [{ model: Usuarios, as: 'usuario', attributes: ['idUsuario', 'nombreUsuario'] }] },
                { model: FichaConfeccionProcesoBitacora, as: 'bitacora', separate: true, order: [['createdAt', 'DESC']], include: [{ model: Usuarios, as: 'usuario', attributes: ['idUsuario', 'nombreUsuario'] }] }
            ]
        });
        if (!proceso) return res.status(404).send('Ese proceso no existe.');

        // Cuántas unidades le tocan a este taller — informativo (y precarga el campo de
        // cantidad al "Entregar al taller"): la suma de los colores que tiene asignados
        // (FichaConfeccionTallerColor), no un campo propio — la cantidad real vive en
        // FICHAS_CONFECCION_COLORES (CLAUDE.md §7, no duplicar lo que ya hay).
        const idsColoresTaller = new Set((proceso.taller.colores || []).map((c) => c.idAtributoColor));
        const coloresFicha = await FichaConfeccion.findByPk(proceso.taller.ficha.idFicha, {
            include: [{ association: 'colores' }]
        });
        const cantidadAsignada = (coloresFicha?.colores || [])
            .filter((c) => idsColoresTaller.has(c.idAtributoColor))
            .reduce((suma, c) => suma + c.cantidad, 0);

        const indiceActual = ORDEN_ESTADOS.indexOf(proceso.estado);
        const siguienteEstado = ORDEN_ESTADOS[indiceActual + 1] || null;

        return res.render('./administrador/produccion/procesoDetalle', {
            pagina: 'Procesos',
            subPagina: proceso.taller.ficha.referencia,
            csrfToken: req.csrfToken(),
            currentPath: '/procesos',
            proceso,
            etiquetaEstado: ETIQUETA_ESTADO,
            cantidadAsignada,
            siguienteEstado,
            siguienteEtiqueta: siguienteEstado ? ETIQUETA_ESTADO[siguienteEstado] : null
        });
    } catch (e) {
        console.error('fichaConfeccionProcesoController(verProceso):', e);
        return res.status(500).send('No se pudo cargar el proceso.');
    }
};

// POST /admin/procesos/:idProceso/avanzar — mueve el proceso a la SIGUIENTE etapa, nunca
// salta ni retrocede (ORDEN_ESTADOS de arriba). Cantidad obligatoria al entregar al taller y
// al cerrar como entregada (son los dos momentos donde de verdad hay unidades moviéndose);
// opcional al pasar a revisión. Cada avance dura su propia fila en el historial, append-only.
const avanzarProceso = async (req, res) => {
    try {
        const proceso = await FichaConfeccionProceso.findByPk(req.params.idProceso);
        if (!proceso) return res.status(404).json({ success: false, mensaje: 'Ese proceso no existe.' });

        const indiceActual = ORDEN_ESTADOS.indexOf(proceso.estado);
        const siguienteEstado = ORDEN_ESTADOS[indiceActual + 1];
        if (!siguienteEstado) {
            return res.status(422).json({ success: false, mensaje: 'Este proceso ya está entregado — no hay una etapa siguiente.' });
        }
        if (req.body?.estado !== siguienteEstado) {
            return res.status(422).json({ success: false, mensaje: `La siguiente etapa es "${ETIQUETA_ESTADO[siguienteEstado]}", no se puede saltar ni retroceder.` });
        }

        let cantidad = null;
        if (siguienteEstado === 'entregado_taller' || siguienteEstado === 'entregada') {
            cantidad = parseInt(req.body?.cantidad, 10);
            if (!Number.isInteger(cantidad) || cantidad <= 0) {
                return res.status(422).json({ success: false, mensaje: 'Escribe cuántas unidades, mayor a 0.' });
            }
        }
        const notas = String(req.body?.notas ?? '').trim().slice(0, 1000) || null;

        await FichaConfeccionProcesoHistorial.create({
            idProceso: proceso.idProceso, estado: siguienteEstado, cantidad, idUsuario: req.usuario.idUsuario, notas
        });
        await proceso.update({ estado: siguienteEstado });

        return res.json({ success: true, estado: siguienteEstado });
    } catch (e) {
        console.error('fichaConfeccionProcesoController(avanzar):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo avanzar el proceso.' });
    }
};

// POST /admin/procesos/:idProceso/bitacora — novedad libre ("le hizo falta tela", "le hizo
// falta herrajes") — no mueve el estado, puede haber varias en cualquier etapa.
const agregarBitacora = async (req, res) => {
    try {
        const nota = String(req.body?.nota ?? '').trim().slice(0, 1000);
        if (!nota) return res.status(422).json({ success: false, mensaje: 'Escribe la novedad.' });

        const proceso = await FichaConfeccionProceso.findByPk(req.params.idProceso, { attributes: ['idProceso'] });
        if (!proceso) return res.status(404).json({ success: false, mensaje: 'Ese proceso no existe.' });

        const fila = await FichaConfeccionProcesoBitacora.create({ idProceso: proceso.idProceso, idUsuario: req.usuario.idUsuario, nota });
        const usuario = await Usuarios.findByPk(req.usuario.idUsuario, { attributes: ['nombreUsuario'] });

        return res.status(201).json({
            success: true,
            bitacora: { idBitacora: fila.idBitacora, nota: fila.nota, createdAt: fila.createdAt, usuario: usuario?.nombreUsuario || '—' }
        });
    } catch (e) {
        console.error('fichaConfeccionProcesoController(bitacora):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar la novedad.' });
    }
};

export { homeProcesosListado, verProceso, avanzarProceso, agregarBitacora };
