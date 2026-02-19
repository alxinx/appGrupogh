
(function () {
    const inputBusqueda = document.getElementById('busquedaProvedor');
    const selectCategoria = document.getElementById('filtroCategoriaProvedor');
    const contenedor = document.getElementById('contenedor-provedores');

    let paginaActual = 1;

    // Función para mostrar los proveedores en la tabla
    const mostrarProvedores = (provedores) => {
        contenedor.innerHTML = '';

        if (provedores.length === 0) {
            contenedor.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500">No se encontraron proveedores 🥲.</td></tr>';
            return;
        }

        provedores.forEach(p => {
            // Generar pills de categorías
            let categoriasHtml = '';
            if (p.categorias && p.categorias.length > 0) {
                p.categorias.forEach(cat => {
                    categoriasHtml += `<span class="inline-block bg-purple-100 text-purple-700 text-[10px] px-2 py-0.5 rounded-full mr-1 mb-1 font-semibold">${cat.nombre}</span>`;
                });
            } else {
                categoriasHtml = '<span class="text-gray-400 text-xs italic">Sin categoría</span>';
            }

            contenedor.innerHTML += `
                <tr class="hover:bg-gray-50 transition-colors group">
                    <td class="p-4">
                        <div class="font-bold text-gray-800">${p.razonSocial}</div>
                        <div class="text-xs text-gray-400">${p.emailProvedor || 'Sin email'}</div>
                    </td>
                    <td class="p-4 text-sm text-gray-600">${p.nombreContacto || '--'}</td>
                    <td class="p-4 text-sm text-gray-600">${p.telefonoContacto || '--'}</td>
                    <td class="p-4 text-sm text-gray-600 font-mono">${p.taxIdSupplier}</td>
                    <td class="p-4">
                        <div class="flex flex-wrap max-w-[200px]">
                            ${categoriasHtml}
                        </div>
                    </td>
                    <td class="p-4 text-right">
                        <a href="/admin/provedores/ver/${p.idProveedor}" class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors" title="Ver Detalle">
                            <i class="fi-rr-eye"></i>
                        </a>
                    </td>
                </tr>
            `;
        });
    };

    // Función principal para obtener datos
    const obtenerProvedores = async () => {
        try {
            const params = new URLSearchParams({
                busqueda: inputBusqueda?.value || '',
                categoria: selectCategoria?.value || '',
                pagina: paginaActual
            });

            const url = `/admin/json/provedores/?${params.toString()}`;

            // Loading state simple (opcional)
            contenedor.style.opacity = '0.5';

            const response = await fetch(url);
            const data = await response.json();

            contenedor.style.opacity = '1';

            if (data.success) {
                mostrarProvedores(data.provedores);
                if (typeof generarPaginacion === 'function') {
                    generarPaginacion(
                        '#paginacionProvedores',
                        data.totalPaginas,
                        data.paginaActual,
                        (nuevaPagina) => {
                            paginaActual = nuevaPagina;
                            obtenerProvedores();
                        }
                    );
                }
            } else {
                console.error('Error del servidor:', data.mensaje);
            }

        } catch (error) {
            console.error('Error al obtener proveedores:', error);
            contenedor.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar datos.</td></tr>';
        }
    };

    // Filtros
    const filtrar = () => {
        paginaActual = 1;
        obtenerProvedores();
    };

    // Debounce para búsqueda
    let timer;
    if (inputBusqueda) {
        inputBusqueda.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(filtrar, 300);
        });
    }

    if (selectCategoria) {
        selectCategoria.addEventListener('change', filtrar);
    }

    // Cargar inicial
    document.addEventListener('DOMContentLoaded', obtenerProvedores);

})();
