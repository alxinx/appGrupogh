(function () {
    let paginaActual = 1;

    const mostrarInventario = (inventory) => {
        const contenedor = document.querySelector('#contenedor-inventario');
        if (!contenedor) return;

        contenedor.innerHTML = '';
        if (inventory.length === 0) {
            contenedor.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-500">No encontré productos en este inventario 🧐.</td></tr>';
            return;
        }

        inventory.forEach(item => {
            contenedor.innerHTML += `
                <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td class="p-4">
                        <img src="${item.imagenUrl}" class="w-12 h-12 object-cover rounded-lg shadow-sm" onerror="this.src='/img/image-default.webp'">
                    </td>
                    <td class="p-4">
                        <div class="font-bold text-gray-800">${item.displayProducto}</div>
                        ${item.displaySku ? `<div class="text-xs text-gray-400">SKU: ${item.displaySku}</div>` : ''}
                    </td>
                    <td class="p-4 text-sm font-semibold text-gh-primary">
                        ${item.cantidad}
                    </td>
                    <td class="p-4">
                        <span class="px-2 py-1 rounded-full text-xs ${item.availability.class}">
                            ${item.availability.text}
                        </span>
                    </td>
                </tr>`;
        });
    }

    const obtenerInventario = async () => {
        const inputBusqueda = document.querySelector('#busquedaInventario');
        const idPuntoDeVenta = document.querySelector('#idPuntoDeVenta')?.value;
        const contenedor = document.querySelector('#contenedor-inventario');

        if (!idPuntoDeVenta || !contenedor) return;

        try {
            const busqueda = inputBusqueda ? inputBusqueda.value : '';
            const url = `/admin/json/inventario-tienda/${idPuntoDeVenta}?busqueda=${encodeURIComponent(busqueda)}&pagina=${paginaActual}`;

            const respuesta = await fetch(url);
            const resultado = await respuesta.json();

            if (resultado.success) {
                mostrarInventario(resultado.inventory);

                if (typeof generarPaginacion === 'function') {
                    generarPaginacion(
                        '#paginacion-inventario',
                        resultado.totalPaginas,
                        resultado.paginaActual,
                        (nuevaPagina) => {
                            paginaActual = nuevaPagina;
                            obtenerInventario();
                        }
                    );
                }
            }
        } catch (error) {
            console.error('Error al obtener inventario:', error);
        }
    }

    // Evento de carga de pestaña
    document.addEventListener('tabLoaded', (e) => {
        if (e.detail.tabId === 'inventario') {
            const inputBusqueda = document.querySelector('#busquedaInventario');

            if (inputBusqueda) {
                let timer;
                inputBusqueda.addEventListener('input', () => {
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        paginaActual = 1;
                        obtenerInventario();
                    }, 300);
                });

                // Carga inicial
                paginaActual = 1;
                obtenerInventario();
            }
        }
    });

    // Botón modo inventario (delegado)
    document.addEventListener('click', (e) => {
        if (e.target.id === 'btn-modo-inventario') {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Modo Inventario',
                    text: 'El modo inventario será habilitado próximamente.',
                    icon: 'info',
                    confirmButtonText: 'Entendido',
                    confirmButtonColor: '#7c3aed'
                });
            } else {
                alert('El modo inventario será habilitado próximamente.');
            }
        }
    });

})();
