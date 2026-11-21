import { adminSSE } from './sseCompartido.js';

// Intercepta todas las respuestas fetch: si el servidor devuelve logout:true
// (límite de intentos fallidos de código de empleado), muestra aviso y cierra sesión.
(function () {
    const _origFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
        const res = await _origFetch(...args);
        if (res.status === 401) {
            try {
                const data = await res.clone().json();
                if (data?.logout === true) {
                    const msg = data.mensaje || 'Tu sesión ha sido cerrada por seguridad.';
                    if (typeof Swal !== 'undefined') {
                        await Swal.fire({
                            icon: 'error',
                            title: 'Sesión cerrada',
                            text: msg,
                            confirmButtonColor: '#EC5FA3',
                            allowOutsideClick: false,
                            allowEscapeKey: false
                        });
                    } else {
                        alert(msg);
                    }
                    window.location.href = '/';
                    return res;
                }
            } catch (_) { /* respuesta no-JSON, ignorar */ }
        }
        return res;
    };
})();

window.fmtCOP = (n) => `$${Math.round(parseFloat(n) || 0).toLocaleString('es-CO')}`;

window.fmtFecha = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

window.fmtFechaLarga = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const local = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
    return local.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};

window.formatMoney = (n, decimals = 0) => {
    return Number(n).toLocaleString('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
};

// Enlaza formato de miles (es-CO) a un <input type="text"> de dinero.
// Úsalo en cualquier campo donde el usuario ingrese valores en pesos.
// Cantidad con decimales escrita como en Colombia ("2,5", "18.400", "1.250,75") → el string
// que espera el servidor ("2.5", "18400", "1250.75"), o null si no es un número. Con coma, los
// puntos son de miles; sin coma, un punto seguido de exactamente 3 dígitos también es de
// miles ("18.400") y cualquier otro punto es el decimal ("2.5"). Hasta 4 decimales, como las
// columnas DECIMAL(15,4) del inventario de insumos (helpers/unidadesInsumo.js).
window.leerDecimal = (texto) => {
    let t = String(texto ?? '').replace(/\s/g, '');
    if (!t) return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    return /^\d{1,11}(\.\d{1,4})?$/.test(t) ? String(Number(t)) : null;
};
// Y al revés, para mostrar: 18400 → "18.400", 2.5 → "2,5".
window.mostrarDecimal = (n) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 4 });

window.initMoneyInput = (el) => {
    if (!el) return;
    el.addEventListener('input', function (e) {
        const cursor    = e.target.selectionStart;
        const original  = e.target.value;
        const digits    = original.replace(/\D/g, '');
        const formatted = digits ? new Intl.NumberFormat('es-CO').format(digits) : '';
        const diff      = formatted.length - original.length;
        e.target.value  = formatted;
        e.target.setSelectionRange(cursor + diff, cursor + diff);
    });
};

// Primera letra de cada palabra en mayúscula, el resto en minúscula: "BODY CELESTE" →
// "Body Celeste". Para mostrar valores que se guardan normalizados en mayúscula (las
// familias de producto, por ejemplo) sin gritarle al operador en la interfaz.
//
// Global acá, junto a los demás helpers de presentación, para que no vuelva a escribirse
// en cada pantalla — en el servidor la misma transformación ya vive suelta como
// `toPascal` dentro de saveCliente y como un replace inline en saveProduct.
window.tituloCase = (texto) => String(texto ?? '')
    .trim()
    .replace(/\S+/g, palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase());

// Convierte un valor formateado ("78.000") o numérico a entero sin decimales.
window.parseMoney = (val) => parseInt(String(val).replace(/\D/g, ''), 10) || 0;

