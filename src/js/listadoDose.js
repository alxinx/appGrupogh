(function() {
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    const tbody = document.querySelector('tbody');
    const inputSearch = document.querySelector('input[name="search"]');
    const selectEstado = document.querySelector('select[name="estado"]');
    const countActual = document.querySelector('#count-actual');
    const countTotal = document.querySelector('#count-total');
    const paginacionContainer = document.querySelector('#paginacion-container');

    let paginaActual = 1;

    // 1. CARGA DE WIDGETS GLOBALES (Corregido)
    const cargarWidgetsGlobales = async () => {
    try {
        // Apuntamos a la nueva ruta única
        const res = await fetch('/admin/api/dosificaciones/stats-global'); 
        const data = await res.json();
        
        console.log("Ahora sí, datos globales:", data);

        const elDose = document.querySelector('#widget-total-dose');
        const elPacks = document.querySelector('#widget-total-packs');

        if (elDose) elDose.innerText = data.totalDosificaciones;
        if (elPacks) elPacks.innerText = data.totalPacks;
    } catch (error) {
        console.error("Error:", error);
    }
};

    const cargarDosificaciones = async () => {
        const valorBusqueda = inputSearch.value.trim() || 'all';
        const estado = selectEstado ? selectEstado.value : '';
        const url = `/admin/api/dosificaciones/${valorBusqueda}?pagina=${paginaActual}&estado=${estado}`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            console.log("Datos del buscador:", data); // Verifica que 'data.dosificaciones' exista
            renderizarTabla(data.dosificaciones);
            actualizarPaginacion(data); 
            // Widget de filtrados (Resultados actuales)
            if (document.querySelector('#widget-filtrados')) 
                document.querySelector('#widget-filtrados').innerText = data.total;
        } catch (error) {
            console.error("Error cargando datos:", error);
        }
    };

    function renderizarTabla(lista) {
        if (!lista || lista.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-slate-400">🫠 No se encontraron dosificaciones</td></tr>`;
            return;
        }

        tbody.innerHTML = lista.map(d => `
            <tr class="border-b border-gray-100 hover:bg-gray-100 transition-colors">
                <td class="px-2 py-5 text-center">
                    <div class="flex items-center justify-center space-x-3">
                        <i class="fi-rr-daily-calendar mr-2"></i>
                        <span class="h3">${d.fecha}</span>
                    </div>
                </td>
                <td class="px-2 py-5 text-center">
                    <span class="status-chip status-active">
                        <span class="status-dot"></span>${d.codigo}
                    </span>
                </td>
                <td class="px-2 text-center">
                    <p class="font-bold text-slate-800">${d.nroPaquetes}</p>
                </td>
                <td class="px-2 text-center">
                    <button class="btn-ver-productos text-gh-primaryHover font-bold underline text-xs cursor-pointer" data-id="${d.id}">
                        <i class="fi-rr-box-open mr-1"></i> Ver productos
                    </button>
                </td>
                <td class="px-2 py-5 text-center">
                    <a href="/admin/dosificaciones/ver/${d.id}" class="btn btn-secondary text-xs">
                        <i class="fi-rr-eye text-xs"></i> Ver Dosificación
                    </a>
                </td>
            </tr>
        `).join('');
    }

    function actualizarPaginacion(data) {
        if (countActual) countActual.innerText = data.dosificaciones ? data.dosificaciones.length : 0;
        if (countTotal) countTotal.innerText = data.total || 0;
        if (!paginacionContainer) return;

        // El paginador del proyecto (paginador.js), como los otros doce listados. Antes este
        // archivo armaba sus propios botones con un bloque fijo de 5, así que era el único que
        // no heredaba nada de lo que se le fue agregando al compartido: cuántas páginas entran
        // según el ancho, la alineación, el deslizamiento al cambiar de bloque y el arreglo de
        // los botones que se comprimían.
        window.generarPaginacion('#paginacion-container', data.paginas || 0, paginaActual, (nuevaPagina) => {
            paginaActual = nuevaPagina;
            cargarDosificaciones();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // --- DELEGACIÓN DE EVENTOS ---
    document.addEventListener('click', async (e) => {
        // Clic en Ver Productos (Modal)
        if (e.target.closest('.btn-ver-productos')) {
            const id = e.target.closest('.btn-ver-productos').dataset.id;

            //ABRO el modal
    document.addEventListener('click', async (e) => {
    // 1. Manejo del Modal (usando closest para capturar el botón aunque toquen el icono)
    const btnProductos = e.target.closest('.btn-ver-productos');
    
    if (btnProductos) {
        const id = btnProductos.dataset.id;
        const modal = document.querySelector('#modal-productos');
        const modalBody = document.querySelector('#modal-body-productos');

        // Reset y mostrar modal
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            modalBody.innerHTML = '<p class="text-center w-full">Cargando...</p>';
        }

        try {
            const res = await fetch(`/admin/api/dosificaciones/productos/${id}`);
            const data = await res.json();
            
            // Renderizar productos
            modalBody.innerHTML = data.productos.map(p => `
                <span class="subItems">
                    ${p}
                </span>
            `).join('') || ' 🫠 No hay productos';
            
        } catch (error) {
            modalBody.innerHTML = '<p class="text-red-500">Error al cargar productos</p>';
        }
    }

  
});
            
        }
    });

    if (inputSearch) inputSearch.addEventListener('input', debounce(() => { paginaActual = 1; cargarDosificaciones(); }, 300));
    if (selectEstado) selectEstado.addEventListener('change', () => { paginaActual = 1; cargarDosificaciones(); });

    // Ejecución inicial
    cargarWidgetsGlobales();
    cargarDosificaciones();



    


})();


