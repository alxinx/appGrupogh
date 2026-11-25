import { Op, QueryTypes } from 'sequelize';
import db from '../config/bd.js';
import { Provedores, CategoriasDeProvedores, ProvedoresCuentasBancarias, Documentacion } from '../models/index.js';
import {
    CATEGORIA_CONFECCIONISTA, PREFIJO_FOTOS_LUGAR_TRABAJO, inicialesProveedor, resolverUbicacionesProveedores, PROVEEDOR_ACTIVO
} from './proveedores.js';
import { money } from './formatMoney.js';
import { fmtFechaCorta } from './plantillaCorreo.js';

// Lista de talleres de confección (admin/confeccionistas). Un confeccionista NO es una tabla
// propia: es un PROVEDORES con la categoría 'Confeccionista'. Acá se junta lo que dice de él
// el resto del sistema —dónde trabaja (fotos del registro web), qué tiene encima ahora
// (FICHAS_CONFECCION_PROCESOS), a cuánto cobra (FICHAS_CONFECCION_TALLERES) y si ya se le
// puede pagar (cuenta verificada)— con un número fijo de consultas, sin importar cuántos
// talleres haya (CLAUDE.md §7).

// Etapas que siguen en manos del taller o de calidad, en el orden del flujo de
// fichaConfeccionProcesoController.js (ORDEN_ESTADOS). 'entregada' es el cierre y se cuenta aparte.
export const ETAPAS_EN_CURSO = [
    { estado: 'asignado',         etiqueta: 'Asignado',    corta: 'Asignado' },
    { estado: 'entregado_taller', etiqueta: 'En el taller', corta: 'Taller' },
    { estado: 'en_revision',      etiqueta: 'En revisión', corta: 'Revisión' }
];

const FOTOS_POR_TALLER = 3;

// ── Calificación ─────────────────────────────────────────────────────────────────────────
// La vista ya está lista; el cálculo todavía no existe. Este es el CONTRATO con el script de
// calificación de confeccionistas: por cada taller calificado devuelve
//
//   { puntaje: 0–5, criterios: { calidad, cumplimiento, insumos }: 0–5 cada uno (o null si
//     no hay con qué medirlo), trabajosEvaluados: n, actualizadoEn: Date }
//
// y `presentarCalificacion` lo convierte en lo que pinta la vista. Un taller sin calificación
// llega null y se muestra "Sin calificar": nunca un puntaje inventado (CLAUDE.md §6).
export const CRITERIOS_CALIFICACION = [
    { clave: 'calidad',      etiqueta: 'Calidad',        ayuda: 'Prendas que pasan la revisión sin reproceso' },
    { clave: 'cumplimiento', etiqueta: 'Cumplimiento',   ayuda: 'Entregas dentro del plazo acordado' },
    { clave: 'insumos',      etiqueta: 'Uso de insumos', ayuda: 'Consumo real contra lo que pide la ficha' }
];

// Niveles por puntaje (de mayor a menor): el primero cuyo mínimo se alcanza.
export const NIVELES_CALIFICACION = [
    { clave: 'excelente', etiqueta: 'Excelente', minimo: 4.5 },
    { clave: 'bueno',     etiqueta: 'Bueno',     minimo: 3.5 },
    { clave: 'regular',   etiqueta: 'Regular',   minimo: 2.5 },
    { clave: 'bajo',      etiqueta: 'Bajo',      minimo: 0 }
];

const puntajeValido = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null
    : Math.min(5, Math.max(0, Math.round(Number(v) * 10) / 10)));
const unDecimal = (n) => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Lo que entrega el script → lo que pinta la vista. Cualquier dato inválido = sin calificar. */
export const presentarCalificacion = (cruda) => {
    const puntaje = puntajeValido(cruda?.puntaje);
    if (puntaje === null) return null;
    const nivel = NIVELES_CALIFICACION.find(n => puntaje >= n.minimo);
    const n = Number(cruda.trabajosEvaluados) || 0;
    return {
        puntaje,
        texto: unDecimal(puntaje),
        porcentaje: Math.round((puntaje / 5) * 100),
        nivel: nivel.clave,
        nivelEtiqueta: nivel.etiqueta,
        trabajosEvaluados: n,
        trabajosTexto: n === 1 ? '1 trabajo evaluado' : `${n} trabajos evaluados`,
        actualizado: cruda.actualizadoEn ? fmtFechaCorta(cruda.actualizadoEn) : null,
        criterios: CRITERIOS_CALIFICACION.map(c => {
            const v = puntajeValido(cruda.criterios?.[c.clave]);
            return { ...c, puntaje: v, texto: v === null ? 'Sin datos' : unDecimal(v), porcentaje: v === null ? 0 : Math.round((v / 5) * 100) };
        })
    };
};

/**
 * PUNTO DE CONEXIÓN del script de calificación: Map idProveedor → calificación cruda (el
 * contrato de arriba). Tiene que resolver a todos los talleres de una vez —una consulta o
 * una tabla precalculada, nunca una por taller (CLAUDE.md §7)—. Hoy no hay script: vacío.
 */
