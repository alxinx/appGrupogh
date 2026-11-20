import { PutObjectCommand } from '@aws-sdk/client-s3';

import db from '../config/bd.js';
import {
    FichaConfeccion, FichaConfeccionColor, FichaConfeccionInsumo, FichaConfeccionTaller, FichaConfeccionTallerColor,
    FichaConfeccionProceso, FichaConfeccionProcesoHistorial,
    FichaConfeccionDxf, FichaConfeccionDxfMaterial, FichaConfeccionMolde, FichaConfeccionMoldeIaIntento, FichaConfeccionVideo,
    Material, Familia, Atributos, Provedores, CategoriasDeProvedores
} from '../models/index.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { keyDocumento, urlDocumento } from '../helpers/almacenamientoDocumentos.js';
import { montoPositivo } from '../helpers/helpers.js';
import { generarPdfFichaConfeccion } from '../helpers/fichaConfeccionPdf.js';
import { coloresSimplesDisponibles } from '../helpers/ordenesCompra.js';
import { presentarMaterial } from '../helpers/insumos.js';
import { CATEGORIA_CONFECCIONISTA } from '../helpers/proveedores.js';

// La categoría de proveedor que puede ser taller de una ficha vive en helpers/proveedores.js.
const CATEGORIA_TALLER = CATEGORIA_CONFECCIONISTA;

// Último paso del asistente "Nueva ficha de confección" — junta lo que el DXF, el molde y
// los videos venían subiendo sueltos (FichaConfeccionDxf/Molde/MoldeIaIntento/Video, todos
// creados en pasos anteriores) en un solo registro, y genera el PDF. No hay "guardar
// borrador": el asistente vive solo en el navegador hasta este POST (CLAUDE.md — no
// inventar persistencia a medias que nadie pidió).

const INCLUDES_PDF = [
    { model: FichaConfeccionDxf, as: 'dxf' },
    { model: FichaConfeccionMolde, as: 'molde' },
    { model: FichaConfeccionMolde, as: 'moldeReferencia' },
    { model: FichaConfeccionMoldeIaIntento, as: 'moldeIaIntento' },
    { model: FichaConfeccionVideo, as: 'videos' },
    { model: FichaConfeccionColor, as: 'colores', include: [{ model: Atributos, as: 'color' }, { model: Material, as: 'material' }] },
    { model: FichaConfeccionInsumo, as: 'insumos' }
];

/** Genera el PDF, lo sube a R2 y guarda la ruta — lo usan finalizarFicha (recién creada) y
 *  verFichaPdf (por si el primer intento falló y hay que generarlo de nuevo bajo demanda). */
async function generarYGuardarPdf(idFicha) {
    const ficha = await FichaConfeccion.findByPk(idFicha, { include: INCLUDES_PDF });
    if (!ficha) throw new Error('Esa ficha no existe.');

    const pdfBuffer = await generarPdfFichaConfeccion(ficha);
    const objectKey = keyDocumento({ carpeta: 'fichas-confeccion', prefijo: 'ficha', idPropietario: idFicha, idx: 0, extension: 'pdf' });
    await r2PrivateClient.send(new PutObjectCommand({
        Bucket: R2_PRIVATE_BUCKET, Key: objectKey, Body: pdfBuffer, ContentType: 'application/pdf', CacheControl: 'no-store'
    }));
    await FichaConfeccion.update({ objectKeyPdf: objectKey }, { where: { idFicha } });
    return { objectKey, referencia: ficha.referencia };
}

// Validaciones compartidas entre finalizarFicha (ficha nueva) y actualizarFichaConfeccion
// (ficha ya creada) — las dos reciben la MISMA forma de body para colores/insumos/talleres
// y tienen que aplicar las MISMAS reglas (CLAUDE.md DRY). Nunca lanzan: devuelven
// `{ error }` para que el controlador decida el status/mensaje de la respuesta.