// Convierte un <select> largo en buscable: un input de texto encima que filtra una lista,
// sin tocar el <select> real (mismo name, mismo value — sigue siendo lo que se manda al
// backend, ningún controlador tiene que cambiar). Pensado para listas donde un <select>
// plano ya no alcanza para elegir escribiendo (nació con departamento/municipio del
// formulario de clientes, hasta ~200 filas por departamento desde que se cargó el listado
// completo del DANE) — global acá a propósito para reusarlo en cualquier formulario nuevo
// con el mismo problema, en vez de reescribirlo por cada uno.
//
// Requiere las clases .select-buscable-* — están en views/components/selectBuscable.pug,
// hay que incluir ese partial en cualquier vista que llame a esto.
//
// Opcionales:
//   conImagen  cada opción muestra la miniatura de su `data-imagen` (una foto; si la opción
//              trae `data-sin-foto`, es un ícono de reemplazo y se pinta más chico).
//   accion     { etiqueta(termino), alElegir(termino) }: una última fila fija de la lista
//              —p. ej. "Crear insumo «tela»"— para lo que no está entre las opciones.
window.enhanceSelectBuscable = (select, { placeholder = 'Buscar...', conImagen = false, accion = null } = {}) => {
    if (!select) return { refresh() {} };

    const wrap = document.createElement('div');
    wrap.className = 'select-buscable-wrap';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    // Hereda las clases del propio <select> (field-text acá, cli-campo cli-con-icono
    // cli-select en el POS, field-text-error si el campo venía con error de validación,
    // etc.) en vez de una clase fija — así el input se ve igual que el select que
    // reemplaza sin importar en qué formulario/sistema visual se use.
    const input = document.createElement('input');
    input.type = 'text';
    // Sin el autocompletado del navegador: la lista propia es la única que debe aparecer.
    // Chrome ignora autocomplete="off" en campos que su heurística toma por dirección (lo
    // deduce de la etiqueta "Departamento"/"Ciudad" y del placeholder) y encima de la lista
    // despliega las direcciones guardadas. Un valor que no está en su lista de tokens sí lo
    // desactiva. data-1p-ignore / data-lpignore hacen lo mismo con los gestores de contraseñas.
    input.setAttribute('autocomplete', 'buscable-sin-autocompletar');
    input.setAttribute('data-1p-ignore', '');
    input.setAttribute('data-lpignore', 'true');
    input.spellcheck = false;
    input.className = `${select.className} select-buscable-input`.trim();
    input.placeholder = placeholder;
    wrap.appendChild(input);

    const lista = document.createElement('ul');
    lista.className = 'select-buscable-lista hidden';
    wrap.appendChild(lista);

    const sinTildes = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    // Las opciones ocultas o deshabilitadas no se ofrecen: así un select filtrado desde
    // afuera (bancos acotados por tipo, entidadFinanciera.js) sigue filtrado en la lista.
    const opciones  = () => Array.from(select.options).filter(o => o.value !== '' && !o.hidden && !o.disabled);

    // La opción vacía ("Selecciona...") nunca se muestra en el input como si fuera texto
    // escrito — si no hay nada elegido de verdad, el input queda vacío y el placeholder
    // hace de prompt.
    const sync = () => {
        const opt = select.options[select.selectedIndex];
        input.value    = (opt && opt.value !== '') ? opt.text : '';
        input.disabled = select.disabled;
    };

    const cerrar = () => { lista.classList.add('hidden'); lista.innerHTML = ''; };

    // El texto de una opción puede venir de un dato que escribió alguien (el nombre de un
    // insumo): se escapa siempre antes de ir al innerHTML.
    const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const miniatura = (o) => !conImagen ? ''
        : o.dataset.imagen
            ? `<img src="${escHtml(o.dataset.imagen)}" alt="" loading="lazy" class="select-buscable-img${o.dataset.sinFoto !== undefined ? ' select-buscable-img--icono' : ''}">`
            : '<span class="select-buscable-img select-buscable-img--vacia"></span>';

    const abrir = (filtro = '') => {
        if (select.disabled) return;
        const termino   = sinTildes(filtro.trim());
        const filtradas = opciones().filter(o => sinTildes(o.text).includes(termino));
        lista.innerHTML = (filtradas.length
            ? filtradas.map(o => `<li data-value="${escHtml(o.value)}" class="select-buscable-item${conImagen ? ' select-buscable-item--img' : ''}${o.value === select.value ? ' select-buscable-item--activo' : ''}">${miniatura(o)}<span>${escHtml(o.text)}</span></li>`).join('')
            : '<li class="select-buscable-vacio">Sin resultados</li>')
            + (accion ? `<li data-accion class="select-buscable-accion">${escHtml(accion.etiqueta(filtro.trim()))}</li>` : '');
        lista.classList.remove('hidden');
    };

    const elegir = (value, text) => {
        select.value = value;
        input.value  = text;
        cerrar();
        select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Clic o foco: siempre se ve la lista completa (no filtrada por lo que ya estaba
    // escrito), y se selecciona el texto actual para poder sobreescribir tecleando de una.
    input.addEventListener('focus', () => { input.select(); abrir(''); });
    input.addEventListener('input', () => abrir(input.value));
    input.addEventListener('blur', () => {
        // El timeout deja que el mousedown de la lista se procese antes de cerrar — si el
        // blur cierra primero, el click nunca llega a disparar.
        setTimeout(() => {
            const coincide = opciones().find(o => o.text === input.value);
            if (!coincide) sync();
            cerrar();
        }, 150);
    });
    lista.addEventListener('mousedown', (e) => {
        if (accion && e.target.closest('li[data-accion]')) {
            e.preventDefault();
            const termino = input.value.trim();
            cerrar();
            sync();
            accion.alElegir(termino);
            return;
        }
        const li = e.target.closest('li[data-value]');
        if (!li) return;
        e.preventDefault();
        elegir(li.dataset.value, li.textContent);
    });

    sync();
    // Quien cambie el value por código (sin evento) llama a select.buscable.refresh().
    const api = { refresh: sync };
    select.buscable = api;
    return api;
};

// Ícono (Flaticon) de un documento según su formato. `conColor` agrega el color de cada
// tipo, que es como lo muestran las fichas de cliente; sin él, quien llama pone el suyo.
// Antes las fichas de cliente tenían su propia copia con colores, y ésta no reconocía
// `webp`: el formato en que se guarda TODA imagen subida (CLAUDE.md §5.9).
window.iconoDoc = (fmt, { conColor = false } = {}) => {
    const f = (fmt || '').toLowerCase();
    const [icono, color] =
        f === 'pdf'                                        ? ['fi-rr-file-pdf',         'text-red-400'] :
        ['doc', 'docx'].includes(f)                        ? ['fi-rr-file-word',        'text-blue-400'] :
        ['xls', 'xlsx'].includes(f)                        ? ['fi-rr-file-spreadsheet', 'text-emerald-500'] :
        ['ppt', 'pptx'].includes(f)                        ? ['fi-rr-file-powerpoint',  'text-orange-400'] :
        ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(f)  ? ['fi-rr-picture',          'text-purple-400'] :
                                                             ['fi-rr-document',         'text-slate-400'];
    return conColor ? `${icono} ${color}` : icono;
};

// ─── SSE ADMIN: una conexión para todas las pestañas ─────────────────────────
// Ver src/js/sseCompartido.js: la comparten todas las pestañas del navegador, no solo
// las pantallas de una misma pestaña.
adminSSE();

window.crearItemDocTienda = (a) => {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5';
    li.dataset.id = a.idDocumento;
    li.innerHTML = `
        <i class="fi ${window.iconoDoc(a.formato)} text-base flex-shrink-0 text-slate-500"></i>
        <a href="${a.url}" target="_blank"
           class="text-xs font-medium truncate flex-1 hover:underline"
           style="color:#EC5FA3">${a.nombreDocumento}</a>
        <span class="text-[10px] text-slate-400 uppercase flex-shrink-0">${a.formato}</span>
        <button type="button"
                data-id="${a.idDocumento}" data-nombre="${a.nombreDocumento}"
                class="btn-del-doc-tienda flex-shrink-0 w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors"
                title="Eliminar">
            <i class="fi fi-rr-trash text-red-400 text-xs pointer-events-none"></i>
        </button>`;
    return li;
};