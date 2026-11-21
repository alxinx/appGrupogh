// Detalle de la calificación de un taller (views/components/calificacionTaller.pug). Es un
// `popover` nativo —capa superior, ningún overflow lo recorta, Esc y clic afuera lo cierran
// solos—; lo único que falta es ubicarlo junto al botón que lo abrió, debajo o, si no
// cabe, encima, sin salirse de la pantalla.
const MARGEN = 8;

const ubicar = (panel, boton) => {
    const b = boton.getBoundingClientRect();
    const { width: w, height: h } = panel.getBoundingClientRect();
    const izquierda = Math.min(Math.max(MARGEN, b.left), window.innerWidth - w - MARGEN);
    const abajo = b.bottom + MARGEN;
    const arriba = abajo + h > window.innerHeight - MARGEN ? Math.max(MARGEN, b.top - h - MARGEN) : abajo;
    Object.assign(panel.style, { inset: 'auto', left: `${izquierda}px`, top: `${arriba}px` });
};

export function activarCalificaciones(raiz = document) {
    raiz.querySelectorAll('[data-calificacion-btn]').forEach(boton => {
        const panel = document.getElementById(boton.getAttribute('popovertarget'));
        if (!panel) return;
        panel.addEventListener('toggle', (e) => { if (e.newState === 'open') ubicar(panel, boton); });
    });
    // Un panel abierto no queda flotando lejos de su fila al desplazarse: se cierra.
    window.addEventListener('scroll', () => {
        document.querySelectorAll('[data-calificacion-panel]:popover-open').forEach(p => p.hidePopover());
    }, { passive: true, capture: true });
}
