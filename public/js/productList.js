/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/js/productList.js"
/*!*******************************!*\
  !*** ./src/js/productList.js ***!
  \*******************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n(function(){\n    //Capturo los parametros que el front me manda. \n    const inputBusqueda = document.querySelector('#busquedaText');\n    const selectCategoria = document.querySelector('#categoriaProductos');\n    const checkWeb = document.querySelector('#filtroWeb');\n    const estado = document.querySelector('#estadoProductos')\n    const contenedor = document.querySelector('#contenedor-productos')\n\n\n\n    \nconst mostrarProductos = (productos) => {\n    // 1. Limpiar el contenido actual de la tabla\n    contenedor.innerHTML = '';\n\n    if (productos.length === 0) {\n        contenedor.innerHTML = `\n            <tr>\n                <td colspan=\"7\" class=\"p-8 text-center text-gray-500\">\n                    No se encontraron productos con esos filtros.\n                </td>\n            </tr>`;\n        return;\n    }\n\n    // 2. Recorrer los productos y construir las filas\n    productos.forEach(producto => {\n        // Buscamos la imagen principal en el array de imágenes que enviamos desde el controlador\n        const principal = producto.imagenes?.find(i => i.tipo === 'principal') || null;\n\n        const imagenUrl = principal?.nombreImagen\n            ? `https://pub-f89c3f57ac314e868860b81774b10373.r2.dev/productos/${principal.nombreImagen}`\n            : '/img/image-default.webp';\n\n        contenedor.innerHTML += `\n            <tr class=\"border-b border-gray-100 hover:bg-gray-50 transition-colors\">\n                <td class=\"p-4\">\n                    <img src=\"${imagenUrl}\" class=\"w-12 h-12 object-cover rounded-lg shadow-sm\">\n                </td>\n                <td class=\"p-4\">\n                    <div class=\"font-bold text-gray-800\">${producto.nombreProducto}</div>\n                    <div class=\"text-xs text-gray-400\">SKU: ${producto.sku}</div>\n                </td>\n                <td class=\"p-4 text-sm font-semibold text-gh-primary\">Público Final: $ ${producto.precioVentaPublicoFinal ?? 0}\n                <div class=\"text-xs text-gray-400\">Mayorista: ${producto.precioVentaMayorista}</div>\n                \n                </td>\n                <td class=\"p-4 text-sm\">${producto.stock ?? 0}</td>\n                <td class=\"p-4\">\n                    <span class=\"px-2 py-1 rounded-full text-xs ${producto.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}\">\n                        ${producto.activo ? 'Activo' : 'Inactivo'}\n                    </span>\n                </td>\n                <td class=\"p-4\">\n                     <div class=\"w-4 h-4 rounded-full ${producto.web ? 'bg-pink-500' : 'bg-gray-300'}\"></div>\n                </td>\n                <td class=\"p-4\">\n                    <a href=\"/admin/editar-producto/${producto.idProducto}\" class=\"text-gh-primary hover:text-gh-primaryHover\">\n                        <i class=\"fi-rr-edit text-lg\"></i>\n                    </a>\n                </td>\n            </tr>\n        `;\n    });\n}\n\n    //Finalmente mandoo los datos para ser consultados al json\nconst obtenerProductos = async (filtros = {}) => {\n    try {\n        const queryParams = new URLSearchParams(filtros).toString();\n        const url = `/admin/json/productos/?${queryParams}`;\n\n        const respuesta = await fetch(url);\n        \n        // Solo una vez: guardamos el resultado completo\n        const resultado = await respuesta.json();\n\n        // Extraemos los productos del objeto resultado\n        // (Recuerda que en el controlador enviamos { success: true, productos: [...] })\n        if (resultado.success) {\n            mostrarProductos(resultado.productos);\n        }\n\n    } catch (error) {\n        console.log('Error al obtener datos:', error);\n    }\n}\n\n\n\n\n\n\n//con filtro lo que hagoo es que convierto lo que me mandan en  un objeto para poder trabajar con el en json\nconst filtrar = () => {\n    const datos = {\n        busqueda: inputBusqueda.value,\n        categoria: selectCategoria.value,\n        estado: estado.value,\n        web: checkWeb.checked \n    };\n\n    //Aqui mando los objetos a la funcion que me controla el json\n    obtenerProductos(datos);\n}\n\n\n\n//Cuando detecto que algunoo de los input ha cambiado, entonces ejecuto la funcion filtrar.\n    //Retraso el tiempo de consulta cuando escriben en el input para que no haga consulta cada vez que el usuario teclee unna letra en el input de busqueda.\n    let timer;\n    inputBusqueda.addEventListener('input', () => {\n            clearTimeout(timer);\n            timer = setTimeout(() => {\n                filtrar(); \n            }, 300);\n        });\n\n    selectCategoria.addEventListener('change', filtrar );\n    checkWeb.addEventListener('change', filtrar);\n    estado.addEventListener('change', filtrar)\n\n   \ndocument.addEventListener('DOMContentLoaded', () => {\n    filtrar(); \n\n});\n\n})()\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/productList.js?\n}");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The require scope
/******/ 	var __webpack_require__ = {};
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module can't be inlined because the eval devtool is used.
/******/ 	var __webpack_exports__ = {};
/******/ 	__webpack_modules__["./src/js/productList.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;