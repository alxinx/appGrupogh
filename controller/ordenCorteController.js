import db from '../config/bd.js';
import {
    OrdenCorte, OrdenCorteReferencia, OrdenCortePieza, OrdenCorteRollo, OrdenCorteEstado,
    FichaConfeccion, FichaConfeccionDxf, Material, InsumoRollo, Atributos, OrdenProduccion, Familia,
    InsumoCapa, DetallesOrdenCompra, OrdenesCompra, Provedores
} from '../models/index.js';
import { pdfOrdenCorte } from '../helpers/ordenCortePdf.js';
import { actorDelPanel } from '../helpers/inventarioInsumos.js';
import { estadoVisible, ETIQUETA_ESTADO_ROLLO } from '../helpers/rollosTela.js';
import { urlDocumento } from '../helpers/almacenamientoDocumentos.js';
import { resultadoReferencia } from '../helpers/trazo.js';
import { etiquetaTalla, ETIQUETA_ESTADO_ORDEN } from '../helpers/ordenesProduccion.js';
import { fechaHoyBogota } from '../helpers/fechas.js';
import { escaparHtml } from '../src/js/escaparHtml.js';
import {
    analizarTrazo, analisisParaNavegador, validarCorte, crearOrdenCorte, registrarCorte, cancelarCorte,
    cantidadesDeCorte, faltantesFicha, ETIQUETA_ESTADO_CORTE, LIMITES_CORTE
} from '../helpers/ordenesCorte.js';
import { presentarMaterial } from '../helpers/insumos.js';
import { VIDEOS_POR_FICHA_MAX } from '../helpers/fichaConfeccionDatos.js';

// Órdenes de corte (admin/procesos/cortes). Las reglas viven en helpers/ordenesCorte.js y la
// lectura del trazo en helpers/trazo.js; esto es la capa del panel. Permiso Procesos
// (CREATE subir el trazo y armar el corte, READ ver, DELETE cancelar). Registrar el corte
// mueve tela: además pide el código de un empleado con Insumos EDIT (routes/adminRoutes.js).

const BASE = '/admin/procesos/cortes';

const fallo = (res, e, donde, mensaje) => {
    if (e?.publico) return res.status(e.status || 400).json({ success: false, mensaje: e.message });
    console.error(`ordenCorteController(${donde}):`, e);
    return res.status(500).json({ success: false, mensaje });
};

const sumaPrendas = (porTalla) => Object.values(porTalla || {}).reduce((s, n) => s + (Number(n) || 0), 0);

// ── Pantallas ────────────────────────────────────────────────────────────────────────────

const FILTROS = { abiertos: ['borrador'], cortada: ['cortada'], cancelada: ['cancelada'], todos: null };
const POR_PAGINA = 50;

