// Catálogos que llegan completos del servidor y se filtran en el navegador (admin/insumos,
// admin/confeccionistas): solo se muestran u ocultan los elementos ya pintados, nada de una
// consulta nueva. Cada elemento está una vez en la lista (<tr>) y otra en la cuadrícula, con
// los mismos data-* — las dos vistas se filtran igual y el conteo sale de las filas.

/**
 * @param {object} o
 * @param {string} o.selector       elementos filtrables (filas y tarjetas)
 * @param {HTMLInputElement} o.busqueda
 * @param {string[]} o.camposTexto  data-* donde busca el texto (ya en minúsculas)
 * @param {{ el: HTMLSelectElement, coincide: (el: HTMLElement, valor: string) => boolean }[]} o.filtros
 * @param {HTMLElement} o.limpiar, o.sinResultados, o.conteo
 * @param {[string, string]} o.nombres  singular y plural para el conteo
 * @param {(coincidentes: HTMLElement[]) => void} [o.alFiltrar]  si está, los que coinciden no
 *        se muestran acá: se le pasan en el orden de la página (ver `paginarCatalogo`)
 */
export function activarFiltrosCatalogo({ selector, busqueda, camposTexto, filtros = [], limpiar, sinResultados, conteo, nombres, alFiltrar }) {
    const elementos = Array.from(document.querySelectorAll(selector));
    const filas = elementos.filter(el => el.tagName === 'TR');
    if (!filas.length || !busqueda) return;
    const [uno, varios] = nombres;
    const total = (n) => (n === 1 ? `1 ${uno}` : `${n} ${varios}`);

    const aplicar = () => {
        const texto = busqueda.value.trim().toLowerCase();
        let visibles = 0;
        const coincidentes = [];
        // Se recorre en el orden actual del documento, no en el de carga: si la página
        // reordena, la paginación tiene que seguir lo que se ve.
        document.querySelectorAll(selector).forEach(el => {
            const ok = (!texto || camposTexto.some(c => (el.dataset[c] || '').includes(texto)))
                && filtros.every(f => !f.el.value || f.coincide(el, f.el.value));
            if (!alFiltrar) el.classList.toggle('hidden', !ok);
            else if (ok) coincidentes.push(el);
            else el.classList.add('hidden');
            if (ok && el.tagName === 'TR') visibles++;
        });
        alFiltrar?.(coincidentes);
        sinResultados?.classList.toggle('hidden', visibles > 0);
        if (conteo) conteo.textContent = visibles === filas.length ? total(filas.length) : `${visibles} de ${total(filas.length)}`;
        limpiar?.classList.toggle('hidden', !(texto || filtros.some(f => f.el.value)));
    };

    busqueda.addEventListener('input', aplicar);
    filtros.forEach(f => f.el.addEventListener('change', aplicar));
    limpiar?.addEventListener('click', () => {
        busqueda.value = '';
        filtros.forEach(f => { f.el.value = ''; });
        aplicar();
        busqueda.focus();
    });
    return { aplicar };
}

/**
 * Lo que coincide con el filtro no se muestra todo de una: la lista va por páginas (el
 * paginador del panel, `window.generarPaginacion` de src/js/paginador.js) y la cuadrícula
 * por tandas a medida que se baja (un centinela al final, con IntersectionObserver). Las
 * fotos de las tarjetas son `loading="lazy"` y una tarjeta oculta no pide la suya, así que
 * la carga de imágenes sigue al scroll. Se conecta como `alFiltrar` de activarFiltrosCatalogo.
 *
 * @param {object} o
 * @param {string} o.paginacion       selector del contenedor del paginador de la lista
 * @param {number} [o.porPagina]      filas por página
 * @param {HTMLElement} [o.centinela] elemento al final de la cuadrícula que pide la tanda siguiente
 * @param {HTMLElement} [o.aviso]     texto "Mostrando N de M" de la cuadrícula
 * @param {number} [o.porTanda]       tarjetas por tanda
 * @param {() => void} [o.alCambiarPagina]
 */