// Insumos: OPCIONALES (una ficha puede no llevar ninguno — CLAUDE.md, no inventar una
// obligación que nadie pidió). La cantidad es POR PRENDA ("2 botones"): la ficha describe la
// prenda y la orden de producción multiplica (wiki "Proceso de confección").
// `nombreMaterial` se congela acá con el nombre que el material tiene HOY, nunca con el que
// mande el navegador.
async function validarInsumosBody(insumosBody) {
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

// Talleres: OPCIONALES. Cada uno tiene que ser un PROVEDORES real de categoría
// 'Confeccionista' (nunca cualquier proveedor) con su propio precio de confección — dos
// talleres pueden cobrar distinto por la misma prenda (models/FichaConfeccionTaller.js). Los
// colores que se le asignan a un taller tienen que ser de los que la ficha REALMENTE tiene
// (idsColoresFicha, los que la ficha ya tiene guardados) — nunca uno que el navegador
// inventó. Es un tag informativo, no reparte cantidad (models/FichaConfeccionTallerColor.js).
async function validarTalleresBody(talleresBody, idsColoresFicha) {
    if (!talleresBody.length) return { talleresLimpios: [] };

    const idsColoresValidos = new Set(idsColoresFicha);
    const talleresLimpios = [];
    const idsProveedorVistos = new Set();
    for (const fila of talleresBody) {
        const idProveedor = String(fila?.idProveedor ?? '');
        const precioConfeccion = montoPositivo(fila?.precioConfeccion);
        if (!idProveedor) return { error: 'Hay un taller inválido en la lista.' };
        if (precioConfeccion === null) return { error: 'Cada taller necesita un precio de confección mayor a $0.' };
        if (idsProveedorVistos.has(idProveedor)) return { error: 'Un mismo taller no puede estar dos veces en la lista.' };
        idsProveedorVistos.add(idProveedor);

        const idsColoresTaller = [];
        for (const idColor of (Array.isArray(fila?.colores) ? fila.colores : [])) {
            const id = parseInt(idColor, 10);
            if (!Number.isInteger(id) || !idsColoresValidos.has(id)) return { error: 'Un taller tiene asignado un color que no está en la ficha.' };
            idsColoresTaller.push(id);
        }
        talleresLimpios.push({ idProveedor, precioConfeccion, idsColoresTaller: [...new Set(idsColoresTaller)] });
    }

    const idsProveedor = talleresLimpios.map((t) => t.idProveedor);
    const proveedores = await Provedores.findAll({
        where: { idProveedor: idsProveedor },
        include: [{ model: CategoriasDeProvedores, as: 'categorias', attributes: ['nombre'], through: { attributes: [] } }]
    });
    if (proveedores.length !== idsProveedor.length) return { error: 'Alguno de los talleres elegidos no existe.' };
    const noConfeccionista = proveedores.find((p) => !(p.categorias || []).some((c) => c.nombre === CATEGORIA_TALLER));
    if (noConfeccionista) return { error: `${noConfeccionista.razonSocial} no está registrado como confeccionista.` };

    return { talleresLimpios };
}

// POST /admin/procesos/fichas-confeccion/finalizar
const finalizarFicha = async (req, res) => {
    try {
        const idUsuario = req.usuario.idUsuario;
        const precioConfeccion = montoPositivo(req.body?.precioConfeccion);
        if (precioConfeccion === null) {
            return res.status(422).json({ success: false, mensaje: 'El precio de confección debe ser mayor a $0.' });
        }

        const idDxf = req.body?.idDxf;
        if (!idDxf) return res.status(422).json({ success: false, mensaje: 'Falta el archivo DXF del paso 1.' });

        const dxf = await FichaConfeccionDxf.findOne({
            where: { idArchivoDxf: idDxf, idUsuarioCarga: idUsuario },
            include: [
                {
                    model: FichaConfeccionDxfMaterial, as: 'materialesDetalle',
                    separate: true, order: [['orden', 'ASC']],
                    include: [{ model: Material, as: 'material' }]
                },
                { model: Familia, as: 'familiaAsociada' }
            ]
        });
        if (!dxf || dxf.estado !== 'listo') return res.status(422).json({ success: false, mensaje: 'El DXF no está listo todavía.' });

        // Puede haber más de un material en el mismo DXF (helpers/dxf.js) — se exige que
        // TODOS los códigos detectados tengan insumo en el catálogo, no solo el primero:
        // una ficha con una tela sin resolver quedaría con una lista de materiales a medias.
        const materialesDetalle = dxf.materialesDetalle || [];
        if (!materialesDetalle.length) {
            return res.status(422).json({ success: false, mensaje: 'No se identificó ningún material del DXF — revisa el código en el archivo.' });
        }
        const materialesSinInsumo = materialesDetalle.filter((m) => !m.material);
        if (materialesSinInsumo.length) {
            return res.status(422).json({
                success: false,
                mensaje: `No hay insumo para el código de material ${materialesSinInsumo.map((m) => m.codigoMaterial).join(', ')} del DXF.`
            });
        }
        if (!dxf.familiaAsociada) return res.status(422).json({ success: false, mensaje: 'No se identificó la referencia (Style Name) del DXF.' });

        // Sin colores ni cantidad: la ficha describe la prenda (el QUÉ). Cuántas y en qué
        // colores lo dice la orden de producción (wiki "Proceso de confección").
        const cantidadTotal = 0;

        const { insumosLimpios, error: errorInsumos } = await validarInsumosBody(
            Array.isArray(req.body?.insumos) ? req.body.insumos : []
        );
        if (errorInsumos) return res.status(422).json({ success: false, mensaje: errorInsumos });

        // Molde / referencia / intento de IA: opcionales — ver models/FichaConfeccion.js.
        let molde = null;
        if (req.body?.idMolde) {
            molde = await FichaConfeccionMolde.findOne({ where: { idMolde: req.body.idMolde, idUsuarioCarga: idUsuario } });
            if (!molde) return res.status(422).json({ success: false, mensaje: 'El molde indicado no existe.' });
        }
        let moldeReferencia = null;
        if (req.body?.idMoldeReferencia) {
            moldeReferencia = await FichaConfeccionMolde.findOne({ where: { idMolde: req.body.idMoldeReferencia, idUsuarioCarga: idUsuario } });
            if (!moldeReferencia) return res.status(422).json({ success: false, mensaje: 'La foto de referencia indicada no existe.' });
        }
        let moldeIaIntento = null;
        if (req.body?.idMoldeIaIntento) {
            moldeIaIntento = await FichaConfeccionMoldeIaIntento.findOne({ where: { idIntento: req.body.idMoldeIaIntento, aprobado: true } });
            if (!moldeIaIntento) return res.status(422).json({ success: false, mensaje: 'La imagen generada con IA no existe o no fue aprobada.' });
        }

        // Videos: solo los que de verdad son del usuario, ya están listos, y todavía no
        // pertenecen a otra ficha — una lista de ids del body nunca basta sola (§12).
        const idsVideos = (Array.isArray(req.body?.idsVideos) ? req.body.idsVideos : []).filter((id) => typeof id === 'string' && id);
        const videos = idsVideos.length
            ? await FichaConfeccionVideo.findAll({ where: { idVideo: idsVideos, idUsuarioCarga: idUsuario, estado: 'ready', idFicha: null } })
            : [];

        const complementos = String(req.body?.complementos ?? '').trim().slice(0, 2000) || null;
        const observaciones = String(req.body?.observaciones ?? '').trim().slice(0, 2000) || null;

        let t = null;
        let idFicha = null;
        try {
            t = await db.transaction();

            const ficha = await FichaConfeccion.create({
                idUsuarioCreacion: idUsuario,
                idDxf: dxf.idArchivoDxf,
                idMolde: molde?.idMolde || null,
                idMoldeReferencia: moldeReferencia?.idMolde || null,
                idMoldeIaIntento: moldeIaIntento?.idIntento || null,
                referencia: dxf.familiaAsociada.nombreFamilia,
                // Foto del/los material(es) en el momento de guardar — "Mayatext, Polilicra"
                // si el DXF traía más de un código (CLAUDE.md §3: mismo criterio que
                // `referencia`, un texto congelado, no solo la FK).
                materialNombre: materialesDetalle.map((m) => m.material.nombre).join(', '),
                complementos,
                observaciones,
                precioConfeccion,
                cantidadTotal,
                estado: 'activa'
            }, { transaction: t });
            idFicha = ficha.idFicha;

            if (insumosLimpios.length) {
                await FichaConfeccionInsumo.bulkCreate(
                    insumosLimpios.map((i, idx) => ({ idFicha, idMaterial: i.idMaterial, nombreMaterial: i.nombreMaterial, cantidad: i.cantidad, orden: idx + 1 })),
                    { transaction: t }
                );
            }

            if (videos.length) {
                await FichaConfeccionVideo.update(
                    { idFicha },
                    { where: { idVideo: videos.map((v) => v.idVideo) }, transaction: t }
                );
            }

            await t.commit();
        } catch (e) {
            if (t && !t.finished) await t.rollback().catch(() => {});
            console.error('fichaConfeccionController(finalizar) transacción:', e);
            return res.status(500).json({ success: false, mensaje: 'No se pudo guardar la ficha. Intenta de nuevo.' });
        }

        // El PDF va DESPUÉS del commit, en su propio try (CLAUDE.md §9): si falla, la ficha
        // ya quedó guardada — queda sin `objectKeyPdf` y se genera bajo demanda la próxima
        // vez que alguien la abra (verFichaPdf, abajo).
        try {
            const { objectKey, referencia } = await generarYGuardarPdf(idFicha);
            const pdfUrl = await urlDocumento(objectKey, { nombre: `ficha-confeccion-${referencia}.pdf` });
            return res.status(201).json({ success: true, idFicha, pdfUrl });
        } catch (e) {
            console.error('fichaConfeccionController(finalizar) pdf:', e);
            return res.status(201).json({
                success: true, idFicha, pdfUrl: null,
                avisoPdf: 'La ficha se guardó, pero el PDF no se pudo generar todavía. Ábrela desde la Biblioteca para reintentarlo.'
            });
        }
    } catch (e) {
        console.error('fichaConfeccionController(finalizar):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar la ficha. Intenta de nuevo.' });
    }
};

