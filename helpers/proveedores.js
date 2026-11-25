import { Op } from 'sequelize';
import { Provedores, CategoriasDeProvedores, ProvedoresCuentasBancarias, Documentacion, Municipios, Departamentos, ProvedorEstado } from '../models/index.js';
import { validarDocumento, CODIGOS_TIPO_DOCUMENTO_PROVEEDOR } from './tiposDocumento.js';
import { errorPublico } from './helpers.js';

// Un proveedor, escrito desde un solo lugar: lo usan el alta del panel (saveSupplier), su
// edición (actualizarProveedor) y el registro público (registroProveedorWebController.js).
// Cada uno aporta lo suyo —el panel sus archivos libres, la web su Turnstile y su
// constancia—, pero el documento, las categorías, las cuentas y su verificación se
// resuelven acá, igual para todos.

// ── Suspendido ───────────────────────────────────────────────────────────────
// Un proveedor suspendido (PROVEDORES.estado = false; decidido con el dueño el 2026-11-23) no
// recibe órdenes de compra nuevas, no se le asignan trabajos de taller, no se le abona y no
// sale en listas ni buscadores, salvo en el filtro "Suspendidos" del listado. Sus órdenes y
// facturas anteriores siguen como están. Una sola copia del criterio: todo lo que liste o
// elija proveedores filtra con PROVEEDOR_ACTIVO, y lo que escriba a nombre de uno (orden de
// compra, abono, asignar taller) llama a exigirProveedorActivo.
export const PROVEEDOR_ACTIVO = { estado: true };
export const MOTIVO_ESTADO_MAX = 500;

/** Lanza un error público 409 si el proveedor está suspendido (o no existe). */
export async function exigirProveedorActivo(idProveedor, { transaction } = {}) {
    const p = await Provedores.findOne({ where: { idProveedor: String(idProveedor ?? '') }, attributes: ['razonSocial', 'estado'], transaction });
    if (!p) throw errorPublico('Ese proveedor no existe.', 404);
    if (!p.estado) throw errorPublico(`${p.razonSocial} está suspendido: no se le pueden hacer pagos, órdenes de compra ni asignar trabajos. Reactívalo desde su ficha.`, 409);
    return p;
}

/**
 * Suspende (`suspender = true`) o reactiva un proveedor, con su constancia, en la
 * transacción del llamador. Update condicionado al estado contrario (§9): si otro ya lo hizo,
 * 409.
 */
export async function cambiarEstadoProveedor({ idProveedor, suspender, motivo, usuario }, transaction) {
    const texto = String(motivo ?? '').trim();
    if (texto.length < 3) throw errorPublico(`Escribe el motivo de la ${suspender ? 'suspensión' : 'reactivación'}.`, 422);
    if (texto.length > MOTIVO_ESTADO_MAX) throw errorPublico(`El motivo no puede pasar de ${MOTIVO_ESTADO_MAX} caracteres.`, 422);
    const [filas] = await Provedores.update(
        { estado: !suspender },
        { where: { idProveedor: String(idProveedor ?? ''), estado: suspender }, transaction }
    );
    if (!filas) {
        const existe = await Provedores.count({ where: { idProveedor: String(idProveedor ?? '') }, transaction });
        throw existe
            ? errorPublico(`Ese proveedor ya estaba ${suspender ? 'suspendido' : 'activo'}. Recarga la página.`, 409)
            : errorPublico('Ese proveedor no existe.', 404);
    }
    await ProvedorEstado.create({
        idProveedor, accion: suspender ? 'suspendido' : 'reactivado', motivo: texto,
        idUsuario: usuario.idUsuario, nombreUsuario: String(usuario.nombre ?? '').slice(0, 150) || null
    }, { transaction });
}

// ── Documento ────────────────────────────────────────────────────────────────
// Busca otro proveedor con ese número, INCLUIDOS los eliminados: taxIdSupplier es único en
// la base aunque la fila esté borrada lógicamente (paranoid), así que un eliminado también
// bloquea el número. `idExcluir` deja fuera al proveedor que se está editando.
export const buscarProveedorPorDocumento = (numero, idExcluir = null) => Provedores.findOne({
    where: {
        taxIdSupplier: numero,
        ...(idExcluir && { idProveedor: { [Op.ne]: idExcluir } })
    },
    attributes: ['idProveedor', 'razonSocial', 'deletedAt'],
    paranoid: false
});

/** Tipo + número válidos (helpers/tiposDocumento.js) y libres. `{ tipoDocumento, numero }` o `{ error }`. */
export const validarDocumentoProveedor = async (tipo, numero, idExcluir = null) => {
    const doc = validarDocumento(tipo, numero, CODIGOS_TIPO_DOCUMENTO_PROVEEDOR);
    if (doc.error) return doc;
    const otro = await buscarProveedorPorDocumento(doc.numero, idExcluir);
    if (otro) {
        return {
            error: otro.deletedAt
                ? `Ese número pertenece a un proveedor eliminado (${otro.razonSocial}).`
                : `Ese número ya está registrado para el proveedor ${otro.razonSocial}.`,
            existente: true
        };
    }
    return doc;
};

// ── Categorías ───────────────────────────────────────────────────────────────
// Categorías cuyo proveedor tiene que mostrar dónde trabaja: a un confeccionista se le
// encarga la producción, y las fotos de sus máquinas y su espacio dicen si puede con ella.
// Se comparan por nombre normalizado porque las categorías son datos fijos de la tabla.
const CATEGORIAS_CON_FOTOS = ['confeccionista'];

