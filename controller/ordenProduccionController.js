import db from '../config/bd.js';
import {
    OrdenProduccion, OrdenProduccionCantidad, OrdenProduccionInsumo, OrdenProduccionInsumoColor, OrdenProduccionEstado,
    FichaConfeccion, FichaConfeccionDxf, FichaConfeccionInsumo, Material, Atributos, Usuarios, OrdenCorte
} from '../models/index.js';
import { crearConCodigo } from '../helpers/secuencias.js';
import { presentarMaterial } from '../helpers/insumos.js';
import { coloresSimplesDisponibles } from '../helpers/ordenesCompra.js';
import { materialesConColor, actorDelPanel } from '../helpers/inventarioInsumos.js';
import { UNIDAD_CONSUMO_CORTA, dec } from '../helpers/unidadesInsumo.js';
import { fechaHoyBogota } from '../helpers/fechas.js';
import { faltantesFicha } from '../helpers/ordenesCorte.js';
import { escaparHtml } from '../src/js/escaparHtml.js';
import {
    ETIQUETA_ESTADO_ORDEN, LIMITES_ORDEN, tallasDeFicha, etiquetaTalla, validarOrdenBody,
    escribirDetalleOrden, revisarMaterial, totalPrendas
} from '../helpers/ordenesProduccion.js';

// Órdenes de producción (admin/procesos/ordenes). Las reglas viven en
// helpers/ordenesProduccion.js; esto es la capa del panel. Permiso: recurso Procesos
// (CREATE crear, EDIT editar y confirmar, DELETE cancelar, READ ver).
//
// La orden no mueve inventario (decidido 2026-11-21: solo avisa si alcanza el material), así
// que confirmar o cancelar no pide código de empleado: no es un movimiento de insumos.

const BASE = '/admin/procesos/ordenes';

// ── Carga ────────────────────────────────────────────────────────────────────────────────

const INCLUDE_FICHA = {
    model: FichaConfeccion, as: 'ficha',
    attributes: ['idFicha', 'referencia', 'materialNombre', 'estado', 'idMolde'],
    include: [{ model: FichaConfeccionDxf, as: 'dxf', attributes: ['idArchivoDxf', 'talla', 'idFamiliaAsociada'] }]
};

const cargarOrden = (idOrdenProduccion) => OrdenProduccion.findByPk(idOrdenProduccion, {
    include: [
        INCLUDE_FICHA,
        { model: Usuarios, as: 'usuarioCreacion', attributes: ['nombreUsuario'] },
        { model: OrdenCorte, as: 'ordenCorte', attributes: ['idOrdenCorte', 'numeroCorte'] },
        { model: OrdenProduccionCantidad, as: 'cantidades', separate: true, include: [{ model: Atributos, as: 'color', attributes: ['idAtributo', 'valor', 'codigo1', 'codigo2'] }] },
        {
            model: OrdenProduccionInsumo, as: 'insumos', separate: true, order: [['orden', 'ASC']],
            include: [
                { model: Material, as: 'material', attributes: ['idMaterial', 'nombre', 'unidadConsumo', 'imagen', 'tipo', 'codigoMaterial'] },
                { model: OrdenProduccionInsumoColor, as: 'colores', include: [{ model: Atributos, as: 'colorInsumo', attributes: ['idAtributo', 'valor', 'codigo1'] }] }
            ]
        }
    ]
});

/** Ficha activa con lo que la orden necesita de ella (tallas e insumos), o null. */
const cargarFicha = (idFicha) => FichaConfeccion.findOne({
    where: { idFicha, estado: 'activa' },
    attributes: ['idFicha', 'referencia', 'materialNombre'],
    include: [
        { model: FichaConfeccionDxf, as: 'dxf', attributes: ['talla'] },
        { model: FichaConfeccionInsumo, as: 'insumos', separate: true, order: [['orden', 'ASC'], ['idDetalle', 'ASC']] }
    ]
});

const nombreActor = (req) => actorDelPanel(req).nombreUsuario;

