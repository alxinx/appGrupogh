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