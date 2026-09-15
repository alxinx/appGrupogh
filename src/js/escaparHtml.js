// Para todo texto que escribe una persona y termina en un innerHTML: sin esto, una razón de
// incidencia o una nota con "<img onerror=…>" se ejecuta en la pantalla de otra tienda.
export const escaparHtml = (texto) => String(texto ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
