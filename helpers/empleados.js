// Reglas del alta y la edición de un empleado (`saveEmployee` / `actualizarEmpleado`).
//
// Antes cada controlador traía lo suyo: la edición validaba campo por campo y el alta no
// validaba nada en el servidor —confiaba en el formulario—, y el mapa cargo → rol estaba
// copiado en los dos. Lo que decide si un empleado entra, con qué rol y con qué permisos
// vive acá, una sola vez.

import { Op } from 'sequelize';
import { Empleados, Usuarios, PuntosDeVenta, PermisosRecursos, PermisosAcciones, UserPermisos } from '../models/index.js';
import { validarDocumento } from './tiposDocumento.js';
import { errorPublico } from './helpers.js';

export const CODIGOS_TIPO_DOCUMENTO_EMPLEADO = Empleados.getAttributes().TipoDocumento.values;
export const CARGOS_EMPLEADO     = Empleados.getAttributes().cargo.values;
export const CONTRATOS_EMPLEADO  = Empleados.getAttributes().tipoContrato.values;

/** Sede de quien no trabaja en un punto de venta (administrativo, operario, otro). */
export const ID_SEDE_ADMINISTRATIVA = '00000000-0000-0000-0000-000000000000';
/** Cargos que trabajan en un punto de venta o bodega concreto. */
export const CARGOS_CON_SEDE = ['vendedor', 'bodega'];

// Cargo → rol de USUARIOS. Un cargo que no está acá no tiene acceso al sistema.
const ROL_POR_CARGO = { vendedor: 'STORE', bodega: 'EMPLOYER', administrativo: 'ADMIN' };

/** Rol de acceso del cargo, o null si no tiene. `hasOwn`: 'constructor' no es un cargo. */
export const rolDeCargo = (cargo) => (Object.hasOwn(ROL_POR_CARGO, cargo) ? ROL_POR_CARGO[cargo] : null);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const texto = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Valida el formulario del empleado. Devuelve `{ errores }` (campo → mensaje) si algo
 * falla, o `{ datos }` ya normalizado: documento sin espacios ni puntos (es la contraseña
 * inicial), correo sin espacios y la sede final según el cargo.
 *
 * `documentoVigente` ({ TipoDocumento, NumeroDocumento }) es el que ya tiene el empleado al
 * editar: si no cambió, se acepta tal cual aunque no cumpla el formato. Hay registros
 * anteriores a esta validación que no lo cumplen, y exigirlo los dejaría sin poder editarse
 * por un dato que nadie tocó.
 */
export const validarDatosEmpleado = async (body, { documentoVigente = null } = {}) => {
    const errores = {};

    if (!texto(body.PrimerNombre))   errores.PrimerNombre   = 'El primer nombre es requerido';
    if (!texto(body.PrimerApellido)) errores.PrimerApellido = 'El primer apellido es requerido';

    const sinCambio = documentoVigente
        && body.TipoDocumento === documentoVigente.TipoDocumento
        && texto(body.NumeroDocumento) === documentoVigente.NumeroDocumento;
    const doc = sinCambio
        ? { tipoDocumento: documentoVigente.TipoDocumento, numero: documentoVigente.NumeroDocumento }
        : validarDocumento(body.TipoDocumento, body.NumeroDocumento, CODIGOS_TIPO_DOCUMENTO_EMPLEADO);
    if (doc.error) errores.NumeroDocumento = doc.error;

    const emailEmpleado = texto(body.emailEmpleado).toLowerCase();
    if (!EMAIL_RE.test(emailEmpleado)) errores.emailEmpleado = 'Ingresa un email válido';

    if (!texto(body.fechaIngreso))    errores.fechaIngreso    = 'La fecha de ingreso es requerida';
    if (!texto(body.fechaNacimiento)) errores.fechaNacimiento = 'La fecha de nacimiento es requerida';

    if (!CONTRATOS_EMPLEADO.includes(String(body.tipoContrato)))
        errores.tipoContrato = 'Selecciona un tipo de contrato válido';

    const cargo = body.cargo;
    if (!CARGOS_EMPLEADO.includes(cargo)) errores.cargo = 'El área de desempeño es inválida';

    if (!texto(body.departamentoSelect)) errores.departamento = 'El departamento es requerido';
    if (!texto(body.ciudadSelect))       errores.ciudad       = 'La ciudad es requerida';

    // Vendedor y bodega trabajan en una sede concreta: tiene que existir y ser un punto de
    // venta o una bodega. Antes un id vacío caía en silencio a la sede administrativa y la
    // persona quedaba en una tienda que no existe, sin caja ni inventario.
    let idPuntoDeVenta = ID_SEDE_ADMINISTRATIVA;
    if (CARGOS_CON_SEDE.includes(cargo)) {
        const idSede = texto(body.idPuntoDeVenta);
        const sede = idSede && await PuntosDeVenta.findOne({
            where: { idPuntoDeVenta: idSede, tipo: { [Op.in]: ['Punto de venta', 'Bodega'] } },
            attributes: ['idPuntoDeVenta']
        });
        if (!sede) errores.idPuntoDeVenta = 'Selecciona la tienda o bodega donde trabaja';
        else idPuntoDeVenta = sede.idPuntoDeVenta;
    }

    if (Object.keys(errores).length) return { errores };

    return {
        datos: {
            TipoDocumento: doc.tipoDocumento,
            NumeroDocumento: doc.numero,
            PrimerNombre: texto(body.PrimerNombre),
            OtrosNombres: texto(body.OtrosNombres) || null,
            PrimerApellido: texto(body.PrimerApellido),
            SegundoApellido: texto(body.SegundoApellido) || null,
            emailEmpleado,
            cargo,
            idPuntoDeVenta
        }
    };
};

