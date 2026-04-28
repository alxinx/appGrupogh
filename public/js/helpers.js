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

/***/ "./src/js/helpers.js"
/*!***************************!*\
  !*** ./src/js/helpers.js ***!
  \***************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\nwindow.formatMoney = (n, decimals = 0) => {\n    return Number(n).toLocaleString('es-CO', {\n        style: 'currency',\n        currency: 'COP',\n        minimumFractionDigits: decimals,\n        maximumFractionDigits: decimals\n    });\n};\n\n// Enlaza formato de miles (es-CO) a un <input type=\"text\"> de dinero.\n// Úsalo en cualquier campo donde el usuario ingrese valores en pesos.\nwindow.initMoneyInput = (el) => {\n    if (!el) return;\n    el.addEventListener('input', function (e) {\n        const cursor    = e.target.selectionStart;\n        const original  = e.target.value;\n        const digits    = original.replace(/\\D/g, '');\n        const formatted = digits ? new Intl.NumberFormat('es-CO').format(digits) : '';\n        const diff      = formatted.length - original.length;\n        e.target.value  = formatted;\n        e.target.setSelectionRange(cursor + diff, cursor + diff);\n    });\n};\n\n// Convierte un valor formateado (\"78.000\") o numérico a entero sin decimales.\nwindow.parseMoney = (val) => parseInt(String(val).replace(/\\D/g, ''), 10) || 0;\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/helpers.js?\n}");

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
/******/ 	__webpack_modules__["./src/js/helpers.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;