// ─────────────────────────────────────────────────────────────────────────────
// Una sola conexión SSE para TODAS las pestañas del navegador.
//
// Por qué: en HTTP/1.1 —lo que habla `localhost:9090` en desarrollo— Chrome permite
// como máximo 6 conexiones simultáneas por dominio, y un EventSource ocupa una para
// siempre. Con una conexión por pestaña, seis pestañas del panel abiertas agotaban el
// cupo y cualquier petición nueva de cualquier pestaña (cargar una página, validar el
// código de empleado) quedaba en cola sin respuesta: el panel "se colgaba".
//
// Cómo: las pestañas eligen una líder con `navigator.locks`. Solo la líder abre el
// EventSource y reparte cada evento a las demás por `BroadcastChannel`. Cuando la líder
// se cierra el navegador suelta el lock y otra pestaña lo toma sola, sin intervención.
//
// Las pestañas no escuchan todas los mismos eventos, así que cada una anuncia los suyos
// por el canal y la líder se suscribe a la unión. Al asumir una líder nueva, pide que
// todas vuelvan a anunciarse.
//
// Si el navegador no tiene `locks` o `BroadcastChannel` (o no es contexto seguro), cae
// al comportamiento anterior: una conexión propia por pestaña.
//
// Los handlers reciben un objeto con `.data` (el string JSON), igual que un evento de
// EventSource, así que los consumidores existentes no cambian.
//
// `eventosDeEstado`: eventos que describen un estado y no un hecho, como el `state` que
// /store/sse manda apenas se conecta. Ese envío inicial solo lo recibe la líder, así que
// ella guarda el último valor de cada uno y lo reenvía cuando una pestaña se suscribe;
// si no, las demás arrancarían sin badge ni banner hasta el próximo cambio. Solo van acá
// eventos que se pueden repetir sin efecto visible: un `new_traslado` repetido volvería
// a abrir su ventana en todas las pestañas.
// ─────────────────────────────────────────────────────────────────────────────

const REINTENTO_MS = 5000;

