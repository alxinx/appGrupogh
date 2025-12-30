/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./src/js/dropdownBtn"
/*!****************************!*\
  !*** ./src/js/dropdownBtn ***!
  \****************************/
() {

eval("{// js/dropdownButton.js\n\ndocument.addEventListener('DOMContentLoaded', () => {\n  // 1. Selección de elementos\n  const btnMas = document.getElementById('btnMas');\n  const menuMas = document.getElementById('menuMas');\n  if (btnMas && menuMas) {\n    \n    // Abrir / Cerrar al hacer clic en el botón\n    btnMas.addEventListener('click', (e) => {\n      // Opcional: e.stopPropagation() ya no es estrictamente necesario \n      // con la lógica de abajo, pero mal no hace aquí.\n      menuMas.classList.toggle('hidden');\n    });\n\n    // Cerrar al hacer clic fuera\n    document.addEventListener('click', (e) => {\n      const target = e.target;\n\n      // Verificamos \"target instanceof Node\" para calmar al editor y asegurar\n      // que estamos trabajando con un elemento HTML válido.\n      if (target instanceof Node && !btnMas.contains(target) && !menuMas.contains(target)) {\n        menuMas.classList.add('hidden');\n      }\n    });\n  }\n});\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/dropdownBtn?\n}");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module can't be inlined because the eval devtool is used.
/******/ 	var __webpack_exports__ = {};
/******/ 	__webpack_modules__["./src/js/dropdownBtn"]();
/******/ 	
/******/ })()
;