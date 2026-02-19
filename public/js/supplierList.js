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

/***/ "./src/js/supplierList.js"
/*!********************************!*\
  !*** ./src/js/supplierList.js ***!
  \********************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n\n(function () {\n    const inputBusqueda = document.getElementById('busquedaProvedor');\n    const selectCategoria = document.getElementById('filtroCategoriaProvedor');\n    const contenedor = document.getElementById('contenedor-provedores');\n\n    let paginaActual = 1;\n\n    // Función para mostrar los proveedores en la tabla\n    const mostrarProvedores = (provedores) => {\n        contenedor.innerHTML = '';\n\n        if (provedores.length === 0) {\n            contenedor.innerHTML = '<tr><td colspan=\"6\" class=\"p-8 text-center text-gray-500\">No se encontraron proveedores 🥲.</td></tr>';\n            return;\n        }\n\n        provedores.forEach(p => {\n            // Generar pills de categorías\n            let categoriasHtml = '';\n            if (p.categorias && p.categorias.length > 0) {\n                p.categorias.forEach(cat => {\n                    categoriasHtml += `<span class=\"inline-block bg-purple-100 text-purple-700 text-[10px] px-2 py-0.5 rounded-full mr-1 mb-1 font-semibold\">${cat.nombre}</span>`;\n                });\n            } else {\n                categoriasHtml = '<span class=\"text-gray-400 text-xs italic\">Sin categoría</span>';\n            }\n\n            contenedor.innerHTML += `\n                <tr class=\"hover:bg-gray-50 transition-colors group\">\n                    <td class=\"p-4\">\n                        <div class=\"font-bold text-gray-800\">${p.razonSocial}</div>\n                        <div class=\"text-xs text-gray-400\">${p.emailProvedor || 'Sin email'}</div>\n                    </td>\n                    <td class=\"p-4 text-sm text-gray-600\">${p.nombreContacto || '--'}</td>\n                    <td class=\"p-4 text-sm text-gray-600\">${p.telefonoContacto || '--'}</td>\n                    <td class=\"p-4 text-sm text-gray-600 font-mono\">${p.taxIdSupplier}</td>\n                    <td class=\"p-4\">\n                        <div class=\"flex flex-wrap max-w-[200px]\">\n                            ${categoriasHtml}\n                        </div>\n                    </td>\n                    <td class=\"p-4 text-right\">\n                        <a href=\"/admin/provedores/ver/${p.idProveedor}\" class=\"inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors\" title=\"Ver Detalle\">\n                            <i class=\"fi-rr-eye\"></i>\n                        </a>\n                    </td>\n                </tr>\n            `;\n        });\n    };\n\n    // Función principal para obtener datos\n    const obtenerProvedores = async () => {\n        try {\n            const params = new URLSearchParams({\n                busqueda: inputBusqueda?.value || '',\n                categoria: selectCategoria?.value || '',\n                pagina: paginaActual\n            });\n\n            const url = `/admin/json/provedores/?${params.toString()}`;\n\n            // Loading state simple (opcional)\n            contenedor.style.opacity = '0.5';\n\n            const response = await fetch(url);\n            const data = await response.json();\n\n            contenedor.style.opacity = '1';\n\n            if (data.success) {\n                mostrarProvedores(data.provedores);\n                if (typeof generarPaginacion === 'function') {\n                    generarPaginacion(\n                        '#paginacionProvedores',\n                        data.totalPaginas,\n                        data.paginaActual,\n                        (nuevaPagina) => {\n                            paginaActual = nuevaPagina;\n                            obtenerProvedores();\n                        }\n                    );\n                }\n            } else {\n                console.error('Error del servidor:', data.mensaje);\n            }\n\n        } catch (error) {\n            console.error('Error al obtener proveedores:', error);\n            contenedor.innerHTML = '<tr><td colspan=\"6\" class=\"p-4 text-center text-red-500\">Error al cargar datos.</td></tr>';\n        }\n    };\n\n    // Filtros\n    const filtrar = () => {\n        paginaActual = 1;\n        obtenerProvedores();\n    };\n\n    // Debounce para búsqueda\n    let timer;\n    if (inputBusqueda) {\n        inputBusqueda.addEventListener('input', () => {\n            clearTimeout(timer);\n            timer = setTimeout(filtrar, 300);\n        });\n    }\n\n    if (selectCategoria) {\n        selectCategoria.addEventListener('change', filtrar);\n    }\n\n    // Cargar inicial\n    document.addEventListener('DOMContentLoaded', obtenerProvedores);\n\n})();\n\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/supplierList.js?\n}");

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
/******/ 	__webpack_modules__["./src/js/supplierList.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;