(function () {

    // ─── TOAST ──────────────────────────────────────────────────────────────
    const showToast = (msg, tipo = 'info', duracion = 10000) => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        // Mismo tratamiento que el aviso de la tienda web: tarjeta blanca, borde de marca
        // de 2px y esquinas 2xl. Un operador y un cliente que ven la misma situación
        // reciben la misma señal visual, aunque estén en aplicaciones distintas.
        //
        // El icono sí conserva su color por tipo: el borde da identidad de marca, pero el
        // vendedor tiene que distinguir de un vistazo un error de un aviso.
        const iconos = {
            info:    'fi-rr-info text-blue-500',
            success: 'fi-rr-check text-emerald-500',
            warning: 'fi-rr-triangle-warning text-amber-500',
            error:   'fi-rr-cross-circle text-red-500'
        };

        const toast = document.createElement('div');
        toast.className = [
            'flex items-start gap-3 px-4 py-3.5 rounded-2xl bg-white border-2 border-gh-magenta pointer-events-auto',
            'shadow-xl shadow-gh-magenta/20',
            'max-w-xs w-full transition-all duration-300 opacity-0 translate-y-2'
        ].join(' ');

        toast.innerHTML = `
            <i class="fi ${iconos[tipo] || iconos.info} text-base flex-shrink-0 mt-0.5"></i>
            <span class="text-sm text-slate-700 font-medium flex-1 leading-snug">${msg}</span>
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

    // ─── ACTUALIZAR MENÚ POR CAMBIO DE PERMISOS (SSE) ───────────────────────
    const actualizarMenu = (carpetasPermitidas) => {
        // Mostrar u ocultar cada ítem del menú según las carpetas permitidas
        document.querySelectorAll('[data-folder]').forEach(el => {
            el.style.display = carpetasPermitidas.includes(el.dataset.folder) ? '' : 'none';
        });

        // Verificar si la página actual sigue siendo accesible
        const rutaRel = window.location.pathname.replace(/^\/store/, '') || '/';
        const tieneAcceso = carpetasPermitidas.some(f =>
            f === '/' ? rutaRel === '/' : rutaRel === f || rutaRel.startsWith(f + '/')
        );

        if (!tieneAcceso) {
            if (!carpetasPermitidas.length) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Sin permisos',
                    text: 'Tu acceso ha sido revocado.',
                    confirmButtonColor: '#EC5FA3',
                    allowOutsideClick: false,
                    allowEscapeKey: false
                }).then(() => { window.location.href = '/'; });
                return;
            }
            Swal.fire({
                icon: 'info',
                title: 'Permisos actualizados',
                text: 'Tus permisos cambiaron. Serás redirigido.',
                timer: 2500,
                timerProgressBar: true,
                showConfirmButton: false
            }).then(() => {
                const primero = carpetasPermitidas[0];
                window.location.href = '/store' + (primero === '/' ? '/' : primero + '/');
            });
        } else {
            showToast('Tus permisos han sido actualizados', 'info', 4000);
        }
    };

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

            // Notificación prominente con Swal
            Swal.fire({
                icon:              'info',
                title:             '📦 ¡Nuevo traslado!',
                html:              `Acaban de generarte un traslado <strong>${codigo}</strong>.<br><a href="/store/traslados/get" style="color:#EC5FA3;font-weight:bold;text-decoration:underline;">Ver traslados →</a>`,
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#EC5FA3',
                timer:             15000,
                timerProgressBar:  true,
                position:          'top-end',
                toast:             false
            });

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

        sseSource.addEventListener('new_pedido_web', (e) => {
            const { numeroPedido } = JSON.parse(e.data);

            Swal.fire({
                icon:               'info',
                title:              '🛍️ ¡Nuevo pedido web!',
                html:               `Te asignaron el pedido <strong>${numeroPedido}</strong> para despachar.`,
                confirmButtonText:  'Entendido',
                confirmButtonColor: '#EC5FA3',
                timer:              8000,
                timerProgressBar:   true,
                position:           'top-end',
                toast:              false
            });

            if (typeof window.__recargarPedidosWebPendientes === 'function') window.__recargarPedidosWebPendientes();
        });

        sseSource.addEventListener('traslado_devuelto', (e) => {
            const { codigo } = JSON.parse(e.data);
            mostrarBannerDevuelto(codigo);
        });

        // El administrador resolvió un traslado de efectivo y no entró completo. El
        // operador tiene que enterarse acá y no por teléfono: esa diferencia vuelve a
        // quedar a su cargo y la va a ver como faltante al cuadrar.
        // La caja entró o salió de cuadre. El servidor reparte este evento por punto de
        // venta, así que llega a las terminales de ESTA sede y a ninguna otra. Dentro de
        // la sede sí llega a todas: si avisara solo a la que abrió el cuadre, la
        // registradora de al lado seguiría vendiendo sobre la caja que se está contando.
        sseSource.addEventListener('caja_en_cuadre', (e) => {
            const { enCuadre } = JSON.parse(e.data);
            if (typeof window.__posCajaEnCuadre === 'function') window.__posCajaEnCuadre(enCuadre);
            showToast(enCuadre
                ? 'La caja entró en cierre: las ventas quedan pausadas hasta que termine el cuadre.'
                : 'La caja volvió a estar disponible: ya se puede vender.', enCuadre ? 'warning' : 'success', 8000);
        });

        sseSource.addEventListener('traslado_resuelto', (e) => {
            const d = JSON.parse(e.data);
            pendientesTraslado.push(d);
            pintarAlertaTraslados();
            avisarTrasladoResuelto(d);
        });

        sseSource.addEventListener('new_egreso', (e) => {
            const data = JSON.parse(e.data);
            if (typeof window.onNuevoEgreso === 'function') window.onNuevoEgreso(data);
        });

        sseSource.addEventListener('permissions_update', (e) => {
            const { carpetasPermitidas } = JSON.parse(e.data);
            actualizarMenu(carpetasPermitidas);
        });

        sseSource.onerror = () => {
            setTimeout(conectarSSE, 5000);
        };
    };

    // ─── TRASLADO DE EFECTIVO RESUELTO SIN ENTRAR COMPLETO ───────────────────
    //
    // Solo llega cuando algo no cuadró: un rechazo o una controversia. Una aceptación
    // completa no interrumpe a nadie — que la plata llegue bien es lo esperado.
    //
    // Es una ventana y no un toast a propósito: el toast se va solo en unos segundos y
    // esto cambia el efectivo que el operador va a tener que responder al cerrar. Pide
    // un clic para cerrarse.
    // ── Avisos pendientes y su badge en el menú ──────────────────────────────
    //
    // El SSE solo alcanza a quien está conectado. Estos avisos además viven en la base
    // —`avisoVistoEn` nulo— y se piden al cargar cualquier pantalla, así el operador que
    // no estaba se entera igual al entrar. El badge se apaga cuando los confirma.
    let pendientesTraslado = [];

    const pintarAlertaTraslados = () => {
        const item  = document.getElementById('menu-caja-ventas');
        const badge = document.getElementById('menu-traslado-badge');
        const texto = document.getElementById('menu-traslado-texto');
        if (!item || !badge) return;

        const n = pendientesTraslado.length;
        item.classList.toggle('has-alert', n > 0);
        badge.classList.toggle('hidden', n === 0);
        badge.textContent = n;
        if (texto) {
            // "no cuadró" y no "no entró completo": ahora también entra el caso contrario,
            // el traslado al que le sobró plata.
            texto.textContent = n === 1
                ? '1 traslado no cuadró'
                : `${n} traslados no cuadraron`;
        }
    };

    const marcarAvisoVisto = async (idTraslado) => {
        try {
            await fetch('/store/traslados/avisos/visto', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''
                },
                body: JSON.stringify({ idTraslado })
            });
        } catch (_) { /* si falla, el aviso vuelve a salir la próxima vez: es lo correcto */ }
        pendientesTraslado = pendientesTraslado.filter(a => a.idTraslado !== idTraslado);
        pintarAlertaTraslados();
    };

    // Al entrar: lo que quedó sin ver mientras el navegador estaba cerrado. Se muestra de
    // a uno, en orden, para que ninguno pase desapercibido detrás de otro.
    const cargarAvisosPendientes = async () => {
        try {
            const r = await fetch('/store/traslados/avisos');
            const d = await r.json();
            if (!d.success || !d.avisos.length) return;
            pendientesTraslado = d.avisos;
            pintarAlertaTraslados();
            for (const aviso of d.avisos) await avisarTrasladoResuelto(aviso);
        } catch (_) {}
    };

    const avisarTrasladoResuelto = async (d) => {
        const excedente = Math.round(Number(d.excedente) || 0);

        // El servidor solo emite este evento cuando algo no cuadró, pero el filtro se
        // repite acá: si alguna vez se emitiera también en las aceptaciones completas, el
        // operador vería "Controversia" sobre un traslado que llegó perfecto. Confiar en
        // que el otro lado filtra bien es la clase de suposición que se rompe callada.
        //
        // El excedente es la excepción: ese traslado queda 'Recibido' —lo que se mandó sí
        // llegó completo— y aun así hay que avisar, porque en el fajo se fue plata de la
        // caja menor.
        const corregido = Math.round(Number(d.corregido) || 0);
        if (d.estado !== 'Rechazado' && d.estado !== 'Controversia' && excedente <= 0 && corregido <= 0) return;

        const pesos = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
        const rechazado = d.estado === 'Rechazado';
        const sobro     = excedente > 0;

        // ── Corrección de una consignación ───────────────────────────────────
        // El banco recibió un monto distinto del que se registró al despachar. No es un
        // faltante ni un sobrante: el efectivo salió del cajón y llegó completo, lo que
        // estaba mal era el número. Se avisa porque el egreso del turno cambió con él.
        if (corregido > 0) {
            const dif   = corregido - d.despachado;
            const subio = dif > 0;
            const cuerpoCor = `
                <p class="text-sm text-slate-600 text-left">Registraste <b>${pesos(d.despachado)}</b> y el comprobante de la consignación muestra <b>${pesos(corregido)}</b>.</p>
                <p class="text-sm text-slate-600 text-left mt-2">El administrador corrigió el traslado y su egreso al valor real. ${subio
                    ? `Esos <b>${pesos(dif)}</b> sí salieron del cajón y no estaban registrados.`
                    : `Esos <b>${pesos(-dif)}</b> nunca salieron del cajón y siguen en la tienda.`}</p>
                <p class="text-xs text-slate-500 text-left mt-2">${d.ajusteAplicado === false
                    ? 'La caja de ese turno <b>ya estaba cerrada</b>, así que su cuadre no cambió: hay que ajustarlo a mano.'
                    : 'Con el egreso corregido, el cuadre de ese turno cierra exacto.'}</p>
                ${d.observacion ? `<p class="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-200 text-left"><b>Nota:</b><br>${String(d.observacion).replace(/[<>]/g, '')}</p>` : ''}`;

            if (typeof Swal === 'undefined') {
                showToast(`Traslado ${d.codigo}: se corrigió de ${pesos(d.despachado)} a ${pesos(corregido)} según el comprobante.`, 'warning', 15000);
                return;
            }
            await Swal.fire({
                icon: 'info',
                title: 'Se corrigió una consignación',
                html: `<p class="text-xs font-mono text-slate-400 mb-2">${d.codigo}</p>${cuerpoCor}`,
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#EC5FA3',
                allowOutsideClick: false
            });
            if (d.idTraslado) await marcarAvisoVisto(d.idTraslado);
            return;
        }

        // ── Sobró plata ──────────────────────────────────────────────────────
        // Es un aviso distinto de los otros dos y no una variante: acá al operador no le
        // falta plata que deba responder, le sobró en el fajo. Lo que necesita saber es
        // que su fondo de cambio quedó corto y que esa plata YA está en la cuenta, para
        // que no la vuelva a enviar.
        if (sobro) {
            const cuerpoExc = `
                <p class="text-sm text-slate-600 text-left">Despachaste <b>${pesos(d.despachado)}</b> y al contarlo en destino había <b>${pesos(d.despachado + excedente)}</b>.</p>
                <p class="text-sm text-slate-600 text-left mt-2">Esos <b>${pesos(excedente)}</b> de más ya se descontaron de tu cajón, así que el cuadre te va a cerrar bien. Salen de las ventas en efectivo sin entregar; si no alcanzan, la diferencia la cubre la base y se repone con las próximas ventas.</p>
                <p class="text-xs text-slate-500 text-left mt-2">Ya quedaron registrados en la cuenta destino: <b>no hay que volver a enviarlos</b>.</p>
                ${d.observacion ? `<p class="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-200 text-left"><b>Nota de quien lo revisó:</b><br>${String(d.observacion).replace(/[<>]/g, '')}</p>` : ''}`;

            if (typeof Swal === 'undefined') {
                showToast(`Traslado ${d.codigo}: llegaron ${pesos(excedente)} de más. Salieron de tu caja menor y ya están registrados.`, 'warning', 15000);
                return;
            }

            await Swal.fire({
                icon: 'info',
                title: 'Llegó efectivo de más',
                html: `<p class="text-xs font-mono text-slate-400 mb-2">${d.codigo}</p>${cuerpoExc}`,
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#EC5FA3',
                allowOutsideClick: false
            });
            if (d.idTraslado) await marcarAvisoVisto(d.idTraslado);
            return;
        }

        const detalle = rechazado
            ? `No se recibió nada de los <b>${pesos(d.despachado)}</b> que despachaste.`
            : `De los <b>${pesos(d.despachado)}</b> que despachaste se recibieron <b>${pesos(d.aceptado)}</b>.`;

        // `ajusteAplicado` dice si la caja de ese turno seguía abierta. Si ya había
        // cerrado, su cuadre no se tocó y el faltante no aparece solo: alguien tiene que
        // arreglarlo a mano, y callarlo dejaría un descuadre que nadie sabe explicar.
        const queHacer = d.ajusteAplicado
            ? `Esos <b>${pesos(d.devuelto)}</b> vuelven a quedar a tu cargo y los vas a ver como faltante al cuadrar la caja.`
            : `Esos <b>${pesos(d.devuelto)}</b> vuelven a quedar a tu cargo, pero la caja de ese turno <b>ya estaba cerrada</b>, así que su cuadre no cambió. Hay que ajustarlo a mano.`;

        const motivo = d.observacion
            ? `<p class="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-200 text-left"><b>Nota de quien lo revisó:</b><br>${String(d.observacion).replace(/[<>]/g, '')}</p>`
            : '';

        const cuerpo = `
            <p class="text-sm text-slate-600 text-left">${detalle}</p>
            <p class="text-sm text-slate-600 text-left mt-2">${queHacer}</p>
            <p class="text-xs text-slate-500 text-left mt-2">Si tenés ese efectivo y hay que volver a enviarlo, registrá un traslado nuevo: este ya quedó cerrado.</p>
            ${motivo}`;

        if (typeof Swal === 'undefined') {
            // Sin SweetAlert en esta pantalla, el aviso no se pierde: cae al toast, que
            // vive en este mismo archivo. NO se marca visto — sin confirmación explícita
            // no hay forma de saber que alguien lo leyó, y prefiero repetirlo a perderlo.
            showToast(`Traslado ${d.codigo}: se recibieron ${pesos(d.aceptado)} de ${pesos(d.despachado)}. ${pesos(d.devuelto)} vuelven a tu cargo.`, 'error', 15000);
            return;
        }

        await Swal.fire({
            icon: rechazado ? 'error' : 'warning',
            title: rechazado ? 'Traslado rechazado' : 'Controversia en un traslado',
            html: `<p class="text-xs font-mono text-slate-400 mb-2">${d.codigo}</p>${cuerpo}`,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#EC5FA3',
            allowOutsideClick: false   // que no se cierre de un clic al pasar
        });

        // Recién acá se da por visto: el operador tuvo que apretar el botón. Cerrarlo con
        // Esc o recargar la página lo deja pendiente, y vuelve a salir.
        if (d.idTraslado) await marcarAvisoVisto(d.idTraslado);
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

        // ── Validación live de empleado (solo feedback visual) ───────────────
        // El botón se habilita por longitud del campo; el servidor es quien
        // valida y cuenta los intentos fallidos.
        inputCodigo.addEventListener('input', () => {
            empleadoValido = false;
            clearInfo();
            clearTimeout(debounceTimer);

            const codigo = inputCodigo.value.trim();
            btnAbrir.disabled = codigo.length < 2;

            if (codigo.length < 2) return;

            debounceTimer = setTimeout(async () => {
                try {
                    const r = await fetch(`/store/json/personal/validar/${encodeURIComponent(codigo.toUpperCase())}?accion=CREATE`);
                    const d = await r.json();
                    if (d.success) {
                        setInfo(d.nombre, true);
                        empleadoValido = true;
                    } else {
                        setInfo(d.mensaje || 'No pertenece a esta tienda', false);
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
            if (!codigoEmpleado) {
                setInfo('Ingresa el código de empleado', false);
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
                } else if (d.trasladosPendientes) {
                    // Un renglón rojo no alcanza acá: el operador no puede resolverlo
                    // solo y necesita saber QUÉ está trabado y por cuánto, para poder
                    // llamar a quien tiene que aceptarlo. Sin la lista, lo único que ve
                    // es una tienda que no abre.
                    const pesos = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
                    const filas = (d.traslados || []).map(t => `
                        <div class="flex items-baseline justify-between gap-3 py-1.5 border-b border-amber-100 last:border-0">
                            <div class="text-left min-w-0">
                                <p class="font-mono text-xs font-bold text-amber-800">${t.codigo}</p>
                                <p class="text-[11px] text-amber-700 truncate">a ${t.destino} · ${t.fecha}</p>
                            </div>
                            <span class="font-mono text-xs font-bold text-amber-800 shrink-0">${pesos(t.valor)}</span>
                        </div>`).join('');

                    if (typeof Swal !== 'undefined') {
                        await Swal.fire({
                            icon: 'warning',
                            title: 'Hay efectivo sin aceptar',
                            html: `
                                <p class="text-sm text-slate-600 text-left">${d.mensaje}</p>
                                <div class="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">${filas}</div>
                                <p class="text-sm text-slate-700 text-left mt-3">Total en el aire: <b>${pesos(d.total)}</b></p>
                                <p class="text-xs text-slate-500 text-left mt-2">Pedile al administrador que los acepte o los rechace desde Cajas y bancos. Apenas lo haga, la caja abre normal.</p>`,
                            confirmButtonText: 'Entendido',
                            confirmButtonColor: '#EC5FA3'
                        });
                    } else {
                        setInfo(d.mensaje, false);
                    }
                    btnAbrir.disabled    = false;
                    btnAbrir.textContent = 'Abrir Caja';
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

    // ─── ALERTA DE TRASLADOS PENDIENTES EN SIDEBAR ───────────────────────────
    const fmtTiempo = (segundos) => {
        if (segundos < 60)   return `hace ${segundos}s`;
        if (segundos < 3600) return `hace ${Math.floor(segundos / 60)}min`;
        if (segundos < 86400) {
            const h = Math.floor(segundos / 3600);
            const m = Math.floor((segundos % 3600) / 60);
            return m > 0 ? `hace ${h}h ${m}min` : `hace ${h}h`;
        }
        const d = Math.floor(segundos / 86400);
        const h = Math.floor((segundos % 86400) / 3600);
        return h > 0 ? `hace ${d}d ${h}h` : `hace ${d}d`;
    };

    // Tokens compartidos para niveles que son iguales en ambas perspectivas
    const _nivelBase = {
        naranja: { borde: '#ea580c', fondo: '#fff7ed', fondoIcono: '#ffedd5', texto: '#c2410c', icono: 'fi-rr-triangle-warning',  extra: '' },
        rojo:    { borde: '#dc2626', fondo: '#fef2f2', fondoIcono: '#fee2e2', texto: '#b91c1c', icono: 'fi-rr-alarm-exclamation', extra: 'alerta-pulso' }
    };

    // Estilos indexados por perspectiva → nivel
    const estilosPorPerspectiva = {
        entrante: {
            verde:   { borde: '#16a34a', fondo: '#f0fdf4', fondoIcono: '#dcfce7', texto: '#15803d', icono: 'fi-rr-truck',       extra: '', label: 'Tienes Traslado',         prefijo: 'De'   },
            naranja: { ..._nivelBase.naranja, label: '¡Próximo a vencer!',                                                                                                     prefijo: 'De'   },
            rojo:    { ..._nivelBase.rojo,    label: '¡URGENTE!',                                                                                                              prefijo: 'De'   }
        },
        origen: {
            verde:   { borde: '#0284c7', fondo: '#f0f9ff', fondoIcono: '#e0f2fe', texto: '#0369a1', icono: 'fi-rr-paper-plane', extra: '', label: 'Enviado',                  prefijo: 'Para' },
            naranja: { ..._nivelBase.naranja, label: '¡Sin recibir!',                                                                                                          prefijo: 'Para' },
            rojo:    { ..._nivelBase.rojo,    label: '¡Inventario en riesgo!',                                                                                                 prefijo: 'Para' }
        }
    };

    // Inyecta keyframes CSS una sola vez
    const inyectarCSSpulso = () => {
        if (document.getElementById('css-alerta-pulso')) return;
        const style = document.createElement('style');
        style.id = 'css-alerta-pulso';
        style.textContent = `
            @keyframes alertaPulso {
                0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,.55); }
                55%       { box-shadow: 0 0 0 8px rgba(220,38,38,0); }
            }
            .alerta-pulso { animation: alertaPulso 1.3s ease-in-out infinite; }
        `;
        document.head.appendChild(style);
    };

    // Banner permanente (sin botón de cierre) que avisa al origen sobre reversión inminente
    const actualizarBannerReversion = (trasladosRojoOrigen) => {
        let el = document.getElementById('banner-reversion');

        if (!trasladosRojoOrigen.length) {
            if (el) el.classList.add('hidden');
            return;
        }

        if (!el) {
            el = document.createElement('div');
            el.id = 'banner-reversion';
            el.className = 'fixed top-0 left-0 right-0 z-[60] bg-red-700 text-white text-center py-2 px-4 text-sm font-bold shadow-lg';
            document.body.prepend(el);
        }

        el.classList.remove('hidden');
        const n = trasladosRojoOrigen.length;
        const codigos = trasladosRojoOrigen.map(t => t.codigo).join(', ');
        el.innerHTML = `
            <i class="fi fi-rr-alarm-exclamation mr-2"></i>
            ⚠ ALERTA: El traslado${n > 1 ? 's' : ''} <strong>${codigos}</strong>
            no ha${n > 1 ? 'n' : ''} sido aceptado${n > 1 ? 's' : ''} por el destino —
            si no se recibe${n > 1 ? 'n' : ''} a tiempo, el inventario regresará automáticamente a tu stock.
            <a href="/store/traslados/get" class="ml-3 underline hover:text-red-200">Ver traslados →</a>
        `;
    };

    const renderAlertasTraslado = (traslados) => {
        const cont = document.getElementById('traslado-alerta-container');
        if (!cont) return;

        if (!traslados.length) { cont.innerHTML = ''; return; }

        inyectarCSSpulso();

        cont.innerHTML = traslados.map(t => {
            const mapa = estilosPorPerspectiva[t.esOrigen ? 'origen' : 'entrante'];
            const e = mapa[t.nivel] || mapa.verde;
            return `
                <a href="/store/traslados/get" style="text-decoration:none;display:block;">
                    <div class="${e.extra}" style="
                        border: 2px solid ${e.borde};
                        background: ${e.fondo};
                        border-radius: 14px;
                        padding: 12px 14px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 12px;
                    ">
                        <div style="
                            width: 52px; height: 52px; flex-shrink: 0;
                            border-radius: 50%;
                            background: ${e.fondoIcono};
                            border: 2.5px solid ${e.borde};
                            display: flex; align-items: center; justify-content: center;
                        ">
                            <i class="fi ${e.icono}" style="color:${e.borde};font-size:22px;"></i>
                        </div>
                        <div style="flex:1;min-width:0;">
                            <p style="margin:0 0 2px;font-size:13px;font-weight:800;color:${e.texto};
                                      text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">
                                ${e.label}
                            </p>
                            <p style="margin:0 0 3px;font-size:11px;color:#64748b;font-weight:500;">
                                ${e.prefijo}:
                            </p>
                            <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#1e293b;
                                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                                ${t.contraparte}
                            </p>
                            <p style="margin:0 0 3px;font-size:13px;color:#475569;font-weight:500;">
                                📦 ${t.totalItems} producto${t.totalItems !== 1 ? 's' : ''}
                            </p>
                            <p style="margin:0;font-size:13px;font-weight:600;color:${e.borde};">
                                ⏱ ${fmtTiempo(t.segundosTranscurridos)}
                            </p>
                        </div>
                    </div>
                </a>`;
        }).join('');
    };

    const pollAlertasTraslado = async () => {
        try {
            const r = await fetch('/store/traslados/alerta');
            if (!r.ok) return;
            const d = await r.json();
            if (!d.success) return;
            renderAlertasTraslado(d.traslados);
            // Banner permanente de reversión: solo traslados salientes en zona roja
            const rojoOrigen = d.traslados.filter(t => t.esOrigen && t.nivel === 'rojo');
            actualizarBannerReversion(rojoOrigen);
        } catch (_) {}
    };

    document.addEventListener('DOMContentLoaded', () => {
        conectarSSE();
        initAperturaCaja();
        // Mostrar modal solo si no hay caja de hoy Y no hay cajas anteriores pendientes
        if (window.__SIN_CAJA__ && !window.__CAJAS_PENDIENTES__) {
            window.abrirModalCaja();
        } else if (!window.__SIN_CAJA__) {
            document.getElementById('codigo')?.focus();
        }

        // Alerta de traslados: carga inmediata + polling cada 30 s
        pollAlertasTraslado();
        setInterval(pollAlertasTraslado, 30_000);

        // Avisos de traslados de efectivo que no entraron completos y que el operador
        // todavía no confirmó. No necesitan polling: los que ya existían llegan acá y los
        // nuevos entran por SSE mientras la pantalla esté abierta.
        cargarAvisosPendientes();
    });

})();
