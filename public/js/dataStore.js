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

/***/ "./src/js/dataStore.js"
/*!*****************************!*\
  !*** ./src/js/dataStore.js ***!
  \*****************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\ndocument.addEventListener('DOMContentLoaded', () => {\n    const container = document.querySelector('#loadDataStore');\n    const tabs = document.querySelectorAll('nav button');\n\n    /**\n     * Función central para la carga asíncrona\n     */\n\n    const loadTabContent = async (tabId) => {\n        // 1. Mostrar estado de carga (Feedback visual para el usuario)\n        container.innerHTML = `\n            <div class=\"flex flex-col items-center justify-center p-20 opacity-50\">\n                <i class=\"fi-rr-spinner animate-spin text-3xl text-gh-primary\"></i>\n                <p class=\"mt-4 font-medium text-slate-500\">Consultando ${tabId}...</p>\n            </div>\n        `;\n\n        // 2. Extraer el UUID de la tienda desde la URL actual\n        // Ejemplo: /tiendas/ver/010efef3...\n        const idPuntoDeVenta = window.location.pathname.split('/').pop();\n\n        try {\n            // 3. Petición al servidor (Rutas que crearemos en Express)\n            const response = await fetch(`/admin/tiendas/partials/${tabId}/${idPuntoDeVenta}`);\n            \n            if (!response.ok) throw new Error('Error en la respuesta del servidor');\n\n            const html = await response.text();\n            \n            // 4. Inyectar contenido\n            container.innerHTML = html;\n\n        } catch (error) {\n            console.error(\"Error al cargar pestaña:\", error);\n            container.innerHTML = `\n                <div class=\"p-10 text-center\">\n                    <i class=\"fi-rr-warning text-red-500 text-2xl\"></i>\n                    <p class=\"text-slate-600\">No se pudo cargar la sección de ${tabId}.</p>\n                </div>\n            `;\n        }\n    };\n\n    /**\n     * Configuración de Listeners para todos los botones\n     */\n    tabs.forEach(tab => {\n        tab.addEventListener('click', (e) => {\n            const selectedTab = e.currentTarget.id;\n\n            // Cambiar estilos de las pestañas (UI/UX)\n            tabs.forEach(t => {\n                t.classList.remove('tab-active', 'text-gh-primary');\n                t.classList.add('text-slate-400');\n            });\n            e.currentTarget.classList.add('tab-active');\n            e.currentTarget.classList.remove('text-slate-400');\n\n            // Cargar el contenido correspondiente\n            loadTabContent(selectedTab);\n        });\n    });\n\n    // Carga inicial por defecto (Facturación de hoy)\n    loadTabContent('facturacionHoy');\n});\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/dataStore.js?\n}");

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
/******/ 	__webpack_modules__["./src/js/dataStore.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;