const constancia = (orden, { accion, desde = null, hacia, motivo = null }, req, transaction) =>
    OrdenProduccionEstado.create({
        idOrdenProduccion: orden.idOrdenProduccion, accion, estadoAnterior: desde, estadoNuevo: hacia,
        motivo, idUsuario: req.usuario.idUsuario, nombreUsuario: nombreActor(req)
    }, { transaction });

// Lo que viaja de una orden al formulario, en la misma forma en que vuelve al guardar.
const estadoFormulario = (orden) => ({
    fechaRequerida: orden.fechaRequerida,
    notas: orden.notas || '',
    cantidades: (orden.cantidades || []).map(c => ({ idAtributoColor: c.idAtributoColor, talla: c.talla, cantidad: c.cantidad })),
    insumos: (orden.insumos || []).map(i => ({
        idMaterial: i.idMaterial,
        cantidadPorPrenda: dec(i.cantidadPorPrenda).toString(),
        colores: (i.colores || []).map(c => ({ idAtributoColorPrenda: c.idAtributoColorPrenda, idAtributoColorInsumo: c.idAtributoColorInsumo }))
    }))
});

// Catálogos del formulario: colores de prenda (todos), de insumo (solo simples, igual que una
// compra), insumos activos con foto y cuáles de ellos manejan colores.
async function catalogosFormulario() {
    const [coloresPrenda, coloresInsumo, materiales] = await Promise.all([
        Atributos.findAll({ where: { tipo: 'COLOR' }, attributes: ['idAtributo', 'valor', 'codigo1', 'codigo2'], order: [['valor', 'ASC']], raw: true }),
        coloresSimplesDisponibles(),
        Material.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] })
    ]);
    const conColor = await materialesConColor(materiales.map(m => m.idMaterial));
    const insumosCatalogo = materiales.map(m => ({
        ...presentarMaterial(m),
        unidadCorta: UNIDAD_CONSUMO_CORTA[m.unidadConsumo] ?? '',
        conColor: conColor.has(m.idMaterial)
    }));
    return { coloresPrenda, coloresInsumo, insumosCatalogo };
}

const renderFormulario = async (res, { ficha, orden = null }) => {
    const catalogos = await catalogosFormulario();
    const inicial = orden
        ? estadoFormulario(orden)
        : {
            fechaRequerida: '',
            notas: '',
            cantidades: [],
            // La receta arranca como la de la ficha; desde acá se edita solo en la orden.
            insumos: (ficha.insumos || []).map(i => ({ idMaterial: i.idMaterial, cantidadPorPrenda: String(i.cantidad), colores: [] }))
        };
    return res.render('./administrador/produccion/ordenProduccionForm', {
        pagina: 'Órdenes de producción',
        subPagina: orden ? orden.numeroProduccion : 'Nueva orden',
        currentPath: '/procesos',
        ficha,
        orden,
        // headerAdmin pinta el subtítulo sin escapar: la referencia la escribió una persona.
        subtituloSeguro: escaparHtml(`${ficha.referencia} · ${ficha.materialNombre}`),
        tallas: tallasConLasDeLaOrden(ficha.dxf?.talla, orden?.cantidades),
        inicial,
        hoy: fechaHoyBogota(),
        limites: LIMITES_ORDEN,
        // Una orden que nació de un corte lleva las prendas que de verdad se cortaron.
        bloquearCantidades: Boolean(orden?.idOrdenCorte),
        ...catalogos
    });
};

const fallo = (res, e, donde, mensaje) => {
    if (e?.publico) return res.status(e.status || 400).json({ success: false, mensaje: e.message });
    console.error(`ordenProduccionController(${donde}):`, e);
    return res.status(500).json({ success: false, mensaje });
};

// ── Pantallas ────────────────────────────────────────────────────────────────────────────

