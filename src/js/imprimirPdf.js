// ─────────────────────────────────────────────────────────────────────────────
// Imprimir un PDF sin abrir una pestaña nueva.
//
// El PDF se carga en un <iframe> invisible dentro de la misma página y se le pide
// imprimir: aparece directo la ventana de impresión del navegador, y al cerrarla el
// operador sigue en la pantalla donde estaba. Antes cada tirilla se abría en otra
// pestaña, había que imprimirla desde ahí y volver.
//
// Lo que la web NO puede hacer es imprimir sin mostrar esa ventana: es una protección del
// navegador. Para que la tirilla salga sola por la impresora, el Chrome del equipo de caja
// se abre con el parámetro --kiosk-printing, y entonces este mismo print() imprime en la
// impresora predeterminada sin preguntar.
//
// Si el navegador no deja imprimir el PDF desde el iframe (Safari, por ejemplo, lo
// bloquea), se cae a lo de antes: abrir el PDF en una pestaña nueva.
//
// Requisitos de la ruta que sirve el PDF:
//   · `Content-Disposition: inline` — con `attachment` el navegador lo descarga en vez de
//     mostrarlo y no hay nada que imprimir.
//   · el middleware `permitirMarcoPropio` (middlewares/cabecerasSeguridad.js) — el
//     `X-Frame-Options: DENY` general hace que el navegador bloquee el iframe.
// ─────────────────────────────────────────────────────────────────────────────

// El visor de PDF de Chrome termina de dibujar un momento después del `load`: imprimir
// en el acto saca una hoja en blanco.
const ESPERA_RENDER_MS = 500;
// Si el PDF no termina de cargar en este tiempo (el servidor respondió con un error, se
// cortó la red), se abre en una pestaña para que al menos se vea qué pasó.
const ESPERA_CARGA_MS = 15_000;
// El iframe se quita un rato después de imprimir y no en el acto: con --kiosk-printing
// print() vuelve antes de que el trabajo termine de salir hacia la impresora.
const VIDA_IFRAME_MS = 60_000;

const imprimirUno = (url) => new Promise((resolver) => {
    const iframe = document.createElement('iframe');
    // Fuera de la vista pero con tamaño: un iframe de 0×0 o display:none no llega a
    // renderizar el PDF en algunos navegadores y la impresión sale vacía.
    iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:1px; height:1px; border:0; opacity:0; pointer-events:none;';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;

    let terminado = false;
    const terminar = (abrirEnPestana = false) => {
        if (terminado) return;
        terminado = true;
        if (abrirEnPestana) { window.open(url, '_blank'); iframe.remove(); }
        else setTimeout(() => iframe.remove(), VIDA_IFRAME_MS);
        resolver();
    };

    iframe.addEventListener('load', () => {
        setTimeout(() => {
            if (terminado) return;   // venció la espera y ya se abrió en pestaña
            try {
                iframe.contentWindow.focus();
                // Detiene el script hasta que se cierra la ventana de impresión.
                iframe.contentWindow.print();
                terminar();
            } catch (_) {
                terminar(true);
            }
        }, ESPERA_RENDER_MS);
    }, { once: true });
    setTimeout(() => terminar(true), ESPERA_CARGA_MS);

    iframe.src = url;
    document.body.appendChild(iframe);
});

// Las impresiones se encolan: un abono deja varios comprobantes (el voucher y la tirilla
// de cada factura), y dos ventanas de impresión a la vez se pisarían.
let cola = Promise.resolve();

/**
 * Imprime el PDF de `url`. Devuelve una promesa que se cumple cuando se cerró la ventana
 * de impresión: quien recarga la página después tiene que esperarla, o la recarga se
 * lleva puestas las impresiones pendientes.
 *
 * `alTerminar` corre al cerrarse la ventana de impresión. Sirve para devolver el foco:
 * al cerrarla queda en el iframe invisible, y en el POS el lector de barras escribiría
 * en la nada.
 */
export const imprimirPdf = (url, { alTerminar = null } = {}) => {
    cola = cola.then(() => imprimirUno(url)).then(() => { alTerminar?.(); });
    return cola;
};