// GET /admin/procesos/cortes?estado=abiertos|cortada|cancelada|todos&pagina=N
const homeCortes = async (req, res) => {
    try {
        const filtro = Object.hasOwn(FILTROS, req.query.estado) ? req.query.estado : 'todos';
        const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
        const { rows, count } = await OrdenCorte.findAndCountAll({
            where: FILTROS[filtro] ? { estado: FILTROS[filtro] } : {},
            attributes: ['idOrdenCorte', 'numeroCorte', 'estado', 'largoCm', 'fechaRequerida', 'createdAt', 'nombreArchivo'],
            include: [{ model: Material, as: 'material', attributes: ['nombre'] }],
            order: [['createdAt', 'DESC'], ['idOrdenCorte', 'ASC']],   // orden total (§8)
            limit: POR_PAGINA,
            offset: (pagina - 1) * POR_PAGINA
        });
        // Referencias y rollos de la página: dos consultas, no una por corte (§7).
        const ids = rows.map(c => c.idOrdenCorte);
        const [refs, rollos] = ids.length
            ? await Promise.all([
                OrdenCorteReferencia.findAll({ where: { idOrdenCorte: ids }, attributes: ['idOrdenCorte', 'estilo', 'prendasPorCapa'], order: [['orden', 'ASC']], raw: true }),
                OrdenCorteRollo.findAll({ where: { idOrdenCorte: ids }, attributes: ['idOrdenCorte', 'capas'], raw: true })
            ])
            : [[], []];
        const capas = new Map();
        rollos.forEach(r => capas.set(r.idOrdenCorte, (capas.get(r.idOrdenCorte) || 0) + r.capas));
        const porCorte = new Map();
        refs.forEach(r => {
            if (!porCorte.has(r.idOrdenCorte)) porCorte.set(r.idOrdenCorte, []);
            porCorte.get(r.idOrdenCorte).push(r);
        });
        return res.render('./administrador/produccion/ordenesCorte', {
            pagina: 'Órdenes de corte',
            subPagina: 'Listado',
            currentPath: '/procesos',
            cortes: rows.map(c => {
                const lista = porCorte.get(c.idOrdenCorte) || [];
                const n = capas.get(c.idOrdenCorte) || 0;
                return {
                    idOrdenCorte: c.idOrdenCorte, numeroCorte: c.numeroCorte, estado: c.estado,
                    tela: c.material?.nombre || '—', largoM: Number(c.largoCm) / 100,
                    referencias: lista.map(r => r.estilo), capas: n,
                    prendas: lista.reduce((s, r) => s + sumaPrendas(r.prendasPorCapa), 0) * n,
                    fechaRequerida: c.fechaRequerida, createdAt: c.createdAt
                };
            }),
            filtro,
            filtros: Object.keys(FILTROS),
            paginaActual: pagina,
            totalPaginas: Math.max(1, Math.ceil(count / POR_PAGINA)),
            total: count,
            etiquetaEstado: ETIQUETA_ESTADO_CORTE
        });
    } catch (e) {
        console.error('ordenCorteController(listado):', e);
        return res.status(500).send('No se pudo cargar el listado de cortes.');
    }
};

// GET /admin/procesos/cortes/nuevo — subir el trazo. Las familias son para el modal "crear
// la ficha ahora" (lista de sugerencias; el nombre se resuelve igual que en el asistente).
const homeCorteNuevo = async (req, res) => {
    try {
        // Las familias y los insumos (catálogo con foto, el mismo del asistente "Nueva ficha":
        // presentarMaterial) son para el modal "crear la ficha ahora".
        const [familias, materiales] = await Promise.all([
            Familia.findAll({ attributes: ['nombreFamilia'], order: [['nombreFamilia', 'ASC']], raw: true }),
            Material.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] })
        ]);
        return res.render('./administrador/produccion/ordenCorteNueva', {
            pagina: 'Órdenes de corte',
            subPagina: 'Nuevo corte',
            currentPath: '/procesos',
            hoy: fechaHoyBogota(),
            limites: { ...LIMITES_CORTE, videosMax: VIDEOS_POR_FICHA_MAX },
            familias: familias.map(f => f.nombreFamilia),
            insumos: materiales.map(presentarMaterial)
        });
    } catch (e) {
        console.error('ordenCorteController(nuevo):', e);
        return res.status(500).send('No se pudo abrir el corte nuevo.');
    }
};

