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

    // ── Campana ──────────────────────────────────────────────────────────────
    //
    // Se sintetiza con WebAudio en vez de cargar un archivo: no suma un binario al
    // repositorio, no depende de que un asset exista en producción y suena igual sin
    // conexión.
    //
    // Los navegadores no dejan sonar nada hasta que la persona interactuó con la página,
    // así que el contexto se desbloquea con el primer clic o tecla. Si el aviso llega
    // antes de eso simplemente no suena: el badge y el banner siguen avisando igual.
    const campana = (() => {
        let ctx = null;

        const contexto = () => {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            if (!ctx) ctx = new AC();
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            return ctx;
        };

        ['pointerdown', 'keydown'].forEach(ev =>
            document.addEventListener(ev, () => contexto(), { once: true, passive: true }));

        // Arma y dispara el golpe. Se llama solo con el contexto ya corriendo: si está
        // suspendido, `currentTime` no avanza y el sonido queda agendado para cuando
        // reanude, que puede ser minutos después y suena a fantasma.
        const golpear = (c) => {
            const t0 = c.currentTime;
            const salida = c.createGain();
            // Ataque instantáneo y caída larga: es lo que distingue un golpe de campana de
            // un pitido. Las rampas son exponenciales porque el oído percibe el volumen en
            // escala logarítmica; una rampa lineal se oye como un corte seco al final.
            salida.gain.setValueAtTime(0.0001, t0);
            salida.gain.exponentialRampToValueAtTime(0.30, t0 + 0.008);
            salida.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
            salida.connect(c.destination);

            // Una campana no es un tono puro. Estos tres parciales —fundamental, quinta y
            // dos octavas arriba— son lo que le da el timbre metálico; con un solo seno
            // suena a alarma de microondas.
            [[880, 1, 1.8], [1320, 0.45, 1.0], [2640, 0.15, 0.55]].forEach(([hz, vol, vida]) => {
                const osc = c.createOscillator();
                const g   = c.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(hz, t0);
                g.gain.setValueAtTime(vol, t0);
                // Los armónicos agudos se apagan antes que el fundamental, como en una
                // campana de verdad: por eso el sonido se va "oscureciendo" al decaer.
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + vida);
                osc.connect(g);
                g.connect(salida);
                osc.start(t0);
                osc.stop(t0 + 1.9);
            });
        };

        return () => {
            const c = contexto();
            if (!c) return;
            // `resume()` es una promesa: justo después del primer clic el contexto todavía
            // figura 'suspended' aunque ya vaya a reanudar. Comprobar el estado y salir
            // —que es lo que hacía antes— dejaba la campana muda casi siempre. Acá se
            // espera a que reanude y recién ahí se golpea; si el navegador se niega
            // porque no hubo gesto, no pasa nada y el badge avisa igual.
            if (c.state === 'running') { golpear(c); return; }
            c.resume().then(() => golpear(c)).catch(() => {});
        };
    })();

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
        // `chip` y no `campana`: ese nombre ya es la función que hace sonar la campana, y
        // tenerlo tapado acá adentro pide una confusión.
        document.querySelectorAll('.campana-traslado').forEach((chip) => {
            const n = porCuenta[chip.dataset.caja] || 0;
            chip.classList.toggle('hidden', n === 0);
            chip.title = `${n} traslado(s) de efectivo esperando que esta cuenta los acepte`;
            const contador = chip.querySelector('.campana-n');
            if (contador) contador.textContent = n;
            // Solo la campana que cambió llama la atención, y una sola vez: si todas
            // parpadearan en cada aviso, ninguna diría nada.
            if (n > 0 && chip.dataset.previo !== String(n)) {
                chip.classList.remove('campana-entra');
                void chip.offsetWidth;   // reinicia la animación aunque el valor repita
                chip.classList.add('campana-entra');
            }
            chip.dataset.previo = String(n);
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        // El punto de partida sale de lo que el servidor ya pintó en el menú. Sin esa
        // referencia, el primer evento que llegara sonaría aunque el número no hubiera
        // subido — o peor, aunque hubiera bajado porque alguien acaba de aceptar uno.
        let totalTraslados = Number(document.getElementById('menu-traslados-badge')?.textContent) || 0;

        // El evento trae el total y el desglose por cuenta juntos: el menú necesita uno y
        // el listado el otro, y mandarlos en dos eventos abriría la puerta a que se pinten
        // estados de momentos distintos.
        suscribir('traslados_pendientes', (ev) => {
            try {
                const d = JSON.parse(ev.data);
                const total = Number(d.total) || 0;

                // Suena solo cuando LLEGA algo nuevo. Que el contador baje significa que
                // alguien resolvió un traslado, y eso no se anuncia con una campana.
                if (total > totalTraslados) campana();
                totalTraslados = total;

                pintarTraslados(total);
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
