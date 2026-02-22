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

/***/ "./src/js/paginador.js"
/*!*****************************!*\
  !*** ./src/js/paginador.js ***!
  \*****************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\nwindow.generarPaginacion = (contenedorId, totalPaginas, paginaActual, callback) => {\n    const contenedor = document.querySelector(contenedorId);\n    if (!contenedor) return;\n\n    contenedor.innerHTML = '';\n    if (totalPaginas <= 1) return;\n\n    const crearBoton = (texto, pagina, activo = false, deshabilitado = false) => {\n        const boton = document.createElement('button');\n        boton.innerText = texto;\n        \n        const clasesBase = \"paginador\";\n        const clasesActivo = \"paginadorActivo\";\n        const clasesInactivo = \"paginadorInactivo\";\n        const clasesDisabled = \"paginadorDeshabilidado\";\n\n        boton.className = `${clasesBase} ${deshabilitado ? clasesDisabled : (activo ? clasesActivo : clasesInactivo)} cursor-pointer`;\n        \n        if (!deshabilitado) {\n            boton.onclick = (e) => {\n                e.preventDefault();\n                callback(pagina);\n            };\n        } else {\n            boton.disabled = true;\n        }\n        return boton;\n    };\n\n    const maxBotones = 5;\n    let inicio = Math.floor((paginaActual - 1) / maxBotones) * maxBotones + 1;\n    let fin = Math.min(inicio + maxBotones - 1, totalPaginas);\n\n    // Atras\n    contenedor.appendChild(crearBoton('«', paginaActual - 1, false, paginaActual === 1));\n\n    // Rangos de numeracin\n    for (let i = inicio; i <= fin; i++) {\n        contenedor.appendChild(crearBoton(i, i, i === paginaActual));\n    }\n\n    // Siguiente\n    contenedor.appendChild(crearBoton('»', paginaActual + 1, false, paginaActual === totalPaginas));\n};\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/paginador.js?\n}");

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
/******/ 	__webpack_modules__["./src/js/paginador.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;