import { activarFormularioInsumo } from './formularioInsumo.js';
import { activarFiltrosCatalogo, activarVistaCatalogo } from './catalogoFiltrable.js';

// Alta de insumos (admin/insumos). El formulario en sí (validación, código DXF único, carga
// de foto) vive en formularioInsumo.js — lo comparte con la edición del perfil
// (admin/insumos/:id). Acá solo queda lo propio de esta pantalla: el modal y el catálogo.

// ── Modal de alta ───────────────────────────────────────────────────────────────
// Mismo patrón que el resto del panel (ej. src/js/adminProductoView.js: "Hacer
// Traslado"): clases hidden/flex, clic en el backdrop cierra, botón de cerrar cierra.
// Se abre desde el botón del header o, si se llega desde el submenu "Nuevo insumo"
// (/admin/insumos?nuevo=1), automáticamente al cargar la página.
(function () {
    const modal = document.getElementById('modal-nuevo-insumo');
    if (!modal) return;

    const abrir = () => { modal.classList.remove('hidden'); modal.classList.add('flex'); };
    const cerrar = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };

    document.getElementById('btn-nuevo-insumo')?.addEventListener('click', abrir);
    document.getElementById('modal-nuevo-insumo-cerrar')?.addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

    if (new URLSearchParams(location.search).get('nuevo') === '1') abrir();
})();

activarFormularioInsumo({
    formId: 'form-insumo',
    urlGuardar: '/admin/insumos',
    metodoGuardar: 'POST',
    badgeConfirmacion: 'Nuevo material',
    confirmarTexto: 'Guardar insumo',
    badgeExito: 'Material guardado',
    // El alta no pide código de empleado hoy (solo pIns('CREATE') de sesión); la edición sí.
    requiereCodigoEmpleado: false,
    // No location.reload(): si se llegó con ?nuevo=1 (submenu), un reload volvería a abrir
    // el modal apenas se refresca la página.
    alGuardar: () => { window.location.href = '/admin/insumos'; }
});

// ── Catálogo: búsqueda, filtros y vista lista/cuadrícula (src/js/catalogoFiltrable.js) ──
// Los cuatro filtros (texto, tipo, unidad, estado) se combinan entre sí.
const $ = (id) => document.getElementById(id);
activarFiltrosCatalogo({
    selector: '[data-material]',
    busqueda: $('busqueda-material'),
    camposTexto: ['nombre', 'codigo'],
    filtros: [
        { el: $('filtro-tipo-material'),   coincide: (el, v) => el.dataset.tipo === v },
        { el: $('filtro-unidad-material'), coincide: (el, v) => el.dataset.unidad === v },
        { el: $('filtro-estado-material'), coincide: (el, v) => el.dataset.activo === (v === 'activo' ? '1' : '0') }
    ],
    limpiar: $('limpiar-filtros-material'),
    sinResultados: $('sin-resultados-material'),
    conteo: $('conteo-materiales'),
    nombres: ['material', 'materiales']
});
activarVistaCatalogo({
    lista: $('vista-lista-materiales'),
    cuadricula: $('vista-cuadricula-materiales'),
    botones: document.querySelectorAll('.vista-catalogo-btn'),
    clave: 'insumos.vistaCatalogo',
    vistaMovil: 'cuadricula'   // en el celular la tabla no cabe; las tarjetas sí
});
