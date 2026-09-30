// Desplegable "Más" de la cabecera del panel (estándar en views/components/accionesAdmin.pug).
// Abre y cierra el menú, lo cierra con Esc o con un clic afuera, y mantiene aria-expanded
// al día para los lectores de pantalla. Cada opción decide qué hace con su propio listener.
export function activarMenuMas(boton, menu) {
    if (!boton || !menu) return { cerrar() {} };

    const abierto = () => !menu.classList.contains('hidden');
    const poner = (abrir) => {
        menu.classList.toggle('hidden', !abrir);
        boton.setAttribute('aria-expanded', String(abrir));
        if (abrir) menu.querySelector('button:not([disabled]), a')?.focus({ preventScroll: true });
    };

    boton.setAttribute('aria-haspopup', 'menu');
    boton.setAttribute('aria-expanded', 'false');
    boton.addEventListener('click', (e) => { e.stopPropagation(); poner(!abierto()); });
    document.addEventListener('click', (e) => { if (abierto() && !menu.contains(e.target)) poner(false); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && abierto()) { poner(false); boton.focus(); }
    });

    return { cerrar: () => poner(false) };
}