// El detalle de un corte, ya presentado: una sola copia para la pantalla y el PDF. null si no
// existe. Consultas fijas: referencias y rollos van con `separate` (una consulta cada uno).
async function detalleCorte(idOrdenCorte) {
    const corte = await OrdenCorte.findByPk(idOrdenCorte, {
        include: [
            { model: Material, as: 'material', attributes: ['idMaterial', 'nombre', 'codigoMaterial'] },
            {
                model: OrdenCorteReferencia, as: 'referencias', separate: true, order: [['orden', 'ASC']],
                include: [
                    { model: OrdenCortePieza, as: 'piezas' },
                    {
                        model: FichaConfeccion, as: 'ficha', attributes: ['idFicha', 'referencia', 'estado', 'idMolde'],
                        include: [{
                            model: FichaConfeccionDxf, as: 'dxf', attributes: ['idFamiliaAsociada'],
                            include: [{ model: Familia, as: 'familiaAsociada', attributes: ['nombreFamilia'] }]
                        }]
                    }
                ]
            },
            {
                model: OrdenCorteRollo, as: 'rollos', separate: true, order: [['idDetalle', 'ASC']],
                include: [
                    {
                        model: InsumoRollo, as: 'rollo', attributes: ['idRollo', 'codigoRollo', 'estado', 'listoDesde', 'metrajeActualCm'],
                        // El proveedor de la tela: la compra que hizo entrar la capa del rollo
                        // (un rollo que entró por ajuste no tiene).
                        include: [{
                            model: InsumoCapa, as: 'capa', attributes: ['idCapa'],
                            include: [{
                                model: DetallesOrdenCompra, as: 'detalleOrdenCompra', attributes: ['idDetalleOrdenCompra'],
                                include: [{
                                    model: OrdenesCompra, as: 'orden', attributes: ['idOrdenCompra'],
                                    include: [{ model: Provedores, as: 'proveedor', attributes: ['razonSocial'] }]
                                }]
                            }]
                        }]
                    },
                    { model: Atributos, as: 'color', attributes: ['idAtributo', 'valor', 'codigo1'] }
                ]
            },
            { model: OrdenProduccion, as: 'ordenesConfeccion', attributes: ['idOrdenProduccion', 'numeroProduccion', 'referencia', 'estado'] }
        ]
    });
    if (!corte) return null;

    const capasTotal = corte.rollos.reduce((s, r) => s + r.capas, 0);
    const colores = [];
    for (const r of corte.rollos) {
        if (!colores.some(c => c.idAtributo === r.idAtributoColor)) colores.push({ idAtributo: r.idAtributoColor, valor: r.color?.valor || '—', hex: r.color?.codigo1 || null });
    }
    const ahora = new Date();
    const rollos = corte.rollos.map(r => {
        const visible = r.rollo ? estadoVisible(r.rollo, ahora) : 'agotado';
        return {
            codigo: r.rollo?.codigoRollo || '—', color: r.color?.valor || '—', colorHex: r.color?.codigo1 || null,
            capas: r.capas, metros: Number(r.cmUsados) / 100, costo: r.costo,
            estado: ETIQUETA_ESTADO_ROLLO[visible] || visible,
            // En borrador: ¿todavía se puede cortar?
            problema: corte.estado !== 'borrador' ? null
                : visible !== 'listo' ? 'ya no está listo para cortar'
                    : Number(r.rollo.metrajeActualCm) < Number(r.cmUsados) ? 'ya no le alcanza la tela' : null
        };
    });

    const referencias = corte.referencias.map(ref => {
        const colocadas = ref.piezas.map(p => ({ nombre: p.nombrePieza, talla: p.talla, colocadas: p.colocadas, porPrenda: p.porPrenda }));
        const tallas = Object.keys(ref.prendasPorCapa || {});
        const resultado = resultadoReferencia({ colocadas, receta: null, faltanPiezas: ref.faltanPiezas, piezasSueltas: ref.piezasSueltas });
        const cantidades = ref.piezasSueltas === 'excluir' ? [] : cantidadesDeCorte(ref.prendasPorCapa, corte.rollos);
        const celda = new Map(cantidades.map(c => [`${c.idAtributoColor}|${c.talla}`, c.cantidad]));
        const porPrenda = Object.fromEntries(colocadas.map(p => [`${p.nombre}|${p.talla}`, p.porPrenda]));
        return {
            estilo: ref.estilo,
            ficha: ref.ficha ? { idFicha: ref.ficha.idFicha, referencia: ref.ficha.referencia, estado: ref.ficha.estado, faltan: faltantesFicha(ref.ficha) } : null,
            fichaCreadaEnCorte: ref.fichaCreadaEnCorte,
            excluida: ref.piezasSueltas === 'excluir',
            pendientes: ref.piezasSueltas === 'pendientes',
            faltanPiezas: ref.faltanPiezas,
            tallas: tallas.map(t => ({ codigo: t, etiqueta: etiquetaTalla(t), porCapa: ref.prendasPorCapa[t] })),
            grilla: colores.map(c => ({ color: c, porTalla: Object.fromEntries(tallas.map(t => [t, celda.get(`${c.idAtributo}|${t}`) || 0])) })),
            prendas: cantidades.reduce((s, c) => s + c.cantidad, 0),
            piezas: ref.piezas.map(p => ({
                nombre: p.nombrePieza, talla: etiquetaTalla(p.talla), porCapa: p.colocadas, porPrenda: p.porPrenda,
                total: ref.piezasSueltas === 'excluir' ? 0 : p.colocadas * capasTotal
            })),
            sueltas: ref.piezasSueltas === 'excluir' ? [] : (ref.faltanPiezas ? resultado.sueltas : sueltasCon(ref, porPrenda)).map(s => ({ ...s, talla: etiquetaTalla(s.talla), total: s.cantidad * capasTotal })),
            cmTela: ref.cmTela, costoTela: ref.costoTela,
            tipoPrenda: ref.ficha?.dxf?.familiaAsociada?.nombreFamilia || null
        };
    });

    return {
        corte,
        aprovechamiento: (Number(corte.areaPiezasCm2) / (Number(corte.largoCm) * Number(corte.anchoCm)) * 100).toFixed(1),
        capasTotal,
        metrosTotal: corte.rollos.reduce((s, r) => s + Number(r.cmUsados), 0) / 100,
        colores,
        rollos,
        proveedores: [...new Set(corte.rollos.map(r => r.rollo?.capa?.detalleOrdenCompra?.orden?.proveedor?.razonSocial).filter(Boolean))],
        referencias
    };
}