// Nombre EXACTO de la categoría del taller de confección (CATEGORIAS_DE_PROVEDORES.nombre):
// la única que se puede asignar como taller en una ficha y la que arma admin/confeccionistas.
export const CATEGORIA_CONFECCIONISTA = 'Confeccionista';
// Prefijo del objeto de R2 de las fotos del lugar de trabajo (registro web del proveedor):
// provedores/{idProveedor}/lugar-trabajo-{ts}-{i}.webp. La lista de confeccionistas las busca por él.
export const PREFIJO_FOTOS_LUGAR_TRABAJO = 'lugar-trabajo';
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export const requiereFotosLugarTrabajo = (categoria) => CATEGORIAS_CON_FOTOS.includes(normalizar(categoria?.nombre ?? categoria));

/** Las categorías que existen en la tabla, a partir de lo que llegó del formulario. */
export async function validarCategoriasProveedor(entrada, { transaction } = {}) {
    const ids = [...new Set((Array.isArray(entrada) ? entrada : entrada ? [entrada] : [])
        .map(v => String(v).trim()).filter(Boolean))];
    if (!ids.length) return { error: 'Elige al menos una categoría de lo que vendes.' };
    if (ids.length > 20) return { error: 'Demasiadas categorías.' };
    const categorias = await CategoriasDeProvedores.findAll({ where: { idCategoria: ids }, transaction });
    if (categorias.length !== ids.length) return { error: 'Alguna de las categorías elegidas no existe. Recarga la página.' };
    return { categorias };
}

// ── Verificación de cuentas ──────────────────────────────────────────────────
// Lo que identifica el destino de un pago: banco, tipo, número o llave, y el titular. El
// orden y cuál es la principal no cambian a dónde va la plata.
export const huellaCuenta = (c) => [
    c.codigoEntidadFinanciera, c.tipoCuenta, c.tipoLlaveBreb || '',
    String(c.numeroCuenta || '').toLowerCase(), String(c.documentoTitular || '')
].join('|');

/** Cuentas que carga el panel: quedan verificadas por quien las cargó. */
export const cuentasDelPanel = (cuentas, idUsuario) => cuentas.map(c => ({
    ...c, origen: 'panel', verificada: true, idUsuarioVerifico: idUsuario ?? null, fechaVerificacion: new Date()
}));

/** Cuentas del registro web: las dio el propio proveedor, nadie las confirmó todavía. */
export const cuentasDeLaWeb = (cuentas) => cuentas.map(c => ({
    ...c, origen: 'web', verificada: false, idUsuarioVerifico: null, fechaVerificacion: null
}));

/**
 * Al editar desde el panel las cuentas se reemplazan. Una cuenta que ya estaba —mismo
 * destino— conserva su origen y su verificación: guardar el formulario por otro motivo no
 * puede dar por verificada una cuenta web que nadie revisó. Una cuenta nueva o cambiada la
 * escribió quien edita, así que queda verificada por él.
 */
export function conservarVerificacion(nuevas, anteriores, idUsuario) {
    const previas = new Map(anteriores.map(c => [huellaCuenta(c), c]));
    return nuevas.map(c => {
        const antes = previas.get(huellaCuenta(c));
        if (!antes) return cuentasDelPanel([c], idUsuario)[0];
        return {
            ...c,
            origen:            antes.origen,
            verificada:        antes.verificada,
            idUsuarioVerifico: antes.idUsuarioVerifico,
            fechaVerificacion: antes.fechaVerificacion
        };
    });
}

// ── Alta ─────────────────────────────────────────────────────────────────────
/**
 * Proveedor + categorías + cuentas + documentos, dentro de la transacción del llamador.
 * `datos` ya viene validado y armado campo por campo (CLAUDE.md §12): acá no se filtra nada.
 */
export async function crearProveedorCompleto({ datos, categorias = [], cuentas = [], docs = [] }, transaction) {
    const proveedor = await Provedores.create(datos, { transaction });
    if (categorias.length) await proveedor.addCategorias(categorias, { transaction });
    if (cuentas.length) {
        await ProvedoresCuentasBancarias.bulkCreate(
            cuentas.map(c => ({ ...c, idProveedor: proveedor.idProveedor })), { transaction });
    }
    if (docs.length) await Documentacion.bulkCreate(docs, { transaction });
    return proveedor;
}

// ── Presentación ─────────────────────────────────────────────────────────────────────────

/** "Distribuidora Andina" → "DA". Para el avatar de un proveedor en cualquier lista. */
export const inicialesProveedor = (nombre) =>
    String(nombre || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '—';

/**
 * Ciudad y departamento (códigos DIVIPOLA en PROVEDORES, CLAUDE.md §6) de VARIOS proveedores
 * de una sola vez: dos consultas con Op.in, nunca un findOne por proveedor (CLAUDE.md §7).
 * Cada proveedor trae `ciudad` y `departamento` (códigos).
 */
export const resolverUbicacionesProveedores = async (proveedores) => {
    const idsCiudad = [...new Set(proveedores.map(p => p.ciudad).filter(Boolean))];
    const idsDepto   = [...new Set(proveedores.map(p => p.departamento).filter(Boolean))];
    const [municipios, departamentos] = await Promise.all([
        idsCiudad.length ? Municipios.findAll({ where: { id: { [Op.in]: idsCiudad } }, attributes: ['id', 'nombre'], raw: true }) : [],
        idsDepto.length  ? Departamentos.findAll({ where: { id: { [Op.in]: idsDepto } }, attributes: ['id', 'nombre'], raw: true }) : []
    ]);
    const mapaMunicipios   = new Map(municipios.map(m => [m.id, m.nombre]));
    const mapaDepartamentos = new Map(departamentos.map(d => [d.id, d.nombre]));
    return { mapaMunicipios, mapaDepartamentos };
};