// GET /admin/procesos/fichas-confeccion/:idFicha/pdf — abre el PDF (firmado, de corta
// vida). Si por lo que sea no se había generado todavía, lo genera acá mismo antes de
// redirigir — así la Biblioteca nunca necesita un botón aparte de "reintentar".
const verFichaPdf = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findByPk(req.params.idFicha, { attributes: ['idFicha', 'referencia', 'objectKeyPdf'] });
        if (!ficha) return res.status(404).send('Esa ficha no existe.');

        const objectKey = ficha.objectKeyPdf || (await generarYGuardarPdf(ficha.idFicha)).objectKey;
        const url = await urlDocumento(objectKey, { nombre: `ficha-confeccion-${ficha.referencia}.pdf` });
        return res.redirect(url);
    } catch (e) {
        console.error('fichaConfeccionController(verPdf):', e);
        return res.status(500).send('No se pudo generar el PDF de la ficha.');
    }
};

// GET /admin/procesos/fichas-confeccion/:idFicha/dxf — descarga el DXF original (firmado,
// de corta vida), mismo patrón que verFichaPdf. La tela/familia NO se re-edita desde acá
// (ver el aviso de homeFichaConfeccionEditar) pero el patronista sigue necesitando bajar el
// archivo de corte.
const verFichaDxf = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findByPk(req.params.idFicha, {
            attributes: ['idFicha'],
            include: [{ model: FichaConfeccionDxf, as: 'dxf', attributes: ['objectKey', 'nombreOriginal'] }]
        });
        if (!ficha || !ficha.dxf?.objectKey) return res.status(404).send('Esa ficha no tiene un DXF para descargar.');

        const url = await urlDocumento(ficha.dxf.objectKey, { nombre: ficha.dxf.nombreOriginal });
        return res.redirect(url);
    } catch (e) {
        console.error('fichaConfeccionController(verDxf):', e);
        return res.status(500).send('No se pudo descargar el DXF.');
    }
};

