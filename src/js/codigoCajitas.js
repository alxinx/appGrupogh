// ─────────────────────────────────────────────────────────────────────────────
// Código de empleado en cajitas: una por dígito, como un código de verificación.
//
// Todo campo marcado con `data-codigo-empleado` se muestra como 5 cajitas. El <input>
// real NO se reemplaza: queda encima de las cajitas, transparente, y es el que recibe el
// foco, el teclado y el pegado. Las cajitas solo dibujan lo que tiene. Así, cada pantalla
// sigue leyendo `input.value` y escuchando sus eventos `input`/`keydown` como antes, sin
// saber que el campo cambió de aspecto — y un campo que se crea después (el HTML de una
// ventana de SweetAlert2) se toma solo, vía MutationObserver.
//
// Se carga desde adminAlertas.js (todas las páginas del admin) y storeGlobal.js (todas
// las de la tienda). El guard de `window` evita montarlo dos veces si una página trae
// los dos.
//
// NO sirve para el input propio de SweetAlert2 (`input: 'password'`): la librería lo
// busca como hijo directo de la ventana y, metido en el contenedor, deja de encontrarlo.
// Las ventanas que piden código llevan su propio <input> dentro del `html`.
//
// Los dígitos se muestran como puntos: el código es una credencial operativa y se
// escribe con gente alrededor, por eso todos estos campos ya eran type="password".
// ─────────────────────────────────────────────────────────────────────────────

const LARGO = 5; // EMPLEADOS.codigoEmpleado es STRING(5), siempre dígitos
const SELECTOR = 'input[data-codigo-empleado]';

const CSS = `
.gh-codigo { position: relative; display: flex; gap: 0.5rem; width: 100%; max-width: 17.5rem; }
.gh-codigo > input {
    /* !important: el input trae sus propias clases (swal2-input, input de DaisyUI, utilidades
       de Tailwind) y cualquiera que gane acá lo corre de encima de las cajitas. */
    position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important;
    margin: 0 !important; padding: 0 !important; opacity: 0 !important; border: 0 !important;
    box-shadow: none !important; cursor: text; z-index: 1;
    /* 16px: con menos, Safari de iPhone hace zoom a la página al enfocar. */
    font-size: 16px; color: transparent; caret-color: transparent;
}
.gh-codigo-caja {
    flex: 1 1 0; min-width: 2rem; max-width: 3.25rem; aspect-ratio: 5 / 6;
    display: flex; align-items: center; justify-content: center;
    background: #fff; border: 1px solid var(--color-gh-grayBorder, #E5E7EB);
    border-radius: var(--radius-gh, 12px);
    box-shadow: 0 2px 6px rgb(15 23 42 / 0.06);
    transition: border-color .15s ease, box-shadow .15s ease;
}
.gh-codigo-caja.gh-codigo-activa {
    border-color: var(--color-gh-primary, #F794C9);
    box-shadow: 0 0 0 3px rgb(247 148 201 / 0.25);
}
/* El dígito escrito, como un punto: el carácter "•" sale chico y cambia con la fuente. */
.gh-codigo-caja.gh-codigo-llena::after {
    content: ''; width: 0.625rem; height: 0.625rem; border-radius: 50%; background: #1E293B;
}
/* El cursor dibujado en la cajita que recibe el próximo dígito. */
.gh-codigo-caja.gh-codigo-activa:not(.gh-codigo-llena)::after {
    content: ''; width: 2px; height: 45%; background: #475569;
    animation: gh-codigo-parpadeo 1s steps(1) infinite;
}
@keyframes gh-codigo-parpadeo { 50% { opacity: 0; } }
/* Resultado de la verificación del código: verde si es válido, rojo si no. Pisa también
   a la cajita activa, para que el resultado se vea aunque el campo siga enfocado. */
.gh-codigo.gh-codigo-ok .gh-codigo-caja {
    border-color: #10B981; background: #ECFDF5; box-shadow: 0 0 0 3px rgb(16 185 129 / 0.12);
}
.gh-codigo.gh-codigo-ok .gh-codigo-caja.gh-codigo-llena::after { background: #047857; }
.gh-codigo.gh-codigo-error .gh-codigo-caja {
    border-color: #F43F5E; background: #FFF1F2; box-shadow: 0 0 0 3px rgb(244 63 94 / 0.12);
}
.gh-codigo.gh-codigo-error .gh-codigo-caja.gh-codigo-llena::after { background: #BE123C; }
.gh-codigo.gh-codigo-error { animation: gh-codigo-sacudir .3s ease; }
@keyframes gh-codigo-sacudir { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
@media (prefers-reduced-motion: reduce) { .gh-codigo.gh-codigo-error { animation: none; } }
.gh-codigo.gh-codigo-deshabilitado { opacity: 0.5; }
/* En una ventana emergente el código va centrado, con su etiqueta y su mensaje de estado:
   es lo único que se escribe ahí, y centrado se lee como el paso final de la confirmación.
   En un formulario de página queda a la izquierda, alineado con los demás campos. Los
   !important pisan el text-align:left que varias ventanas traen escrito en línea. */
.swal2-popup .gh-codigo { margin-left: auto; margin-right: auto; }
/* display:block porque un <label> es en línea, y text-align no mueve a un elemento en línea. */
.swal2-popup :is(label, p):has(+ .gh-codigo, + * > .gh-codigo) { display: block; text-align: center !important; }
.swal2-popup :is(.gh-codigo, :has(> .gh-codigo)) + p { text-align: center !important; }
.gh-codigo-aviso { color: #BE123C; }
.gh-codigo.gh-codigo-deshabilitado > input { cursor: not-allowed; }
`;

const valorNativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

// Pinta las cajitas con el resultado de la verificación: 'ok', 'error', o null para
// volver al color normal. Cada pantalla verifica el código a su manera (endpoint y
// permiso propios); esto solo muestra el resultado, así que la llaman todas igual.
// No hace falta limpiar al volver a escribir: el componente lo hace solo.
export const pintarCodigo = (inputOId, estado) => {
    const input = typeof inputOId === 'string' ? document.getElementById(inputOId) : inputOId;
    const caja = input?.closest('.gh-codigo');
    if (!caja) return;
    caja.classList.toggle('gh-codigo-ok', estado === 'ok');
    caja.classList.toggle('gh-codigo-error', estado === 'error');
};

const montar = (input) => {
    if (input.dataset.codigoMontado) return;
    input.dataset.codigoMontado = '1';

    input.maxLength = LARGO;
    input.inputMode = 'numeric';
    if (!input.getAttribute('autocomplete')) input.setAttribute('autocomplete', 'one-time-code');

    const caja = document.createElement('div');
    caja.className = 'gh-codigo';
    const cajitas = Array.from({ length: LARGO }, () => {
        const c = document.createElement('span');
        c.className = 'gh-codigo-caja';
        c.setAttribute('aria-hidden', 'true');
        return c;
    });

    // Íconos decorativos puestos encima del input viejo (el del usuario, el candado):
    // quedarían tapando la primera cajita.
    input.parentElement?.querySelectorAll(':scope > .fi, :scope > [class*="fi-rr-"]').forEach((ic) => {
        if (getComputedStyle(ic).position === 'absolute') ic.style.display = 'none';
    });

    // Mover el input al contenedor le quita el foco; si la ventana ya lo había enfocado
    // al abrirse, se le devuelve.
    const teniaFoco = document.activeElement === input;
    input.replaceWith(caja);
    caja.append(...cajitas, input);
    if (teniaFoco) input.focus();

    const pintar = () => {
        const valor = valorNativo.get.call(input);
        const enfocado = document.activeElement === input;
        cajitas.forEach((c, i) => {
            c.classList.toggle('gh-codigo-llena', i < valor.length);
            c.classList.toggle('gh-codigo-activa', enfocado && i === Math.min(valor.length, LARGO - 1));
        });
        caja.classList.toggle('gh-codigo-deshabilitado', input.disabled);
    };

    // Las pantallas vacían o precargan el campo asignando `.value` a mano (al cerrar una
    // ventana, tras un error), y eso no dispara ningún evento: se intercepta el setter en
    // esta instancia para repintar igual.
    Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return valorNativo.get.call(this); },
        set(v) { valorNativo.set.call(this, v); if (!v) pintarCodigo(this, null); pintar(); }
    });

    // Solo dígitos. Se frena ANTES de que el carácter entre (beforeinput) y no limpiando
    // después: los listeners de cada pantalla ya leyeron el valor para cuando corre el
    // nuestro, y validarían un código con letras.
    input.addEventListener('beforeinput', (e) => {
        // Cualquier cambio invalida el resultado anterior. Va acá y no en `input` porque
        // `beforeinput` corre antes que los listeners de la pantalla: si una verificara en
        // el mismo evento, el color que pinta no se borraría detrás.
        pintarCodigo(input, null);
        if (!e.data || /^\d+$/.test(e.data)) return;
        e.preventDefault();
        const digitos = e.data.replace(/\D/g, '');
        if (!digitos) return;
        // Un pegado con espacios o guiones ("97 215"): se insertan solo los dígitos.
        input.setRangeText(digitos, input.selectionStart, input.selectionEnd, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // El cursor siempre al final: se escribe y se borra de a un dígito, como en las
    // cajitas de cualquier código de verificación.
    const alFinal = () => { const n = input.value.length; input.setSelectionRange(n, n); };
    ['focus', 'click', 'keyup'].forEach((ev) => input.addEventListener(ev, () => { alFinal(); pintar(); }));
    ['input', 'blur'].forEach((ev) => input.addEventListener(ev, pintar));
    input.form?.addEventListener('reset', () => setTimeout(pintar));
    // `disabled` cambia por atributo desde varias pantallas.
    new MutationObserver(pintar).observe(input, { attributes: true, attributeFilter: ['disabled'] });

    pintar();
};

export const activarCajitasCodigo = () => {
    if (window.__cajitasCodigo) return;
    window.__cajitasCodigo = true;

    // Para los scripts escritos dentro de una vista Pug, que no pueden importar el módulo.
    window.codigoRequerido = codigoRequerido;
    window.pintarCodigo = pintarCodigo;

    const estilo = document.createElement('style');
    estilo.textContent = CSS;
    document.head.appendChild(estilo);

    const barrer = (raiz) => {
        if (raiz.matches?.(SELECTOR)) montar(raiz);
        raiz.querySelectorAll?.(SELECTOR).forEach(montar);
    };
    barrer(document);
    // Nodos nuevos, y también el atributo puesto sobre un input que ya existía.
    new MutationObserver((cambios) => cambios.forEach((c) => {
        if (c.type === 'attributes') barrer(c.target);
        else c.addedNodes.forEach(barrer);
    })).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['data-codigo-empleado']
    });
};

