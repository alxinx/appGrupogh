import { activarFiltrosCatalogo, activarVistaCatalogo, paginarCatalogo } from './catalogoFiltrable.js';
import { activarCalificaciones } from './calificacionTaller.js';

// Lista de confeccionistas (admin/confeccionistas). Mismo mecanismo que el catálogo de
// insumos: llega completa del servidor y acá solo se filtra y se cambia de vista.
const $ = (id) => document.getElementById(id);

const CARGA = {
    trabajo:  (el) => Number(el.dataset.encurso) > 0,
    libre:    (el) => Number(el.dataset.encurso) === 0 && el.dataset.activo === '1',
    revision: (el) => Number(el.dataset.revision) > 0
};

// Calificación de 0 a 5 (null = sin calificar), ver helpers/confeccionistas.js.
const CALIFICACION = {
    4:    (p) => p !== null && p >= 4,
    3:    (p) => p !== null && p >= 3,
    bajo: (p) => p !== null && p < 3,
    sin:  (p) => p === null
};

// Lista por páginas, cuadrícula por tandas al bajar.
const paginar = paginarCatalogo({
    paginacion: '#paginacion-talleres',
    porPagina: 25,
    centinela: $('centinela-talleres'),
    aviso: $('aviso-tanda-talleres'),
    porTanda: 12,
    alCambiarPagina: () => {
        const lista = $('vista-lista-talleres');
        if (lista && lista.getBoundingClientRect().top < 0) lista.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});

const catalogo = activarFiltrosCatalogo({
    selector: '[data-taller]',
    busqueda: $('busqueda-taller'),
    camposTexto: ['nombre', 'documento', 'contacto'],
    filtros: [
        { el: $('filtro-ciudad-taller'), coincide: (el, v) => el.dataset.ciudad === v },
        { el: $('filtro-carga-taller'),  coincide: (el, v) => CARGA[v]?.(el) ?? true },
        { el: $('filtro-pago-taller'),   coincide: (el, v) => el.dataset.pago === v },
        { el: $('filtro-calificacion-taller'), coincide: (el, v) => CALIFICACION[v]?.(el.dataset.puntaje === '' ? null : Number(el.dataset.puntaje)) ?? true },
        { el: $('filtro-estado-taller'), coincide: (el, v) => el.dataset.activo === (v === 'activo' ? '1' : '0') }
    ],
    limpiar: $('limpiar-filtros-taller'),
    sinResultados: $('sin-resultados-taller'),
    conteo: $('conteo-talleres'),
    nombres: ['taller', 'talleres'],
    alFiltrar: paginar
});

activarVistaCatalogo({
    lista: $('vista-lista-talleres'),
    cuadricula: $('vista-cuadricula-talleres'),
    botones: document.querySelectorAll('.vista-catalogo-btn'),
    clave: 'confeccionistas.vista'
});

// Una foto que no carga (se borró del bucket, o el enlace firmado falló) no deja un ícono
// roto: se cae a las iniciales que ya están pintadas debajo.
document.querySelectorAll('img[data-foto-taller]').forEach(img => {
    const caer = () => img.remove();
    if (img.complete && img.naturalWidth === 0) caer();
    else img.addEventListener('error', caer, { once: true });
});

activarCalificaciones();

// ── Orden ──────────────────────────────────────────────────────────────────────────────
// Reordena filas y tarjetas que ya están en la página. "Con trabajo primero" es el orden en
// que llegaron del servidor (data-orden); los sin calificar van siempre al final.
(function () {
    const select = $('orden-talleres');
    if (!select) return;
    const puntaje = (el) => (el.dataset.puntaje === '' ? -1 : Number(el.dataset.puntaje));
    const comparar = {
        carga:        (a, b) => a.dataset.orden - b.dataset.orden,
        calificacion: (a, b) => puntaje(b) - puntaje(a) || a.dataset.orden - b.dataset.orden,
        nombre:       (a, b) => a.dataset.nombre.localeCompare(b.dataset.nombre, 'es')
    };
    const CLAVE = 'confeccionistas.orden';
    const ordenar = () => {
        const fn = comparar[select.value] || comparar.carga;
        [$('vista-lista-talleres')?.querySelector('tbody'), $('rejilla-talleres')].forEach(cont => {
            if (!cont) return;
            [...cont.querySelectorAll(':scope > [data-taller]')].sort(fn).forEach(el => cont.appendChild(el));
        });
    };
    try { const g = localStorage.getItem(CLAVE); if (g && comparar[g]) select.value = g; } catch { /* sin almacenamiento */ }
    ordenar();
    select.addEventListener('change', () => {
        ordenar();
        catalogo?.aplicar();   // la página 1 y la primera tanda siguen el orden nuevo
        try { localStorage.setItem(CLAVE, select.value); } catch { /* no se recuerda */ }
    });
})();

// Primera pintada: página 1 de la lista y primera tanda de la cuadrícula, ya en el orden
// elegido (el bloque de arriba ordena antes de llegar acá).
catalogo?.aplicar();
