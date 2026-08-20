import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';

// Sanitizador para descripciones cortas: negritas, listas, enlaces y poco más.
export const sanitizarHTML = (contenido) => {
    return sanitizeHtml(contenido, {
        allowedTags: [
            'b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'h3', 'h4', 'a'
        ],
        allowedAttributes: {
            'a': ['href', 'target', 'rel']
        },
        allowedSchemes: ['http', 'https', 'mailto'],
        // Elimina etiquetas vacías accidentales que ensucian el diseño
        exclusiveFilter: (frame) => {
            return frame.tag === 'p' && !frame.text.trim();
        }
    });
};

// Sanitizador para el cuerpo de una página del CMS.
//
// Es más permisivo que `sanitizarHTML` —una página necesita títulos, tablas, imágenes y
// citas, no solo negritas— pero sigue siendo una LISTA BLANCA: lo que no está acá se
// descarta. Nada de <script>, <iframe>, <object>, ni atributos `on*`.
//
// El contenido se guardaba tal cual llegaba del editor y se volvía a pintar sin escapar en
// el formulario de edición. Un editor con acceso al CMS podía dejar un <script> que se
// ejecutaba en el navegador de cualquier administrador que abriera esa página: robo de
// sesión no, porque la cookie es httpOnly, pero sí acciones en su nombre con su sesión
// abierta —crear usuarios, mover plata— que es peor.
//
// `allowedSchemes` deja fuera `javascript:` y `data:`, que son las dos formas de meter
// código en un href o en un src aunque la etiqueta esté permitida.
export const sanitizarContenidoPagina = (contenido) => {
    return sanitizeHtml(String(contenido ?? ''), {
        allowedTags: [
            'p', 'br', 'hr', 'div', 'span', 'blockquote', 'pre', 'code',
            'b', 'i', 'em', 'strong', 'u', 's', 'sub', 'sup', 'small',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'ul', 'ol', 'li', 'dl', 'dt', 'dd',
            'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
            'a', 'img', 'figure', 'figcaption',
            // Obsoletas pero inofensivas: los editores de texto enriquecido y el pegado
            // desde Word las siguen emitiendo. Descartarlas rompía el formato de páginas
            // que ya estaban publicadas.
            'font', 'mark', 'del', 'ins', 'abbr', 'cite', 'q'
        ],
        allowedAttributes: {
            a:   ['href', 'target', 'rel', 'title'],
            img:  ['src', 'alt', 'title', 'width', 'height', 'loading'],
            font: ['size', 'face', 'color'],
            td:   ['colspan', 'rowspan', 'align', 'valign'],
            th:   ['colspan', 'rowspan', 'align', 'valign', 'scope'],
            '*':  ['class', 'style', 'dir', 'lang']
        },
        allowedSchemes: ['http', 'https', 'mailto', 'tel'],
        // `style` se permite pero por lista blanca de propiedades y de valores. Dejarlo
        // libre admitiría `expression()` y `url(javascript:...)`, que ejecutan código
        // desde una hoja de estilos. Acá cada propiedad declara qué forma puede tener su
        // valor, así que nada que no calce con esos patrones sobrevive.
        //
        // La lista cubre lo que emiten los editores de texto enriquecido —color,
        // tipografía, alineación, bordes, espaciado—. Faltaban la mitad y saneaban a la
        // basura páginas legítimas: el documento de tratamiento de datos perdía dos
        // tercios de su formato.
        allowedStyles: {
            '*': (() => {
                const COLOR   = [/^#(0x)?[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s.,%]+\)$/i, /^hsla?\([\d\s.,%]+\)$/i, /^[a-zA-Z-]+$/];
                const MEDIDA  = [/^-?[\d.]+(?:px|em|rem|%|pt|vh|vw)?$/];
                const MEDIDAS = [/^(-?[\d.]+(?:px|em|rem|%|pt)?\s*){1,4}$/];
                const estilos = {
                    'color': COLOR, 'background-color': COLOR, 'background': COLOR,
                    'border-color': COLOR, 'border-top-color': COLOR, 'border-bottom-color': COLOR,
                    'border-left-color': COLOR, 'border-right-color': COLOR,
                    // Tipografía. `font-family` acepta comillas y comas: es una lista de
                    // nombres, no una URL, y el patrón excluye paréntesis para que no
                    // pueda colarse un url() ni un expression().
                    'font-family':  [/^[a-zA-Z0-9\s,'"\u00C0-\u017F.-]+$/],
                    'font-size':    MEDIDA,
                    'font-weight':  [/^\d{3}$|^bold$|^bolder$|^normal$|^lighter$/i],
                    'font-style':   [/^normal$|^italic$|^oblique$/i],
                    'font-variant-ligatures': [/^[a-z-]+$/i],
                    'line-height':  [/^[\d.]+(?:px|em|rem|%)?$/],
                    // `normal` es un valor válido de estos dos y no es una medida.
                    'letter-spacing': [...MEDIDA, /^normal$/i], 'word-spacing': [...MEDIDA, /^normal$/i],
                    'border-collapse': [/^collapse$|^separate$/i],
                    'border-spacing':  MEDIDAS,
                    'text-align':      [/^left$|^right$|^center$|^justify$/i],
                    'text-decoration': [/^[a-z\s-]+$/i],
                    'text-transform':  [/^[a-z-]+$/i],
                    'text-indent':     MEDIDA,
                    'white-space':     [/^[a-z-]+$/i],
                    'vertical-align':  [/^[a-z-]+$/i],
                    'list-style-type': [/^[a-z-]+$/i],
                    // Caja
                    'width': MEDIDA, 'max-width': MEDIDA, 'min-width': MEDIDA,
                    'height': MEDIDA, 'max-height': MEDIDA,
                    'margin': MEDIDAS, 'padding': MEDIDAS,
                    'border-radius': MEDIDAS,
                    'float': [/^left$|^right$|^none$/i],
                    'display': [/^block$|^inline$|^inline-block$|^none$|^flex$|^table$/i]
                };
                // border y sus cuatro lados: "3px solid rgb(17,17,17)". El patrón admite
                // medida, estilo de línea y color, y nada más.
                const BORDE = [/^[\d.]+(?:px|em|rem|pt)?\s+(?:solid|dashed|dotted|double|none)(?:\s+(?:#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|[a-zA-Z-]+))?$/i];
                // Solo los CUATRO LADOS. El bucle no toca `margin`, `padding` ni `border`
                // a secas: ésos ya están arriba admitiendo hasta cuatro valores, y
                // pisarlos acá con el patrón de un solo valor descartaba `margin: 0 0 8px`.
                for (const lado of ['-top', '-bottom', '-left', '-right']) {
                    estilos[`border${lado}`]  = BORDE;
                    estilos[`margin${lado}`]  = MEDIDA;
                    estilos[`padding${lado}`] = MEDIDA;
                }
                estilos['border'] = BORDE;
                return estilos;
            })()
        },
        // Un enlace que sale del sitio no debe poder tocar la ventana que lo abrió.
        transformTags: {
            a: (nombre, attrs) => attrs.target === '_blank'
                ? { tagName: 'a', attribs: { ...attrs, rel: 'noopener noreferrer' } }
                : { tagName: 'a', attribs: attrs }
        }
    });
};

// Una familia agrupa productos que son el mismo artículo en distintas variantes
// ("Blusa Greicy - Rojo" y "Blusa Greicy - Negro" → BLUSA GREICY). Para que dos personas
// que escriben lo mismo con distinto tipeo caigan en la misma familia hay que normalizar
// SIEMPRE por acá: extremos recortados, espacios internos colapsados y mayúsculas.
// Devuelve null cuando no queda nada, porque en la columna conviven muchos NULL pero la
// cadena vacía sería una "familia" más, compartida por todos los productos sin familia.
export const normalizarFamilia = (valor) => {
    if (valor === null || valor === undefined) return null;
    const limpio = String(valor).replace(/\s+/g, ' ').trim().toUpperCase();
    return limpio === '' ? null : limpio;
};

// El nombre de familia que se propone para un producto es su propio nombre normalizado:
// esa es la regla ("BLUSA VERONIKA"). Vive acá para que el formulario, el controlador y
// el buscador de parecidos propongan exactamente lo mismo.
export const familiaDesdeNombre = (nombreProducto) => normalizarFamilia(nombreProducto);

// Cuántas palabras del nombre identifican al artículo. Los nombres del catálogo comparten
// prefijo y se diferencian al final por el color o la talla ("Blusa Greicy - Rojo",
// "Blusa Greicy - Negro"), así que las primeras palabras son lo que agrupa.
export const PALABRAS_FAMILIA = 2;

// Familia deducida de un nombre de producto que YA incluye la variante.
// "Blusa Greicy - Rojo" → "BLUSA GREICY". Usar el nombre completo daría una familia por
// producto, que es justo lo contrario de agrupar.
// Lo comparten el buscador de sugerencias y el alta automática: si divergieran, lo que el
// formulario propone y lo que el backend guarda dejarían de coincidir.
export const prefijoFamilia = (nombreProducto, palabras = PALABRAS_FAMILIA) => {
    const limpio = normalizarFamilia(nombreProducto);
    if (!limpio) return null;
    return limpio.split(' ').slice(0, palabras).join(' ');
};

export const limpiarPrecio = (precio) => {
    if (!precio) return 0;
    // Eliminamos todo lo que no sea número
    const numeroLimpio = precio.toString().replace(/[^0-9]/g, '');
    return parseInt(numeroLimpio, 10);
};


export const formatearFecha = (fechaRaw) => {
    if (!fechaRaw) return "Sin fecha";

    const fecha = new Date(fechaRaw);
    return new Intl.DateTimeFormat('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    }).format(fecha);
};


export const getAvailability = (cantidad) => {
    if (cantidad <= 0) return { text: 'Agotado', class: 'bg-red-100 text-red-700' };
    if (cantidad <= 5) return { text: 'Stock Bajo', class: 'bg-orange-100 text-orange-700' };
    return { text: 'Disponible', class: 'bg-green-100 text-green-700' };
};

// Valida que el archivo subido sea realmente una imagen decodificable (no solo que el cliente
// diga que lo es vía mimetype, que se puede falsificar) y lo convierte a WebP.
// Lanza un error claro si sharp no logra interpretar el buffer como imagen.
export const validarYConvertirImagenWebp = async (buffer, { calidad = 85 } = {}) => {
    let metadata;
    try {
        metadata = await sharp(buffer).metadata();
    } catch {
        throw new Error('El archivo no es una imagen válida.');
    }
    if (!metadata.width || !metadata.height) {
        throw new Error('El archivo no es una imagen válida.');
    }
    return sharp(buffer).webp({ quality: calidad }).toBuffer();
};