// GET /admin/procesos/ordenes?estado=abiertas|borrador|en_curso|cerrada|cancelada|todas&pagina=N
// Por defecto las abiertas (borrador + en curso), las más urgentes primero.
const FILTROS = {
    abiertas: ['borrador', 'en_curso'],
    borrador: ['borrador'], en_curso: ['en_curso'], cerrada: ['cerrada'], cancelada: ['cancelada'],
    todas: null
};
const POR_PAGINA = 50;

const homeOrdenesProduccion = async (req, res) => {
    try {
        const filtro = Object.hasOwn(FILTROS, req.query.estado) ? req.query.estado : 'abiertas';
        const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
        const where = FILTROS[filtro] ? { estado: FILTROS[filtro] } : {};
        const { rows, count } = await OrdenProduccion.findAndCountAll({
            where,
            attributes: ['idOrdenProduccion', 'numeroProduccion', 'referencia', 'estado', 'fechaRequerida', 'createdAt', 'idOrdenCorte'],
            include: [
                { model: FichaConfeccion, as: 'ficha', attributes: ['idFicha', 'materialNombre'] },
                { model: OrdenCorte, as: 'ordenCorte', attributes: ['numeroCorte'] }
            ],
            // Orden total (CLAUDE.md §8): la fecha empata, el id no.
            order: [['fechaRequerida', 'ASC'], ['createdAt', 'ASC'], ['idOrdenProduccion', 'ASC']],
            limit: POR_PAGINA,
            offset: (pagina - 1) * POR_PAGINA,
            distinct: true
        });

        // Prendas por orden en una sola consulta agregada (CLAUDE.md §7).
        const ids = rows.map(o => o.idOrdenProduccion);
        const sumas = ids.length
            ? await OrdenProduccionCantidad.findAll({
                where: { idOrdenProduccion: ids },
                attributes: ['idOrdenProduccion', [db.fn('SUM', db.col('cantidad')), 'prendas']],
                group: ['idOrdenProduccion'],
                raw: true
            })
            : [];
        const prendas = new Map(sumas.map(s => [s.idOrdenProduccion, Number(s.prendas)]));
        const hoy = fechaHoyBogota();

        return res.render('./administrador/produccion/ordenesProduccion', {
            pagina: 'Órdenes de producción',
            subPagina: 'Listado',
            currentPath: '/procesos',
            ordenes: rows.map(o => ({
                idOrdenProduccion: o.idOrdenProduccion,
                numeroProduccion: o.numeroProduccion,
                referencia: o.referencia,
                materialNombre: o.ficha?.materialNombre || '',
                idOrdenCorte: o.idOrdenCorte,
                numeroCorte: o.ordenCorte?.numeroCorte || null,
                estado: o.estado,
                fechaRequerida: o.fechaRequerida,
                vencida: ['borrador', 'en_curso'].includes(o.estado) && o.fechaRequerida < hoy,
                prendas: prendas.get(o.idOrdenProduccion) || 0
            })),
            filtro,
            filtros: Object.keys(FILTROS),
            paginaActual: pagina,
            totalPaginas: Math.max(1, Math.ceil(count / POR_PAGINA)),
            total: count,
            etiquetaEstado: ETIQUETA_ESTADO_ORDEN
        });
    } catch (e) {
        console.error('ordenProduccionController(listado):', e);
        return res.status(500).send('No se pudo cargar el listado de órdenes de producción.');
    }
};

// GET /admin/procesos/ordenes/nueva[?ficha=idFicha] — sin ficha, primero se elige una.
const homeOrdenProduccionNueva = async (req, res) => {
    try {
        const idFicha = String(req.query.ficha ?? '').trim();
        if (!idFicha) {
            const fichas = await FichaConfeccion.findAll({
                where: { estado: 'activa' },
                attributes: ['idFicha', 'referencia', 'materialNombre'],
                order: [['referencia', 'ASC'], ['idFicha', 'ASC']]
            });
            return res.render('./administrador/produccion/ordenProduccionElegirFicha', {
                pagina: 'Órdenes de producción',
                subPagina: 'Nueva orden',
                currentPath: '/procesos',
                fichas
            });
        }
        const ficha = await cargarFicha(idFicha);
        if (!ficha) return res.status(404).send('Esa ficha no existe o está anulada.');
        return await renderFormulario(res, { ficha });
    } catch (e) {
        console.error('ordenProduccionController(nueva):', e);
        return res.status(500).send('No se pudo abrir la orden nueva.');
    }
};