/**
 * Documento y correo que ya están tomados. `idEmpleado`/`idUsuario` excluyen al propio
 * empleado al editar. Devuelve `{ campo: mensaje }`, vacío si no hay choque.
 *
 * - El documento se busca INCLUYENDO a los empleados borrados (`paranoid: false`): el
 *   índice único de la base sí los ve, así que sin esto el formulario decía "libre" y el
 *   alta reventaba con un "Validation error" sin explicación.
 * - El correo se busca en USUARIOS cuando el cargo tiene acceso: es el usuario del login y
 *   es único. Al editar, `findOrCreate` por correo ataba al empleado a la cuenta de OTRA
 *   persona —y le cargaba permisos— si ese correo ya tenía usuario.
 */
export const buscarConflictosEmpleado = async ({ NumeroDocumento, emailEmpleado, conUsuario, idEmpleado = null, idUsuario = null }) => {
    const errores = {};

    const [porDocumento, porCorreo] = await Promise.all([
        NumeroDocumento
            ? Empleados.findOne({
                where: { NumeroDocumento, ...(idEmpleado && { idEmpleado: { [Op.ne]: idEmpleado } }) },
                attributes: ['idEmpleado', 'deletedAt'],
                paranoid: false
            })
            : null,
        conUsuario && emailEmpleado
            ? Usuarios.findOne({
                where: { emailUsuario: emailEmpleado, ...(idUsuario && { idUsuario: { [Op.ne]: idUsuario } }) },
                attributes: ['idUsuario']
            })
            : null
    ]);

    if (porDocumento) {
        errores.NumeroDocumento = porDocumento.deletedAt
            ? 'Este documento pertenece a un empleado eliminado del sistema. Pide a soporte que lo restaure en vez de crearlo de nuevo.'
            : 'Ya hay un empleado registrado con este documento.';
    }
    if (porCorreo) errores.emailEmpleado = 'Este correo ya es el usuario de acceso de otra persona. Usa otro correo.';

    return errores;
};

// Administradores principales: pueden asignar CUALQUIER permiso, tengan o no ese permiso.
// Se definen por correo en la configuración (ADMINS_PRINCIPALES, separados por coma), no en
// la base: así marcar a alguien no es un cambio de datos y el cupo lo controla quien
// administra el servidor, no quien tiene acceso a Personal. Decidido con el dueño el
// 2026-11-19: ningún administrador tenía todos los módulos, así que con "solo das lo que
// tienes" había permisos que nadie podía asignar (el DELETE de Confeccionistas y Procesos).
const ADMINS_PRINCIPALES = new Set(
    String(process.env.ADMINS_PRINCIPALES || '').split(',').map(c => c.trim().toLowerCase()).filter(Boolean)
);
export const esAdminPrincipal = (usuario) =>
    usuario?.permisos === 'ADMIN' && ADMINS_PRINCIPALES.has(String(usuario.emailUsuario || '').trim().toLowerCase());

/** Respuesta 422 con los errores por campo y un mensaje que los nombra (el formulario muestra `mensaje`). */
export const responderErroresEmpleado = (res, errores, status = 422) =>
    res.status(status).json({ success: false, mensaje: Object.values(errores).join('\n'), errores });

/** Lee `permisosJSON` del formulario. Lanza un error público si no es una lista válida. */
export const leerPermisosJSON = (crudo) => {
    if (crudo === undefined || crudo === null || crudo === '') return [];
    let lista;
    try { lista = JSON.parse(crudo); } catch { throw errorPublico('La lista de permisos llegó dañada. Recarga la página.'); }
    const valida = Array.isArray(lista) && lista.every(p =>
        p && typeof p.idRecurso === 'string' && typeof p.idAccion === 'string');
    if (!valida) throw errorPublico('La lista de permisos llegó dañada. Recarga la página.');
    return lista;
};

