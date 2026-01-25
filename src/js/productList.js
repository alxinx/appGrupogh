(function(){
    //Capturo los parametros que el front me manda. 
    const inputBusqueda = document.querySelector('#busquedaText');
    const selectCategoria = document.querySelector('#categoriaProductos');
    const checkWeb = document.querySelector('#filtroWeb');
    const estado = document.querySelector('#estadoProductos')
    const contenedor = document.querySelector('#contenedor-productos')



    
const mostrarProductos = (productos) => {
    // 1. Limpiar el contenido actual de la tabla
    contenedor.innerHTML = '';

    if (productos.length === 0) {
        contenedor.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-gray-500">
                    No se encontraron productos con esos filtros.
                </td>
            </tr>`;
        return;
    }

    // 2. Recorrer los productos y construir las filas
    productos.forEach(producto => {
        // Buscamos la imagen principal en el array de imágenes que enviamos desde el controlador
        const principal = producto.imagenes?.find(i => i.tipo === 'principal') || null;

        const imagenUrl = principal?.nombreImagen
            ? `https://pub-f89c3f57ac314e868860b81774b10373.r2.dev/productos/${principal.nombreImagen}`
            : '/img/image-default.webp';

        contenedor.innerHTML += `
            <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td class="p-4">
                    <img src="${imagenUrl}" class="w-12 h-12 object-cover rounded-lg shadow-sm">
                </td>
                <td class="p-4">
                    <div class="font-bold text-gray-800">${producto.nombreProducto}</div>
                    <div class="text-xs text-gray-400">SKU: ${producto.sku}</div>
                </td>
                <td class="p-4 text-sm font-semibold text-gh-primary">Público Final: $ ${producto.precioVentaPublicoFinal ?? 0}
                <div class="text-xs text-gray-400">Mayorista: ${producto.precioVentaMayorista}</div>
                
                </td>
                <td class="p-4 text-sm">${producto.stock ?? 0}</td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded-full text-xs ${producto.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                        ${producto.activo ? 'Activo' : 'Inactivo'}
                    </span>
                </td>
                <td class="p-4">
                     <div class="w-4 h-4 rounded-full ${producto.web ? 'bg-pink-500' : 'bg-gray-300'}"></div>
                </td>
                <td class="p-4">
                    <a href="/admin/editar-producto/${producto.idProducto}" class="text-gh-primary hover:text-gh-primaryHover">
                        <i class="fi-rr-edit text-lg"></i>
                    </a>
                </td>
            </tr>
        `;
    });
}

    //Finalmente mandoo los datos para ser consultados al json
const obtenerProductos = async (filtros = {}) => {
    try {
        const queryParams = new URLSearchParams(filtros).toString();
        const url = `/admin/json/productos/?${queryParams}`;

        const respuesta = await fetch(url);
        
        // Solo una vez: guardamos el resultado completo
        const resultado = await respuesta.json();

        // Extraemos los productos del objeto resultado
        // (Recuerda que en el controlador enviamos { success: true, productos: [...] })
        if (resultado.success) {
            mostrarProductos(resultado.productos);
        }

    } catch (error) {
        console.log('Error al obtener datos:', error);
    }
}






//con filtro lo que hagoo es que convierto lo que me mandan en  un objeto para poder trabajar con el en json
const filtrar = () => {
    const datos = {
        busqueda: inputBusqueda.value,
        categoria: selectCategoria.value,
        estado: estado.value,
        web: checkWeb.checked 
    };

    //Aqui mando los objetos a la funcion que me controla el json
    obtenerProductos(datos);
}



//Cuando detecto que algunoo de los input ha cambiado, entonces ejecuto la funcion filtrar.
    //Retraso el tiempo de consulta cuando escriben en el input para que no haga consulta cada vez que el usuario teclee unna letra en el input de busqueda.
    let timer;
    inputBusqueda.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                filtrar(); 
            }, 300);
        });

    selectCategoria.addEventListener('change', filtrar );
    checkWeb.addEventListener('change', filtrar);
    estado.addEventListener('change', filtrar)

   
document.addEventListener('DOMContentLoaded', () => {
    filtrar(); 

});

})()