// Para las ventanas de SweetAlert2 que piden solo el código (reactivar o suspender un
// crédito, cancelar un pedido): el campo va dentro del `html` y no como `input:` de la
// librería (ver arriba). `margen` alinea el campo con el texto de la ventana.
export const campoCodigoEmpleado = (id, margen = '1.75rem') =>
    `<div style="padding:0 ${margen}; display:flex;">
        <input id="${id}" type="password" data-codigo-empleado autocomplete="one-time-code" aria-label="Código de empleado">
     </div>`;

// `preConfirm` de toda ventana que pide el código: devuelve el código, o false —la ventana
// sigue abierta— con el aviso. Sin `idEstado` el aviso sale como mensaje de validación de
// SweetAlert2 (el mismo que daba el `inputValidator` al que reemplaza); con `idEstado`, en
// ese párrafo, para las ventanas con estilo propio donde el mensaje de la librería desentona.
export const codigoRequerido = (id, idEstado = null) => {
    const input = document.getElementById(id);
    const codigo = (input?.value || '').trim();
    if (codigo) return codigo;
    pintarCodigo(input, 'error');
    const estado = idEstado && document.getElementById(idEstado);
    if (estado) {
        estado.textContent = 'Ingresá tu código de empleado.';
        estado.classList.add('gh-codigo-aviso');
    } else {
        Swal.showValidationMessage('Ingresá el código del empleado.');
    }
    input?.focus();
    return false;
};

// Se activa sola en cualquier página que importe este módulo, y no solo desde
// adminAlertas.js / storeGlobal.js: hay pantallas con campo de código que no cargan
// ninguno de los dos (el cuadre de caja y los egresos de la tienda), y ahí el campo
// quedaba sin cajitas. Toda pantalla que pide el código importa algo de acá (pintarCodigo,
// codigoRequerido) o de modalConfirmacion.js, que a su vez importa este módulo.
//
// Va al FINAL del archivo a propósito: activarCajitasCodigo publica codigoRequerido y
// pintarCodigo en window, y llamarla antes de que esas constantes estén definidas lanza
// un ReferenceError que tumba el script entero de la página.
if (typeof document !== 'undefined') activarCajitasCodigo();
