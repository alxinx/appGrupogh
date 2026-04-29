(function () {

    // ─── TOAST ──────────────────────────────────────────────────────────────
    const showToast = (msg, tipo = 'info', duracion = 10000) => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const colores = {
            info:    'bg-white border-blue-400',
            success: 'bg-white border-emerald-400',
            warning: 'bg-white border-amber-400',
            error:   'bg-white border-red-400'
        };
        const iconos = {
            info:    'fi-rr-info text-blue-500',
            success: 'fi-rr-check text-emerald-500',
            warning: 'fi-rr-triangle-warning text-amber-500',
            error:   'fi-rr-cross-circle text-red-500'
        };

        const toast = document.createElement('div');
        toast.className = [
            'flex items-start gap-3 px-4 py-3 rounded-2xl shadow-lg border-l-4 pointer-events-auto',
            'max-w-xs w-full transition-all duration-300 opacity-0 translate-y-2',
            colores[tipo] || colores.info
        ].join(' ');

        toast.innerHTML = `
            <i class="fi ${iconos[tipo] || iconos.info} text-base flex-shrink-0 mt-0.5"></i>
            <span class="text-sm text-slate-700 font-medium flex-1">${msg}</span>
            <button class="text-slate-400 hover:text-slate-600 flex-shrink-0" onclick="this.closest('.toast-item').remove()">
                <i class="fi fi-rr-cross-small text-sm"></i>
            </button>`;
        toast.classList.add('toast-item');
        container.appendChild(toast);

        requestAnimationFrame(() => toast.classList.remove('opacity-0', 'translate-y-2'));

        const timer = setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-2');
            setTimeout(() => toast.remove(), 300);
        }, duracion);

        toast.querySelector('button').addEventListener('click', () => clearTimeout(timer));
    };

    window.showToast = showToast;

    // ─── BANNER CONTROVERSIAS ────────────────────────────────────────────────
    const actualizarBanner = (count) => {
        const banner = document.getElementById('controversia-banner');
        const texto  = document.getElementById('controversia-texto');
        if (!banner) return;
        if (count > 0) {
            if (texto) texto.textContent = `TIENE ${count} CONTROVERSIA${count > 1 ? 'S' : ''} POR RESOLVER — INGRESA A TRASLADOS PARA GESTIONARLAS`;
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    };

    // ─── SSE ─────────────────────────────────────────────────────────────────
    let sseSource = null;
    let renotifyTimer = null;

    const conectarSSE = () => {
        if (sseSource) sseSource.close();

        sseSource = new EventSource('/store/sse');

        sseSource.addEventListener('state', (e) => {
            const { pendientes, controversias } = JSON.parse(e.data);
            actualizarBanner(controversias);

            const badge = document.getElementById('badge-pendientes');
            if (badge) badge.textContent = pendientes;
        });

        sseSource.addEventListener('new_traslado', (e) => {
            const { codigo, pendientes } = JSON.parse(e.data);
            showToast(`📦 Nuevo traslado entrante: <strong>${codigo}</strong>`, 'info', 10000);

            const badge = document.getElementById('badge-pendientes');
            if (badge) badge.textContent = pendientes;

            // Recargar tabla si existe en la página actual
            if (typeof window.loadPendientes === 'function') window.loadPendientes();

            // Re-notificar cada 60 min si sigue sin atenderse
            clearTimeout(renotifyTimer);
            renotifyTimer = setTimeout(() => {
                showToast(`⚠️ Aún tienes el traslado <strong>${codigo}</strong> sin recibir.`, 'warning', 10000);
            }, 60 * 60 * 1000);
        });

        sseSource.addEventListener('traslado_devuelto', (e) => {
            const { codigo } = JSON.parse(e.data);
            mostrarBannerDevuelto(codigo);
        });

        sseSource.onerror = () => {
            setTimeout(conectarSSE, 5000);
        };
    };

    // Banner persistente para traslados devueltos por vencimiento
    const bannerDevuelto = (() => {
        let codigos = [];
        const render = () => {
            let el = document.getElementById('banner-devuelto');
            if (!el) {
                el = document.createElement('div');
                el.id = 'banner-devuelto';
                el.className = 'fixed top-0 left-0 right-0 z-50 bg-orange-600 text-white text-center py-2 px-4 text-sm font-bold shadow-lg';
                document.body.prepend(el);
            }
            el.innerHTML = `<i class="fi fi-rr-triangle-warning mr-2"></i>
                ⚠ TRASLADO${codigos.length > 1 ? 'S' : ''} DEVUELTO${codigos.length > 1 ? 'S' : ''} POR VENCIMIENTO: ${codigos.join(', ')} — La mercancía fue regresada al inventario de origen.
                <button class="ml-4 underline hover:text-orange-200" onclick="document.getElementById('banner-devuelto').remove()">Entendido</button>`;
        };
        return (codigo) => {
            if (!codigos.includes(codigo)) codigos.push(codigo);
            render();
        };
    })();

    window.mostrarBannerDevuelto = bannerDevuelto;

    document.addEventListener('DOMContentLoaded', conectarSSE);

})();