export function paginarCatalogo({ paginacion, porPagina = 25, centinela, aviso, porTanda = 12, alCambiarPagina }) {
    let filas = [];
    let tarjetas = [];
    let pagina = 1;
    let mostradas = porTanda;

    const pintarLista = () => {
        const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
        pagina = Math.min(pagina, paginas);
        const desde = (pagina - 1) * porPagina;
        filas.forEach((el, i) => el.classList.toggle('hidden', i < desde || i >= desde + porPagina));
        window.generarPaginacion?.(paginacion, paginas, pagina, (p) => {
            pagina = p;
            pintarLista();
            alCambiarPagina?.();
        });
    };

    let observador = null;
    const pintarCuadricula = () => {
        tarjetas.forEach((el, i) => el.classList.toggle('hidden', i >= mostradas));
        const quedan = tarjetas.length > mostradas;
        centinela?.classList.toggle('hidden', !quedan);
        if (aviso) aviso.textContent = `Mostrando ${Math.min(mostradas, tarjetas.length)} de ${tarjetas.length}`;
        // El observador solo avisa cuando el centinela ENTRA en pantalla: si después de una
        // tanda sigue a la vista (pantalla alta), volver a observarlo dispara otro aviso.
        if (quedan && observador) { observador.unobserve(centinela); observador.observe(centinela); }
    };

    if (centinela && 'IntersectionObserver' in window) {
        observador = new IntersectionObserver((entradas) => {
            if (!entradas.some(e => e.isIntersecting) || tarjetas.length <= mostradas) return;
            mostradas += porTanda;
            pintarCuadricula();
        }, { rootMargin: '0px 0px 400px 0px' });
    } else {
        mostradas = Infinity;   // sin observador, la cuadrícula completa
    }

    return (coincidentes) => {
        filas = coincidentes.filter(el => el.tagName === 'TR');
        tarjetas = coincidentes.filter(el => el.tagName !== 'TR');
        pagina = 1;
        if (observador) mostradas = porTanda;
        pintarLista();
        pintarCuadricula();
    };
}

/**
 * Lista o cuadrícula. La elección se recuerda en este navegador (localStorage, comodidad de
 * cada operador; si el navegador no deja guardar, arranca en la vista por defecto).
 * `vistaMovil`: la vista por defecto en pantallas de celular (menos de 768px, el `md` de
 * Tailwind) mientras la persona no haya elegido otra. Sin ella, la lista en todos lados.
 */
export function activarVistaCatalogo({ lista, cuadricula, botones, clave, vistaMovil }) {
    if (!lista || !cuadricula || !botones?.length) return;
    const aplicar = (vista) => {
        const enCuadricula = vista === 'cuadricula';
        lista.classList.toggle('hidden', enCuadricula);
        cuadricula.classList.toggle('hidden', !enCuadricula);
        botones.forEach(b => {
            const activo = b.dataset.vista === vista;
            b.setAttribute('aria-pressed', String(activo));
            b.classList.toggle('bg-white', activo);
            b.classList.toggle('shadow-sm', activo);
            b.classList.toggle('text-gh-primaryHover', activo);
        });
    };
    const enMovil = window.matchMedia?.('(max-width: 767px)').matches;
    let vista = enMovil && vistaMovil === 'cuadricula' ? 'cuadricula' : 'lista';
    try {
        const g = localStorage.getItem(clave);
        if (g === 'lista' || g === 'cuadricula') vista = g;
    } catch { /* sin almacenamiento: la vista por defecto */ }
    aplicar(vista);
    botones.forEach(b => b.addEventListener('click', () => {
        aplicar(b.dataset.vista);
        try { localStorage.setItem(clave, b.dataset.vista); } catch { /* no se recuerda, no pasa nada */ }
    }));
}
