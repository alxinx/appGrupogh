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

/***/ "./src/js/steepForms.js"
/*!******************************!*\
  !*** ./src/js/steepForms.js ***!
  \******************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\ndocument.querySelectorAll('.step-btn').forEach(btn => {\n    btn.addEventListener('click', () => {\n        const step = btn.dataset.step;\n        const targetContent = document.querySelector(`.step-content[data-content=\"${step}\"]`);\n\n        if (!targetContent) {\n            console.warn(`No se encontró contenido para el paso: ${step}`);\n            return; \n        }\n        document.querySelectorAll('.step-content').forEach(c => c.classList.add('hidden'));\n        targetContent.classList.remove('hidden');\n        document.querySelectorAll('.step-btn').forEach(b => {\n    const circle = b.querySelector('.itemInCircle');\n    const text = b.querySelector('span');\n\n    // VALIDACIÓN DEFENSIVA: Solo actúa si los elementos existen\n    if (circle && text) {\n        if (b === btn) {\n            // ESTADO ACTIVADO\n            circle.classList.remove('circleGray');\n            circle.classList.add('circlePink');\n            text.classList.remove('text-gray-400');\n            text.classList.add('text-pink-500');\n        } else {\n            // ESTADO DESACTIVADO\n            circle.classList.remove('circlePink');\n            circle.classList.add('circleGray');\n            text.classList.remove('text-pink-500');\n            text.classList.add('text-gray-400');\n        }\n    } else {\n        //console.warn(\"Estructura incompleta en un step-btn\", b);\n    }\n});\n    });\n});\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/steepForms.js?\n}");

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
/******/ 	__webpack_modules__["./src/js/steepForms.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;