// GET /admin/procesos/cortes/:idOrdenCorte — detalle.
const verCorte = async (req, res) => {
    try {
        const detalle = await detalleCorte(req.params.idOrdenCorte);
        if (!detalle) return res.status(404).send('Esa orden de corte no existe.');
        const { corte, rollos, referencias } = detalle;

        const historial = await OrdenCorteEstado.findAll({ where: { idOrdenCorte: corte.idOrdenCorte }, order: [['createdAt', 'DESC'], ['idRegistro', 'DESC']], raw: true });
        const fichasPorTerminar = referencias.filter(r => r.ficha && r.ficha.faltan.length && !r.excluida);

        return res.render('./administrador/produccion/ordenCorteDetalle', {
            pagina: 'Órdenes de corte',
            subPagina: corte.numeroCorte,
            currentPath: '/procesos',
            corte,
            subtituloSeguro: escaparHtml(`${corte.material?.nombre || ''} · trazo de ${(Number(corte.largoCm) / 100).toLocaleString('es-CO')} m × ${(Number(corte.anchoCm) / 100).toLocaleString('es-CO')} m`),
            aprovechamiento: detalle.aprovechamiento,
            capasTotal: detalle.capasTotal,
            metrosTotal: detalle.metrosTotal,
            rollos,
            conProblema: rollos.some(r => r.problema),
            referencias,
            fichasPorTerminar,
            ordenes: corte.ordenesConfeccion,
            historial,
            etiquetaEstado: ETIQUETA_ESTADO_CORTE,
            etiquetaEstadoOrden: ETIQUETA_ESTADO_ORDEN,
            limites: LIMITES_CORTE
        });
    } catch (e) {
        console.error('ordenCorteController(ver):', e);
        return res.status(500).send('No se pudo cargar la orden de corte.');
    }
};

// Piezas que sobran por capa con lo que se guardó (prendasPorCapa ya tiene las respuestas).
const sueltasCon = (ref, porPrenda) => ref.piezas
    .map(p => {
        const usadas = (ref.prendasPorCapa?.[p.talla] || 0) * (porPrenda[`${p.nombrePieza}|${p.talla}`] || 1);
        return { nombre: p.nombrePieza, talla: p.talla, cantidad: p.colocadas - usadas };
    })
    .filter(s => s.cantidad > 0);