// GET /admin/procesos/fichas-confeccion/:idFicha — "Abrir" desde la Biblioteca: el editor
// completo. La tela (Mayatext, Polilicra…) y la familia/referencia-de-catálogo SIGUEN
// saliendo del DXF y no se re-editan acá — cambiarlas re-dispararía toda la resolución de
// materiales/familia del paso 1 del asistente, que es un flujo aparte. Lo que SÍ es
// editable: nombre de referencia, colores (agregar/quitar/cantidad), insumos
// (agregar/quitar), talleres de confección con su propio precio y los colores que le tocan
// a cada uno, más videos adicionales — exactamente lo que pidió el usuario.
const homeFichaConfeccionEditar = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findByPk(req.params.idFicha, {
            include: [
                {
                    model: FichaConfeccionDxf, as: 'dxf',
                    include: [{
                        model: FichaConfeccionDxfMaterial, as: 'materialesDetalle',
                        separate: true, order: [['orden', 'ASC']],
                        include: [{ model: Material, as: 'material', attributes: ['idMaterial', 'nombre', 'codigoMaterial'] }]
                    }]
                },
                { model: FichaConfeccionMolde, as: 'molde' },
                { model: FichaConfeccionMolde, as: 'moldeReferencia' },
                { model: FichaConfeccionMoldeIaIntento, as: 'moldeIaIntento' },
                { model: FichaConfeccionColor, as: 'colores', include: [{ model: Atributos, as: 'color' }, { model: Material, as: 'material' }] },
                { model: FichaConfeccionInsumo, as: 'insumos' },
                { model: FichaConfeccionVideo, as: 'videos' },
                {
                    model: FichaConfeccionTaller, as: 'talleres',
                    include: [
                        { model: Provedores, as: 'proveedor', attributes: ['idProveedor', 'razonSocial'] },
                        { model: FichaConfeccionTallerColor, as: 'colores', include: [{ model: Atributos, as: 'color' }] }
                    ]
                }
            ]
        });
        if (!ficha) return res.status(404).send('Esa ficha no existe.');

        // Catálogos que necesita el editor — mismo criterio y mismos helpers que ya usa el
        // asistente de la ficha nueva (CLAUDE.md DRY): colores simples para "Agregar color"
        // (helpers/ordenesCompra.js, nunca combinados), insumos activos con foto para
        // "Agregar insumo" (helpers/insumos.js presentarMaterial), y los proveedores de
        // categoría 'Confeccionista' para "Agregar taller".
        const [coloresCatalogo, insumosCatalogo, confeccionistas] = await Promise.all([
            coloresSimplesDisponibles(),
            Material.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] }).then((filas) => filas.map(presentarMaterial)),
            Provedores.findAll({
                include: [{ model: CategoriasDeProvedores, as: 'categorias', attributes: [], where: { nombre: CATEGORIA_TALLER }, through: { attributes: [] } }],
                attributes: ['idProveedor', 'razonSocial'],
                order: [['razonSocial', 'ASC']]
            })
        ]);

        // Imágenes de "Referencias visuales" — igual que el PDF (helpers/fichaConfeccionPdf.js
        // cajaImagen), pero acá hace falta una URL para un <img>, no los bytes: un molde en
        // PDF no tiene con qué mostrarse (mismo límite de siempre, este proyecto no
        // rasteriza PDF a imagen), y el intento de IA solo cuenta si quedó aprobado.
        // Enriquecer materiales del DXF con nombrePadre para los de código compuesto (ej. 2.1)
        const detalleDxf = ficha.dxf?.materialesDetalle || [];
        const codigosPadreDxf = [...new Set(
            detalleDxf.map(f => f.material?.codigoMaterial).filter(c => c?.includes('.')).map(c => c.split('.')[0])
        )];
        if (codigosPadreDxf.length) {
            const padres = await Material.findAll({ where: { codigoMaterial: codigosPadreDxf }, attributes: ['codigoMaterial', 'nombre'] });
            const padrePorCodigo = new Map(padres.map(p => [p.codigoMaterial, p.nombre]));
            detalleDxf.forEach(f => {
                if (f.material?.codigoMaterial?.includes('.'))
                    f.material.nombrePadre = padrePorCodigo.get(f.material.codigoMaterial.split('.')[0]) || null;
            });
        }

        const [moldeImagenUrl, moldeIaImagenUrl, moldeReferenciaImagenUrl] = await Promise.all([
            ficha.molde?.tipoArchivo === 'jpg' && ficha.molde?.objectKey ? urlDocumento(ficha.molde.objectKey) : null,
            ficha.moldeIaIntento?.aprobado && ficha.moldeIaIntento?.objectKeyFinal ? urlDocumento(ficha.moldeIaIntento.objectKeyFinal) : null,
            ficha.moldeReferencia?.objectKey ? urlDocumento(ficha.moldeReferencia.objectKey) : null
        ]);

        return res.render('./administrador/produccion/fichaConfeccionEditar', {
            pagina: 'Fichas de confección',
            subPagina: ficha.referencia,
            currentPath: '/procesos',
            ficha,
            coloresCatalogo,
            insumosCatalogo,
            confeccionistas,
            moldeImagenUrl,
            moldeIaImagenUrl,
            moldeReferenciaImagenUrl
        });
    } catch (e) {
        console.error('fichaConfeccionController(editar):', e);
        return res.status(500).send('No se pudo cargar la ficha.');
    }
};

