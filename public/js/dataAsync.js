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

/***/ "./src/js/dataAsync.js"
/*!*****************************!*\
  !*** ./src/js/dataAsync.js ***!
  \*****************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n(function() { // Envolvemos todo en una función autoejecutable para no ensuciar el global\n    console.log('✅ JS dataAsync cargado correctamente'); \n    // Escuchamos cuando el DOM esté listo (por seguridad extra)\n    document.addEventListener('DOMContentLoaded', function() {\n\n        const departamentoSelect = document.querySelector('#departamento');\n        const ciudadSelect = document.querySelector('#municipio');\n\n        // Verificamos que existan en esta página (para evitar errores en otras vistas)\n        if (departamentoSelect && ciudadSelect) {\n\n            departamentoSelect.addEventListener('change', async function(e) {\n                const departamentoId = e.target.value;\n\n                // 1. Resetear el select de ciudades\n                ciudadSelect.innerHTML = '<option value=\"\">-- Cargando --</option>';\n                \n                if(departamentoId === '') {\n                    ciudadSelect.innerHTML = '<option value=\"\">-- Seleccione Dpto --</option>';\n                    ciudadSelect.disabled = true;\n                    return;\n                }\n\n                try {\n                    // 2. Llamar a tu API\n                    // Asegúrate de tener esta ruta creada en tu backend\n                    const url = `/admin/json/municipios/${departamentoId}`;\n                    const respuesta = await fetch(url);\n                    const resultado = await respuesta.json();\n\n                    // 3. Limpiar y Llenar\n                    ciudadSelect.innerHTML = '<option value=\"\">-- Seleccione Ciudad --</option>';\n                    \n                    resultado.forEach(municipio => {\n                        const option = document.createElement('option');\n                        option.value = municipio.id; // O el campo que sea tu ID\n                        option.textContent = municipio.nombre;\n                        ciudadSelect.appendChild(option);\n                    });\n\n                    ciudadSelect.disabled = false;\n\n                } catch (error) {\n                    console.log(error);\n                    ciudadSelect.innerHTML = '<option value=\"\">Error al cargar</option>';\n                }\n            });\n        }\n    });\n\n})();\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/dataAsync.js?\n}");

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
/******/ 	__webpack_modules__["./src/js/dataAsync.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;