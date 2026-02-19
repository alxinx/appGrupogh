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

/***/ "./src/js/dataDose.js"
/*!****************************!*\
  !*** ./src/js/dataDose.js ***!
  \****************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./utils.js */ \"./src/js/utils.js\");\n\n//OBLIGO A HACER DOBLE CLIC A LAS UNIDADES POR PAQUETE POR SI QUIEREN CAMBIARLO\n(function(){\n    const inputUnidades = document.querySelector('#unidadesPorPaquete');\n\n\n    \n// 1. Activar con doble clic\ninputUnidades.addEventListener('dblclick', function() {\n    this.readOnly = false;\n    this.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-75');\n    this.classList.add('bg-white', 'border-blue-500'); // Indicador visual de edición\n    this.focus(); // Poner el cursor de una vez\n});\n\n// 2. Bloquear automáticamente al salir del campo (blur)\ninputUnidades.addEventListener('blur', function() {\n    this.readOnly = true;\n    this.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-75');\n    this.classList.remove('bg-white', 'border-blue-500');\n    \n\n    \n    // Aquí podrías disparar una validación para verificar \n    // si el nuevo número es compatible con las filas ya agregadas\n   // validarCapacidadVersusFilas(); \n});\n\ninputUnidades.addEventListener('blur', function() {\n    const valor = parseInt(this.value);\n    const LIMITE_MAXIMO = 36; // Puedes ajustar este número según la bolsa más grande\n\n    // 1. Validar contra el límite máximo \"irreal\"\n    if (valor > LIMITE_MAXIMO) {\n        Swal.fire({\n            icon: 'error',\n            title: 'No puedo permitirte hacer eso 😶',\n            text: `No es posible dosificar ${valor} prendas en una sola bolsa. El máximo permitido es ${LIMITE_MAXIMO}.`,\n            confirmButtonColor: '#3085d6'\n        });\n        this.value = 12; // Revertir al estándar de GH\n    }\n\n    // 2. Validar que no sea cero o negativo\n    if (valor <= 0 || isNaN(valor)) {\n        this.value = 12;\n    }\n\n    // Volver a bloquear el campo\n    this.readOnly = true;\n    this.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-75');\n});\n\n})()\n\n\n\n\n//FORMATEO A MONEDA PARA FRONTEND.\ndocument.addEventListener('keyup', (e) => {\n    if (e.target.matches('input[name=\"valorUnidad[]\"]')) {\n        // 1. Obtener el valor actual y limpiar lo que no sea número\n        let valorPuro = e.target.value.replace(/\\D/g, \"\");\n        \n        // 2. Si hay valor, formatearlo y ponerlo de vuelta en el input\n        if (valorPuro) {\n            e.target.value = (0,_utils_js__WEBPACK_IMPORTED_MODULE_0__.formatMoney)(valorPuro);\n        }\n    }\n});\n\n\n\n\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/dataDose.js?\n}");

/***/ },

/***/ "./src/js/utils.js"
/*!*************************!*\
  !*** ./src/js/utils.js ***!
  \*************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   cleanMoney: () => (/* binding */ cleanMoney),\n/* harmony export */   formatMoney: () => (/* binding */ formatMoney)\n/* harmony export */ });\n/**\n * Formatea un número a moneda colombiana (COP)\n */\nconst formatMoney = (n, decimals = 0) => {\n    if (isNaN(n) || n === null) return \"0\";\n    return Number(n).toLocaleString('es-CO', {\n        minimumFractionDigits: decimals,\n        maximumFractionDigits: decimals\n    });\n};\n\n/**\n * Limpia un string de moneda para obtener solo el número\n * Útil para cálculos antes de enviar al servidor\n */\nconst cleanMoney = (str) => {\n    return Number(str.replace(/[^0-9.-]+/g, \"\"));\n};\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/utils.js?\n}");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Check if module exists (development only)
/******/ 		if (__webpack_modules__[moduleId] === undefined) {
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
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
/******/ 	var __webpack_exports__ = __webpack_require__("./src/js/dataDose.js");
/******/ 	
/******/ })()
;