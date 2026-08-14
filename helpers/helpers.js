import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';

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