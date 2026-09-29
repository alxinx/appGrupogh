// Escapa un texto para meterlo dentro de un innerHTML o del `html` de una ventana de
// SweetAlert. Todo dato que escribió una persona —y más si llegó de un formulario público,
// como el registro de proveedores— pasa por acá antes de volverse marcado: sin esto, un
// "<img onerror=…>" guardado como nombre o llave se ejecuta en el navegador de quien abre
// el panel.
export const escaparHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
