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

/***/ "./src/js/employeeList.js"
/*!********************************!*\
  !*** ./src/js/employeeList.js ***!
  \********************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n(function () {\n    const inputBusqueda = document.getElementById('busquedaEmpleado');\n    const contenedor = document.getElementById('contenedor-empleados');\n    const resumen = document.getElementById('resumenEmpleados');\n\n    if (!contenedor) return;\n\n    let paginaActual = 1;\n\n    const estadoBadge = (estado) => {\n        const map = {\n            activo:      'bg-emerald-100 text-emerald-700',\n            suspendido:  'bg-yellow-100 text-yellow-700',\n            despedido:   'bg-red-100 text-red-700',\n            vacaciones:  'bg-blue-100 text-blue-700',\n            enfermedad:  'bg-orange-100 text-orange-700',\n            licencia:    'bg-purple-100 text-purple-700',\n            otro:        'bg-gray-100 text-gray-600',\n        };\n        const clase = map[estado] || map.otro;\n        return `<span class=\"inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${clase}\">${estado}</span>`;\n    };\n\n    const mostrarEmpleados = (empleados) => {\n        contenedor.innerHTML = '';\n\n        if (empleados.length === 0) {\n            contenedor.innerHTML = '<tr><td colspan=\"6\" class=\"px-6 py-8 text-center text-gray-400\">No se encontraron empleados.</td></tr>';\n            return;\n        }\n\n        empleados.forEach(emp => {\n            const sede = emp.sede ? emp.sede.nombreComercial : '<span class=\"text-gray-400 italic text-xs\">Sin sede</span>';\n            contenedor.innerHTML += `\n                <tr class=\"border-b border-gray-100 hover:bg-gray-100 transition-colors\">\n                    <td class=\"px-6 py-4\">\n                        <p class=\"font-bold text-slate-800\">${emp.PrimerNombre} ${emp.PrimerApellido}</p>\n                        <p class=\"text-xs text-slate-400\">${emp.emailEmpleado}</p>\n                    </td>\n                    <td class=\"px-4 py-4 text-center text-sm text-slate-600\">${emp.NumeroDocumento}</td>\n                    <td class=\"px-4 py-4 text-center text-sm text-slate-600\">${emp.telefonoContacto || '--'}</td>\n                    <td class=\"px-4 py-4 text-center\">\n                        <span class=\"font-mono text-xs bg-slate-100 px-2 py-1 rounded\">${emp.codigoEmpleado}</span>\n                    </td>\n                    <td class=\"px-4 py-4 text-center text-sm text-slate-600\">${sede}</td>\n                    <td class=\"px-6 py-4 text-center\">\n                        <a href=\"/admin/personal/ver/${emp.idEmpleado}\" class=\"btn btn-secondary text-xs\">\n                            <i class=\"fi-rr-eye text-xs\"></i> Ver más\n                        </a>\n                    </td>\n                </tr>\n            `;\n        });\n    };\n\n    const obtenerEmpleados = async () => {\n        contenedor.style.opacity = '0.5';\n        try {\n            const params = new URLSearchParams({\n                busqueda: inputBusqueda?.value || '',\n                pagina: paginaActual,\n            });\n\n            const response = await fetch(`/admin/json/personal/lista?${params}`);\n            const data = await response.json();\n\n            contenedor.style.opacity = '1';\n\n            if (!data.success) return;\n\n            mostrarEmpleados(data.empleados);\n\n            if (resumen) {\n                resumen.innerHTML = `Mostrando <span class=\"font-bold text-slate-600\">${data.empleados.length}</span> de <span class=\"font-bold text-slate-600\">${data.totalRegistros}</span> empleados`;\n            }\n\n            if (typeof generarPaginacion === 'function') {\n                generarPaginacion(\n                    '#paginacionEmpleados',\n                    data.totalPaginas,\n                    data.paginaActual,\n                    (nuevaPagina) => {\n                        paginaActual = nuevaPagina;\n                        obtenerEmpleados();\n                    }\n                );\n            }\n        } catch (error) {\n            contenedor.style.opacity = '1';\n            contenedor.innerHTML = '<tr><td colspan=\"6\" class=\"px-6 py-4 text-center text-red-500\">Error al cargar datos.</td></tr>';\n        }\n    };\n\n    const filtrar = () => {\n        paginaActual = 1;\n        obtenerEmpleados();\n    };\n\n    let timer;\n    if (inputBusqueda) {\n        inputBusqueda.addEventListener('input', () => {\n            clearTimeout(timer);\n            timer = setTimeout(filtrar, 300);\n        });\n    }\n\n    document.addEventListener('DOMContentLoaded', obtenerEmpleados);\n})();\n\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/employeeList.js?\n}");

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
/******/ 	__webpack_modules__["./src/js/employeeList.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;