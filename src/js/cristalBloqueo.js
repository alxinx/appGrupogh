// ── CRISTAL DE BLOQUEO ───────────────────────────────────────────────────────
//
// Lámina de vidrio esmerilado sobre algo que no se puede usar ahora mismo. El contenido
// se sigue viendo detrás, así queda claro QUÉ está bloqueado en vez de dejar un hueco.
//
// Es el gemelo en JavaScript de views/components/cristalBloqueo.pug: los dos escriben el
// MISMO marcado y comparten los estilos `.bloqueo-*` de public/css/input.css. El mixin es
// para lo que pinta el servidor; este módulo para lo que cambia con la pantalla abierta.
// Si se toca uno hay que tocar el otro — por eso el marcado vive en un solo lugar de cada
// lado y no repetido en cada pantalla, que es como estaba: el POS lo tenía dos veces y el
// cuadre de caja una tercera, cada una con su propio texto en el HTML.
//
// El cristal solo TAPA. Lo que de verdad inhabilita un formulario es `inert`: sin él los
// campos se siguen alcanzando con el tabulador y se puede escribir a ciegas detrás del
// velo. Y ni el cristal ni `inert` son la garantía — eso es el servidor.

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/**
 * El marcado del cristal.
 *
 * @param titulo      qué pasa, en pocas palabras
 * @param texto       por qué, y qué implica
 * @param pista       píldora al pie con el siguiente paso
 * @param iconoPista  clase de UIcons para esa píldora
 * @param accion      rótulo de un botón (el llamador le engancha el clic por su id)
 * @param idAccion    id de ese botón
 * @param imagen      por defecto el candado de /img/avatars/seguro.webp
 * @param id          id del cristal, para poder encontrarlo y sacarlo después
 */
export const cristalBloqueo = ({ titulo, texto, pista, iconoPista, accion, idAccion, imagen, id } = {}) => `
    <div class="bloqueo-cristal"${id ? ` id="${esc(id)}"` : ''}>
        <img src="${esc(imagen || '/img/avatars/seguro.webp')}" alt="" class="bloqueo-icono">
        <p class="bloqueo-titulo">${esc(titulo)}</p>
        ${texto ? `<p class="bloqueo-texto">${esc(texto)}</p>` : ''}
        ${pista ? `<p class="bloqueo-pista">${iconoPista ? `<i class="fi ${esc(iconoPista)}"></i>` : ''}${esc(pista)}</p>` : ''}
        ${accion ? `<button type="button" class="bloqueo-accion"${idAccion ? ` id="${esc(idAccion)}"` : ''}>${esc(accion)}</button>` : ''}
    </div>`;

/**
 * Sella un elemento: le pone el cristal encima y lo saca de la navegación por teclado.
 * Es idempotente — llamarlo dos veces no apila dos cristales.
 *
 * `inert` va sobre el formulario de adentro si lo hay, y si no sobre el elemento entero:
 * marcarlo en el contenedor del cristal lo desactivaría a él también y el botón de acción
 * dejaría de responder.
 */
export function sellar(elemento, opciones = {}) {
    if (!elemento) return null;
    elemento.classList.add('bloqueo-anfitrion');

    const yaEsta = opciones.id
        ? elemento.querySelector(`#${CSS.escape(opciones.id)}`)
        : elemento.querySelector(':scope > .bloqueo-cristal');
    if (!yaEsta) elemento.insertAdjacentHTML('beforeend', cristalBloqueo(opciones));

    const inerte = opciones.inerte ?? elemento.querySelector('form') ?? null;
    if (inerte) inerte.setAttribute('inert', '');

    return elemento.querySelector(':scope > .bloqueo-cristal');
}

/** Le saca el cristal y devuelve el foco a lo que había debajo. */
export function desellar(elemento, id) {
    if (!elemento) return;
    const cristal = id
        ? elemento.querySelector(`#${CSS.escape(id)}`)
        : elemento.querySelector(':scope > .bloqueo-cristal');
    cristal?.remove();
    if (!elemento.querySelector(':scope > .bloqueo-cristal')) {
        elemento.classList.remove('bloqueo-anfitrion');
        elemento.querySelector('form')?.removeAttribute('inert');
        elemento.removeAttribute('inert');
    }
}