// GET /admin/procesos/ordenes/:id/editar — solo en borrador.
const homeOrdenProduccionEditar = async (req, res) => {
    try {
        const orden = await cargarOrden(req.params.idOrdenProduccion);
        if (!orden) return res.status(404).send('Esa orden no existe.');
        if (orden.estado !== 'borrador') return res.redirect(`${BASE}/${orden.idOrdenProduccion}`);
        const ficha = await FichaConfeccion.findByPk(orden.idFicha, {
            attributes: ['idFicha', 'referencia', 'materialNombre'],
            include: [{ model: FichaConfeccionDxf, as: 'dxf', attributes: ['talla'] }]
        });
        return await renderFormulario(res, { ficha, orden });
    } catch (e) {
        console.error('ordenProduccionController(editar):', e);
        return res.status(500).send('No se pudo abrir la orden.');
    }
};

// GET /admin/procesos/ordenes/:id — detalle: cantidades, receta, revisión de material y bitácora.
const verOrdenProduccion = async (req, res) => {
    try {
        const orden = await cargarOrden(req.params.idOrdenProduccion);
        if (!orden) return res.status(404).send('Esa orden no existe.');

        // Grilla color × talla. Las tallas son las de la ficha, más cualquiera que la orden
        // tenga y la ficha ya no (si se cambió el DXF después).
        const tallas = tallasDeFicha(orden.ficha?.dxf?.talla);
        for (const c of orden.cantidades) {
            if (!tallas.some(t => t.codigo === c.talla)) tallas.push({ codigo: c.talla, etiqueta: etiquetaTalla(c.talla) });
        }
        const filas = new Map();
        for (const c of orden.cantidades) {
            if (!filas.has(c.idAtributoColor)) filas.set(c.idAtributoColor, { color: c.color, porTalla: {}, total: 0 });
            const f = filas.get(c.idAtributoColor);
            f.porTalla[c.talla] = c.cantidad;
            f.total += c.cantidad;
        }
        const grilla = [...filas.values()].sort((a, b) => String(a.color?.valor).localeCompare(String(b.color?.valor), 'es'));
        const totalPorTalla = Object.fromEntries(tallas.map(t => [t.codigo, grilla.reduce((s, f) => s + (f.porTalla[t.codigo] || 0), 0)]));

        // La revisión de material solo tiene sentido mientras la orden está abierta.
        const abierta = ['borrador', 'en_curso'].includes(orden.estado);
        const revision = abierta ? await revisarMaterial(estadoFormularioConId(orden)) : null;

        const historial = await OrdenProduccionEstado.findAll({
            where: { idOrdenProduccion: orden.idOrdenProduccion },
            order: [['createdAt', 'DESC'], ['idRegistro', 'DESC']],
            raw: true
        });

        const nombreColor = new Map(orden.cantidades.map(c => [c.idAtributoColor, c.color?.valor]));
        return res.render('./administrador/produccion/ordenProduccionDetalle', {
            pagina: 'Órdenes de producción',
            subPagina: orden.numeroProduccion,
            currentPath: '/procesos',
            orden,
            subtituloSeguro: escaparHtml(`${orden.referencia}${orden.ficha?.materialNombre ? ` · ${orden.ficha.materialNombre}` : ''}`),
            tallas,
            grilla,
            totalPorTalla,
            total: totalPrendas(orden.cantidades),
            insumos: orden.insumos.map(i => ({
                nombre: i.nombreMaterial,
                imagenUrl: i.material ? presentarMaterial(i.material).imagenUrl : null,
                cantidadPorPrenda: dec(i.cantidadPorPrenda).toString(),
                unidad: UNIDAD_CONSUMO_CORTA[i.material?.unidadConsumo] ?? '',
                colores: (i.colores || []).map(c => ({ prenda: nombreColor.get(c.idAtributoColorPrenda) || '—', insumo: c.colorInsumo?.valor || '—', hex: c.colorInsumo?.codigo1 || null }))
            })),
            revision,
            historial,
            impedimentos: orden.estado === 'borrador' ? await impedimentosParaConfirmar(orden) : [],
            vencida: abierta && orden.fechaRequerida < fechaHoyBogota(),
            etiquetaEstado: ETIQUETA_ESTADO_ORDEN,
            limites: LIMITES_ORDEN
        });
    } catch (e) {
        console.error('ordenProduccionController(ver):', e);
        return res.status(500).send('No se pudo cargar la orden de producción.');
    }
};

