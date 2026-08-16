/**
 * Editor con formato para la meta descripción del producto.
 *
 * El campo ya aceptaba HTML: al guardar pasa por `sanitizarHTML()` (sanitize-html) y la
 * tienda lo pinta con innerHTML. Lo que faltaba era poder escribirlo sin teclear etiquetas
 * a mano y sin adivinar cómo va a quedar.
 *
 * Se trabaja sobre el <textarea> y no sobre un contenteditable a propósito: así el HTML
 * queda a la vista y se puede corregir a mano, y no hace falta sumar una librería de
 * edición al proyecto.
 *
 * IMPORTANTE: el filtro de acá es SOLO para que la vista previa diga la verdad. La
 * autoridad es el servidor, que vuelve a sanear lo que llegue. Un usuario que edite el
 * DOM no gana nada.
 */

// Espejo exacto de helpers/helpers.js -> sanitizarHTML. Si allá cambia, acá también.
const ETIQUETAS = ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'h3', 'h4', 'a'];
const ATRIBUTOS = { a: ['href', 'target', 'rel'] };
const ESQUEMAS  = ['http:', 'https:', 'mailto:'];

/** Deja solo lo que el servidor va a aceptar. Devuelve HTML seguro para la vista previa. */
function sanear(html) {
    const doc = new DOMParser().parseFromString(`<div id="raiz">${html}</div>`, 'text/html');
    const raiz = doc.getElementById('raiz');

    const limpiar = (nodo) => {
        [...nodo.children].forEach(el => {
            const tag = el.tagName.toLowerCase();
            if (!ETIQUETAS.includes(tag)) {
                // Se conserva el texto interior, igual que hace sanitize-html por defecto.
                el.replaceWith(...el.childNodes);
                return;
            }
            const permitidos = ATRIBUTOS[tag] || [];
            [...el.attributes].forEach(at => {
                if (!permitidos.includes(at.name)) { el.removeAttribute(at.name); return; }
                if (at.name === 'href') {
                    // Bloquea javascript: y data:; solo pasan los esquemas de la lista.
                    try {
                        const u = new URL(at.value, window.location.origin);
                        if (!ESQUEMAS.includes(u.protocol)) el.removeAttribute('href');
                    } catch { el.removeAttribute('href'); }
                }
            });
            limpiar(el);
        });
    };
    limpiar(raiz);
    return raiz.innerHTML;
}

/** Texto plano: es lo que termina en la etiqueta <meta name="description">. */
const aTextoPlano = (html) => {
    const d = new DOMParser().parseFromString(html, 'text/html');
    return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
};

document.addEventListener('DOMContentLoaded', () => {
    const area = document.getElementById('meta_descripcion');
    const barra = document.getElementById('meta-toolbar');
    const previa = document.getElementById('meta-preview');
    const contador = document.getElementById('meta-contador');
    if (!area || !barra) return;

    /** Envuelve lo seleccionado; si no hay selección, deja el cursor entre las etiquetas. */
    const envolver = (apertura, cierre) => {
        const ini = area.selectionStart, fin = area.selectionEnd;
        const sel = area.value.slice(ini, fin);
        area.value = area.value.slice(0, ini) + apertura + sel + cierre + area.value.slice(fin);
        const cursor = ini + apertura.length + sel.length;
        area.focus();
        area.setSelectionRange(sel ? ini + apertura.length : cursor, cursor);
        area.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const acciones = {
        negrita:  () => envolver('<strong>', '</strong>'),
        cursiva:  () => envolver('<em>', '</em>'),
        parrafo:  () => envolver('<p>', '</p>'),
        subtitulo:() => envolver('<h3>', '</h3>'),
        salto:    () => envolver('<br>', ''),
        lista:    () => {
            const ini = area.selectionStart, fin = area.selectionEnd;
            const sel = area.value.slice(ini, fin);
            const items = (sel ? sel.split('\n') : ['']).filter(l => l.trim() || !sel);
            envolver('<ul>' + items.map(l => `<li>${l.trim()}</li>`).join('') + '</ul>', '');
            // envolver ya insertó todo; se quita la selección original duplicada
            area.value = area.value.slice(0, ini) + area.value.slice(ini).replace(sel, '');
            area.dispatchEvent(new Event('input', { bubbles: true }));
        },
        enlace: () => {
            const url = window.prompt('Dirección del enlace (https://…)');
            if (!url) return;
            if (!/^(https?:|mailto:)/i.test(url)) {
                window.showToast?.('El enlace debe empezar con https:// o mailto:', 'warning');
                return;
            }
            envolver(`<a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">`, '</a>');
        },
    };

    barra.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-accion]');
        if (!btn) return;
        e.preventDefault();
        acciones[btn.dataset.accion]?.();
    });

    const refrescar = () => {
        const limpio = sanear(area.value || '');
        if (previa) previa.innerHTML = limpio || '<span class="text-gray-300">La vista previa aparece acá…</span>';
        if (contador) {
            const n = aTextoPlano(limpio).length;
            // 160 es lo que muestran los buscadores; de ahí en adelante se corta.
            contador.textContent = `${n} caracteres de texto`;
            contador.className = 'text-[10px] ' + (n > 160 ? 'text-gh-primaryHover font-bold' : 'text-gray-400');
            if (n > 160) contador.textContent += ' — los buscadores cortan en 160';
        }
    };
    area.addEventListener('input', refrescar);
    refrescar();
});
