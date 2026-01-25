(function(){
    const inputBusqueda = document.querySelector('#busquedaText');
    const selectCategoria = document.querySelector('#categoriaProductos');
    const checkWeb = document.querySelector('#filtroWeb');
    const estado = document.querySelector('#estadoProductos');
    const contenedor = document.querySelector('#contenedor-productos');

    // Estado local del listado
    let paginaActual = 1; 

    const mostrarProductos = (productos) => {
        contenedor.innerHTML = '';
        if (productos.length === 0) {
            contenedor.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-500">No se encontraron productos.</td></tr>';
            return;
        }

        productos.forEach(producto => {
            const principal = producto.imagenes?.find(i => i.tipo === 'principal') || null;
            const imagenUrl = principal?.nombreImagen
                ? `https://pub-f89c3f57ac314e868860b81774b10373.r2.dev/productos/${principal.nombreImagen}`
                : '/img/image-default.webp';

            contenedor.innerHTML += `
                <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td class="p-4"><img src="${imagenUrl}" class="w-12 h-12 object-cover rounded-lg shadow-sm"></td>
                    <td class="p-4">
                        <div class="font-bold text-gray-800">${producto.nombreProducto}</div>
                        <div class="text-xs text-gray-400">SKU: ${producto.sku}</div>
                    </td>
                    <td class="p-4 text-sm font-semibold text-gh-primary">
                         ${formatMoney(producto.precioVentaPublicoFinal, 0) ?? 0}
                        <div class="text-xs text-gray-400 font-normal">Mayorista:  ${formatMoney(producto.precioVentaMayorista, 0)}</div>
                    </td>
                    <td class="p-4 text-sm">${producto.stock ?? 0}</td>
                    <td class="p-4">
                        <span class="px-2 py-1 rounded-full text-xs ${producto.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                            ${producto.activo ? 'Activo' : 'Inactivo'}
                        </span>
                    </td>
                    <td class="p-4"><div class="w-4 h-4 rounded-full ${producto.web ? 'bg-pink-500' : 'bg-gray-300'}"></div></td>
                    <td class="p-4">
                        <a href="/admin/editar-producto/${producto.idProducto}" class="text-gh-primary hover:text-gh-primaryHover">
                            <i class="fi-rr-edit text-lg"></i>
                        </a>
                    </td>
                </tr>`;
        });
    }

    const obtenerProductos = async () => {
        try {
            // Recolectamos filtros + la página actual
            const filtros = {
                busqueda: inputBusqueda.value,
                categoria: selectCategoria.value,
                estado: estado.value,
                web: checkWeb.checked,
                pagina: paginaActual
            };

            const queryParams = new URLSearchParams(filtros).toString();
            const url = `/admin/json/productos/?${queryParams}`;

            const respuesta = await fetch(url);
            const resultado = await respuesta.json();

            if (resultado.success) {
                mostrarProductos(resultado.productos);
                
                // Invocamos al paginador global
                generarPaginacion(
                    '#paginacion', 
                    resultado.totalPaginas, 
                    resultado.paginaActual, 
                    (nuevaPagina) => {
                        paginaActual = nuevaPagina;
                        obtenerProductos(); // Re-consultamos con la nueva página
                    }
                );
            }
        } catch (error) {
            console.error('Error al obtener datos:', error);
        }
    }

    const filtrar = () => {
        paginaActual = 1; // Siempre que filtramos, volvemos a la pág 1
        obtenerProductos();
    }

    // Listeners
    let timer;
    inputBusqueda.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(filtrar, 300);
    });

    [selectCategoria, checkWeb, estado].forEach(el => el.addEventListener('change', filtrar));

    document.addEventListener('DOMContentLoaded', filtrar);



    
})();