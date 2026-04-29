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

/***/ "./src/js/storeGlobal.js"
/*!*******************************!*\
  !*** ./src/js/storeGlobal.js ***!
  \*******************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n(function () {\n\n    // ─── TOAST ──────────────────────────────────────────────────────────────\n    const showToast = (msg, tipo = 'info', duracion = 10000) => {\n        const container = document.getElementById('toast-container');\n        if (!container) return;\n\n        const colores = {\n            info:    'bg-white border-blue-400',\n            success: 'bg-white border-emerald-400',\n            warning: 'bg-white border-amber-400',\n            error:   'bg-white border-red-400'\n        };\n        const iconos = {\n            info:    'fi-rr-info text-blue-500',\n            success: 'fi-rr-check text-emerald-500',\n            warning: 'fi-rr-triangle-warning text-amber-500',\n            error:   'fi-rr-cross-circle text-red-500'\n        };\n\n        const toast = document.createElement('div');\n        toast.className = [\n            'flex items-start gap-3 px-4 py-3 rounded-2xl shadow-lg border-l-4 pointer-events-auto',\n            'max-w-xs w-full transition-all duration-300 opacity-0 translate-y-2',\n            colores[tipo] || colores.info\n        ].join(' ');\n\n        toast.innerHTML = `\n            <i class=\"fi ${iconos[tipo] || iconos.info} text-base flex-shrink-0 mt-0.5\"></i>\n            <span class=\"text-sm text-slate-700 font-medium flex-1\">${msg}</span>\n            <button class=\"text-slate-400 hover:text-slate-600 flex-shrink-0\" onclick=\"this.closest('.toast-item').remove()\">\n                <i class=\"fi fi-rr-cross-small text-sm\"></i>\n            </button>`;\n        toast.classList.add('toast-item');\n        container.appendChild(toast);\n\n        requestAnimationFrame(() => toast.classList.remove('opacity-0', 'translate-y-2'));\n\n        const timer = setTimeout(() => {\n            toast.classList.add('opacity-0', 'translate-y-2');\n            setTimeout(() => toast.remove(), 300);\n        }, duracion);\n\n        toast.querySelector('button').addEventListener('click', () => clearTimeout(timer));\n    };\n\n    window.showToast = showToast;\n\n    // ─── BANNER CONTROVERSIAS ────────────────────────────────────────────────\n    const actualizarBanner = (count) => {\n        const banner = document.getElementById('controversia-banner');\n        const texto  = document.getElementById('controversia-texto');\n        if (!banner) return;\n        if (count > 0) {\n            if (texto) texto.textContent = `TIENE ${count} CONTROVERSIA${count > 1 ? 'S' : ''} POR RESOLVER — INGRESA A TRASLADOS PARA GESTIONARLAS`;\n            banner.classList.remove('hidden');\n        } else {\n            banner.classList.add('hidden');\n        }\n    };\n\n    // ─── SSE ─────────────────────────────────────────────────────────────────\n    let sseSource = null;\n    let renotifyTimer = null;\n\n    const conectarSSE = () => {\n        if (sseSource) sseSource.close();\n\n        sseSource = new EventSource('/store/sse');\n\n        sseSource.addEventListener('state', (e) => {\n            const { pendientes, controversias } = JSON.parse(e.data);\n            actualizarBanner(controversias);\n\n            const badge = document.getElementById('badge-pendientes');\n            if (badge) badge.textContent = pendientes;\n        });\n\n        sseSource.addEventListener('new_traslado', (e) => {\n            const { codigo, pendientes } = JSON.parse(e.data);\n            showToast(`📦 Nuevo traslado entrante: <strong>${codigo}</strong>`, 'info', 10000);\n\n            const badge = document.getElementById('badge-pendientes');\n            if (badge) badge.textContent = pendientes;\n\n            // Recargar tabla si existe en la página actual\n            if (typeof window.loadPendientes === 'function') window.loadPendientes();\n\n            // Re-notificar cada 60 min si sigue sin atenderse\n            clearTimeout(renotifyTimer);\n            renotifyTimer = setTimeout(() => {\n                showToast(`⚠️ Aún tienes el traslado <strong>${codigo}</strong> sin recibir.`, 'warning', 10000);\n            }, 60 * 60 * 1000);\n        });\n\n        sseSource.addEventListener('traslado_devuelto', (e) => {\n            const { codigo } = JSON.parse(e.data);\n            mostrarBannerDevuelto(codigo);\n        });\n\n        sseSource.onerror = () => {\n            setTimeout(conectarSSE, 5000);\n        };\n    };\n\n    // Banner persistente para traslados devueltos por vencimiento\n    const bannerDevuelto = (() => {\n        let codigos = [];\n        const render = () => {\n            let el = document.getElementById('banner-devuelto');\n            if (!el) {\n                el = document.createElement('div');\n                el.id = 'banner-devuelto';\n                el.className = 'fixed top-0 left-0 right-0 z-50 bg-orange-600 text-white text-center py-2 px-4 text-sm font-bold shadow-lg';\n                document.body.prepend(el);\n            }\n            el.innerHTML = `<i class=\"fi fi-rr-triangle-warning mr-2\"></i>\n                ⚠ TRASLADO${codigos.length > 1 ? 'S' : ''} DEVUELTO${codigos.length > 1 ? 'S' : ''} POR VENCIMIENTO: ${codigos.join(', ')} — La mercancía fue regresada al inventario de origen.\n                <button class=\"ml-4 underline hover:text-orange-200\" onclick=\"document.getElementById('banner-devuelto').remove()\">Entendido</button>`;\n        };\n        return (codigo) => {\n            if (!codigos.includes(codigo)) codigos.push(codigo);\n            render();\n        };\n    })();\n\n    window.mostrarBannerDevuelto = bannerDevuelto;\n\n    document.addEventListener('DOMContentLoaded', conectarSSE);\n\n})();\n\n\n//# sourceURL=webpack://GRUPO_GH/./src/js/storeGlobal.js?\n}");

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
/******/ 	__webpack_modules__["./src/js/storeGlobal.js"](0,__webpack_exports__,__webpack_require__);
/******/ 	
/******/ })()
;