// Las tallas de la ficha más las que ya tiene la orden (una orden de un corte puede traer una
// talla que el DXF de la ficha no nombra igual).
const tallasConLasDeLaOrden = (tallasDxf, cantidades) => {
    const tallas = tallasDeFicha(tallasDxf);
    for (const c of cantidades || []) if (!tallas.some(t => t.codigo === c.talla)) tallas.push({ codigo: c.talla, etiqueta: etiquetaTalla(c.talla) });
    return tallas;
};

/**
 * Lo que impide confirmar una orden (pasarla a confección), o []: la ficha tiene que estar
 * activa y con molde y familia (decidido con el dueño el 2026-11-21), y cada insumo que
 * maneja colores necesita su color para cada color de prenda (una orden que nace de un corte
 * llega sin ellos).
 */
async function impedimentosParaConfirmar(orden) {
    const motivos = [];
    const faltan = faltantesFicha(orden.ficha);
    if (orden.ficha?.estado !== 'activa' || faltan.length) {
        motivos.push(`La ficha "${orden.ficha?.referencia}" no está terminada${faltan.length ? `: le falta ${faltan.join(' y ')}` : ''}.`);
    }
    const coloresPrenda = new Set((orden.cantidades || []).map(c => c.idAtributoColor));
    const conColor = await materialesConColor((orden.insumos || []).map(i => i.idMaterial));
    for (const i of orden.insumos || []) {
        if (conColor.has(i.idMaterial) && new Set((i.colores || []).map(c => c.idAtributoColorPrenda)).size < coloresPrenda.size) {
            motivos.push(`"${i.nombreMaterial}" maneja colores: edita la orden y elige su color para cada color de la prenda.`);
        }
    }
    return motivos;
}

const estadoFormularioConId = (orden) => ({ idOrdenProduccion: orden.idOrdenProduccion, ...estadoFormulario(orden) });

// ── Escritura ────────────────────────────────────────────────────────────────────────────

// POST /admin/procesos/ordenes — { idFicha, fechaRequerida, notas, cantidades, insumos }
// Nace en borrador.
const crearOrdenProduccion = async (req, res) => {
    try {
        const ficha = await cargarFicha(String(req.body?.idFicha ?? ''));
        if (!ficha) return res.status(404).json({ success: false, mensaje: 'Esa ficha no existe o está anulada.' });

        const { datos, errores } = await validarOrdenBody(req.body, { tallas: tallasDeFicha(ficha.dxf?.talla) });
        if (errores) return res.status(422).json({ success: false, errores, mensaje: Object.values(errores)[0] });

        const orden = await db.transaction(async (t) => {
            const nueva = await crearConCodigo(OrdenProduccion, 'numeroProduccion', 'OP-', 'orden_produccion', {
                idFicha: ficha.idFicha,
                referencia: ficha.referencia,
                estado: 'borrador',
                fechaRequerida: datos.fechaRequerida,
                notas: datos.notas,
                idUsuarioCreacion: req.usuario.idUsuario
            }, t);
            await escribirDetalleOrden(nueva.idOrdenProduccion, datos, t);
            await constancia(nueva, { accion: 'creada', hacia: 'borrador' }, req, t);
            return nueva;
        });
        return res.status(201).json({ success: true, idOrdenProduccion: orden.idOrdenProduccion, numeroProduccion: orden.numeroProduccion, url: `${BASE}/${orden.idOrdenProduccion}` });
    } catch (e) {
        return fallo(res, e, 'crear', 'No se pudo crear la orden de producción.');
    }
};

