// ─────────────────────────────────────────────────────────────────────────────
// Avisos del menú lateral del admin, en vivo.
//
// El menú se renderiza con los contadores que trae `cargarContadoresAdmin`, que además
// los cachea 30 segundos. Eso alcanza para la carga inicial, pero no para enterarse de
// que una tienda acaba de despachar efectivo: el admin puede estar con la pantalla
// abierta y no ver nada hasta la próxima navegación. Este archivo cierra ese hueco
// escuchando el SSE del panel y repintando el badge sin recargar.
//
// Va cargado desde views/partials/leftMenu.pug, que se incluye en todas las páginas del
// admin y en ninguna del panel de tienda ni del sitio web —que no tienen /admin/sse—.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    // `window.adminSSE` (helpers.js) mantiene UNA conexión por pestaña y la comparte
    // entre pantallas. No está en todas las páginas del panel, así que si no aparece se
    // abre una propia. La suscripción se hace en DOMContentLoaded porque helpers.js es un
    // script clásico al final del body: para entonces ya corrió, y así no se abren dos
    // conexiones en las páginas que sí lo cargan.
    const suscribir = (evento, handler) => {
        if (window.adminSSE) {
            window.adminSSE.on(evento, handler);
            window.adminSSE.connect();
            return;
        }
        if (!window.__sseAlertas) {
            window.__sseAlertas = new EventSource('/admin/sse');
            // EventSource reintenta solo, pero deja la conexión anterior colgada. Cerrarla
            // antes evita que se acumulen zombis en cada caída del servidor.
            window.__sseAlertas.addEventListener('error', () => {
                window.__sseAlertas.close();
                window.__sseAlertas = null;
                setTimeout(() => suscribir(evento, handler), 5000);
            });
        }
        window.__sseAlertas.addEventListener(evento, handler);
    };

    // Prende o apaga el aviso de un ítem del menú. `has-alert` es el interruptor: la
    // hoja de estilos decide con esa sola clase si el ítem es una fila normal o el
    // bloque de 3.5rem donde el banner rota con el contenido.
    const pintarItem = (idItem, idBadge, idTexto, n, frase) => {
        const item  = document.getElementById(idItem);
        const badge = document.getElementById(idBadge);
        const texto = document.getElementById(idTexto);
        if (!item || !badge) return;

        item.classList.toggle('has-alert', n > 0);
        badge.classList.toggle('hidden', n === 0);
        badge.textContent = n;
        if (texto) texto.textContent = frase(n);
    };

    const pintarTraslados = (n) => pintarItem(
        'menu-cajas-bancos', 'menu-traslados-badge', 'menu-traslados-texto', n,
        (k) => k === 1 ? '1 traslado pendiente por aceptar' : `${k} traslados pendientes por aceptar`
    );

    const pintarPedidos = (n) => pintarItem(
        'menu-tienda-web', 'menu-pedidos-badge', 'menu-pedidos-texto', n,
        (k) => k === 1 ? '1 pedido nuevo por atender' : `${k} pedidos nuevos por atender`
    );

    // Campanas del listado de cajas y bancos. Solo existen si esa pantalla está abierta;
    // en cualquier otra página del panel no hay ninguna y el bucle no hace nada.
    const pintarCampanas = (porCuenta) => {
        document.querySelectorAll('.campana-traslado').forEach((campana) => {
            const n = porCuenta[campana.dataset.caja] || 0;
            campana.classList.toggle('hidden', n === 0);
            campana.title = `${n} traslado(s) de efectivo esperando que esta cuenta los acepte`;
            const contador = campana.querySelector('.campana-n');
            if (contador) contador.textContent = n;
            // Solo la campana que cambió llama la atención, y una sola vez: si todas
            // parpadearan en cada aviso, ninguna diría nada.
            if (n > 0 && campana.dataset.previo !== String(n)) {
                campana.classList.remove('campana-entra');
                void campana.offsetWidth;   // reinicia la animación aunque el valor repita
                campana.classList.add('campana-entra');
            }
            campana.dataset.previo = String(n);
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        // El evento trae el total y el desglose por cuenta juntos: el menú necesita uno y
        // el listado el otro, y mandarlos en dos eventos abriría la puerta a que se
        // pinten estados de momentos distintos.
        suscribir('traslados_pendientes', (ev) => {
            try {
                const d = JSON.parse(ev.data);
                pintarTraslados(Number(d.total) || 0);
                pintarCampanas(d.porCuenta || {});
            } catch (_) {}
        });

        // El mismo mecanismo para el badge de Tienda Web, que hasta ahora solo se
        // actualizaba al recargar la página.
        suscribir('pedidos_web_pendientes', (ev) => {
            try { pintarPedidos(Number(JSON.parse(ev.data).total) || 0); } catch (_) {}
        });
    });
})();
