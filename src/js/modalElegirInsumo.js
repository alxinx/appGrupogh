// Lógica del modal "Elige un insumo" (views/components/modalElegirInsumo.pug): abrir,
// filtrar por nombre, elegir y cerrar. Antes estaba escrita dos veces (asistente y editor de
// la ficha); ahora la usan esos dos y la orden de producción.
//
//   const selector = crearModalElegirInsumo('modal-elegir-insumo', (insumo, contexto) => { … });
//   selector.abrir(fila);   // `contexto` es lo que se pasó a abrir (la fila que se completa)
//
// `insumo` = { idMaterial, nombre, imagen, unidad, conColor }.
export function crearModalElegirInsumo(idModal, alElegir) {
    const modal = document.getElementById(idModal);
    if (!modal) return { abrir: () => {} };
    const buscador = modal.querySelector('[data-buscador-insumo]');
    const grid = modal.querySelector('[data-grid-insumos]');
    let contexto = null;

    const mostrarTodas = () => grid?.querySelectorAll('[data-opcion-insumo]').forEach((b) => { b.style.display = ''; });
    const cerrar = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        contexto = null;
        if (buscador) buscador.value = '';
        mostrarTodas();
    };
    const abrir = (ctx = null) => {
        contexto = ctx;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        buscador?.focus();
    };

    modal.querySelector('[data-cerrar-modal-insumo]')?.addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
    buscador?.addEventListener('input', (e) => {
        const termino = e.target.value.toLowerCase().trim();
        grid?.querySelectorAll('[data-opcion-insumo]').forEach((b) => {
            b.style.display = (b.dataset.nombre || '').toLowerCase().includes(termino) ? '' : 'none';
        });
    });
    grid?.addEventListener('click', (e) => {
        const opcion = e.target.closest('[data-opcion-insumo]');
        if (!opcion) return;
        const ctx = contexto;
        alElegir({
            idMaterial: opcion.dataset.id,
            nombre: opcion.dataset.nombre,
            imagen: opcion.dataset.imagen || '',
            unidad: opcion.dataset.unidad || '',
            conColor: opcion.dataset.conColor === '1'
        }, ctx);
        cerrar();
    });

    return { abrir, cerrar };
}