export async function calificacionesDeConfeccionistas(ids) { // eslint-disable-line no-unused-vars
    return new Map();
}

// Estado de pago: a un taller se le paga a una cuenta; una que dio él mismo por internet no
// sirve hasta que alguien del panel la verifica (CLAUDE.md §5.13).
const estadoPago = (cuentas) => {
    if (!cuentas.length) return { clave: 'sin_cuenta', etiqueta: 'Sin cuenta de pago' };
    if (cuentas.some(c => c.verificada)) return { clave: 'verificada', etiqueta: 'Cuenta verificada' };
    return { clave: 'sin_verificar', etiqueta: 'Cuenta sin verificar' };
};

/** Celular colombiano de 10 dígitos → enlace de WhatsApp; cualquier otra cosa, null. */
const enlaceWhatsapp = (tel) => {
    const d = String(tel ?? '').replace(/\D/g, '');
    return /^3\d{9}$/.test(d) ? `https://wa.me/57${d}` : null;
};
const telefonoLegible = (tel) => {
    const d = String(tel ?? '').replace(/\D/g, '');
    return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : (tel || null);
};

export async function listarConfeccionistas() {
    const talleres = await Provedores.findAll({
        where: PROVEEDOR_ACTIVO,   // un taller suspendido no sale en la lista (helpers/proveedores.js)
        include: [{
            model: CategoriasDeProvedores, as: 'categorias', attributes: [],
            where: { nombre: CATEGORIA_CONFECCIONISTA }, through: { attributes: [] }
        }],
        attributes: ['idProveedor', 'razonSocial', 'tipoDocumento', 'taxIdSupplier', 'nombreContacto',
            'telefonoContacto', 'telefonoProvedor', 'emailProvedor', 'direccionProvedor', 'ciudad', 'departamento', 'estado', 'createdAt'],
        order: [['razonSocial', 'ASC']]
    });
    if (!talleres.length) return [];
    const ids = talleres.map(t => t.idProveedor);

    // Consultas fijas en paralelo, todas por Op.in / GROUP BY: no crecen con los talleres.
    const [ubicaciones, cuentas, fotos, etapas, tarifas, unidades, calificaciones] = await Promise.all([
        resolverUbicacionesProveedores(talleres),
        ProvedoresCuentasBancarias.findAll({ where: { idProveedor: { [Op.in]: ids } }, attributes: ['idProveedor', 'verificada'], raw: true }),
        Documentacion.findAll({
            where: {
                idPropietario: { [Op.in]: ids }, pertenece: 'provedor',
                keyName: { [Op.like]: `provedores/%/${PREFIJO_FOTOS_LUGAR_TRABAJO}-%` }
            },
            attributes: ['idDocumento', 'idPropietario'], order: [['idDocumento', 'ASC']], raw: true
        }),
        db.query(`
            SELECT t.idProveedor, p.estado, COUNT(*) AS n, MAX(p.updatedAt) AS ultima
            FROM FICHAS_CONFECCION_TALLERES t
            JOIN FICHAS_CONFECCION_PROCESOS p ON p.idTaller = t.idDetalle
            WHERE t.idProveedor IN (:ids)
            GROUP BY t.idProveedor, p.estado`, { replacements: { ids }, type: QueryTypes.SELECT }),
        db.query(`
            SELECT idProveedor, MIN(precioConfeccion) AS minimo, MAX(precioConfeccion) AS maximo
            FROM FICHAS_CONFECCION_TALLERES WHERE idProveedor IN (:ids) GROUP BY idProveedor`,
            { replacements: { ids }, type: QueryTypes.SELECT }),
        // Prendas que le entregaron y todavía no volvieron cerradas: las cantidades que se
        // anotaron al pasar a "entregado al taller" de los procesos que siguen abiertos.
        db.query(`
            SELECT t.idProveedor, SUM(h.cantidad) AS unidades
            FROM FICHAS_CONFECCION_TALLERES t
            JOIN FICHAS_CONFECCION_PROCESOS p ON p.idTaller = t.idDetalle
            JOIN FICHAS_CONFECCION_PROCESOS_HISTORIAL h ON h.idProceso = p.idProceso AND h.estado = 'entregado_taller'
            WHERE t.idProveedor IN (:ids) AND p.estado IN ('entregado_taller', 'en_revision')
            GROUP BY t.idProveedor`, { replacements: { ids }, type: QueryTypes.SELECT }),
        calificacionesDeConfeccionistas(ids)
    ]);

    const agrupar = (filas, clave = 'idProveedor') => filas.reduce((m, f) => (m.get(f[clave]) || m.set(f[clave], []).get(f[clave])).push(f) && m, new Map());
    const cuentasPor = agrupar(cuentas);
    const fotosPor = agrupar(fotos, 'idPropietario');
    const etapasPor = agrupar(etapas);
    const tarifaPor = new Map(tarifas.map(t => [t.idProveedor, t]));
    const unidadesPor = new Map(unidades.map(u => [u.idProveedor, Number(u.unidades) || 0]));
    const { mapaMunicipios, mapaDepartamentos } = ubicaciones;

    return talleres.map(t => {
        const filasEtapa = etapasPor.get(t.idProveedor) || [];
        const cuenta = (estado) => Number(filasEtapa.find(f => f.estado === estado)?.n || 0);
        const etapasCurso = ETAPAS_EN_CURSO.map(e => ({ ...e, n: cuenta(e.estado) }));
        const enCurso = etapasCurso.reduce((s, e) => s + e.n, 0);
        const ultima = filasEtapa.reduce((max, f) => (!max || new Date(f.ultima) > max ? new Date(f.ultima) : max), null);
        const tarifa = tarifaPor.get(t.idProveedor);
        const fotosTaller = fotosPor.get(t.idProveedor) || [];
        const pago = estadoPago(cuentasPor.get(t.idProveedor) || []);
        const telefono = t.telefonoContacto || t.telefonoProvedor;
        const ciudad = mapaMunicipios.get(t.ciudad) || null;

        return {
            idProveedor: t.idProveedor,
            nombre: t.razonSocial,
            iniciales: inicialesProveedor(t.razonSocial),
            documento: `${t.tipoDocumento} ${/^\d+$/.test(t.taxIdSupplier) ? money(Number(t.taxIdSupplier)) : t.taxIdSupplier}`,
            documentoPlano: String(t.taxIdSupplier),
            contacto: t.nombreContacto && t.nombreContacto.trim().toLowerCase() !== t.razonSocial.trim().toLowerCase() ? t.nombreContacto : null,
            telefono: telefonoLegible(telefono),
            whatsapp: enlaceWhatsapp(telefono),
            email: t.emailProvedor,
            ciudad,
            idCiudad: t.ciudad || '',
            departamento: mapaDepartamentos.get(t.departamento) || null,
            direccion: t.direccionProvedor,
            activo: !!t.estado,
            // Las fotos se piden por idDocumento a una ruta que firma en el momento
            // (GET /admin/confeccionistas/fotos/:id): un enlace firmado acá vencería a los
            // 5 minutos con la página abierta, y la vista en cuadrícula carga las suyas tarde.
            fotos: fotosTaller.slice(0, FOTOS_POR_TALLER).map(f => `/admin/confeccionistas/fotos/${f.idDocumento}`),
            totalFotos: fotosTaller.length,
            etapas: etapasCurso,
            enCurso,
            entregadas: cuenta('entregada'),
            unidadesEnTaller: unidadesPor.get(t.idProveedor) || 0,
            ultimaActividad: ultima ? fmtFechaCorta(ultima) : null,
            tarifa: tarifa
                ? (Number(tarifa.minimo) === Number(tarifa.maximo)
                    ? `$${money(Number(tarifa.minimo))}`
                    : `$${money(Number(tarifa.minimo))} – $${money(Number(tarifa.maximo))}`)
                : null,
            pago,
            calificacion: presentarCalificacion(calificaciones.get(t.idProveedor)),
            desde: fmtFechaCorta(t.createdAt)
        };
    // Los que tienen trabajo encima primero: es a quienes se está llamando hoy.
    }).sort((a, b) => (b.enCurso > 0) - (a.enCurso > 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Resumen para el encabezado de la lista, sobre lo que ya devolvió listarConfeccionistas. */
export const resumenConfeccionistas = (lista) => ({
    total: lista.length,
    conTrabajo: lista.filter(c => c.enCurso > 0).length,
    disponibles: lista.filter(c => c.activo && c.enCurso === 0).length,
    unidadesEnTaller: lista.reduce((s, c) => s + c.unidadesEnTaller, 0),
    enRevision: lista.reduce((s, c) => s + (c.etapas.find(e => e.estado === 'en_revision')?.n || 0), 0),
    sinVerificar: lista.filter(c => c.pago.clave !== 'verificada').length,
    // Promedio simple de los calificados (puntajes de 0 a 5 con un decimal, solo para mostrar).
    calificacionPromedio: (() => {
        const p = lista.map(c => c.calificacion?.puntaje).filter(v => v != null);
        return p.length ? (p.reduce((s, v) => s + v, 0) / p.length).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null;
    })()
});

/**
 * Key de R2 de una foto del lugar de trabajo de un confeccionista, o null. La ruta de la foto
 * solo abre fotos del lugar de trabajo de un proveedor que ES confeccionista: el permiso de
 * Confeccionistas no alcanza para ver la cédula o el RUT de cualquier proveedor.
 */
export async function keyFotoConfeccionista(idDocumento) {
    if (!/^\d+$/.test(String(idDocumento))) return null;
    const doc = await Documentacion.findOne({
        where: { idDocumento, pertenece: 'provedor', keyName: { [Op.like]: `provedores/%/${PREFIJO_FOTOS_LUGAR_TRABAJO}-%` } },
        attributes: ['keyName', 'idPropietario'], raw: true
    });
    if (!doc) return null;
    const esTaller = await Provedores.count({
        where: { idProveedor: doc.idPropietario },
        include: [{ model: CategoriasDeProvedores, as: 'categorias', attributes: [], where: { nombre: CATEGORIA_CONFECCIONISTA }, through: { attributes: [] } }]
    });
    return esTaller ? doc.keyName : null;
}