// GET /admin/procesos/cortes/:idOrdenCorte/pdf — la hoja de la orden de corte para el
// cortador (el formato que se usaba a mano: referencia, tipo de prenda, tallas, veces por
// talla, piezas y qué separar), con los datos del corte. En streaming (§11).
const pdfCorte = async (req, res) => {
    try {
        const detalle = await detalleCorte(req.params.idOrdenCorte);
        if (!detalle) return res.status(404).send('Esa orden de corte no existe.');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="orden-corte-${detalle.corte.numeroCorte}.pdf"`);
        pdfOrdenCorte(detalle, res);
    } catch (e) {
        console.error('ordenCorteController(pdf):', e);
        if (!res.headersSent) return res.status(500).send('No se pudo generar el PDF del corte.');
        res.end();
    }
};

// GET /admin/procesos/cortes/:idOrdenCorte/trazo — el DXF que se subió (enlace firmado corto).
const verTrazoCorte = async (req, res) => {
    try {
        const corte = await OrdenCorte.findByPk(req.params.idOrdenCorte, { attributes: ['objectKey', 'nombreArchivo'] });
        if (!corte) return res.status(404).send('Esa orden de corte no existe.');
        return res.redirect(await urlDocumento(corte.objectKey, { nombre: corte.nombreArchivo }));
    } catch (e) {
        console.error('ordenCorteController(trazo):', e);
        return res.status(500).send('No se pudo abrir el trazo.');
    }
};

// ── Escritura ────────────────────────────────────────────────────────────────────────────

// POST /admin/procesos/cortes/analizar — multipart con el DXF. No guarda nada.
const analizarTrazoCorte = async (req, res) => {
    try {
        if (!req.file?.buffer?.length) return res.status(422).json({ success: false, mensaje: 'No se recibió ningún archivo.' });
        const analisis = await analizarTrazo(req.file.buffer);
        return res.json({ success: true, analisis: analisisParaNavegador(analisis), nombreArchivo: req.file.originalname });
    } catch (e) {
        return fallo(res, e, 'analizar', 'No se pudo leer el trazo.');
    }
};

// POST /admin/procesos/cortes — multipart: el DXF otra vez + `datos` (JSON con las
// respuestas). El servidor vuelve a leer el archivo: nunca toma el análisis del navegador.
const crearCorte = async (req, res) => {
    try {
        if (!req.file?.buffer?.length) return res.status(422).json({ success: false, mensaje: 'No se recibió el trazo.' });
        let body;
        try { body = JSON.parse(String(req.body?.datos ?? '{}')); } catch { return res.status(422).json({ success: false, mensaje: 'Las respuestas llegaron dañadas: recarga la página.' }); }

        const analisis = await analizarTrazo(req.file.buffer);
        const { datos, error } = await validarCorte(body, analisis, req.usuario.idUsuario);
        if (error) return res.status(422).json({ success: false, mensaje: error });

        const { orden } = await crearOrdenCorte({
            buffer: req.file.buffer, nombreArchivo: req.file.originalname, analisis, datos,
            idUsuario: req.usuario.idUsuario, actor: actorDelPanel(req)
        });

        // El PDF de cada ficha base no se genera acá: se arma la primera vez que alguien lo abre
        // (verFichaPdf). Generarlos en fila hacía esperar ~1 s por ficha nueva.
        return res.status(201).json({ success: true, numeroCorte: orden.numeroCorte, url: `${BASE}/${orden.idOrdenCorte}` });
    } catch (e) {
        return fallo(res, e, 'crear', 'No se pudo crear la orden de corte.');
    }
};

// POST /admin/procesos/cortes/:idOrdenCorte/registrar — { codigoEmpleado }.
const registrarCorteHandler = async (req, res) => {
    try {
        const { corte, ordenes } = await db.transaction((transaction) => registrarCorte({
            idOrdenCorte: req.params.idOrdenCorte, actor: actorDelPanel(req), idUsuario: req.usuario.idUsuario, transaction
        }));
        return res.json({
            success: true,
            mensaje: ordenes.length
                ? `Corte ${corte.numeroCorte} registrado. Nacieron ${ordenes.length} orden(es) de confección: ${ordenes.map(o => o.numeroProduccion).join(', ')}.`
                : `Corte ${corte.numeroCorte} registrado.`,
            ordenes
        });
    } catch (e) {
        return fallo(res, e, 'registrar', 'No se pudo registrar el corte.');
    }
};

// POST /admin/procesos/cortes/:idOrdenCorte/cancelar — { motivo }.
const cancelarCorteHandler = async (req, res) => {
    try {
        const motivo = String(req.body?.motivo ?? '').trim();
        if (motivo.length < 3) return res.status(422).json({ success: false, mensaje: 'Escribe el motivo de la cancelación.' });
        if (motivo.length > LIMITES_CORTE.motivoMax) return res.status(422).json({ success: false, mensaje: `El motivo no puede pasar de ${LIMITES_CORTE.motivoMax} caracteres.` });
        await db.transaction((transaction) => cancelarCorte({ idOrdenCorte: req.params.idOrdenCorte, motivo, actor: actorDelPanel(req), transaction }));
        return res.json({ success: true });
    } catch (e) {
        return fallo(res, e, 'cancelar', 'No se pudo cancelar el corte.');
    }
};

export { homeCortes, homeCorteNuevo, verCorte, verTrazoCorte, pdfCorte, analizarTrazoCorte, crearCorte, registrarCorteHandler, cancelarCorteHandler };