export const crearSseCompartido = (url, nombre, { eventosDeEstado = [] } = {}) => {
    const handlers = new Map();          // evento → [handler]
    let iniciado = false;

    const entregar = (evento, data) =>
        (handlers.get(evento) || []).forEach((h) => { try { h({ data, type: evento }); } catch (e) { console.error(e); } });

    // ── Sin soporte: una conexión por pestaña, como antes ────────────────────
    const compartible = typeof BroadcastChannel !== 'undefined' && navigator.locks?.request;
    if (!compartible) {
        let sse = null;
        const abrir = () => {
            if (sse) sse.close();
            sse = new EventSource(url);
            handlers.forEach((_, evento) => sse.addEventListener(evento, (e) => entregar(evento, e.data)));
            sse.addEventListener('error', () => { sse.close(); setTimeout(abrir, REINTENTO_MS); });
        };
        return {
            on(evento, handler) {
                const nuevo = !handlers.has(evento);
                if (nuevo) handlers.set(evento, []);
                handlers.get(evento).push(handler);
                if (nuevo && sse) sse.addEventListener(evento, (e) => entregar(evento, e.data));
            },
            connect() { if (!iniciado) { iniciado = true; abrir(); } }
        };
    }

    // ── Compartida entre pestañas ────────────────────────────────────────────
    const canal = new BroadcastChannel(`sse:${nombre}`);
    let esLider = false;
    let sse = null;
    const escuchando = new Set();        // eventos a los que la líder ya se suscribió
    const ultimoEstado = new Map();      // evento de estado → último data recibido
    const idPestana = Math.random().toString(36).slice(2);
    let soltarLock = null;

    const escucharEnLider = (evento) => {
        if (!sse || escuchando.has(evento)) return;
        escuchando.add(evento);
        sse.addEventListener(evento, (e) => {
            if (eventosDeEstado.includes(evento)) ultimoEstado.set(evento, e.data);
            entregar(evento, e.data);                              // esta pestaña
            canal.postMessage({ tipo: 'evento', evento, data: e.data }); // las demás
        });
    };

    const abrirComoLider = () => {
        if (sse) sse.close();
        escuchando.clear();
        ultimoEstado.clear();
        sse = new EventSource(url);
        handlers.forEach((_, evento) => escucharEnLider(evento));
        sse.addEventListener('error', () => {
            // EventSource reintenta solo pero deja la conexión vieja colgada; se cierra y
            // se reabre a mano (cada reinicio de nodemon pasaba por acá).
            sse.close();
            sse = null;
            setTimeout(() => { if (esLider) abrirComoLider(); }, REINTENTO_MS);
        });
        canal.postMessage({ tipo: 'anunciense' });
    };

    canal.onmessage = ({ data: m }) => {
        if (m.tipo === 'evento') entregar(m.evento, m.data);
        else if (m.tipo === 'estado' && m.para === idPestana) entregar(m.evento, m.data);
        else if (m.tipo === 'suscribir' && esLider) {
            m.eventos.forEach(escucharEnLider);
            // Una pestaña nueva no vio el estado inicial: se lo manda la líder a ELLA sola
            // (`para`), no a todas, que ya lo tienen.
            m.eventos.filter((ev) => ultimoEstado.has(ev))
                .forEach((ev) => canal.postMessage({ tipo: 'estado', para: m.de, evento: ev, data: ultimoEstado.get(ev) }));
        }
        else if (m.tipo === 'anunciense' && handlers.size) anunciar([...handlers.keys()]);
    };

    const anunciar = (eventos) => canal.postMessage({ tipo: 'suscribir', de: idPestana, eventos });

    const postularse = () => {
        // El lock se sostiene mientras la promesa no resuelva, o sea mientras viva la
        // pestaña, salvo que la suelte `pagehide`.
        navigator.locks.request(`sse-lider:${nombre}`, () => {
            esLider = true;
            abrirComoLider();
            return new Promise((resolve) => { soltarLock = resolve; });
        });
    };

    // Al salir de la página la líder suelta el lock ella misma. Si esperara a que el
    // navegador destruya el documento (o lo guarde en el back/forward cache), las demás
    // pestañas pasaban unos segundos sin conexión y los avisos de ese rato se perdían.
    window.addEventListener('pagehide', () => {
        if (!esLider) return;
        esLider = false;
        if (sse) { sse.close(); sse = null; }
        soltarLock?.();
        soltarLock = null;
    });
    // Si la página vuelve desde el back/forward cache, se postula de nuevo.
    window.addEventListener('pageshow', (e) => {
        if (e.persisted && iniciado) { postularse(); if (handlers.size) anunciar([...handlers.keys()]); }
    });

    return {
        on(evento, handler) {
            const nuevo = !handlers.has(evento);
            if (nuevo) handlers.set(evento, []);
            handlers.get(evento).push(handler);
            if (!nuevo) return;
            // Antes de connect() no se anuncia: connect() manda todos juntos. Anunciarlos de
            // a uno haría que la líder reenviara el estado una vez por cada evento.
            if (esLider) escucharEnLider(evento);
            else if (iniciado) anunciar([evento]);
        },
        connect() {
            if (iniciado) return;
            iniciado = true;
            postularse();
            if (handlers.size) anunciar([...handlers.keys()]);
        }
    };
};

// Instala la conexión compartida del panel admin en `window.adminSSE` una sola vez por
// pestaña, la importe quien la importe (helpers.js y adminAlertas.js son bundles
// separados y los dos la necesitan).
export const adminSSE = () => (window.adminSSE ||= crearSseCompartido('/admin/sse', 'admin'));

// Lo mismo para el panel de tienda (storeGlobal.js).
export const storeSSE = () => (window.storeSSE ||= crearSseCompartido('/store/sse', 'store', { eventosDeEstado: ['state'] }));
