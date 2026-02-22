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

/***/ "./src/js/doseView.js"
/*!****************************!*\
  !*** ./src/js/doseView.js ***!
  \****************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n(function () {\n    document.addEventListener('DOMContentLoaded', () => {\n        const cargarMetadata = async () => {\n            const pathParts = window.location.pathname.split('/');\n            const id = pathParts[pathParts.length - 1]; // El ID es el último segmento: /admin/dosificaciones/ver/:id\n\n            try {\n                const res = await fetch(`/admin/api/dosificaciones/metadata/${id}`);\n                const data = await res.json();\n\n                // Solo actualizamos los widgets de arriba\n                if (document.querySelector('#widget-fecha-creacion'))\n                    document.querySelector('#widget-fecha-creacion').innerText = data.fechaFormateada;\n\n                if (document.querySelector('#widget-units-pack'))\n                    document.querySelector('#widget-units-pack').innerText = data.unidadesPorPaquete;\n\n                if (document.querySelector('#widget-sobrantes'))\n                    document.querySelector('#widget-sobrantes').innerText = data.sobrantes;\n\n                if (document.querySelector('#widget-total-bultos'))\n                    document.querySelector('#widget-total-bultos').innerText = data.totalBultos;\n\n                if (document.querySelector('#widget-total-productos'))\n                    document.querySelector('#widget-total-productos').innerText = data.totalUnidades;\n\n            } catch (error) {\n                console.error('Error cargando widgets:', error);\n            }\n        };\n\n        cargarMetadata();\n    });\n})();\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/doseView.js?\n}");

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
/******/ 	__webpack_modules__["./src/js/doseView.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;