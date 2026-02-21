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

/***/ "./src/js/dosificador.js"
/*!*******************************!*\
  !*** ./src/js/dosificador.js ***!
  \*******************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   calcularKitting: () => (/* binding */ calcularKitting)\n/* harmony export */ });\n/**\n * Algoritmo de Kitting Proporcional para Grupo GH\n * @param {Object} productos - Ej: { 'A': 233, 'B': 533... }\n * @param {Number} capacidad - Ej: 12\n */\nconst calcularKitting = (productos, capacidad) => {\n    let stock = { ...productos };\n    let totalUnidades = Object.values(stock).reduce((a, b) => a + b, 0);\n    let numPacksCompletos = Math.floor(totalUnidades / capacidad);\n    \n    let planEmpaque = [];\n\n    for (let i = 0; i < numPacksCompletos; i++) {\n        let bolsa = {};\n        let totalEnBolsa = 0;\n        let stockRestanteBolsa = Object.values(stock).reduce((a, b) => a + b, 0);\n\n        // 1. Asignación obligatoria (Piso proporcional)\n        Object.keys(stock).forEach(sku => {\n            let proporcion = stock[sku] / stockRestanteBolsa;\n            let asignacion = Math.floor(proporcion * capacidad);\n            \n            // No asignar más de lo que hay en stock\n            asignacion = Math.min(asignacion, stock[sku]);\n            \n            bolsa[sku] = asignacion;\n            totalEnBolsa += asignacion;\n            stock[sku] -= asignacion;\n        });\n\n        // 2. Reparto de huecos (Rounding por prioridad de stock)\n        while (totalEnBolsa < capacidad) {\n            // Buscamos el producto que más stock tiene actualmente para llenar el hueco\n            let skuPrioridad = Object.keys(stock).reduce((a, b) => stock[a] > stock[b] ? a : b);\n            \n            if (stock[skuPrioridad] > 0) {\n                bolsa[skuPrioridad]++;\n                stock[skuPrioridad]--;\n                totalEnBolsa++;\n            } else {\n                break; // No hay más stock para llenar la bolsa\n            }\n        }\n        planEmpaque.push(bolsa);\n    }\n\n    // 3. El residuo es lo que quedó en el stock\n    let residuo = Object.fromEntries(Object.entries(stock).filter(([_, v]) => v > 0));\n\n    return {\n        packs: agruparConfiguraciones(planEmpaque),\n        residuo\n    };\n};\n\n/**\n * Agrupa bolsas idénticas para que el operario lea: \"Haga 75 bolsas de este tipo\"\n */\nfunction agruparConfiguraciones(packs) {\n    const grupos = {};\n    packs.forEach(p => {\n        const key = JSON.stringify(p);\n        grupos[key] = (grupos[key] || 0) + 1;\n    });\n    return Object.entries(grupos).map(([config, cantidad]) => ({\n        cantidad,\n        detalle: JSON.parse(config)\n    }));\n}\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/dosificador.js?\n}");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The require scope
/******/ 	var __webpack_require__ = {};
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
/******/ 	var __webpack_exports__ = {};
/******/ 	__webpack_modules__["./src/js/dosificador.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;