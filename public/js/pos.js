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

/***/ "./src/js/pos.js"
/*!***********************!*\
  !*** ./src/js/pos.js ***!
  \***********************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n(function () {\n    document.addEventListener('DOMContentLoaded', () => {\n        // Estado para rastrear la imagen actual por modal (si hay varios)\n        const modalStates = {};\n\n        // 1. Escuchar el clic en cualquier tarjeta de producto o sus elementos\n        document.addEventListener('dblclick', (e) => {\n            // Verificar si el clic fue en el botón de agregar\n            if (e.target.closest('.btn-agregar-pedido')) {\n                return;\n            }\n\n            const tarjeta = e.target.closest('.product-card-individual');\n\n            if (tarjeta) {\n                const modalId = tarjeta.dataset.modalTarget;\n                if (modalId) {\n                    abrirModalProducto(modalId);\n                }\n            }\n        });\n\n        // Manejo de clics generales (Cierre y Navegación de Galería)\n        document.addEventListener('click', (e) => {\n            const modalAbierto = document.querySelector('div[id^=\"modal-producto-\"]:not(.hidden)');\n            if (!modalAbierto) return;\n\n            // 1. Cerrar modal\n            if (e.target === modalAbierto || e.target.closest('.btn-close-modal')) {\n                cerrarModal(modalAbierto);\n                return;\n            }\n\n            // 2. Navegación de Galería\n            const btnPrev = e.target.closest('.btn-prev-image');\n            const btnNext = e.target.closest('.btn-next-image');\n\n            if (btnPrev || btnNext) {\n                const modalId = modalAbierto.id;\n                const images = JSON.parse(modalAbierto.dataset.images || '[]');\n                if (images.length <= 1) return;\n\n                if (!modalStates[modalId]) modalStates[modalId] = { currentIndex: 0 };\n\n                if (btnPrev) {\n                    modalStates[modalId].currentIndex = (modalStates[modalId].currentIndex - 1 + images.length) % images.length;\n                } else {\n                    modalStates[modalId].currentIndex = (modalStates[modalId].currentIndex + 1) % images.length;\n                }\n\n                const mainImg = modalAbierto.querySelector('#main-image');\n                if (mainImg) {\n                    mainImg.src = images[modalStates[modalId].currentIndex];\n                    // Pequeña animación de transición\n                    mainImg.animate([\n                        { opacity: 0.5 },\n                        { opacity: 1 }\n                    ], { duration: 200, easing: 'ease-in-out' });\n                }\n            }\n        });\n\n        // 2. Función para mostrar el modal con animación\n        function abrirModalProducto(modalId) {\n            const modal = document.getElementById(modalId);\n            if (!modal) return;\n\n            modal.classList.remove('hidden');\n            modal.classList.add('flex');\n\n            // Resetear índice al abrir\n            modalStates[modalId] = { currentIndex: 0 };\n            const images = JSON.parse(modal.dataset.images || '[]');\n            const mainImg = modal.querySelector('#main-image');\n            if (mainImg && images.length > 0) {\n                mainImg.src = images[0];\n            }\n\n            // Animación de entrada estilo iOS\n            const contenido = modal.querySelector('.bg-white');\n            if (contenido) {\n                contenido.animate([\n                    { transform: 'scale(0.95)', opacity: 0 },\n                    { transform: 'scale(1)', opacity: 1 }\n                ], { duration: 200, easing: 'ease-out' });\n            }\n        }\n\n        // 3. Soporte para tecla ESC\n        document.addEventListener('keydown', (e) => {\n            if (e.key === 'Escape') {\n                const modalAbierto = document.querySelector('div[id^=\"modal-producto-\"]:not(.hidden)');\n                if (modalAbierto) {\n                    cerrarModal(modalAbierto);\n                }\n            }\n        });\n\n        function cerrarModal(modal) {\n            modal.classList.add('hidden');\n            modal.classList.remove('flex');\n        }\n    });\n})();\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/pos.js?\n}");

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
/******/ 	__webpack_modules__["./src/js/pos.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;