// POST /admin/procesos/ordenes/:id/actualizar — mismo body que crear, sin idFicha. Solo en borrador.
const actualizarOrdenProduccion = async (req, res) => {
    try {
        const orden = await OrdenProduccion.findByPk(req.params.idOrdenProduccion, { include: [INCLUDE_FICHA] });
        if (!orden) return res.status(404).json({ success: false, mensaje: 'Esa orden no existe.' });
        if (orden.estado !== 'borrador') return res.status(409).json({ success: false, mensaje: 'Solo se edita una orden en borrador.' });

        // Nacida de un corte: las cantidades son las que se cortaron y no se toman del body.
        const body = orden.idOrdenCorte
            ? { ...req.body, cantidades: await OrdenProduccionCantidad.findAll({ where: { idOrdenProduccion: orden.idOrdenProduccion }, attributes: ['idAtributoColor', 'talla', 'cantidad'], raw: true }) }
            : req.body;
        const { datos, errores } = await validarOrdenBody(body, { tallas: tallasConLasDeLaOrden(orden.ficha?.dxf?.talla, body.cantidades) });
        if (errores) return res.status(422).json({ success: false, errores, mensaje: Object.values(errores)[0] });

        await db.transaction(async (t) => {
            // Bloquea la fila y vuelve a mirar el estado: si otro la confirmó mientras tanto,
            // no se reescribe una orden en curso (CLAUDE.md §9).
            const bloqueada = await OrdenProduccion.findByPk(orden.idOrdenProduccion, { transaction: t, lock: t.LOCK.UPDATE });
            if (bloqueada?.estado !== 'borrador') throw Object.assign(new Error('La orden ya no está en borrador: recarga la página.'), { publico: true, status: 409 });
            await bloqueada.update({ fechaRequerida: datos.fechaRequerida, notas: datos.notas }, { transaction: t });
            await escribirDetalleOrden(orden.idOrdenProduccion, datos, t);
            await constancia(orden, { accion: 'editada', desde: 'borrador', hacia: 'borrador' }, req, t);
        });
        return res.json({ success: true, url: `${BASE}/${orden.idOrdenProduccion}` });
    } catch (e) {
        return fallo(res, e, 'actualizar', 'No se pudo guardar la orden de producción.');
    }
};

/** Cambia el estado con update condicionado y deja la constancia, en una transacción. false si no estaba en `desde`. */
const cambiarEstado = (req, { desde, hacia, accion, motivo = null }) => db.transaction(async (t) => {
    const idOrdenProduccion = req.params.idOrdenProduccion;
    const actual = await OrdenProduccion.findByPk(idOrdenProduccion, { attributes: ['idOrdenProduccion', 'estado'], transaction: t, lock: t.LOCK.UPDATE });
    if (!actual || !desde.includes(actual.estado)) return false;
    const [filas] = await OrdenProduccion.update({ estado: hacia }, { where: { idOrdenProduccion, estado: actual.estado }, transaction: t });
    if (!filas) return false;
    await constancia(actual, { accion, desde: actual.estado, hacia, motivo }, req, t);
    return true;
});

// POST /admin/procesos/ordenes/:id/confirmar — borrador → en curso. Desde acá no se edita.
const confirmarOrdenProduccion = async (req, res) => {
    try {
        // Una orden vacía no se confirma (no debería existir, pero el formulario no es la garantía).
        const orden = await cargarOrden(req.params.idOrdenProduccion);
        if (!orden) return res.status(404).json({ success: false, mensaje: 'Esa orden no existe.' });
        if (!totalPrendas(orden.cantidades)) return res.status(422).json({ success: false, mensaje: 'La orden no tiene prendas.' });
        const impedimentos = await impedimentosParaConfirmar(orden);
        if (impedimentos.length) return res.status(422).json({ success: false, mensaje: impedimentos[0] });
        const ok = await cambiarEstado(req, { desde: ['borrador'], hacia: 'en_curso', accion: 'confirmada' });
        if (!ok) return res.status(409).json({ success: false, mensaje: 'La orden no existe o ya no está en borrador.' });
        return res.json({ success: true });
    } catch (e) {
        return fallo(res, e, 'confirmar', 'No se pudo confirmar la orden.');
    }
};

