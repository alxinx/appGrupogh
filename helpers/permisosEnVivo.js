import { UserPermisos, PermisosRecursos, PermisosAcciones } from '../models/index.js';
import { broadcast } from './sseManager.js';

// ── PERMISOS EN VIVO ─────────────────────────────────────────────────────────
//
// Un permiso que se quita mientras la persona tiene la pantalla abierta no se entera de
// nada hasta la próxima navegación: sigue viendo el formulario y recién al enviarlo se
// lleva un 403. Peor al revés — a quien le acaban de DAR el permiso le sigue apareciendo
// el cartel de "sin permiso" y cree que no se aplicó.
//
// Por eso el cambio se empuja por SSE al canal del usuario afectado, igual que el POS se
// bloquea cuando la caja entra en cuadre. Esto es comodidad: quien decide de verdad sigue
// siendo el middleware de la ruta en cada petición.
//
// El canal es el idUsuario, no el punto de venta: un permiso es de la persona y la
// alcanza esté donde esté, con cuantas pestañas tenga abiertas.

/** Los permisos de un usuario, como los necesita el cliente. */
export async function permisosDeUsuario(idUsuario) {
    const filas = await UserPermisos.findAll({
        where: { idUsuario },
        include: [
            { model: PermisosRecursos, as: 'recurso', attributes: ['nombreRecurso', 'tipo', 'folder'] },
            { model: PermisosAcciones, as: 'accion', attributes: ['nombreAccion'] }
        ],
        attributes: [],
        raw: true
    });

    // "Recurso:ACCION" — la misma llave que usa el cliente en data-requiere-permiso, para
    // que comparar sea una búsqueda en un Set y no recorrer un árbol.
    const permisos = [...new Set(filas
        .filter(f => f['recurso.nombreRecurso'] && f['accion.nombreAccion'])
        .map(f => `${f['recurso.nombreRecurso']}:${f['accion.nombreAccion']}`))];

    // Las carpetas se mandan separadas por tipo: el menú de tienda mira las de 'vendedor' y
    // el del panel las de 'administrativo'. Antes solo se enviaban las de vendedor y por eso
    // el panel nunca se enteraba de un cambio.
    const carpetas = { vendedor: new Set(), administrativo: new Set() };
    for (const f of filas) {
        const folder = f['recurso.folder'];
        const tipo = f['recurso.tipo'];
        if (folder && carpetas[tipo]) carpetas[tipo].add(folder);
    }

    return {
        permisos,
        carpetas: { vendedor: [...carpetas.vendedor], administrativo: [...carpetas.administrativo] }
    };
}

/**
 * Avisa a las sesiones abiertas de ese usuario que sus permisos cambiaron.
 *
 * Se llama DESPUÉS del commit y nunca lanza: un aviso que falla no puede tumbar la
 * operación que lo disparó (CLAUDE.md §9). Si el usuario no tiene ninguna sesión abierta,
 * el broadcast no hace nada y no es un error — al entrar de nuevo lee los permisos frescos.
 */
export async function avisarCambioDePermisos(idUsuario) {
    if (!idUsuario) return;
    try {
        broadcast(idUsuario, 'permissions_update', await permisosDeUsuario(idUsuario));
    } catch (e) {
        console.error('avisarCambioDePermisos:', e);
    }
}
