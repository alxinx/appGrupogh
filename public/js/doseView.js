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

eval("{__webpack_require__.r(__webpack_exports__);\n(function(){\ndocument.addEventListener('DOMContentLoaded', () => {\n    const cargarMetadata = async () => {\n        const pathParts = window.location.pathname.split('/');\n        const id = pathParts[pathParts.length - 1];\n\n        // Referencias a los widgets\n        const fechaWidget = document.querySelector('#widget-fecha-creacion');\n        const unitsWidget = document.querySelector('#widget-units-pack');\n        const sobrantesWidget = document.querySelector('#widget-sobrantes');\n        const totalWidget = document.querySelector('#widget-total-bultos');\n        const totalUnidades = document.querySelector('#widget-total-productos');\n        \n        // Contenedor principal para los lotes\n        const contenedorLotes = document.querySelector('#contenedor-lotes-dinamicos');\n\n        try {\n            // 1. Llamada a la Metadata (Widgets)\n            const res = await fetch(`/admin/api/dosificaciones/metadata/${id}`);\n            const data = await res.json();\n\n            if (fechaWidget) fechaWidget.innerText = data.fechaFormateada;\n            if (unitsWidget) unitsWidget.innerText = data.unidadesPorPaquete;\n            if (sobrantesWidget) sobrantesWidget.innerText = data.sobrantes;\n            if (totalWidget) totalWidget.innerText = data.totalBultos;\n            if (totalUnidades) totalUnidades.innerText = data.totalUnidades.toLocaleString('es-CO');\n\n            // 2. Llamada a los Packs para construir la cuadrícula\n            const resPacks = await fetch(`/admin/api/dosificaciones/packs/${id}`);\n            const packs = await resPacks.json();\n\n            renderizarCuadriculaLotes(packs, contenedorLotes);\n\n        } catch (error) {\n            console.error('Error cargando la hoja de dosificación:', error);\n        }\n    };\n\n    const renderizarCuadriculaLotes = (packs, contenedor) => {\n        if (!contenedor) return;\n\n        // Agrupamos por numLote en el Frontend\n        const grupos = packs.reduce((acc, p) => {\n            acc[p.numLote] = acc[p.numLote] || [];\n            acc[p.numLote].push(p);\n            return acc;\n        }, {});\n\n        const numGrupos = Object.keys(grupos).length;\n        // Calculamos el span: si son 3 grupos = span 4, si son 4 grupos = span 3\n        const colSpan = numGrupos > 0 ? Math.floor(12 / Math.min(numGrupos, 4)) : 12;\n\n        contenedor.innerHTML = Object.entries(grupos).map(([numLote, bultos]) => {\n            const esResiduo = bultos[0].tipo === 'RESIDUO'; //\n            const primerPack = bultos[0];\n            \n            // Definición de clases según tipo de lote\n            const cardClass = esResiduo ? 'bg-gh-primaryHover' : 'cardsWhite';\n            const textClass = esResiduo ? 'text-gh-grayBorder' : 'text-[#8a40d8]';\n            const iconBg = esResiduo ? 'bg-gh-grayBorder' : 'bg-[#dcbdfe]';\n            const listItemClass = esResiduo ? 'bg-gh-grayBorder' : 'bg-gh-grayText/5';\n\n            return `\n                <div class=\"col-span-12 md:col-span-${colSpan} grid grid-cols-1 gap-4 cards ${cardClass} p-6 group is-collapsed\">\n                    <div class=\"flex items-center justify-between mb-2 cursor-pointer select-none\" onclick=\"this.parentElement.classList.toggle('is-collapsed')\">\n                        <div class=\"flex items-center gap-3\">\n                            <div class=\"w-10 h-10 rounded-xl ${iconBg} text-slate-900 flex items-center justify-center\">\n                                <i class=\"${esResiduo ? 'fi-rr-file-minus' : 'fi-rr-inventory-alt'}\"></i>\n                            </div>\n                            <h2 class=\"font-bold ${textClass}\">${esResiduo ? 'Lote de residuo' : 'Lote ' + numLote}</h2>\n                        </div>\n                        <div class=\"flex items-center gap-2\">\n                            <span class=\"px-3 py-1 bg-[#dcbdfe] rounded-full text-xs font-bold text-slate-900 uppercase\">${primerPack.DETALLES_PACKs.length} tipos</span>\n                            ${!esResiduo ? `<span class=\"px-3 py-1 bg-[#dcbdfe] rounded-full text-xs font-bold text-slate-900 uppercase\">${bultos.length} Lotes</span>` : ''}\n                        </div>\n                        <i class=\"fi-rr-angle-small-down transition-transform duration-300 icon-flecha\"></i>\n                    </div>\n\n                    <div class=\"grid gap-4 overflow-hidden transition-all duration-300 group-[.is-collapsed]:hidden\">\n                        <a href=\"#\" class=\"bgforCode cursor-pointer\">\n                            <i class=\"fi-rr-barcode-read greenFont mr-3 text-xl\"></i>\n                            <h3 class=\"mb-1 uppercase font-mono\">${primerPack.codigoEtiqueta}</h3>\n                        </a>\n                        <ul class=\"grid gap-2\">\n                            ${primerPack.DETALLES_PACKs.map(det => `\n                                <li class=\"flex items-center justify-between p-2 rounded-xl ${listItemClass} shadow-2xs shadow-gray-200\">\n                                    <div class=\"flex items-center gap-3\">\n                                        <i class=\"fi-rr-tshirt text-gh-primaryHover\"></i>\n                                        <span class=\"text-gh-primaryHover font-medium\">${det.producto.nombreProducto}</span>\n                                    </div>\n                                    <span class=\"font-black text-xs text-gh-grayText\">${det.cantidad} por bolsa</span>\n                                </li>\n                            `).join('')}\n                        </ul>\n                    </div>\n                </div>\n            `;\n        }).join('');\n    };\n\n    cargarMetadata();\n});\n})();\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/doseView.js?\n}");

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