import { tituloLista as tc } from '../../helpers/textoLista.js';
import { activarMenuMas } from './menuMasAcciones.js';
import { abrirExportarProductos } from './exportarProductos.js';
import { abrirPreciosMasivos } from './preciosMasivos.js';
(function(){
    const inputBusqueda = document.querySelector('#busquedaText');
    const selectCategoria = document.querySelector('#categoriaProductos');
    const selectFamilia = document.querySelector('#familiaProductos');
    // El botón vive en la cabecera, junto a "Volver" y "Crear Nuevo Producto".
    const btnExportar = document.querySelector('#btnExportarCodigos');
    const nombreFamiliaExportar = document.querySelector('#exportarCodigosFamilia');
    const checkWeb = document.querySelector('#filtroWeb');
    const estado = document.querySelector('#estadoProductos');
    const contenedor = document.querySelector('#contenedor-productos');

    // Estado local del listado
    let paginaActual = 1;

    // Se incrementa en cada consulta nueva. Sin esto, una respuesta lenta de una
    // búsqueda vieja puede llegar después de una más nueva y pisar sus resultados
    // (p. ej. mostrar "No se encontraron productos" aunque el producto exista).
    let ultimaConsultaId = 0;

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
                        <div class="font-bold text-gray-800">${tc(producto.nombreProducto)}</div>
                        <div class="text-xs text-gray-400">SKU: ${producto.sku}</div>
                    </td>
                    <td class="p-4 text-sm font-semibold text-gh-primary">
                         ${formatMoney(producto.precioVentaPublicoFinal, 0) ?? 0}
                        <div class="text-xs text-gray-400 font-normal">Mayorista:  ${formatMoney(producto.precioVentaMayorista, 0)}</div>
                    </td>
                    <td class="p-4 text-sm">${(producto.stockGlobal ?? 0).toLocaleString('es-CO')}</td>
                    <td class="p-4">
                        <span class="px-2 py-1 rounded-full text-xs ${producto.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                            ${producto.activo ? 'Activo' : 'Inactivo'}
                        </span>
                    </td>
                    <td class="p-4"><div class="w-4 h-4 rounded-full ${producto.web ? 'bg-green-500' : 'bg-gray-300'}"></div></td>
                    <td class="p-4">
                        <a href="/admin/inventario/ver/${producto.idProducto}" class="text-gh-primary hover:text-gh-primaryHover">
                            <div class="btn btn-secondary" >
                                <i class="fi-rr-eye text-lg"></i>
                                Ver Detalles
                            </div>

                        
                        
                        </a>
                    </td>
                </tr>`;
        });
    }

    // Los filtros de la pantalla, en un solo lugar: los usan el listado y la exportación,
    // que tiene que traer exactamente las mismas filas.
    const leerFiltros = () => ({
        busqueda: inputBusqueda.value,
        categoria: selectCategoria.value,
        familia: selectFamilia?.value || '',
        estado: estado.value,
        // Solo filtra encendido. Antes mandaba siempre true/false y, apagado, dejaba
        // únicamente los productos NO publicados en vez de mostrarlos todos.
        web: checkWeb.checked ? 'true' : ''
    });

    // Los mismos filtros dichos en palabras, para la tarjeta "Los filtrados" de la ventana.
    const textoOpcion = (sel) => (sel?.value ? sel.options[sel.selectedIndex]?.text.trim() : '');
    const resumirFiltros = () => [
        inputBusqueda.value.trim() && `Búsqueda “${inputBusqueda.value.trim()}”`,
        textoOpcion(selectCategoria),
        selectFamilia?.value && `Familia ${window.tituloCase?.(textoOpcion(selectFamilia)) || textoOpcion(selectFamilia)}`,
        estado.value === '1' ? 'Solo activos' : estado.value === '0' ? 'Solo inactivos' : '',
        checkWeb.checked && 'Publicados en la web'
    ].filter(Boolean).join(' · ');

    const obtenerProductos = async () => {
        const consultaId = ++ultimaConsultaId;
        try {
            // Recolectamos filtros + la página actual
            const filtros = { ...leerFiltros(), pagina: paginaActual };

            const queryParams = new URLSearchParams(filtros).toString();
            const url = `/admin/json/productos/?${queryParams}`;

            const respuesta = await fetch(url);
            const resultado = await respuesta.json();

            // Ya salió otra consulta más nueva mientras esperábamos esta respuesta: descartarla.
            if (consultaId !== ultimaConsultaId) return;

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

    // El botón de exportar existe solo con una familia elegida. Lleva el nombre de la
    // familia en la etiqueta a propósito: exporta TODOS los códigos de ese artículo,
    // ignorando los demás filtros de la pantalla, y sin nombrarla el operador podría
    // creer que baja lo que está viendo.
    const sincronizarExportar = () => {
        if (!btnExportar) return;
        const idFamilia = selectFamilia?.value || '';

        if (!idFamilia) {
            btnExportar.classList.add('hidden');
            btnExportar.removeAttribute('href');
            return;
        }

        // Las familias se guardan en mayúscula (normalizarFamilia), pero en la etiqueta se
        // muestran en Título: "BODY CELESTE" gritado al lado de "Volver" y "Crear Nuevo
        // Producto" desentona con el resto de la cabecera.
        const nombre = selectFamilia.options[selectFamilia.selectedIndex]?.text || 'esta familia';
        nombreFamiliaExportar.textContent = window.tituloCase?.(nombre) || nombre;
        btnExportar.href = `/admin/inventario/etiqueta-sku/familia/${idFamilia}?format=excel`;
        btnExportar.title = `Descarga un Excel con el nombre y el código de todos los productos de ${window.tituloCase?.(nombre) || nombre}`;
        btnExportar.classList.remove('hidden');
    };

    const filtrar = () => {
        paginaActual = 1; // Siempre que filtramos, volvemos a la pág 1
        sincronizarExportar();
        obtenerProductos();
    }

    // Listeners
    let timer;
    inputBusqueda.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(filtrar, 300);
    });

    [selectCategoria, selectFamilia, checkWeb, estado]
        .filter(Boolean)
        .forEach(el => el.addEventListener('change', filtrar));

    // La lista de familias crece con cada alta, así que el select se vuelve buscable:
    // se puede escribir o elegir, igual que departamento/municipio. El <select> real no
    // se toca —mismo id, mismo value—, así que `filtros.familia` sigue leyéndose igual.
    // Requiere el partial views/components/selectBuscable, ya incluido en la vista.
    window.enhanceSelectBuscable?.(selectFamilia, { placeholder: 'Escribe o elige una familia' });

    // Al cargar, por si el navegador restauró una familia elegida.
    sincronizarExportar();

    // ── Menú "Más" de la cabecera ──
    const menuMas = activarMenuMas(document.querySelector('#btn-mas-productos'), document.querySelector('#menu-mas-productos'));
    let camposExportar = [];
    try { camposExportar = JSON.parse(document.querySelector('[data-campos-exportar]')?.dataset.camposExportar || '[]'); } catch { /* sin campos: la ventana igual abre */ }
    document.querySelector('#opcion-editar-precios')?.addEventListener('click', () => {
        menuMas.cerrar();
        abrirPreciosMasivos({
            csrfToken: document.querySelector('[data-csrf]')?.dataset.csrf || '',
            alTerminar: obtenerProductos   // el listado muestra los precios nuevos sin recargar
        });
    });
    document.querySelector('#opcion-exportar-productos')?.addEventListener('click', () => {
        menuMas.cerrar();
        abrirExportarProductos({ filtros: leerFiltros(), resumenFiltros: resumirFiltros(), campos: camposExportar });
    });

    document.addEventListener('DOMContentLoaded', filtrar);



    
})();