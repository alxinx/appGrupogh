import sanitizeHtml from 'sanitize-html';

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