import db from '../config/bd.js';
import { Material } from '../models/index.js';
import { actorDelPanel } from '../helpers/inventarioInsumos.js';
import { tenderRollos, adelantarReposo, deshacerTendido, esTelaPorRollo, datosEtiquetasRollos, lineasEtiquetaRollo } from '../helpers/rollosTela.js';
import { nuevoDocEtiquetas, paginaEtiqueta } from '../helpers/etiquetaCodigo.js';

// Estado de los rollos de tela desde el perfil del insumo (admin/insumos/:idMaterial). Las
// reglas viven en helpers/rollosTela.js; esto es la capa del panel. Los tres llegan detrás
// de los mismos candados que el ajuste de existencia (routes/adminRoutes.js): permiso de
// editar insumos de la sesión, código de un empleado de esa sesión y que ese empleado tenga
// el mismo permiso. Adelantar y deshacer piden además un motivo.

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 300;

const leerMotivo = (body) => {
    const motivo = String(body?.motivo ?? '').trim();
    return motivo.length >= MOTIVO_MIN && motivo.length <= MOTIVO_MAX ? motivo : null;
};

const fallo = (res, e, donde, mensaje) => {
    if (e?.publico) return res.status(e.status || 400).json({ success: false, mensaje: e.message });
    console.error(`rollosTelaController(${donde}):`, e);
    return res.status(500).json({ success: false, mensaje });
};

// POST /admin/insumos/:idMaterial/rollos/tender — { idsRollo: [...] }
const tenderRollosMaterial = async (req, res) => {
    try {
        const material = await Material.findByPk(req.params.idMaterial, { attributes: ['idMaterial', 'tipo', 'unidadConsumo'] });
        if (!material || !esTelaPorRollo(material)) return res.status(404).json({ success: false, mensaje: 'Esa tela no existe.' });
        const idsRollo = Array.isArray(req.body?.idsRollo) ? req.body.idsRollo.slice(0, 200).map(String) : [];
        const n = await db.transaction((transaction) =>
            tenderRollos({ idMaterial: material.idMaterial, idsRollo, actor: actorDelPanel(req), transaction }));
        return res.json({ success: true, mensaje: `${n} rollo${n === 1 ? '' : 's'} tendido${n === 1 ? '' : 's'}: quedan en reposo.` });
    } catch (e) {
        return fallo(res, e, 'tender', 'No se pudieron tender los rollos.');
    }
};

// POST /admin/insumos/rollos/:idRollo/adelantar-reposo — { motivo }
const adelantarReposoRollo = async (req, res) => {
    const motivo = leerMotivo(req.body);
    if (!motivo) return res.status(422).json({ success: false, mensaje: `Explica por qué se adelanta el reposo (entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres).` });
    try {
        const rollo = await db.transaction((transaction) =>
            adelantarReposo({ idRollo: req.params.idRollo, motivo, actor: actorDelPanel(req), transaction }));
        return res.json({ success: true, mensaje: `${rollo.codigoRollo} quedó listo para cortar.` });
    } catch (e) {
        return fallo(res, e, 'adelantar', 'No se pudo adelantar el reposo.');
    }
};

// POST /admin/insumos/rollos/:idRollo/deshacer-tendido — { motivo }
const deshacerTendidoRollo = async (req, res) => {
    const motivo = leerMotivo(req.body);
    if (!motivo) return res.status(422).json({ success: false, mensaje: `Explica por qué se deshace el tendido (entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres).` });
    try {
        const rollo = await db.transaction((transaction) =>
            deshacerTendido({ idRollo: req.params.idRollo, motivo, actor: actorDelPanel(req), transaction }));
        return res.json({ success: true, mensaje: `${rollo.codigoRollo} volvió a sin tender.` });
    } catch (e) {
        return fallo(res, e, 'deshacer', 'No se pudo deshacer el tendido.');
    }
};

// GET /admin/insumos/rollos/etiquetas?ids=a,b,c — PDF con una etiqueta de 5,5 × 2,5 cm por
// rollo (la misma impresora que la del SKU), en el orden de `ids`. Lo abren la recepción
// (los rollos que acaban de entrar) y la tarjeta "Rollos de tela" (reimprimir). Solo lectura:
// no pide código de empleado. En streaming (CLAUDE.md §11).
const etiquetasRollos = async (req, res) => {
    try {
        const ids = String(req.query.ids ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const rollos = await datosEtiquetasRollos(ids);
        if (!rollos.length) return res.status(404).send('No se encontraron esos rollos.');
        const doc = nuevoDocEtiquetas();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="rollos_${rollos[0].codigoRollo}${rollos.length > 1 ? `_y_${rollos.length - 1}_mas` : ''}.pdf"`);
        doc.pipe(res);
        for (const f of rollos) await paginaEtiqueta(doc, { codigo: f.codigoRollo, lineas: lineasEtiquetaRollo(f) });
        doc.end();
    } catch (e) {
        console.error('rollosTelaController(etiquetas):', e);
        if (!res.headersSent) res.status(500).send('No se pudieron generar las etiquetas.');
    }
};

export { tenderRollosMaterial, adelantarReposoRollo, deshacerTendidoRollo, etiquetasRollos };
