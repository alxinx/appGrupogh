import { Op, fn, col, literal } from 'sequelize';
import db from '../config/bd.js';
import { Traslados, DetalleTraslados, PuntosDeVenta } from '../models/index.js';
import {
    cargarDetalleTraslado, recibirDevolucionTraslado, registrarRechazo, TrasladoRechazadoError,
    esOrigenProduccion, ORIGENES_PRODUCCION
} from '../helpers/traslados.js';
import { armarCursor, leerCursor, despuesDelCursor } from '../helpers/cursor.js';
import { validarCodigoConPermiso } from '../middlewares/verificarPermisoEmpleado.js';
import { invalidarContadoresAdmin } from '../middlewares/adminMenuMiddleware.js';

// ─── /admin/traslados ─────────────────────────────────────────────────────────
// El admin no tenía dónde ver los traslados de mercancía ni dónde recibir lo que una tienda
// rechaza de producción: esas controversias quedaban abiertas para siempre (la tienda de
// origen es la que recibe, y producción no es una tienda).

const TRASLADOS_POR_PAGINA = 20;
const ESTADOS_FILTRABLES = ['EN_TRANSITO', 'EN_CONTROVERSIA', 'RECIBIDO', 'DEVUELTO'];
// El historial va por createdAt y no por fechaEnvio: fechaEnvio admite NULL en la base, y un
// NULL rompe el orden total que necesita el cursor.
const ORDEN_HISTORIAL = [['createdAt', 'DESC'], ['idTraslado', 'DESC']];

const nombreLado = (traslado, lado) => {
    const id = lado === 'origen' ? traslado.idOrigen : traslado.idDestino;
    if (esOrigenProduccion(id)) return 'Producción';
    return traslado[lado]?.nombreComercial || '—';
};

const incluirPuntos = [
    { model: PuntosDeVenta, as: 'origen',  attributes: ['nombreComercial'], required: false },
    { model: PuntosDeVenta, as: 'destino', attributes: ['nombreComercial'], required: false }
];

const paginaTraslados = async (req, res) => {
    try {
        const [puntos, controversias] = await Promise.all([
            PuntosDeVenta.findAll({
                attributes: ['idPuntoDeVenta', 'nombreComercial'],
                order: [['nombreComercial', 'ASC'], ['idPuntoDeVenta', 'ASC']],
                raw: true
            }),
            Traslados.count({ where: { estado: 'EN_CONTROVERSIA' } })
        ]);
        return res.render('./administrador/traslados/index', {
            pagina: 'Traslados',
            subPagina: 'Traslados',
            csrfToken: req.csrfToken(),
            currentPath: '/traslados',
            puntos,
            controversias
        });
    } catch (e) {
        console.error('paginaTraslados:', e);
        return res.status(500).send('No se pudo cargar la página de traslados.');
    }
};

// Las controversias abiertas no se paginan: son lo que espera una acción, y un listado que
// esconde la mitad de lo pendiente no sirve para atenderlo. El tope es de seguridad.
const listarControversiasJSON = async (req, res) => {
    try {
        const traslados = await Traslados.findAll({
            where: { estado: 'EN_CONTROVERSIA' },
            include: [
                ...incluirPuntos,
                { model: DetalleTraslados, as: 'items', attributes: ['idDetalleTraslado', 'idPack', 'estado', 'cantidad', 'cantidadControversia'] }
            ],
            // Lo que lleva más tiempo esperando va primero.
            order: [['fechaRecepcion', 'ASC'], ['idTraslado', 'ASC']],
            limit: 200
        });

        return res.json({
            success: true,
            controversias: traslados.map((t) => {
                const rechazados = t.items.filter(i => i.estado === 'CONTROVERSIA');
                return {
                    idTraslado:     t.idTraslado,
                    codigo:         t.codigoTraslado,
                    origen:         nombreLado(t, 'origen'),
                    destino:        nombreLado(t, 'destino'),
                    fechaEnvio:     t.fechaEnvio,
                    fechaRecepcion: t.fechaRecepcion,
                    itemsRechazados: rechazados.length,
                    packsRechazados: rechazados.filter(i => i.idPack).length,
                    unidadesRechazadas: rechazados.reduce((s, i) => s + (i.cantidadControversia ?? i.cantidad), 0),
                    recibeAdmin:    esOrigenProduccion(t.idOrigen)
                };
            })
        });
    } catch (e) {
        console.error('listarControversiasJSON:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudieron cargar las controversias.' });
    }
};

const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

