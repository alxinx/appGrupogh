import { activarFormularioInsumo } from './formularioInsumo.js';

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

// ── Catálogo: búsqueda + filtros ──────────────────────────────────────────────────
// El catálogo llega completo del servidor (es chico, ver produccionController.js): acá
// solo se muestran/ocultan las <tr> que ya están pintadas, nada de una consulta nueva.
// Los cuatro filtros (texto, tipo, unidad, estado) se combinan entre sí.
(function () {
    const filas = Array.from(document.querySelectorAll('#tabla-materiales tr[data-nombre]'));
    if (!filas.length) return;

    const busqueda      = document.getElementById('busqueda-material');
    const filtroTipo    = document.getElementById('filtro-tipo-material');
    const filtroUnidad  = document.getElementById('filtro-unidad-material');
    const filtroEstado  = document.getElementById('filtro-estado-material');
    const btnLimpiar    = document.getElementById('limpiar-filtros-material');
    const sinResultados = document.getElementById('sin-resultados-material');
    const conteo        = document.getElementById('conteo-materiales');

    const aplicarFiltros = () => {
        const texto  = busqueda.value.trim().toLowerCase();
        const tipo   = filtroTipo.value;
        const unidad = filtroUnidad.value;
        const activoBuscado = filtroEstado.value && (filtroEstado.value === 'activo' ? '1' : '0');

        let visibles = 0;
        filas.forEach(fila => {
            const coincide =
                (!texto || fila.dataset.nombre.includes(texto) || fila.dataset.codigo.includes(texto)) &&
                (!tipo || fila.dataset.tipo === tipo) &&
                (!unidad || fila.dataset.unidad === unidad) &&
                (!activoBuscado || fila.dataset.activo === activoBuscado);
            fila.classList.toggle('hidden', !coincide);
            if (coincide) visibles++;
        });

        sinResultados.classList.toggle('hidden', visibles > 0);
        conteo.textContent = visibles === filas.length
            ? (filas.length === 1 ? '1 material' : `${filas.length} materiales`)
            : `${visibles} de ${filas.length} materiales`;
        btnLimpiar.classList.toggle('hidden', !(texto || tipo || unidad || filtroEstado.value));
    };

    busqueda.addEventListener('input', aplicarFiltros);
    [filtroTipo, filtroUnidad, filtroEstado].forEach(sel => sel.addEventListener('change', aplicarFiltros));
    btnLimpiar.addEventListener('click', () => {
        busqueda.value = '';
        filtroTipo.value = '';
        filtroUnidad.value = '';
        filtroEstado.value = '';
        aplicarFiltros();
    });
})();
