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
window.enhanceSelectBuscable = (select, { placeholder = 'Buscar...' } = {}) => {
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
    input.autocomplete = 'off';
    input.className = `${select.className} select-buscable-input`.trim();
    input.placeholder = placeholder;
    wrap.appendChild(input);

    const lista = document.createElement('ul');
    lista.className = 'select-buscable-lista hidden';
    wrap.appendChild(lista);

    const sinTildes = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const opciones  = () => Array.from(select.options).filter(o => o.value !== '');

    // La opción vacía ("Selecciona...") nunca se muestra en el input como si fuera texto
    // escrito — si no hay nada elegido de verdad, el input queda vacío y el placeholder
    // hace de prompt.
    const sync = () => {
        const opt = select.options[select.selectedIndex];
        input.value    = (opt && opt.value !== '') ? opt.text : '';
        input.disabled = select.disabled;
    };

    const cerrar = () => { lista.classList.add('hidden'); lista.innerHTML = ''; };

    const abrir = (filtro = '') => {
        if (select.disabled) return;
        const termino   = sinTildes(filtro.trim());
        const filtradas = opciones().filter(o => sinTildes(o.text).includes(termino));
        lista.innerHTML = filtradas.length
            ? filtradas.map(o => `<li data-value="${o.value}" class="select-buscable-item${o.value === select.value ? ' select-buscable-item--activo' : ''}">${o.text}</li>`).join('')
            : '<li class="select-buscable-vacio">Sin resultados</li>';
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
        const li = e.target.closest('li[data-value]');
        if (!li) return;
        e.preventDefault();
        elegir(li.dataset.value, li.textContent);
    });

    sync();
    return { refresh: sync };
};

window.iconoDoc = (fmt) => {
    const f = (fmt || '').toLowerCase();
    if (f === 'pdf')                          return 'fi-rr-file-pdf';
    if (['doc', 'docx'].includes(f))          return 'fi-rr-file-word';
    if (['xls', 'xlsx'].includes(f))          return 'fi-rr-file-spreadsheet';
    if (['ppt', 'pptx'].includes(f))          return 'fi-rr-file-powerpoint';
    if (['jpg', 'jpeg', 'png'].includes(f))   return 'fi-rr-picture';
    return 'fi-rr-document';
};

// ─── SSE ADMIN: conexión única compartida por pestaña ─────────────────────────
// Antes de reconectar SIEMPRE cierra la conexión anterior (si no, EventSource
// reintenta solo en segundo plano y se acumulan conexiones zombi en cada
// caída — p.ej. cada reinicio de nodemon en dev — degradando navegador/SO).
(function () {
    let sse = null;
    const listeners = [];

    const conectar = () => {
        if (sse) sse.close();
        sse = new EventSource('/admin/sse');
        listeners.forEach(([evento, handler]) => sse.addEventListener(evento, handler));
        sse.addEventListener('error', () => setTimeout(conectar, 5000));
    };

    window.adminSSE = {
        on(evento, handler) {
            listeners.push([evento, handler]);
            if (sse) sse.addEventListener(evento, handler);
        },
        connect() {
            if (!sse) conectar();
        }
    };
})();

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