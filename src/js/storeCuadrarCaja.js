(function () {
    // ── Utilidades ───────────────────────────────────────────────────────────
    const fmt   = (n) => '$' + Math.round(n).toLocaleString('es-CO');
    const parse = (s) => parseInt(String(s).replace(/\./g, '').replace(/[^0-9]/g, ''), 10) || 0;

    const formatInput = (inp) => {
        const raw = parse(inp.value);
        inp.value = raw === 0 ? '' : Math.round(raw).toLocaleString('es-CO');
    };

    // Formatea mientras el usuario escribe preservando la posición del cursor
    const formatInputLive = (inp) => {
        const oldVal = inp.value;
        const start  = inp.selectionStart;

        // Contar dígitos antes del cursor en el valor actual
        const digitsAntes = oldVal.slice(0, start).replace(/[^0-9]/g, '').length;

        const raw    = parse(oldVal);
        const newVal = raw === 0 ? '' : Math.round(raw).toLocaleString('es-CO');
        if (newVal === oldVal) return;
        inp.value = newVal;

        // Restaurar cursor: avanzar hasta haber contado los mismos dígitos
        let cnt = 0, newPos = newVal.length;
        for (let i = 0; i < newVal.length; i++) {
            if (/\d/.test(newVal[i])) cnt++;
            if (cnt === digitsAntes) { newPos = i + 1; break; }
        }
        if (digitsAntes === 0) newPos = 0;
        inp.setSelectionRange(newPos, newPos);
    };

    // ── Estado ───────────────────────────────────────────────────────────────
    let dataSistema  = null;
    let empleadoId   = null;
    let empleadoNombre = null;

    // ── Referencias DOM ──────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);

    const sVentas   = $('cc-s-ventas');
    // Un egreso por transferencia no mueve el cajón: se distingue a simple vista.
    const etiquetaMedio = (e) => e.metodoPago === 'Electronico'
        ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 whitespace-nowrap">${e.entidad || 'Transferencia'}</span>`
        : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 whitespace-nowrap">Cajón</span>`;

    const sBase     = $('cc-s-base');
    const sEgresos  = $('cc-s-egresos');
    const sEfectivo = $('cc-s-efectivo');
    const sMedios   = $('cc-s-medios');
    const sCredito  = $('cc-s-credito');

    // Tarjetas de cifra de la fila superior. "Total a entregar" y "Total egresos"
    // también viven en la columna izquierda: son el mismo dato en dos lugares, así que
    // se escriben juntos y nunca desde sitios distintos del archivo.
    const kEntregar   = $('cc-k-entregar');
    const kEgresos    = $('cc-k-egresos');
    const kDiferencia = $('cc-k-diferencia');
    const kDifDetalle = $('cc-k-diferencia-detalle');
    const kCardDif    = kDiferencia?.closest('.cc-kpi');

    const oBase     = $('cc-o-base');
    const oEgresos  = $('cc-o-egresos');
    const oEfectivo = $('cc-o-efectivo');
    const oMedios   = $('cc-o-medios');
    const oCredito  = $('cc-o-credito');

    const codEmpleado    = $('cc-codigo-empleado');
    const btnCerrar      = $('cc-btn-cerrar');
    const empleadoInfo   = $('cc-empleado-info');
    const nota           = $('cc-nota');
    const cardDescuadre  = $('cc-card-descuadre');
    const checkDescuadre = $('cc-check-descuadre');

    // ── Acordeones ───────────────────────────────────────────────────────────
    // El estado se aplica en un solo lugar (`setAcordeon`) para que abrir desde el
    // renglón y abrir desde "Ver detalle" no puedan dejar el panel abierto con el
    // chevron apuntando hacia arriba.
    const setAcordeon = (panelId, iconId, abrir) => {
        const panel = $(panelId);
        const icon  = $(iconId);
        if (!panel) return;
        panel.classList.toggle('hidden', !abrir);
        if (icon) icon.style.transform = abrir ? 'rotate(180deg)' : '';
    };

    const initAcordeon = (btnId, panelId, iconId) => {
        const btn   = $(btnId);
        const panel = $(panelId);
        if (!btn || !panel) return;
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', panelId);
        btn.addEventListener('click', () => {
            const abrir = panel.classList.contains('hidden');
            setAcordeon(panelId, iconId, abrir);
            btn.setAttribute('aria-expanded', String(abrir));
        });
    };
    initAcordeon('cc-toggle-egresos',  'cc-acordeon-egresos',  'cc-icon-egresos');
    initAcordeon('cc-toggle-efectivo', 'cc-acordeon-efectivo', 'cc-icon-efectivo');
    initAcordeon('cc-toggle-medios',   'cc-acordeon-medios',   'cc-icon-medios');
    initAcordeon('cc-toggle-credito',  'cc-acordeon-credito',  'cc-icon-credito');

    // "Ver detalle" de la tarjeta de egresos: no duplica la lista, lleva a la única
    // que hay. Si ya está abierta igual hace scroll, que es lo que el operador pidió.
    $('cc-k-ver-egresos')?.addEventListener('click', () => {
        setAcordeon('cc-acordeon-egresos', 'cc-icon-egresos', true);
        $('cc-toggle-egresos')?.setAttribute('aria-expanded', 'true');
        $('cc-toggle-egresos')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // ── Fila de acordeón ────────────────────────────────────────────────────
    const buildRow = (tx) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 hover:bg-slate-50';
        tr.innerHTML = `
            <td class="py-1.5 px-2">
                <button class="text-pink-500 underline text-xs hover:text-pink-700 font-medium"
                    onclick="window.open('/store/facturas/${tx.idFacturaCliente}/tirilla','_blank')">
                    ${tx.nroFactura}
                </button>
            </td>
            <td class="py-1.5 px-2 text-slate-600 text-xs">${tx.entidad}</td>
            <td class="py-1.5 px-2 text-slate-500 text-xs">${tx.referencia}</td>
            <td class="py-1.5 px-2 text-right font-mono text-xs font-semibold text-slate-700">${fmt(tx.valor)}</td>`;
        return tr;
    };

    // ── Cifras del sistema ────────────────────────────────────────────────────
    // Un solo sitio que escribe todas: varias aparecen dos veces en pantalla (egresos
    // y total a entregar viven en una tarjeta y en un renglón), y actualizarlas por
    // separado era lo que las dejaba diciendo cosas distintas después de registrar un
    // egreso olvidado.
    const pintarTotales = () => {
        if (!dataSistema) return;
        const { totales: t, caja } = dataSistema;

        sVentas.textContent   = fmt(t.ventas);
        sBase.textContent     = fmt(caja.cajaMenor);
        sEgresos.textContent  = `-${fmt(t.egresos)}`;
        sEfectivo.textContent = fmt(t.efectivo);
        sMedios.textContent   = fmt(t.mediosElectronicos);
        sCredito.textContent  = fmt(t.credito);

        if (kEgresos) kEgresos.textContent = fmt(t.egresos);

        // Efectivo que debería estar en el cajón. Antes esta cuenta la hacía el
        // vendedor de cabeza; ahora sale del backend con el mismo criterio.
        const elEsp = $('cc-s-esperado');
        if (elEsp) {
            elEsp.textContent = fmt(t.efectivoEsperado);
            $('cc-s-esperado-detalle').textContent =
                `Base ${fmt(caja.cajaMenor)} + ventas ${fmt(t.efectivo)} − egresos ${fmt(t.egresosEfectivo)}`;
        }

        // Lo que se entrega al cerrar: lo del cajón menos la base, que se queda para
        // que el turno siguiente pueda dar cambio. El detalle nombra esa resta en vez
        // de repetir la fórmula larga, para que se lea la relación entre las dos.
        const elEnt = $('cc-s-entregar');
        if (elEnt) {
            elEnt.textContent = fmt(t.totalAEntregar);
            // Cuando del cajón salió más efectivo del que entró por ventas no hay nada
            // que entregar, y lo que falta es de la base. Decirlo en el renglón del
            // detalle —donde ya se explica la resta— evita imprimir un negativo que se
            // leería como un monto a cobrar.
            $('cc-s-entregar-detalle').textContent = t.baseCorta > 0
                ? `La base quedó corta en ${fmt(t.baseCorta)}: salió más efectivo del que entró por ventas. Se repone con las próximas ventas en efectivo.`
                : `Cajón ${fmt(t.efectivoEsperado)} − base ${fmt(caja.cajaMenor)}, que queda para el próximo turno`;
            $('cc-s-entregar-detalle').classList.toggle('font-semibold', t.baseCorta > 0);
        }
        if (kEntregar) kEntregar.textContent = fmt(t.totalAEntregar);
    };

    // Desglose del panel de egresos. Sale a función propia porque también hay que
    // repintarlo al registrar un egreso olvidado: si solo se actualizaba el total, el
    // desglose de abajo seguía contando la plata vieja.
    const pintarDesgloseEgresos = () => {
        if (!dataSistema) return;
        const { totales: t, txEgresos } = dataSistema;

        // Gastos y traslados, por separado. El total combinado sigue en el renglón
        // porque es contra ese número que el operador escribe su conteo; acá se abre en
        // sus dos partes, que significan cosas distintas.
        const totalesEgr = $('cc-egresos-totales');
        if (totalesEgr && txEgresos && txEgresos.length) {
            const traslados = txEgresos
                .filter(e => e.tipo === 'Traslado')
                .reduce((a, e) => a + e.valor, 0);
            // Por resta y no filtrando: así los dos números siempre suman el total que
            // muestra el renglón, aunque algún registro viejo traiga un tipo raro.
            $('cc-total-gastos').textContent    = fmt(t.egresos - traslados);
            $('cc-total-traslados').textContent = fmt(traslados);
            totalesEgr.classList.remove('hidden');
        }

        // Lo que salió del cajón y todavía nadie aceptó. Va como número y no solo como
        // marcas en las filas: con la lista plegada —que es como está casi siempre— las
        // marcas no se ven, y este es justo el dato que el operador necesita antes de
        // firmar el cuadre.
        const avisoPend = $('cc-egresos-pendiente');
        if (avisoPend && txEgresos) {
            const pendientes = txEgresos.filter(e => e.estadoTraslado === 'En Transito');
            const montoPend  = pendientes.reduce((a, e) => a + e.valor, 0);
            if (pendientes.length) {
                avisoPend.innerHTML = `<i class="fi fi-rr-hourglass-end mt-px"></i><span>${
                    pendientes.length === 1
                        ? `Un traslado de <b>${fmt(montoPend)}</b> todavía no fue aceptado`
                        : `${pendientes.length} traslados por <b>${fmt(montoPend)}</b> todavía no fueron aceptados`
                }. Si el administrador rechaza o recibe menos, la diferencia vuelve a tu cuadre.</span>`;
                avisoPend.classList.remove('hidden');
            } else {
                avisoPend.classList.add('hidden');
            }
        }

        // El desglose deja claro cuánto de los egresos salió del cajón y cuánto no.
        const desglose = $('cc-egresos-desglose');
        if (desglose && t.egresos > 0) {
            desglose.textContent = t.egresosElectronicos > 0
                ? `Del cajón salieron ${fmt(t.egresosEfectivo)}; ${fmt(t.egresosElectronicos)} se pagaron por transferencia y no afectan el efectivo.`
                : `Todos los egresos salieron del cajón.`;
            desglose.classList.remove('hidden');
        }
    };

    // ── Fila de egreso ──────────────────────────────────────────────────────
    const FILA_SIN_EGRESOS = '<tr><td colspan="4" class="py-2 px-2 text-xs text-slate-400 text-center">Sin egresos</td></tr>';

    const buildRowEgreso = (e) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100';
        // El distintivo va junto a la referencia y no en una columna propia: el panel es
        // angosto y una quinta columna aprieta las cuatro que ya están. Es el mismo chip
        // del listado de egresos, así el operador no aprende dos vocabularios para la
        // misma distinción.
        const chipTipo = e.tipo === 'Traslado'
            ? '<span class="egr-tipo egr-tipo--traslado">Traslado</span>'
            : '<span class="egr-tipo egr-tipo--egreso">Egreso</span>';

        // Traslado despachado que nadie aceptó todavía. Es lo único de esta tabla que el
        // operador no puede dar por cerrado: esa plata ya salió del cajón, pero el
        // administrador todavía puede rechazarla o recibirla incompleta, y si eso pasa el
        // faltante vuelve a este turno. Se avisa ANTES de que firme el cuadre, no después.
        const chipPendiente = e.estadoTraslado === 'En Transito'
            ? '<span class="egr-pendiente" title="Ya salió del cajón, pero el administrador todavía no lo acepta. Si lo rechaza o recibe menos, la diferencia vuelve a tu cuadre."><i class="fi fi-rr-hourglass-end"></i>Sin aceptar</span>'
            : '';

        tr.innerHTML = `
            <td class="py-1.5 px-2 text-xs">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <a href="/store/storebehivors/expenses/${e.idEgreso}/pdf" target="_blank"
                       class="text-pink-500 underline hover:text-pink-700 font-medium">${e.referencia}</a>
                    ${chipTipo}
                    ${chipPendiente}
                </div>
            </td>
            <td class="py-1.5 px-2 text-slate-500 text-xs">${e.descripcion}</td>
            <td class="py-1.5 px-2 text-center">${etiquetaMedio(e)}</td>
            <td class="py-1.5 px-2 text-right font-mono text-xs font-semibold text-rose-600">${fmt(e.valor)}</td>`;
        return tr;
    };

    // ── MODO DE TRABAJO ──────────────────────────────────────────────────────
    //
    // Entrar a esta pantalla no significa lo mismo que ir a cerrar la caja. El operador
    // puede venir solo a mirar cómo va el turno, y ahí bloquear el POS de toda la tienda
    // sería absurdo. Por eso se pregunta primero.
    //
    // Si viene a cerrar de verdad, la caja pasa a 'auditoria' y el POS deja de facturar:
    // sin eso, una venta que entra mientras cuenta queda en los totales del cierre pero
    // no en lo que él contó, y el descuadre se le anota a él aunque la plata esté ahí.
    const CSRF = () => document.querySelector('meta[name="csrf-token"]')?.content || '';

    const post = (url) => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF() }
    }).then(r => r.json()).catch(() => ({ success: false }));

    const cristalHTML = (titulo, texto, accion) => `
        <div class="bloqueo-cristal">
            <img src="/img/avatars/seguro.webp" alt="" class="bloqueo-icono">
            <p class="bloqueo-titulo">${titulo}</p>
            <p class="bloqueo-texto">${texto}</p>
            ${accion ? `<button type="button" id="cc-btn-desbloquear" class="bloqueo-accion">${accion}</button>` : ''}
        </div>`;

    const bloquearConteo = () => {
        const tarjeta = $('cc-tarjeta-operador');
        if (!tarjeta || tarjeta.querySelector('.bloqueo-cristal')) return;
        tarjeta.insertAdjacentHTML('beforeend', cristalHTML(
            'Solo estás revisando',
            'Entraste a mirar cómo va el turno, así que el conteo está bloqueado y la tienda sigue vendiendo. Para cerrar la caja hay que pausar las ventas.',
            'Cuadrar caja ahora'
        ));
        $('cc-btn-desbloquear')?.addEventListener('click', async () => {
            const d = await post('/store/storebehivors/caja/cuadre/iniciar');
            if (!d.success) {
                return Swal.fire({ icon: 'error', title: 'No se pudo iniciar el cuadre',
                    text: d.mensaje || 'Intentá de nuevo.', confirmButtonColor: '#EC5FA3' });
            }
            tarjeta.querySelector('.bloqueo-cristal')?.remove();
            soltarAlSalir();
            // Los totales pudieron moverse mientras miraba: se recargan antes de contar.
            cargarDatos();
        });
    };

    // Al cerrar la pestaña sin terminar, la caja vuelve a 'abierto' sola. Sin esto, un
    // operador que se va deja a toda la tienda sin poder facturar.
    //
    // Ese aviso es la vía rápida, no la garantía: si el equipo se apaga o se cae la red
    // nunca sale. Por eso además se manda un latido mientras esta pantalla vive, y el
    // servidor caduca el candado cuando el latido se detiene.
    const LATIDO_MS = 5 * 60 * 1000;   // holgado frente a los 30 min de expiración
    let latido = null;

    const soltarAlSalir = () => {
        if (!latido) {
            latido = setInterval(() => {
                // `iniciar` sobre una caja que ya está en cuadre solo corre la marca hacia
                // adelante: no hace falta un endpoint aparte para decir "sigo acá".
                //
                // Con la pestaña en segundo plano el navegador estira los timers, así que
                // el latido puede llegar tarde. Cinco minutos contra treinta deja margen
                // de sobra incluso así.
                post('/store/storebehivors/caja/cuadre/iniciar').catch(() => {});
            }, LATIDO_MS);
        }

        window.addEventListener('pagehide', () => {
            clearInterval(latido);
            const url = '/store/storebehivors/caja/cuadre/liberar';
            // sendBeacon sobrevive a la descarga de la página; un fetch normal se cancela.
            if (navigator.sendBeacon) {
                navigator.sendBeacon(url, new Blob([JSON.stringify({ _csrf: CSRF() })],
                    { type: 'application/json' }));
            }
        }, { once: true });
    };

    const preguntarModo = async () => {
        const { isConfirmed, isDenied } = await Swal.fire({
            imageUrl: '/img/avatars/seguro.webp',
            imageWidth: 96,
            title: '¿Qué vas a hacer?',
            html: `<p class="text-sm text-slate-600">Cerrar la caja <b>pausa las ventas</b> de toda la tienda mientras contás el cajón. Si solo venís a mirar, no hace falta.</p>`,
            showConfirmButton: true,
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: 'Cuadrar caja finalmente',
            denyButtonText: 'Solo revisar',
            cancelButtonText: 'Volver',
            confirmButtonColor: '#047857',
            denyButtonColor: '#6366F1',
            cancelButtonColor: '#94A3B8',
            reverseButtons: true,
            allowOutsideClick: false,
            allowEscapeKey: false
        });

        if (isConfirmed) {
            const d = await post('/store/storebehivors/caja/cuadre/iniciar');
            if (!d.success) {
                await Swal.fire({ icon: 'error', title: 'No se pudo iniciar el cuadre',
                    text: d.mensaje || 'Intentá de nuevo.', confirmButtonColor: '#EC5FA3' });
                return bloquearConteo();
            }
            soltarAlSalir();
            return;
        }

        if (isDenied) return bloquearConteo();

        // "Volver": no se tocó nada, así que la tienda sigue vendiendo.
        window.location.href = '/store/';
    };

    // ── Cargar datos del sistema ──────────────────────────────────────────────
    const cargarDatos = async () => {
        try {
            const r = await fetch('/store/storebehivors/caja/datos');
            const d = await r.json();
            if (!d.success) {
                $('cc-apertura-info').textContent = d.mensaje || 'No hay caja abierta.';
                return;
            }
            dataSistema = d;

            // Header info
            $('cc-apertura-info').textContent =
                `Abierta por: ${d.caja.empleadoApertura} • Base: ${fmt(d.caja.cajaMenor)}`;

            pintarTotales();

            // Default operador
            oBase.value = Math.round(d.caja.cajaMenor).toLocaleString('es-CO');

            // Acordeón — egresos
            const tbodyE = $('cc-tbody-egresos');
            if (!d.txEgresos || d.txEgresos.length === 0) {
                tbodyE.innerHTML = FILA_SIN_EGRESOS;
            } else {
                d.txEgresos.forEach(e => tbodyE.appendChild(buildRowEgreso(e)));
            }

            pintarDesgloseEgresos();

            // Acordeón — efectivo
            const tbodyEf = $('cc-tbody-efectivo');
            if (d.txEfectivo.length === 0) {
                tbodyEf.innerHTML = '<tr><td colspan="4" class="py-2 px-2 text-xs text-slate-400 text-center">Sin transacciones</td></tr>';
            } else {
                d.txEfectivo.forEach(tx => tbodyEf.appendChild(buildRow(tx)));
            }

            // Acordeón — medios
            const tbodyM = $('cc-tbody-medios');
            if (d.txElectronicos.length === 0) {
                tbodyM.innerHTML = '<tr><td colspan="4" class="py-2 px-2 text-xs text-slate-400 text-center">Sin transacciones</td></tr>';
            } else {
                d.txElectronicos.forEach(tx => tbodyM.appendChild(buildRow(tx)));
            }

            // Acordeón — crédito
            const tbodyC = $('cc-tbody-credito');
            if (d.txCredito.length === 0) {
                tbodyC.innerHTML = '<tr><td colspan="4" class="py-2 px-2 text-xs text-slate-400 text-center">Sin transacciones</td></tr>';
            } else {
                d.txCredito.forEach(tx => tbodyC.appendChild(buildRow(tx)));
            }

            comparar();
        } catch (_) {
            $('cc-apertura-info').textContent = 'Error al cargar datos.';
        }
    };

    // ── Formateo y comparación en tiempo real ─────────────────────────────────
    const ALERT_CLASS   = 'border-red-400 bg-red-50 text-red-700 focus:ring-red-300/40';
    const NORMAL_CLASS  = 'border-slate-200 bg-white text-slate-800 focus:ring-pink-300/40';

    const comparar = () => {
        if (!dataSistema) return;
        const pares = [
            { inp: oBase,     sys: dataSistema.caja.cajaMenor },
            { inp: oEgresos,  sys: dataSistema.totales.egresos },
            { inp: oEfectivo, sys: dataSistema.totales.efectivo },
            { inp: oMedios,   sys: dataSistema.totales.mediosElectronicos },
            { inp: oCredito,  sys: dataSistema.totales.credito },
        ];
        let hayDescuadre = false;
        // Suma con signo, no de valores absolutos: si al operador le sobran $5.000 en el
        // cajón y le faltan $5.000 en electrónicos, lo que hay es un pago mal clasificado,
        // no un faltante de $10.000. El conteo de conceptos aparte dice cuántas casillas
        // hay que revisar.
        let saldoDif = 0;
        let conDif   = 0;
        for (const { inp, sys } of pares) {
            const val    = parse(inp.value);
            const vacio  = inp.value.trim() === '';
            const diff   = !vacio && Math.abs(val - sys) > 0.5;
            if (diff) { hayDescuadre = true; conDif++; saldoDif += val - sys; }
            inp.classList.remove(...ALERT_CLASS.split(' '), ...NORMAL_CLASS.split(' '));
            inp.classList.add(...(diff ? ALERT_CLASS : NORMAL_CLASS).split(' '));
        }
        pintarDiferencia(saldoDif, conDif);
        toggleDescuadre(hayDescuadre);
    };

    // Tarjeta "Diferencia". El signo importa y se escribe explícito: "+" es plata de más
    // en el conteo del operador, "−" es faltante. Sin el signo el operador no sabe si
    // tiene que buscar dinero o explicar un sobrante.
    const pintarDiferencia = (saldo, conceptos) => {
        if (!kDiferencia) return;
        const redondeado = Math.round(saldo);
        const signo = redondeado > 0 ? '+' : redondeado < 0 ? '−' : '';
        kDiferencia.textContent = signo + fmt(Math.abs(redondeado));
        if (kDifDetalle) {
            kDifDetalle.textContent = conceptos === 0
                ? 'Sin diferencias'
                : conceptos === 1
                    ? '1 concepto con diferencia'
                    : `${conceptos} conceptos con diferencia`;
        }
        kCardDif?.classList.toggle('is-descuadre', conceptos > 0);
    };

    // ── Checkbox de responsabilidad por descuadre ─────────────────────────────
    const toggleDescuadre = (hayDescuadre) => {
        if (!cardDescuadre) return;
        cardDescuadre.classList.toggle('hidden', !hayDescuadre);
        cardDescuadre.classList.toggle('flex',   hayDescuadre);
        if (!hayDescuadre) checkDescuadre.checked = false;
        actualizarBotonCerrar();
    };

    // Inputs: formateo en tiempo real + comparación
    [oBase, oEgresos, oEfectivo, oMedios, oCredito].forEach(inp => {
        inp.addEventListener('keydown', (e) => {
            const ok = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Enter','Home','End'];
            if (!ok.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault();
        });
        inp.addEventListener('input', () => { formatInputLive(inp); comparar(); });
        inp.addEventListener('blur',  () => { formatInput(inp);     comparar(); });
    });

    // ── Validar empleado ──────────────────────────────────────────────────────
    const setEmpInfo = (txt, ok) => {
        empleadoInfo.textContent = txt;
        empleadoInfo.className = ok
            ? 'text-xs mt-1.5 h-4 text-green-600 font-medium'
            : 'text-xs mt-1.5 h-4 text-red-500';
    };

    let validarTimer = null;
    let empleadoOk    = false;

    // Habilita "Cerrar caja" solo si el empleado quedó validado y, en caso de
    // descuadre, el responsable marcó la casilla de aceptación.
    const actualizarBotonCerrar = () => {
        const descuadreOk = !cardDescuadre || cardDescuadre.classList.contains('hidden') || checkDescuadre.checked;
        btnCerrar.disabled = !empleadoOk || !descuadreOk;
    };

    checkDescuadre?.addEventListener('change', actualizarBotonCerrar);

    const validarEmpleado = async () => {
        const codigo = codEmpleado.value.trim().toUpperCase();
        if (!codigo) { setEmpInfo('', false); return; }
        setEmpInfo('Verificando...', false);
        try {
            const r = await fetch(`/store/json/personal/validar/${encodeURIComponent(codigo)}?accion=EDIT`);
            const d = await r.json();
            if (d.success) {
                empleadoId     = d.idEmpleado;
                empleadoNombre = d.nombre;
                setEmpInfo(d.nombre, true);
                empleadoOk = true;
            } else {
                empleadoId = null;
                setEmpInfo(d.mensaje || 'No pertenece a esta tienda', false);
                empleadoOk = false;
            }
        } catch (_) {
            setEmpInfo('Error al verificar', false);
            empleadoOk = false;
        }
        actualizarBotonCerrar();
    };

    codEmpleado.addEventListener('input', () => {
        empleadoId = null;
        clearTimeout(validarTimer);
        const codigo = codEmpleado.value.trim();
        // Se habilita de forma optimista por longitud; la validación asíncrona
        // (debounce) confirma o revoca el acceso al terminar.
        empleadoOk = codigo.length >= 2;
        actualizarBotonCerrar();
        if (codigo.length >= 2) {
            setEmpInfo('Verificando...', false);
            validarTimer = setTimeout(validarEmpleado, 600);
        } else {
            setEmpInfo('', false);
        }
    });

    codEmpleado.addEventListener('blur', () => {
        clearTimeout(validarTimer);
        if (codEmpleado.value.trim()) validarEmpleado();
    });

    // ── Cerrar caja ───────────────────────────────────────────────────────────
    btnCerrar.addEventListener('click', async () => {
        if (!dataSistema) return;
        if (!codEmpleado.value.trim()) { setEmpInfo('Ingresa el código de empleado', false); return; }
        if (cardDescuadre && !cardDescuadre.classList.contains('hidden') && !checkDescuadre.checked) {
            Swal.fire({
                icon: 'warning',
                title: 'Confirma el descuadre',
                text: 'Debes marcar la casilla de responsabilidad antes de cerrar la caja.',
                confirmButtonColor: '#EC5FA3'
            });
            return;
        }

        const oE  = parse(oEgresos.value);
        const oEf = parse(oEfectivo.value);
        const oM  = parse(oMedios.value);
        const oCr = parse(oCredito.value);
        const oB  = parse(oBase.value);

        const swalResult = await Swal.fire({
            icon: 'question',
            title: '¿Cerrar esta caja?',
            html: `
                <div style="text-align:left;font-size:13px;line-height:1.8">
                    <strong>Estás seguro de cerrar esta caja con los siguientes valores:</strong><br><br>
                    <table style="width:100%;border-collapse:collapse">
                        <tr style="border-bottom:1px solid #eee">
                            <td style="padding:2px 6px;color:#888">Concepto</td>
                            <td style="padding:2px 6px;text-align:right;color:#888">Sistema</td>
                            <td style="padding:2px 6px;text-align:right;color:#888">Registrado</td>
                        </tr>
                        ${buildConfirmRow('Egresos', dataSistema.totales.egresos, oE)}
                        ${buildConfirmRow('Efectivo', dataSistema.totales.efectivo, oEf)}
                        ${buildConfirmRow('Medios Elect.', dataSistema.totales.mediosElectronicos, oM)}
                        ${buildConfirmRow('Crédito', dataSistema.totales.credito, oCr)}
                        ${buildConfirmRow('Base', dataSistema.caja.cajaMenor, oB)}
                    </table>
                    <br><em style="font-size:11px;color:#999">Vendedor: ${empleadoNombre || codEmpleado.value.trim().toUpperCase()}</em>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Sí, cerrar caja',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#EC5FA3',
            cancelButtonColor: '#94a3b8',
            width: '480px'
        });

        if (!swalResult.isConfirmed) return;

        btnCerrar.disabled = true;
        btnCerrar.querySelector('span').textContent = 'Cerrando...';

        // Abrir ventana ANTES del await para evitar el popup-blocker
        const pdfWin = window.open('about:blank', '_blank');

        const csrf = document.getElementById('csrf-token')?.value || '';
        try {
            const r = await fetch('/store/storebehivors/caja/cerrar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({
                    idCajaTienda:         dataSistema.caja.idCajaTienda,
                    codigoEmpleado:       codEmpleado.value.trim().toUpperCase(),
                    operadorEgresos:      oE,
                    operadorEfectivo:     oEf,
                    operadorElectronicos: oM,
                    operadorCredito:      oCr,
                    operadorBase:         oB,
                    nota:                 nota.value.trim() || null
                })
            });

            const d = await r.json().catch(() => ({}));

            if (r.status === 403) {
                pdfWin.close();
                Swal.fire({
                    icon: 'warning',
                    title: 'Sin permiso',
                    text: d.mensaje || 'No tienes permiso para cerrar la caja.',
                    confirmButtonColor: '#EC5FA3'
                });
                btnCerrar.disabled = false;
                btnCerrar.querySelector('span').textContent = 'Cerrar e imprimir cuadre de caja';
                return;
            }

            if (!r.ok || !d.success) {
                pdfWin.close();
                Swal.fire({ icon: 'error', title: 'Error', text: d.mensaje || 'Error al cerrar caja.', confirmButtonColor: '#EC5FA3' });
                btnCerrar.disabled = false;
                btnCerrar.querySelector('span').textContent = 'Cerrar e imprimir cuadre de caja';
                return;
            }

            // Navegar la ventana ya abierta al PDF (GET — sin bloqueo de popup)
            pdfWin.location.href = `/store/storebehivors/caja/${d.idCajaTienda}/pdf`;
            window.location.href = '/store';
        } catch (_) {
            pdfWin.close();
            Swal.fire({ icon: 'error', title: 'Error de conexión', confirmButtonColor: '#EC5FA3' });
            btnCerrar.disabled = false;
            btnCerrar.querySelector('span').textContent = 'Cerrar e imprimir cuadre de caja';
        }
    });

    // ── Helper fila tabla confirmación ────────────────────────────────────────
    function buildConfirmRow(label, sys, op) {
        const diff = Math.abs(sys - op) > 0.5;
        const color = diff ? 'color:#ef4444;font-weight:bold' : 'color:#334155';
        const icon  = diff ? ' ✗' : '';
        return `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:3px 6px;${color}">${label}${icon}</td>
            <td style="padding:3px 6px;text-align:right">${fmt(sys)}</td>
            <td style="padding:3px 6px;text-align:right;${color}">${fmt(op)}</td>
        </tr>`;
    }

    // ── Modal: egreso olvidado ────────────────────────────────────────────────
    const abrirModalEgreso = async () => {
        const { value: resultado, isConfirmed } = await Swal.fire({
            title: 'Registrar Egreso Olvidado',
            html: `
                <div style="text-align:left;display:flex;flex-direction:column;gap:12px">
                    <div>
                        <label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Valor *</label>
                        <div style="position:relative;margin-top:4px">
                            <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;font-weight:bold;pointer-events:none">$</span>
                            <input id="me-valor" type="text" inputmode="numeric" placeholder="0"
                                style="width:100%;padding:8px 12px 8px 24px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:monospace;box-sizing:border-box">
                        </div>
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Referencia</label>
                        <input id="me-referencia" type="text" maxlength="100" placeholder="Ej: EG-001"
                            style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;margin-top:4px;box-sizing:border-box">
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Descripción</label>
                        <input id="me-descripcion" type="text" maxlength="200" placeholder="Motivo del egreso"
                            style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;margin-top:4px;box-sizing:border-box">
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Código del vendedor *</label>
                        <input id="me-codigo" type="password" maxlength="10" placeholder="• • • • • •"
                            style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:monospace;letter-spacing:.15em;margin-top:4px;box-sizing:border-box">
                    </div>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Registrar egreso',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#EC5FA3',
            cancelButtonColor: '#94a3b8',
            width: '420px',
            didOpen: () => {
                const inp = document.getElementById('me-valor');
                inp.addEventListener('keydown', (e) => {
                    const ok = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Enter','Home','End'];
                    if (!ok.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault();
                });
                inp.addEventListener('input', () => formatInputLive(inp));
                inp.addEventListener('blur',  () => formatInput(inp));
                inp.focus();
            },
            preConfirm: async () => {
                const valor      = parse(document.getElementById('me-valor').value);
                const referencia = document.getElementById('me-referencia').value.trim();
                const descripcion = document.getElementById('me-descripcion').value.trim();
                const codigo     = document.getElementById('me-codigo').value.trim().toUpperCase();

                if (!valor || valor <= 0) { Swal.showValidationMessage('Ingresa un valor mayor a 0'); return false; }
                if (!codigo)              { Swal.showValidationMessage('Ingresa el código del vendedor'); return false; }

                const csrf = document.getElementById('csrf-token')?.value || '';
                const r = await fetch('/store/storebehivors/expenses/crear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                    body: JSON.stringify({ valorEgreso: valor, referencia, descripcion, codigoEmpleado: codigo })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || !d.success) { Swal.showValidationMessage(d.mensaje || 'Error al registrar el egreso'); return false; }
                return { valor, referencia, descripcion, idEgreso: d.idEgreso, nombreEmpleado: d.nombreEmpleado };
            }
        });

        if (!isConfirmed || !resultado) return;

        // Actualizar totales en caliente. El modal no manda `metodoPago`, así que el
        // backend lo registra como efectivo: sale del cajón y baja el efectivo esperado
        // y el total a entregar. Sin esto las tarjetas de arriba seguían mostrando la
        // plata que ya no está.
        const t = dataSistema.totales;
        t.egresos          = (t.egresos || 0) + resultado.valor;
        t.egresosEfectivo  = (t.egresosEfectivo || 0) + resultado.valor;
        t.efectivoEsperado = (t.efectivoEsperado || 0) - resultado.valor;
        // El egreso recién registrado puede llevar el neto por debajo de cero: ahí no se
        // entrega nada y el faltante pasa a la base, igual que en el cálculo del servidor.
        const netoTrasEgreso = (t.totalAEntregar || 0) - (t.baseCorta || 0) - resultado.valor;
        t.totalAEntregar   = Math.max(0, netoTrasEgreso);
        t.baseCorta        = Math.max(0, -netoTrasEgreso);

        const nuevoEgreso = {
            idEgreso:    resultado.idEgreso,
            referencia:  resultado.referencia || `EG-${resultado.idEgreso}`,
            descripcion: resultado.descripcion || '—',
            valor:       resultado.valor,
            tipo:        'Egreso',
            metodoPago:  'Efectivo',
            entidad:     null
        };
        dataSistema.txEgresos = [nuevoEgreso, ...(dataSistema.txEgresos || [])];

        pintarTotales();
        pintarDesgloseEgresos();

        // Agregar la fila al panel (quita el "Sin egresos" si estaba) y dejarlo abierto:
        // el operador acaba de registrar algo y tiene que poder verificarlo.
        const tbodyE = $('cc-tbody-egresos');
        const placeholder = tbodyE.querySelector('td[colspan]');
        if (placeholder) placeholder.closest('tr').remove();
        tbodyE.insertBefore(buildRowEgreso(nuevoEgreso), tbodyE.firstChild);
        setAcordeon('cc-acordeon-egresos', 'cc-icon-egresos', true);
        $('cc-toggle-egresos')?.setAttribute('aria-expanded', 'true');

        comparar();

        Swal.fire({
            icon: 'success',
            title: 'Egreso registrado',
            text: `Se registró ${fmt(resultado.valor)}${resultado.nombreEmpleado ? ` — ${resultado.nombreEmpleado}` : ''}.`,
            confirmButtonColor: '#EC5FA3',
            timer: 3000,
            timerProgressBar: true
        });
    };

    $('cc-btn-nuevo-egreso')?.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirModalEgreso();
    });

    // ── Init ──────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        // Los datos se cargan primero: la pregunta se responde mejor viendo la pantalla
        // detrás, y si elige "solo revisar" ya están los totales a la vista.
        cargarDatos();
        preguntarModo();
    });
})();
