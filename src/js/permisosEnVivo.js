import { adminSSE, storeSSE } from './sseCompartido.js';
import { sellar, desellar } from './cristalBloqueo.js';

// ── PERMISOS EN VIVO ─────────────────────────────────────────────────────────
//
// Un permiso que se quita con la pantalla abierta no se nota hasta la próxima navegación:
// la persona sigue viendo el formulario y recién al enviarlo se lleva un 403. Al revés es
// peor — a quien le acaban de dar el permiso le sigue apareciendo el cartel de "sin
// permiso" y cree que no se aplicó.
//
// El servidor empuja el cambio por SSE al canal del usuario (helpers/permisosEnVivo.js) y
// esto lo aplica sin recargar, igual que el POS se bloquea cuando la caja entra en cuadre.
//
// Esto es comodidad: quien decide de verdad es el middleware de la ruta en cada petición.
//
// ── Cómo se usa ──────────────────────────────────────────────────────────────
//
// En la vista, sobre el contenedor que hay que sellar:
//
//     div#card-movimiento(
//         data-requiere-permiso="Bancos:CREATE"
//         data-bloqueo-titulo="Sin permiso para registrar"
//         data-bloqueo-texto="Tu usuario puede consultar esta cuenta, pero no registrar."
//         data-bloqueo-pista="Lo habilita un administrador en Personal."
//     )
//
// El servidor ya pinta el cristal si corresponde (components/cristalBloqueo.pug): esto se
// encarga de los cambios POSTERIORES. No hay que llamar a nada — con el atributo alcanza.
//
// Para reaccionar a algo que no sea sellar una tarjeta, `alCambiarPermisos(fn)` avisa en
// cada cambio, igual que `alCambiarCuadre` en el POS.

const ATRIBUTO = 'data-requiere-permiso';
const ID_CRISTAL = 'cristal-sin-permiso';

let permisos = null;          // Set de "Recurso:ACCION", o null mientras no llegó nada
const oyentes = [];

/** ¿El usuario tiene este permiso? Con `Recurso:ACCION`, tal cual el atributo. */
export const puede = (llave) => !permisos || permisos.has(llave);

/** Se ejecuta en cada cambio de permisos. Devuelve una función para darse de baja. */
export function alCambiarPermisos(fn) {
    oyentes.push(fn);
    return () => { const i = oyentes.indexOf(fn); if (i >= 0) oyentes.splice(i, 1); };
}

/**
 * Revisa cada elemento que declara un permiso y lo sella o lo libera.
 *
 * Mientras no llegó ningún `permissions_update` no se toca nada: lo que pintó el servidor
 * es la verdad. Sellar por las dudas dejaría la pantalla bloqueada de arranque cada vez
 * que el SSE tarde en conectar.
 */
function aplicar() {
    if (!permisos) return;
    document.querySelectorAll(`[${ATRIBUTO}]`).forEach((el) => {
        const llave = el.getAttribute(ATRIBUTO);
        const tienePermiso = permisos.has(llave);
        // El cristal que puso el servidor por OTRO motivo (una cuenta inactiva, por
        // ejemplo) no se toca: este módulo solo maneja el suyo, el del permiso.
        const propio = el.querySelector(`#${ID_CRISTAL}`);
        const ajeno = el.querySelector(':scope > .bloqueo-cristal:not(#' + ID_CRISTAL + ')');

        if (!tienePermiso && !propio && !ajeno) {
            sellar(el, {
                id: ID_CRISTAL,
                titulo: el.dataset.bloqueoTitulo || 'Sin permiso',
                texto: el.dataset.bloqueoTexto || 'Tu usuario ya no puede usar esta sección.',
                pista: el.dataset.bloqueoPista,
                iconoPista: el.dataset.bloqueoIcono || 'fi-rr-user-gear'
            });
        } else if (tienePermiso && propio) {
            desellar(el, ID_CRISTAL);
        }
    });
}

function alLlegarCambio(e) {
    try {
        const datos = JSON.parse(e.data);
        // `permisos` es el formato nuevo; si llegara un evento viejo con solo carpetas, se
        // ignora en vez de vaciar el Set y sellar media pantalla sin motivo.
        if (!Array.isArray(datos.permisos)) return;
        permisos = new Set(datos.permisos);
        aplicar();
        oyentes.forEach((fn) => { try { fn(permisos); } catch (err) { console.error('permisos:', err); } });
    } catch (err) {
        console.error('permissions_update:', err);
    }
}

// El canal se elige por la ruta: el panel escucha /admin/sse y la tienda /store/sse. Son
// conexiones compartidas entre pestañas (sseCompartido.js), así que suscribirse acá no
// abre una nueva.
const enElPanel = window.location.pathname.startsWith('/admin');
const sse = enElPanel ? adminSSE() : storeSSE();
sse.on('permissions_update', alLlegarCambio);
sse.connect();

// Un elemento con el atributo puede aparecer después (una tarjeta que se pinta por JS),
// así que se revisa también cuando cambia el DOM. Solo corre si ya hubo un cambio de
// permisos: sin eso no hay nada que aplicar.
if (typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (permisos) aplicar(); })
        .observe(document.documentElement, { childList: true, subtree: true });
}