/**
 * Verifica que quien asigna PUEDE dar estos permisos al cargo y devuelve los que se graban.
 * Lanza un error público si alguno no se puede dar.
 *
 * - Recurso y acción deben existir.
 * - Solo se graban los recursos del tipo del cargo (un vendedor recibe permisos de tienda,
 *   no de bancos). Los de otro tipo se DESCARTAN sin error: el formulario guarda las casillas
 *   de los tres paneles en un mismo estado, así que quien marcó algo como vendedor y después
 *   cambió el cargo a administrativo los manda igual, aunque ya no los vea.
 * - Los permisos del panel de administrador solo los puede dar quien los TIENE. Antes
 *   bastaba con poder crear personal para darle a otro —o a una cuenta propia— acceso a
 *   bancos, nómina o precios: crear personal equivalía a ser dueño del sistema.
 *   Excepción, **módulos sin dueño**: si NINGÚN usuario tiene todavía ningún permiso de ese
 *   módulo (uno recién agregado, como Confeccionistas, Insumos o Procesos), lo puede dar
 *   quien llega acá —ya pasó el permiso de Personal de la ruta—. Sin esto un módulo nuevo
 *   no lo podía recibir nadie, nunca. En cuanto alguien tiene un permiso del módulo, vuelve
 *   la regla normal.
 * - Un administrador principal (`esAdminPrincipal`, ADMINS_PRINCIPALES) puede dar cualquiera.
 * - Los de tienda y bodega no se exigen a quien asigna: un administrador no tiene permisos
 *   de tipo vendedor (no opera el POS) y es justamente quien da de alta a los vendedores.
 *
 * Solo recibe lo que se va a AGREGAR: al editar, los permisos que el empleado ya tenía y
 * siguen igual no se vuelven a verificar.
 */
export const verificarPermisosAsignables = async ({ permisos, cargo, quienAsigna, transaction }) => {
    if (!permisos.length) return [];
    const idUsuarioQueAsigna = quienAsigna.idUsuario;
    const principal = esAdminPrincipal(quienAsigna);

    const idsRecurso = [...new Set(permisos.map(p => p.idRecurso))];
    const idsAccion  = [...new Set(permisos.map(p => p.idAccion))];

    const [recursos, acciones, propios, conDueno] = await Promise.all([
        PermisosRecursos.findAll({ where: { idRecurso: { [Op.in]: idsRecurso } }, attributes: ['idRecurso', 'nombreRecurso', 'tipo'], raw: true, transaction }),
        PermisosAcciones.findAll({ where: { idAccion: { [Op.in]: idsAccion } }, attributes: ['idAccion', 'nombreAccion'], raw: true, transaction }),
        UserPermisos.findAll({ where: { idUsuario: idUsuarioQueAsigna, idRecurso: { [Op.in]: idsRecurso } }, attributes: ['idRecurso', 'idAccion'], raw: true, transaction }),
        // Módulos que alguien ya tiene (cualquier usuario, cualquier acción).
        UserPermisos.findAll({ where: { idRecurso: { [Op.in]: idsRecurso } }, attributes: ['idRecurso'], group: ['idRecurso'], raw: true, transaction })
    ]);

    const recursoPorId = new Map(recursos.map(r => [String(r.idRecurso), r]));
    const accionPorId  = new Map(acciones.map(a => [String(a.idAccion), a]));
    const tieneQuienAsigna = new Set(propios.map(p => `${p.idRecurso}:${p.idAccion}`));
    const modulosConDueno  = new Set(conDueno.map(p => String(p.idRecurso)));

    const sinPermiso = [];
    const delCargo = [];
    for (const { idRecurso, idAccion } of permisos) {
        const recurso = recursoPorId.get(String(idRecurso));
        const accion  = accionPorId.get(String(idAccion));
        if (!recurso || !accion) throw errorPublico('La lista de permisos trae un permiso que no existe. Recarga la página.');
        if (recurso.tipo !== cargo) continue;
        delCargo.push({ idRecurso, idAccion });
        if (recurso.tipo === 'administrativo'
            && !principal
            && modulosConDueno.has(String(idRecurso))
            && !tieneQuienAsigna.has(`${idRecurso}:${idAccion}`)) {
            sinPermiso.push(`${recurso.nombreRecurso} (${accion.nombreAccion})`);
        }
    }

    if (sinPermiso.length) {
        throw errorPublico(`No puedes asignar permisos que tu usuario no tiene: ${sinPermiso.join(', ')}.`, 403);
    }
    return delCargo;
};
