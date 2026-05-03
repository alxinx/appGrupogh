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

        sseSource.addEventListener('new_egreso', (e) => {
            const data = JSON.parse(e.data);
            if (typeof window.onNuevoEgreso === 'function') window.onNuevoEgreso(data);
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

    // ─── APERTURA DE CAJA ────────────────────────────────────────────────────
    const formatMiles  = (n) => Math.round(n).toLocaleString('es-CO');
    const parseMiles   = (s) => parseInt(String(s).replace(/\./g, ''), 10) || 0;

    const initAperturaCaja = () => {
        const modal        = document.getElementById('modal-apertura-caja');
        if (!modal) return;

        const inputMenor   = document.getElementById('input-caja-menor');
        const inputCodigo  = document.getElementById('input-codigo-apertura');
        const infoEmpleado = document.getElementById('apertura-empleado-info');
        const btnAbrir     = document.getElementById('btn-abrir-caja');
        const btnCerrar    = document.getElementById('btn-cerrar-caja-modal');

        let empleadoValido = false;
        let debounceTimer  = null;

        // ── Formateo con puntos de miles ─────────────────────────────────────
        // Readonly se usa en lugar de disabled para que el dblclick funcione.
        inputMenor.addEventListener('dblclick', () => {
            inputMenor.removeAttribute('readonly');
            inputMenor.classList.remove('cursor-default', 'select-none', 'bg-slate-50');
            inputMenor.classList.add('bg-white');
            inputMenor.style.borderColor = '#EC5FA3';
            // Mostrar número sin formato para edición
            inputMenor.value = parseMiles(inputMenor.value);
            inputMenor.select();
        });

        inputMenor.addEventListener('keydown', (e) => {
            // Solo permitir dígitos, teclas de control y punto/coma (que descartamos)
            const permitidas = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Enter','Home','End'];
            if (!permitidas.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault();
        });

        inputMenor.addEventListener('blur', () => {
            let val = parseMiles(inputMenor.value);
            if (val < 0 || !Number.isFinite(val)) val = window.__CAJA_MENOR_DEFAULT__ || 0;
            inputMenor.value = formatMiles(val);
            inputMenor.setAttribute('readonly', '');
            inputMenor.classList.add('cursor-default', 'select-none', 'bg-slate-50');
            inputMenor.classList.remove('bg-white');
            inputMenor.style.borderColor = '';
        });

        // ── Info empleado ─────────────────────────────────────────────────────
        const setInfo = (texto, ok) => {
            infoEmpleado.textContent = texto;
            infoEmpleado.className = ok
                ? 'mt-2 px-3 py-2 rounded-lg text-xs font-medium bg-green-50 border border-green-200 text-green-700'
                : 'mt-2 px-3 py-2 rounded-lg text-xs font-medium bg-red-50 border border-red-200 text-red-600';
            infoEmpleado.classList.remove('hidden');
        };
        const clearInfo = () => {
            infoEmpleado.classList.add('hidden');
            infoEmpleado.textContent = '';
        };

        // ── Validación live de empleado ───────────────────────────────────────
        inputCodigo.addEventListener('input', () => {
            empleadoValido    = false;
            btnAbrir.disabled = true;
            clearTimeout(debounceTimer);

            const codigo = inputCodigo.value.trim();
            if (codigo.length < 3) { clearInfo(); return; }

            debounceTimer = setTimeout(async () => {
                try {
                    const r = await fetch(`/store/json/personal/codigo/${encodeURIComponent(codigo.toUpperCase())}`);
                    const d = await r.json();
                    if (d.success) {
                        setInfo(d.nombre, true);
                        empleadoValido    = true;
                        btnAbrir.disabled = false;
                    } else {
                        setInfo('Empleado no encontrado', false);
                    }
                } catch (_) {
                    setInfo('Error al verificar', false);
                }
            }, 400);
        });

        // ── Cerrar modal (sin abrir caja) ─────────────────────────────────────
        btnCerrar.addEventListener('click', () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        });

        // ── Abrir caja ────────────────────────────────────────────────────────
        btnAbrir.addEventListener('click', async () => {
            const cajaMenor      = parseMiles(inputMenor.value);
            const codigoEmpleado = inputCodigo.value.trim().toUpperCase();

            if (cajaMenor < 0) {
                setInfo('El valor de caja menor no puede ser negativo', false);
                return;
            }
            if (!codigoEmpleado || !empleadoValido) {
                setInfo('Ingresa un código de empleado válido', false);
                return;
            }

            btnAbrir.disabled    = true;
            btnAbrir.textContent = 'Abriendo...';

            const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
            try {
                const r = await fetch('/store/caja/abrir', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                    body:    JSON.stringify({ cajaMenor, codigoEmpleado })
                });
                const d = await r.json();
                if (d.success) {
                    window.__cajaAbierta = true;
                    modal.remove();
                    // Actualizar botón del menú: button → link "Cuadrar Caja"
                    const menuBtn = document.getElementById('btn-apertura-caja-menu');
                    if (menuBtn) {
                        const link = document.createElement('a');
                        link.id        = 'btn-apertura-caja-menu';
                        link.href      = '/store/storebehivors/';
                        link.className = menuBtn.className;
                        link.innerHTML = '<i class="fi fi-rr-calculator text-sm mr-2"></i> Cuadrar Caja';
                        menuBtn.replaceWith(link);
                    }
                    showToast('Caja abierta correctamente', 'success', 5000);
                } else {
                    setInfo(d.mensaje || 'Error al abrir la caja', false);
                    btnAbrir.disabled    = false;
                    btnAbrir.textContent = 'Abrir Caja';
                }
            } catch (_) {
                setInfo('Error de conexión', false);
                btnAbrir.disabled    = false;
                btnAbrir.textContent = 'Abrir Caja';
            }
        });
    };

    window.abrirModalCaja = () => {
        const modal = document.getElementById('modal-apertura-caja');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        conectarSSE();
        initAperturaCaja();
        // Mostrar modal si la caja no está abierta
        if (window.__SIN_CAJA__) window.abrirModalCaja();
    });

})();