// POST /admin/procesos/ordenes/:id/cancelar — { motivo }. Desde borrador o en curso.
const cancelarOrdenProduccion = async (req, res) => {
    try {
        const motivo = String(req.body?.motivo ?? '').trim();
        if (motivo.length < 3) return res.status(422).json({ success: false, mensaje: 'Escribe el motivo de la cancelación.' });
        if (motivo.length > LIMITES_ORDEN.motivoMax) return res.status(422).json({ success: false, mensaje: `El motivo no puede pasar de ${LIMITES_ORDEN.motivoMax} caracteres.` });
        const ok = await cambiarEstado(req, { desde: ['borrador', 'en_curso'], hacia: 'cancelada', accion: 'cancelada', motivo });
        if (!ok) return res.status(409).json({ success: false, mensaje: 'La orden no existe o ya está cerrada o cancelada.' });
        return res.json({ success: true });
    } catch (e) {
        return fallo(res, e, 'cancelar', 'No se pudo cancelar la orden.');
    }
};

// POST /admin/procesos/ordenes/revisar-material — { idOrdenProduccion?, cantidades, insumos }
// La revisión del formulario mientras se escribe. No guarda nada: es un POST solo porque el
// borrador viaja en el cuerpo. Se acota igual que al guardar (validarOrdenBody), sin exigir
// que esté completo: lo que no sirve se ignora.
const revisarMaterialOrden = async (req, res) => {
    try {
        const cantidades = (Array.isArray(req.body?.cantidades) ? req.body.cantidades : [])
            .slice(0, 2000)
            .map(c => ({ idAtributoColor: parseInt(c?.idAtributoColor, 10), cantidad: parseInt(c?.cantidad, 10) }))
            .filter(c => c.idAtributoColor > 0 && c.cantidad > 0 && c.cantidad <= LIMITES_ORDEN.cantidadMaxCelda);
        const insumos = (Array.isArray(req.body?.insumos) ? req.body.insumos : [])
            .slice(0, LIMITES_ORDEN.insumosMax)
            .map(i => ({
                idMaterial: String(i?.idMaterial ?? '').slice(0, 36),
                cantidadPorPrenda: /^\d{1,11}(\.\d{1,4})?$/.test(String(i?.cantidadPorPrenda ?? '')) ? String(i.cantidadPorPrenda) : '0',
                colores: (Array.isArray(i?.colores) ? i.colores : []).slice(0, 200)
                    .map(c => ({ idAtributoColorPrenda: parseInt(c?.idAtributoColorPrenda, 10), idAtributoColorInsumo: parseInt(c?.idAtributoColorInsumo, 10) }))
                    .filter(c => c.idAtributoColorPrenda > 0 && c.idAtributoColorInsumo > 0)
            }))
            .filter(i => i.idMaterial && Number(i.cantidadPorPrenda) > 0);
        const idOrdenProduccion = req.body?.idOrdenProduccion ? String(req.body.idOrdenProduccion) : undefined;
        const revision = await revisarMaterial({ idOrdenProduccion, cantidades, insumos });
        return res.json({ success: true, ...revision });
    } catch (e) {
        return fallo(res, e, 'revisar', 'No se pudo revisar el material.');
    }
};

export {
    homeOrdenesProduccion, homeOrdenProduccionNueva, homeOrdenProduccionEditar, verOrdenProduccion,
    crearOrdenProduccion, actualizarOrdenProduccion, confirmarOrdenProduccion, cancelarOrdenProduccion,
    revisarMaterialOrden
};
