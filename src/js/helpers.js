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

window.iconoDoc = (fmt) => {
    const f = (fmt || '').toLowerCase();
    if (f === 'pdf')                          return 'fi-rr-file-pdf';
    if (['doc', 'docx'].includes(f))          return 'fi-rr-file-word';
    if (['xls', 'xlsx'].includes(f))          return 'fi-rr-file-spreadsheet';
    if (['ppt', 'pptx'].includes(f))          return 'fi-rr-file-powerpoint';
    if (['jpg', 'jpeg', 'png'].includes(f))   return 'fi-rr-picture';
    return 'fi-rr-document';
};

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