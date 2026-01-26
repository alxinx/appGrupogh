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

eval("{__webpack_require__.r(__webpack_exports__);\n(function(){\n    const inputBusqueda = document.querySelector('#busquedaText');\n    const selectCategoria = document.querySelector('#categoriaProductos');\n    const checkWeb = document.querySelector('#filtroWeb');\n    const estado = document.querySelector('#estadoProductos');\n    const contenedor = document.querySelector('#contenedor-productos');\n\n    // Estado local del listado\n    let paginaActual = 1; \n\n    const mostrarProductos = (productos) => {\n        contenedor.innerHTML = '';\n        if (productos.length === 0) {\n            contenedor.innerHTML = '<tr><td colspan=\"7\" class=\"p-8 text-center text-gray-500\">No se encontraron productos.</td></tr>';\n            return;\n        }\n\n        productos.forEach(producto => {\n            const principal = producto.imagenes?.find(i => i.tipo === 'principal') || null;\n            const imagenUrl = principal?.nombreImagen\n                ? `https://pub-f89c3f57ac314e868860b81774b10373.r2.dev/productos/${principal.nombreImagen}`\n                : '/img/image-default.webp';\n\n            contenedor.innerHTML += `\n                <tr class=\"border-b border-gray-100 hover:bg-gray-50 transition-colors\">\n                    <td class=\"p-4\"><img src=\"${imagenUrl}\" class=\"w-12 h-12 object-cover rounded-lg shadow-sm\"></td>\n                    <td class=\"p-4\">\n                        <div class=\"font-bold text-gray-800\">${producto.nombreProducto}</div>\n                        <div class=\"text-xs text-gray-400\">SKU: ${producto.sku}</div>\n                    </td>\n                    <td class=\"p-4 text-sm font-semibold text-gh-primary\">\n                         ${formatMoney(producto.precioVentaPublicoFinal, 0) ?? 0}\n                        <div class=\"text-xs text-gray-400 font-normal\">Mayorista:  ${formatMoney(producto.precioVentaMayorista, 0)}</div>\n                    </td>\n                    <td class=\"p-4 text-sm\">${producto.stock ?? 0}</td>\n                    <td class=\"p-4\">\n                        <span class=\"px-2 py-1 rounded-full text-xs ${producto.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}\">\n                            ${producto.activo ? 'Activo' : 'Inactivo'}\n                        </span>\n                    </td>\n                    <td class=\"p-4\"><div class=\"w-4 h-4 rounded-full ${producto.web ? 'bg-green-500' : 'bg-gray-300'}\"></div></td>\n                    <td class=\"p-4\">\n                        <a href=\"/admin/inventario/ver/${producto.idProducto}\" class=\"text-gh-primary hover:text-gh-primaryHover\">\n                            <div class=\"btn btn-secondary\" >\n                                <i class=\"fi-rr-eye text-lg\"></i>\n                                Ver Detalles\n                            </div>\n\n                        \n                        \n                        </a>\n                    </td>\n                </tr>`;\n        });\n    }\n\n    const obtenerProductos = async () => {\n        try {\n            // Recolectamos filtros + la página actual\n            const filtros = {\n                busqueda: inputBusqueda.value,\n                categoria: selectCategoria.value,\n                estado: estado.value,\n                web: checkWeb.checked,\n                pagina: paginaActual\n            };\n\n            const queryParams = new URLSearchParams(filtros).toString();\n            const url = `/admin/json/productos/?${queryParams}`;\n\n            const respuesta = await fetch(url);\n            const resultado = await respuesta.json();\n\n            if (resultado.success) {\n                mostrarProductos(resultado.productos);\n                \n                // Invocamos al paginador global\n                generarPaginacion(\n                    '#paginacion', \n                    resultado.totalPaginas, \n                    resultado.paginaActual, \n                    (nuevaPagina) => {\n                        paginaActual = nuevaPagina;\n                        obtenerProductos(); // Re-consultamos con la nueva página\n                    }\n                );\n            }\n        } catch (error) {\n            console.error('Error al obtener datos:', error);\n        }\n    }\n\n    const filtrar = () => {\n        paginaActual = 1; // Siempre que filtramos, volvemos a la pág 1\n        obtenerProductos();\n    }\n\n    // Listeners\n    let timer;\n    inputBusqueda.addEventListener('input', () => {\n        clearTimeout(timer);\n        timer = setTimeout(filtrar, 300);\n    });\n\n    [selectCategoria, checkWeb, estado].forEach(el => el.addEventListener('change', filtrar));\n\n    document.addEventListener('DOMContentLoaded', filtrar);\n\n\n\n    \n})();\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/productList.js?\n}");

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