// POST /admin/procesos/fichas-confeccion/:idFicha/actualizar — guarda TODO lo editable del
// editor en un solo POST (mismo criterio que finalizarFicha: el front junta el estado
// completo y lo manda de una vez, no hay autosave por campo). Colores/insumos/talleres se
// reemplazan enteros (borrar + recrear) en vez de un diff granular — son pocas filas por
// ficha (CLAUDE.md §7) y así no hay que inventar un endpoint por línea.
const actualizarFichaConfeccion = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findOne({
            where: { idFicha: req.params.idFicha, estado: 'activa' },
            include: [{
                model: FichaConfeccionDxf, as: 'dxf',
                include: [{
                    model: FichaConfeccionDxfMaterial, as: 'materialesDetalle',
                    separate: true, order: [['orden', 'ASC']],
                    include: [{ model: Material, as: 'material' }]
                }]
            }]
        });
        if (!ficha) return res.status(404).json({ success: false, mensaje: 'Esa ficha no existe.' });

        const referencia = String(req.body?.referencia ?? '').trim().slice(0, 150);
        if (!referencia) return res.status(422).json({ success: false, mensaje: 'Escribe una referencia.' });

        const precioConfeccion = montoPositivo(req.body?.precioConfeccion);
        if (precioConfeccion === null) {
            return res.status(422).json({ success: false, mensaje: 'El precio de confección debe ser mayor a $0.' });
        }
        // Cantidad y colores ya no se editan acá: la ficha describe la prenda y sus insumos
        // van por prenda (wiki "Proceso de confección"); cuántas y en qué colores lo dirá la
        // orden de producción. Lo que la ficha ya tenía guardado se conserva tal cual.
        const cantidadTotal = ficha.cantidadTotal;
        const complementos = String(req.body?.complementos ?? '').trim().slice(0, 2000) || null;
        const observaciones = String(req.body?.observaciones ?? '').trim().slice(0, 2000) || null;

        // Insumos por prenda: sin tope contra una cantidad total que la ficha ya no maneja.
        const { insumosLimpios, error: errorInsumos } = await validarInsumosBody(
            Array.isArray(req.body?.insumos) ? req.body.insumos : []
        );
        if (errorInsumos) return res.status(422).json({ success: false, mensaje: errorInsumos });

        // Los colores que se le marcan a un taller tienen que ser de la ficha: los que ya
        // tenía guardados (hoy, ninguno en una ficha nueva).
        const idsColoresFicha = (await FichaConfeccionColor.findAll({ where: { idFicha: ficha.idFicha }, attributes: ['idAtributoColor'] }))
            .map((c) => c.idAtributoColor);
        const { talleresLimpios, error: errorTalleres } = await validarTalleresBody(
            Array.isArray(req.body?.talleres) ? req.body.talleres : [], idsColoresFicha
        );
        if (errorTalleres) return res.status(422).json({ success: false, mensaje: errorTalleres });

        // Talleres existentes de la ficha, con su proceso — hace falta ANTES de la
        // transacción para decidir qué se puede tocar: un taller con seguimiento ya
        // arrancado (estado != 'asignado') no se puede borrar ni recrear desde acá, se
        // perdería su historial y su bitácora. Por eso esto ya NO es un destroy+recreate
        // como colores/insumos — es un diff (CLAUDE.md, no perder datos de producción real).
        const talleresExistentes = await FichaConfeccionTaller.findAll({
            where: { idFicha: ficha.idFicha },
            include: [{ model: FichaConfeccionProceso, as: 'proceso' }]
        });
        const idsProveedorNuevos = new Set(talleresLimpios.map((t) => t.idProveedor));
        const talleresQueSeQuitan = talleresExistentes.filter((ex) => !idsProveedorNuevos.has(ex.idProveedor));
        const bloqueado = talleresQueSeQuitan.find((ex) => ex.proceso && ex.proceso.estado !== 'asignado');
        if (bloqueado) {
            return res.status(422).json({
                success: false,
                mensaje: 'No se puede quitar un taller que ya tiene seguimiento de producción iniciado.'
            });
        }

        let t = null;
        try {
            t = await db.transaction();

            await FichaConfeccion.update(
                { referencia, complementos, observaciones, precioConfeccion, cantidadTotal },
                { where: { idFicha: ficha.idFicha }, transaction: t }
            );

            await FichaConfeccionInsumo.destroy({ where: { idFicha: ficha.idFicha }, transaction: t });
            if (insumosLimpios.length) {
                await FichaConfeccionInsumo.bulkCreate(
                    insumosLimpios.map((ins, idx) => ({ idFicha: ficha.idFicha, idMaterial: ins.idMaterial, nombreMaterial: ins.nombreMaterial, cantidad: ins.cantidad, orden: idx + 1 })),
                    { transaction: t }
                );
            }

            // Talleres: diff, no destroy+recreate (ver el aviso de arriba) — un taller que
            // ya existía conserva su idDetalle y, con él, su FichaConfeccionProceso con todo
            // el historial/bitácora que tenga. Los colores asignados a cada taller (la parte
            // sin seguimiento, un simple tag) sí se reemplazan enteros, es barato.
            const porProveedorExistente = new Map(talleresExistentes.map((ex) => [ex.idProveedor, ex]));

            // Quitar los que ya no están (acá sí es seguro: la única razón por la que
            // llegaron hasta este punto es que su proceso seguía en 'asignado' — el filtro
            // de arriba ya habría cortado con un 422 si alguno tenía seguimiento real).
            if (talleresQueSeQuitan.length) {
                await FichaConfeccionTaller.destroy({
                    where: { idDetalle: talleresQueSeQuitan.map((ex) => ex.idDetalle) },
                    transaction: t
                });
            }

            for (let i = 0; i < talleresLimpios.length; i++) {
                const datos = talleresLimpios[i];
                const existente = porProveedorExistente.get(datos.idProveedor);
                let idTaller;

                if (existente) {
                    await existente.update({ precioConfeccion: datos.precioConfeccion, orden: i + 1 }, { transaction: t });
                    idTaller = existente.idDetalle;
                } else {
                    const nuevoTaller = await FichaConfeccionTaller.create({
                        idFicha: ficha.idFicha,
                        idProveedor: datos.idProveedor,
                        precioConfeccion: datos.precioConfeccion,
                        orden: i + 1
                    }, { transaction: t });
                    idTaller = nuevoTaller.idDetalle;

                    // Nace el seguimiento de producción — pedido explícito del usuario: "si
                    // existen confeccionistas en esta hoja, crearemos el nuevo proceso".
                    const nuevoProceso = await FichaConfeccionProceso.create(
                        { idTaller, estado: 'asignado' },
                        { transaction: t }
                    );
                    await FichaConfeccionProcesoHistorial.create(
                        { idProceso: nuevoProceso.idProceso, estado: 'asignado', idUsuario: req.usuario.idUsuario },
                        { transaction: t }
                    );
                }

                await FichaConfeccionTallerColor.destroy({ where: { idTaller }, transaction: t });
                if (datos.idsColoresTaller.length) {
                    await FichaConfeccionTallerColor.bulkCreate(
                        datos.idsColoresTaller.map((idAtributoColor) => ({ idTaller, idAtributoColor })),
                        { transaction: t }
                    );
                }
            }

            await t.commit();
        } catch (e) {
            if (t && !t.finished) await t.rollback().catch(() => {});
            console.error('fichaConfeccionController(actualizar) transacción:', e);
            return res.status(500).json({ success: false, mensaje: 'No se pudo guardar los cambios. Intenta de nuevo.' });
        }

        // El PDF va DESPUÉS del commit, en su propio try (CLAUDE.md §9).
        try {
            const { objectKey, referencia: referenciaPdf } = await generarYGuardarPdf(ficha.idFicha);
            const pdfUrl = await urlDocumento(objectKey, { nombre: `ficha-confeccion-${referenciaPdf}.pdf` });
            return res.json({ success: true, pdfUrl, cantidadTotal });
        } catch (e) {
            console.error('fichaConfeccionController(actualizar) pdf:', e);
            return res.json({ success: true, pdfUrl: null, cantidadTotal, avisoPdf: 'Se guardaron los cambios, pero el PDF no se pudo regenerar todavía.' });
        }
    } catch (e) {
        console.error('fichaConfeccionController(actualizar):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar los cambios.' });
    }
};

export { finalizarFicha, verFichaPdf, verFichaDxf, homeFichaConfeccionEditar, actualizarFichaConfeccion };