const listarHistorialJSON = async (req, res) => {
    const { estado, punto, codigo, cursor } = req.query;
    try {
        const condiciones = [];
        if (ESTADOS_FILTRABLES.includes(estado)) condiciones.push({ estado });
        if (punto === 'PRODUCCION') {
            condiciones.push({ [Op.or]: [{ idOrigen: ORIGENES_PRODUCCION }, { idDestino: ORIGENES_PRODUCCION }] });
        } else if (punto) {
            condiciones.push({ [Op.or]: [{ idOrigen: punto }, { idDestino: punto }] });
        }
        const busqueda = String(codigo || '').trim();
        if (busqueda) condiciones.push({ codigoTraslado: { [Op.like]: `%${escaparLike(busqueda)}%` } });

        const posicion = leerCursor(cursor);
        if (posicion) condiciones.push(despuesDelCursor(posicion, 'createdAt', 'idTraslado'));

        // Una fila de más para saber si hay página siguiente sin contar el total.
        const filas = await Traslados.findAll({
            where: { [Op.and]: condiciones },
            include: incluirPuntos,
            order: ORDEN_HISTORIAL,
            limit: TRASLADOS_POR_PAGINA + 1
        });
        const hayMas = filas.length > TRASLADOS_POR_PAGINA;
        const pagina = hayMas ? filas.slice(0, TRASLADOS_POR_PAGINA) : filas;

        // Conteo de ítems de toda la página en una sola consulta agrupada (CLAUDE.md §7).
        const conteos = pagina.length ? await DetalleTraslados.findAll({
            where: { idTraslado: pagina.map(t => t.idTraslado) },
            attributes: [
                'idTraslado',
                [fn('COUNT', col('idPack')), 'packs'],
                [fn('COALESCE', fn('SUM', literal('CASE WHEN idPack IS NULL THEN cantidad ELSE 0 END')), 0), 'unidades']
            ],
            group: ['idTraslado'],
            raw: true
        }) : [];
        const conteoDe = new Map(conteos.map(c => [c.idTraslado, c]));

        const ultimo = pagina[pagina.length - 1];
        return res.json({
            success: true,
            traslados: pagina.map((t) => ({
                idTraslado:     t.idTraslado,
                codigo:         t.codigoTraslado,
                estado:         t.estado,
                origen:         nombreLado(t, 'origen'),
                destino:        nombreLado(t, 'destino'),
                fechaEnvio:     t.fechaEnvio || t.createdAt,
                fechaRecepcion: t.fechaRecepcion,
                packs:          Number(conteoDe.get(t.idTraslado)?.packs) || 0,
                unidades:       Number(conteoDe.get(t.idTraslado)?.unidades) || 0
            })),
            cursorSiguiente: hayMas ? armarCursor(ultimo.createdAt, ultimo.idTraslado) : null
        });
    } catch (e) {
        console.error('listarHistorialJSON:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo cargar el historial.' });
    }
};

const detalleTrasladoAdminJSON = async (req, res) => {
    try {
        const detalle = await cargarDetalleTraslado(req.params.idTraslado);
        if (!detalle) return res.status(404).json({ success: false, mensaje: 'El traslado no existe.' });
        const { traslado } = detalle;
        return res.json({
            success: true,
            ...detalle,
            origen:  nombreLado(traslado, 'origen'),
            destino: nombreLado(traslado, 'destino'),
            recibeAdmin: traslado.estado === 'EN_CONTROVERSIA' && esOrigenProduccion(traslado.idOrigen)
        });
    } catch (e) {
        console.error('detalleTrasladoAdminJSON:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo cargar el traslado.' });
    }
};

const validarEmpleadoTraslados = validarCodigoConPermiso(
    'Traslados', 'administrativo', 'EDIT', 'Ese empleado no tiene permiso para recibir traslados.'
);

// Recibe lo que una tienda rechazó de producción: los packs vuelven a EMPACADO y el traslado
// se cierra. Las devoluciones entre tiendas no pasan por acá: esas las recibe la tienda de
// origen, que es donde está la mercancía.
const recibirDevolucionAdmin = async (req, res) => {
    const empleado = req.empleadoVerificado;
    const t = await db.transaction();
    let traslado;
    try {
        traslado = await recibirDevolucionTraslado(req.params.idTraslado, {
            empleado,
            validarReceptor: (tr) => (esOrigenProduccion(tr.idOrigen)
                ? null
                : 'Esta devolución la recibe la tienda de origen, no la administración.')
        }, t);
        await t.commit();
    } catch (e) {
        if (!t.finished) await t.rollback().catch(() => {});
        if (e instanceof TrasladoRechazadoError) {
            await registrarRechazo(e, { idEmpleado: empleado.idEmpleado, accion: 'recibir devolución en administración' });
            return res.status(e.status).json({ success: false, mensaje: e.message });
        }
        console.error('recibirDevolucionAdmin:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo recibir la devolución.' });
    }

    invalidarContadoresAdmin();
    return res.json({ success: true, codigo: traslado.codigoTraslado });
};

export {
    paginaTraslados, listarControversiasJSON, listarHistorialJSON, detalleTrasladoAdminJSON,
    validarEmpleadoTraslados, recibirDevolucionAdmin
};
