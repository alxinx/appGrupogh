(function () {
    'use strict';

    const csrf = () => document.getElementById('csrf-token').value;

    // Formatea un valor que viene del backend: un número (el total) o un DECIMAL de
    // Sequelize, que llega como string con punto decimal ("10000.00").
    //
    // La versión anterior borraba los puntos antes de parsear —tratándolos como
    // separadores de miles— y "10000.00" terminaba siendo 1.000.000: cien veces el valor
    // real. Eso solo tiene sentido para texto tecleado por una persona, y el input del
    // formulario ya se limpia por su cuenta antes de enviarse.
    //
    // Se redondea a pesos: los centavos no se muestran en el listado.
    const fmtMoney = (n) => {
        const num = Math.round(Number(n) || 0);
        return num.toLocaleString('es-CO', { maximumFractionDigits: 0 });
    };

    const inputValor = document.getElementById('egr-valor');

    // ── Medio de pago del egreso ──────────────────────────────────────────────
    // Solo el efectivo descuenta del cajón; si fue transferencia hay que decir de qué
    // cuenta salió, para que el cuadre pueda separarlo.
    const radiosMetodo   = document.querySelectorAll('input[name="egr-metodo"]');
    const bloqueEntidad  = document.getElementById('egr-bloque-entidad');
    const selEntidad     = document.getElementById('egr-entidad');
    const errorEntidad   = document.getElementById('egr-error-entidad');
    const ayudaMetodo    = document.getElementById('egr-ayuda-metodo');

    const metodoElegido = () => document.querySelector('input[name="egr-metodo"]:checked')?.value || 'Efectivo';

    // El formulario se renombra entero según lo que se esté registrando: un egreso del
    // cajón o una transferencia desde una cuenta. Es el mismo registro, pero para el
    // operador son dos operaciones distintas y el texto tiene que decirlo.
    const titulo     = document.getElementById('egr-titulo');
    const labelValor = document.getElementById('egr-label-valor');

    // ── Tope de la transferencia ──────────────────────────────────────────────
    // Una transferencia saca efectivo del cajón para consignarlo, así que no puede
    // superar lo que hay: recaudado en efectivo menos lo que ya salió en efectivo. El
    // dato se pide al servidor, que es el mismo que después lo vuelve a verificar al
    // guardar — acá solo se avisa antes de que el operador llene todo el formulario.
    const topeAviso  = document.getElementById('egr-tope');
    const errorValor = document.getElementById('egr-error-valor');
    const pesos = (n) => '$' + Math.round(n || 0).toLocaleString('es-CO');

    let efectivo = null;   // { hayCaja, recaudado, egresosEfectivo, disponible }

    const cargarEfectivo = async () => {
        try {
            const r = await fetch('/store/storebehivors/expenses/efectivo-disponible');
            const j = await r.json();
            efectivo = j.success ? j : null;
        } catch (_) { efectivo = null; }
        validarTope();
        revisar();
    };

    const valorEscrito = () => parseInt((inputValor.value || '').replace(/\D/g, ''), 10) || 0;

    // Devuelve true si el valor es aceptable. Se usa tanto para pintar el aviso como
    // para frenar el envío.
    const validarTope = () => {
        const electronico = metodoElegido() === 'Electronico';
        if (!electronico || !topeAviso) {
            topeAviso?.classList.add('hidden');
            errorValor?.classList.add('hidden');
            return true;
        }

        if (!efectivo) {
            topeAviso.textContent = 'No se pudo consultar el efectivo disponible.';
            topeAviso.classList.remove('hidden');
            return true;   // el servidor decide; no se bloquea por una consulta caída
        }

        if (!efectivo.hayCaja) {
            topeAviso.textContent = 'No hay una caja abierta: no se puede transferir efectivo.';
            topeAviso.classList.remove('hidden');
            errorValor.classList.add('hidden');
            return false;
        }

        topeAviso.innerHTML = `Disponible para transferir: <b class="text-slate-600">${pesos(efectivo.disponible)}</b>` +
            (efectivo.egresosEfectivo
                ? ` &middot; recaudado ${pesos(efectivo.recaudado)} menos ${pesos(efectivo.egresosEfectivo)} de egresos en efectivo.`
                : '');
        topeAviso.classList.remove('hidden');

        const valor = valorEscrito();
        const excede = valor > efectivo.disponible;
        if (excede) {
            errorValor.textContent = `No puede superar ${pesos(efectivo.disponible)}, que es el efectivo disponible en caja.`;
            errorValor.classList.remove('hidden');
        } else {
            errorValor.classList.add('hidden');
        }
        inputValor.classList.toggle('border-red-400', excede);
        inputValor.classList.toggle('border-slate-200', !excede);
        return !excede;
    };

    // ── Destino de la transferencia ───────────────────────────────────────────
    // Consignar en un banco o una billetera deja un comprobante; pasar plata a otro
    // cajón, no. Por eso la referencia y la foto solo aparecen cuando el destino es una
    // cuenta, y ahí son obligatorias: sin ellas nadie puede conciliar el movimiento
    // contra el extracto después.
    const bloqueComprobante = document.getElementById('egr-bloque-comprobante');
    const inputComprobante  = document.getElementById('egr-comprobante');
    const previaComprobante = document.getElementById('egr-comprobante-previa');
    const imgComprobante    = document.getElementById('egr-comprobante-img');
    const iconoPDF          = document.getElementById('egr-comprobante-pdf');
    const nombreComprobante = document.getElementById('egr-comprobante-nombre');
    const pesoComprobante   = document.getElementById('egr-comprobante-peso');
    const ctaComprobante    = document.getElementById('egr-comprobante-cta');
    const errorComprobante  = document.getElementById('egr-error-comprobante');
    const labelReferencia   = document.getElementById('egr-label-referencia');
    const inputReferencia   = document.getElementById('egr-referencia');
    let   textoSubmit       = document.getElementById('egr-submit-texto');
    const avisoFalta        = document.getElementById('egr-falta');

    const MAX_COMPROBANTE = 5 * 1024 * 1024;
    let comprobante = null;   // File elegido, aún sin subir

    // Se declaran acá y no en el bloque del empleado porque `revisar()` los necesita y
    // ese bloque vive más abajo en el archivo.
    let empleadoOk  = false;
    const btnSubmit = document.getElementById('egr-submit');

    const tipoDestino = () => selEntidad?.selectedOptions?.[0]?.dataset?.tipo || '';
    const destinoEsCuenta = () => metodoElegido() === 'Electronico' && ['banco', 'billetera'].includes(tipoDestino());

    const limpiarComprobante = () => {
        comprobante = null;
        if (inputComprobante) inputComprobante.value = '';
        previaComprobante?.classList.add('hidden');
        previaComprobante?.classList.remove('flex');
        if (imgComprobante?.src?.startsWith('blob:')) URL.revokeObjectURL(imgComprobante.src);
        imgComprobante?.classList.remove('hidden');
        iconoPDF?.classList.add('hidden');
        if (ctaComprobante) ctaComprobante.textContent = 'Adjuntar comprobante de la consignación';
    };

    inputComprobante?.addEventListener('change', () => {
        errorComprobante?.classList.add('hidden');
        const f = inputComprobante.files?.[0];
        if (!f) { limpiarComprobante(); return revisar(); }

        // El servidor revalida el contenido real del archivo; esto solo evita que el
        // operador espere una subida que ya se sabe que va a fallar.
        const esPDF = f.type === 'application/pdf';
        if (!esPDF && !/^image\/(jpeg|png|webp)$/.test(f.type)) {
            errorComprobante.textContent = 'Adjuntá una imagen JPG, PNG o WebP, o un PDF.';
            errorComprobante.classList.remove('hidden');
            limpiarComprobante(); return revisar();
        }
        if (f.size > MAX_COMPROBANTE) {
            errorComprobante.textContent = 'La imagen supera los 5MB.';
            errorComprobante.classList.remove('hidden');
            limpiarComprobante(); return revisar();
        }

        comprobante = f;
        if (imgComprobante?.src?.startsWith('blob:')) URL.revokeObjectURL(imgComprobante.src);
        // Un PDF no tiene miniatura que mostrar: en su lugar va un recuadro con el
        // ícono. Sin esto el <img> quedaba roto y parecía que la subida había fallado.
        imgComprobante.classList.toggle('hidden', esPDF);
        iconoPDF?.classList.toggle('hidden', !esPDF);
        if (!esPDF) imgComprobante.src = URL.createObjectURL(f);
        nombreComprobante.textContent = f.name;
        pesoComprobante.textContent = f.size >= 1024 * 1024
            ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
            : `${Math.max(1, Math.round(f.size / 1024))} KB`;
        previaComprobante.classList.remove('hidden');
        previaComprobante.classList.add('flex');
        ctaComprobante.textContent = 'Cambiar comprobante';
        revisar();
    });

    document.getElementById('egr-comprobante-quitar')?.addEventListener('click', () => {
        limpiarComprobante();
        revisar();
    });

    // ── Habilitación del botón ────────────────────────────────────────────────
    // El botón se prende cuando el formulario está completo, no solo cuando el código de
    // empleado es válido. La descripción no cuenta: es opcional.
    //
    // Devuelve qué falta, no un booleano: un botón apagado sin motivo obliga a adivinar
    // cuál de los seis campos es el que sobra o falta.
    const loQueFalta = () => {
        const faltan = [];
        const electronico = metodoElegido() === 'Electronico';

        if (valorEscrito() <= 0)              faltan.push('el valor');
        else if (electronico && !validarTope()) faltan.push('un valor dentro del disponible');

        if (electronico) {
            if (!selEntidad?.value) faltan.push('la cuenta destino');
            if (destinoEsCuenta()) {
                if (!inputReferencia?.value.trim()) faltan.push('la referencia de la consignación');
                if (!comprobante)                   faltan.push('el comprobante');
            }
        }

        if (!empleadoOk) faltan.push('un código de empleado válido');
        return faltan;
    };

    const revisar = () => {
        const faltan = loQueFalta();
        btnSubmit.disabled = faltan.length > 0;
        if (!avisoFalta) return;
        avisoFalta.textContent = faltan.length
            ? `Falta ${faltan.length === 1 ? faltan[0] : faltan.slice(0, -1).join(', ') + ' y ' + faltan.at(-1)}.`
            : '';
    };

    const pintarDestino = () => {
        const esCuenta = destinoEsCuenta();
        bloqueComprobante?.classList.toggle('hidden', !esCuenta);
        if (labelReferencia) labelReferencia.textContent = esCuenta ? 'Referencia consignación *' : 'Referencia de Factura';
        if (inputReferencia) inputReferencia.placeholder = esCuenta ? 'Ej: 0012345678, comprobante Nequi...' : 'Ej: FAC-001, REC-2024...';
        if (!esCuenta) { limpiarComprobante(); errorComprobante?.classList.add('hidden'); }
    };

    const pintarMetodo = () => {
        const electronico = metodoElegido() === 'Electronico';
        bloqueEntidad?.classList.toggle('hidden', !electronico);
        if (ayudaMetodo) ayudaMetodo.textContent = electronico
            ? 'Saca el efectivo del cajón y lo consigna en una cuenta del negocio.'
            : 'Sale del cajón de la tienda.';
        if (titulo)     titulo.textContent     = electronico ? 'Nueva Transferencia' : 'Nuevo Egreso';
        if (labelValor) labelValor.textContent = electronico ? 'Valor de la transferencia *' : 'Valor del Egreso *';
        const desc = document.getElementById('egr-descripcion');
        if (desc) desc.placeholder = electronico ? 'Detalle de la transferencia...' : 'Detalle del egreso...';
        if (!electronico && selEntidad) { selEntidad.value = ''; errorEntidad?.classList.add('hidden'); }
        // El efectivo se vuelve a pedir al entrar a transferencia: entre que se abrió la
        // pantalla y ahora pudo entrar una venta o salir un egreso.
        if (textoSubmit) textoSubmit.textContent = electronico ? 'Registrar Transferencia' : 'Registrar Egreso';
        pintarDestino();
        if (electronico) cargarEfectivo(); else validarTope();
        revisar();
    };
    radiosMetodo.forEach(r => r.addEventListener('change', pintarMetodo));
    selEntidad?.addEventListener('change', () => {
        errorEntidad?.classList.add('hidden');
        pintarDestino();
        revisar();
    });
    inputValor.addEventListener('input', () => { validarTope(); revisar(); });
    inputReferencia?.addEventListener('input', revisar);
    pintarMetodo();
    inputValor.addEventListener('keydown', (e) => {
        const ok = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Enter','Home','End'];
        if (!ok.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault();
    });
    inputValor.addEventListener('input', () => {
        const oldVal = inputValor.value;
        const start  = inputValor.selectionStart;
        const digitsAntes = oldVal.slice(0, start).replace(/[^0-9]/g, '').length;

        const raw    = parseInt(oldVal.replace(/\D/g, ''), 10);
        const newVal = raw ? raw.toLocaleString('es-CO') : '';
        if (newVal === oldVal) return;
        inputValor.value = newVal;

        let cnt = 0, newPos = newVal.length;
        for (let i = 0; i < newVal.length; i++) {
            if (/\d/.test(newVal[i])) cnt++;
            if (cnt === digitsAntes) { newPos = i + 1; break; }
        }
        if (digitsAntes === 0) newPos = 0;
        inputValor.setSelectionRange(newPos, newPos);
    });

    // ─── LOOKUP DE EMPLEADO ───────────────────────────────────────────────────
    let empTimer = null;
    let nombreEmpleado = '';   // el que devolvió el lookup, para nombrarlo al confirmar
    const feedbackEmp = document.getElementById('egr-feedback-emp');

    const setEmpleadoOk = (ok) => {
        empleadoOk = ok;
        if (!ok) nombreEmpleado = '';
        revisar();
    };

    document.getElementById('egr-empleado').addEventListener('input', (e) => {
        clearTimeout(empTimer);
        const cod = e.target.value.trim();
        feedbackEmp.textContent = '';
        setEmpleadoOk(false);
        if (cod.length < 3) return;
        empTimer = setTimeout(async () => {
            try {
                const r = await fetch(`/store/json/personal/validar/${encodeURIComponent(cod.toUpperCase())}?accion=CREATE`);
                const json = await r.json();
                if (json.success) {
                    feedbackEmp.textContent = `✓ ${json.nombre}`;
                    feedbackEmp.className = 'text-xs ml-1 h-4 text-emerald-600';
                    setEmpleadoOk(true);
                    nombreEmpleado = json.nombre;
                } else {
                    feedbackEmp.textContent = json.mensaje || 'Empleado no encontrado';
                    feedbackEmp.className = 'text-xs ml-1 h-4 text-red-500';
                }
            } catch (_) {}
        }, 400);
    });

    // ─── RESUMEN DEL DÍA ─────────────────────────────────────────────────────
    const actualizarStatHoy = (total) => {
        const el = document.getElementById('stat-total-hoy');
        // textContent y no innerHTML: además de escribir la cifra, se lleva por delante
        // el hueso del esqueleto que estaba ocupando el lugar.
        if (el) el.textContent = `$${fmtMoney(total)}`;
    };

    // La tarjeta de transferencias todavía no tiene de dónde sacar el número. Cuando el
    // servidor lo entregue, esto es lo único que hay que llamar; el aviso "sin conectar"
    // se retira solo.
    //
    // Ojo al conectarla: `getTotalEgresosHoy` suma HOY todos los egresos del día sin
    // filtrar por tipo, así que los traslados ya están contados adentro. Las dos cifras
    // se pisarían. Hay que decidir si "Total egresos de hoy" pasa a excluir los
    // traslados —que es lo que su nombre promete— o si la segunda tarjeta se rotula
    // como un desglose de la primera.
    const actualizarStatTransferido = (total) => {
        const el = document.getElementById('stat-transferido-hoy');
        if (!el) return;
        el.textContent = `$${fmtMoney(total)}`;
        el.classList.remove('egr-stat-valor--espera');
        document.getElementById('stat-transferido-aviso')?.remove();
    };
    window.actualizarStatTransferido = actualizarStatTransferido;

    const cargarStatHoy = async () => {
        try {
            const r = await fetch('/store/storebehivors/expenses/total-hoy');
            const json = await r.json();
            if (json.success) actualizarStatHoy(json.total);
        } catch (_) {}
    };

    // ─── SSE: escuchar new_egreso despachado desde storeGlobal ───────────────
    window.onNuevoEgreso = (data) => {
        actualizarStatHoy(data.totalHoy);
        prependarEgreso(data.egreso);
    };

    // ─── LISTADO ─────────────────────────────────────────────────────────────
    // Paginación por cursor: el servidor devuelve una página y la posición desde la que
    // sigue la próxima. No hay números de página porque no se conoce el total sin
    // contarlo, y contar un libro que crece sin techo cuesta más que traer la página.
    const tbody      = document.getElementById('egr-tbody');
    const btnMas     = document.getElementById('egr-cargar-mas');
    const contador   = document.getElementById('egr-contador');
    const btnLimpiar = document.getElementById('egr-limpiar');
    const selTipo    = document.getElementById('filtro-tipo');
    const filtroA    = document.getElementById('filtro-fecha-a');
    const filtroB    = document.getElementById('filtro-fecha-b');

    const filtros = { fechaA: '', fechaB: '', estado: '', tipo: '' };
    let cursor = null;
    let cargadas = 0;

    const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    const COLUMNAS = 6;

    const egresoRow = (e) => {
        const traslado = e.tipo === 'Traslado';
        const sabor = traslado ? 'traslado' : 'egreso';

        const badgeEstado = e.estado === 'pendiente'
            ? '<span class="table-badge table-badge-pending"><span class="table-badge-dot"></span>Pendiente</span>'
            : '<span class="table-badge table-badge-active"><span class="table-badge-dot"></span>Liquidada</span>';

        // La descripción es opcional, así que la fila no puede depender de ella para
        // decir qué fue. Cuando falta, el tipo queda como el rótulo de la fila.
        const titulo = e.descripcion
            ? `<p class="egr-desc">${escapar(e.descripcion)}</p>`
            : `<p class="egr-desc egr-desc--vacia">${traslado ? 'Consignación sin detalle' : 'Egreso sin detalle'}</p>`;

        const meta = [`<span class="egr-tipo egr-tipo--${sabor}">${traslado ? 'Traslado' : 'Egreso'}</span>`];
        if (e.referencia) meta.push(`<span class="egr-ref">${escapar(e.referencia)}</span>`);
        const separadas = meta.join('<span class="egr-meta-sep">·</span>');

        // A dónde fue la plata: sin esto, dos consignaciones del mismo día son
        // indistinguibles y nadie sabe en qué extracto buscarlas.
        const destino = e.destino
            ? `<p class="egr-destino"><i class="fi fi-rr-arrow-right text-[9px]"></i>${escapar(e.destino)}</p>`
            : '';

        return `
            <tr class="egr-fila">
                <td class="egr-c-fecha">
                    <span class="egr-fecha">${escapar(e.fecha)}</span>
                    <span class="egr-hora">${escapar(e.hora)}</span>
                </td>
                <td class="egr-c-detalle">
                    ${titulo}
                    <div class="egr-meta">${separadas}</div>
                    ${destino}
                </td>
                <td class="egr-c-quien"><span class="egr-quien" title="${e.responsable ? escapar(e.responsable) : ''}">${e.responsable ? escapar(e.responsable) : '—'}</span></td>
                <td class="egr-c-valor"><span class="egr-valor egr-valor--${sabor}">$${fmtMoney(e.valor)}</span></td>
                <td class="egr-c-estado">${badgeEstado}</td>
                <td class="egr-c-pdf text-right">
                    <a href="/store/storebehivors/expenses/${e.idEgreso}/pdf" target="_blank" rel="noopener"
                       class="egr-pdf" title="Abrir comprobante en PDF" aria-label="Comprobante del egreso del ${escapar(e.fecha)}">
                        <i class="fi fi-rr-file-pdf text-sm"></i>
                    </a>
                </td>
            </tr>`;
    };

    // Huesos del ancho de lo que reemplazan, para que la tabla no salte al llegar los datos.
    const ANCHOS = ['3.5rem', '11rem', '5rem', '4rem', '4.5rem', '1.5rem'];
    const esqueleto = (filas = 5) => Array.from({ length: filas }, () => `
        <tr class="egr-esqueleto">
            ${ANCHOS.map((w, i) => `<td class="${i === 0 ? 'pl-6' : ''} ${i === ANCHOS.length - 1 ? 'pr-6' : ''}"><span class="egr-hueso" style="width:${w}"></span></td>`).join('')}
        </tr>`).join('');

    // Una cabecera de columnas encima de un mensaje de "no hay nada" rotula columnas
    // que no existen. Se retira mientras la tabla está vacía y vuelve con las filas.
    const tabla = tbody.closest('table');
    const mostrarCabecera = (visible) => tabla?.classList.toggle('egr-sin-filas', !visible);

    const filaMensaje = (icono, titulo, detalle, accion = '') => `
        <tr class="egr-vacio-fila">
            <td colspan="${COLUMNAS}" class="px-6 py-12 text-center">
                <i class="fi ${icono} text-2xl text-slate-300"></i>
                <p class="text-sm font-semibold text-slate-500 mt-3">${titulo}</p>
                <p class="text-xs text-slate-400 mt-1">${detalle}</p>
                ${accion}
            </td>
        </tr>`;

    const hayFiltros = () => !!(filtros.fechaA || filtros.fechaB || filtros.estado || filtros.tipo);

    const actualizarPie = () => {
        if (contador) {
            contador.textContent = cargadas
                ? `Mostrando ${cargadas} egreso${cargadas === 1 ? '' : 's'}${cursor ? '' : ' · no hay más'}`
                : '';
        }
        btnMas?.classList.toggle('hidden', !cursor);
        btnLimpiar?.classList.toggle('hidden', !hayFiltros());
    };

    const params = () => {
        const p = new URLSearchParams();
        if (filtros.fechaA) p.set('fechaA', filtros.fechaA);
        if (filtros.fechaB) p.set('fechaB', filtros.fechaB);
        if (filtros.estado) p.set('estado', filtros.estado);
        if (filtros.tipo)   p.set('tipo',   filtros.tipo);
        return p;
    };

    const cargarEgresos = async () => {
        cursor = null;
        cargadas = 0;
        tbody.innerHTML = esqueleto();
        mostrarCabecera(true);
        actualizarPie();

        try {
            const r = await fetch(`/store/storebehivors/expenses/json?${params()}`);
            const json = await r.json();

            if (!json.success) {
                tbody.innerHTML = filaMensaje('fi-rr-triangle-warning', 'No se pudo cargar el listado',
                    'Volvé a intentarlo en un momento.');
                mostrarCabecera(false);
                return;
            }

            if (!json.egresos.length) {
                // Dos pantallas vacías distintas: una tienda que todavía no registró
                // nada necesita saber qué va a aparecer acá; una búsqueda sin resultados
                // necesita una salida.
                tbody.innerHTML = json.filtrado
                    ? filaMensaje('fi-rr-search', 'Ningún egreso con estos filtros',
                        'Probá con otro rango de fechas o quitá los filtros.',
                        '<button type="button" id="egr-vaciar-filtros" class="mt-4 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer">Quitar filtros</button>')
                    : filaMensaje('fi-rr-receipt', 'Todavía no hay egresos',
                        'Los que registres en el formulario de al lado aparecen acá al instante.');
                cursor = null;
                mostrarCabecera(false);
                actualizarPie();
                return;
            }

            tbody.innerHTML = json.egresos.map(egresoRow).join('');
            mostrarCabecera(true);
            cursor = json.cursorSiguiente;
            cargadas = json.egresos.length;
            actualizarPie();
        } catch (_) {
            tbody.innerHTML = filaMensaje('fi-rr-wifi-slash', 'Sin conexión con el servidor',
                'Revisá la red y volvé a intentarlo.');
            mostrarCabecera(false);
        }
    };

    btnMas?.addEventListener('click', async () => {
        if (!cursor) return;
        btnMas.disabled = true;
        btnMas.textContent = 'Cargando...';
        try {
            const p = params();
            p.set('cursor', cursor);
            const r = await fetch(`/store/storebehivors/expenses/json?${p}`);
            const json = await r.json();
            if (json.success) {
                // El cursor apunta a una posición del libro, no a un número de página:
                // aunque entre un egreso nuevo mientras se pagina, la página siguiente
                // arranca donde terminó la anterior y ninguna fila se repite ni se pierde.
                const html = json.egresos.map(egresoRow).join('');
                tbody.insertAdjacentHTML('beforeend', html);
                json.egresos.forEach((_, i) => {
                    const tr = tbody.children[cargadas + i];
                    if (tr) tr.classList.add('egr-entra');
                });
                cursor = json.cursorSiguiente;
                cargadas += json.egresos.length;
                actualizarPie();
            }
        } finally {
            btnMas.disabled = false;
            btnMas.textContent = 'Cargar más';
        }
    });

    const prependarEgreso = (e) => {
        // Un egreso que entra mientras hay filtros puestos no tiene por qué caer dentro
        // de ellos; meterlo igual mostraría una fila que la próxima recarga hace
        // desaparecer. El contador de hoy sí se actualiza siempre.
        if (hayFiltros()) return;

        const vacio = tbody.querySelector('.egr-vacio-fila, .egr-esqueleto');
        if (vacio) { tbody.innerHTML = ''; cargadas = 0; mostrarCabecera(true); }

        const tmp = document.createElement('tbody');
        tmp.innerHTML = egresoRow(e);
        const tr = tmp.querySelector('tr');
        tr.classList.add('egr-entra');
        tr.style.background = '#FDF2F8';
        tbody.insertBefore(tr, tbody.firstChild);
        // El resaltado se apaga solo: marca cuál llegó recién sin dejar la tabla teñida.
        setTimeout(() => { tr.style.transition = 'background-color 1.2s ease'; tr.style.background = ''; }, 900);

        cargadas += 1;
        actualizarPie();
    };

    // ─── FILTROS ─────────────────────────────────────────────────────────────
    const iso = (d) => {
        // La fecha del input es la del calendario local de quien mira, y el servidor
        // interpreta esa fecha en hora de Bogotá. Se arma a mano y no con toISOString(),
        // que convierte a UTC y a partir de las 7 p. m. devuelve el día siguiente.
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };

    const RANGOS = {
        hoy: () => { const h = new Date(); return [iso(h), iso(h)]; },
        '7d': () => { const h = new Date(); const a = new Date(); a.setDate(a.getDate() - 6); return [iso(a), iso(h)]; },
        mes: () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)]; },
        '':  () => ['', '']
    };

    const atajos = document.querySelectorAll('#egr-atajos .egr-seg-btn');

    // El atajo marcado deja de estarlo si las fechas dejan de coincidir con él: un botón
    // que dice "Hoy" sobre un rango que ya no es hoy miente sobre lo que se está viendo.
    const sincronizarAtajos = () => {
        let activo = null;
        for (const [clave, calcular] of Object.entries(RANGOS)) {
            const [a, b] = calcular();
            if (a === filtros.fechaA && b === filtros.fechaB) { activo = clave; break; }
        }
        atajos.forEach(b => b.classList.toggle('is-activo', b.dataset.rango === activo));
    };

    const aplicar = () => { sincronizarAtajos(); cargarEgresos(); };

    atajos.forEach(btn => btn.addEventListener('click', () => {
        const [a, b] = RANGOS[btn.dataset.rango]();
        filtros.fechaA = a; filtros.fechaB = b;
        filtroA.value = a;  filtroB.value = b;
        aplicar();
    }));

    filtroA.addEventListener('change', (e) => { filtros.fechaA = e.target.value; aplicar(); });
    filtroB.addEventListener('change', (e) => { filtros.fechaB = e.target.value; aplicar(); });
    document.getElementById('filtro-estado').addEventListener('change', (e) => { filtros.estado = e.target.value; aplicar(); });
    selTipo?.addEventListener('change', (e) => { filtros.tipo = e.target.value; aplicar(); });

    const vaciarFiltros = () => {
        filtros.fechaA = ''; filtros.fechaB = ''; filtros.estado = ''; filtros.tipo = '';
        filtroA.value = ''; filtroB.value = '';
        document.getElementById('filtro-estado').value = '';
        if (selTipo) selTipo.value = '';
        aplicar();
    };
    btnLimpiar?.addEventListener('click', vaciarFiltros);
    // El botón del estado vacío nace y muere con cada render, así que se escucha desde
    // el tbody en vez de volver a enlazarlo cada vez.
    tbody.addEventListener('click', (ev) => {
        if (ev.target.closest('#egr-vaciar-filtros')) vaciarFiltros();
    });

    // ─── CONFIRMACIÓN ANTES DE ASENTAR ───────────────────────────────────────
    // Un egreso no se puede editar ni borrar después: queda en el cuadre de la caja
    // del día y en el PDF que se imprime. Por eso la ventana no pregunta "¿estás
    // seguro?" sino que muestra el asiento tal como va a quedar —monto, destino y en
    // cuánto queda el efectivo del cajón— para releerlo antes de escribirlo. Es la
    // misma ventana que confirma un movimiento de caja o banco en el panel admin.
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    // El monto de la cabecera lleva un signo menos tipográfico (−, U+2212), que tiene
    // el ancho de un dígito. `pesos` usa el guion del teclado, más corto: los dos
    // juntos en la misma ventana se ven desparejos.
    const pesosConf = (n) => pesos(n).replace('-', '−');

    const fechaLarga = (d) =>
        d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }) +
        ', ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });

    const confirmarEgreso = ({ valor, metodoPago, referencia, descripcion }) => {
        const esTraslado = metodoPago === 'Electronico';
        const cuenta = esTraslado ? (selEntidad?.selectedOptions?.[0]?.textContent || '') : '';

        const fila = (etiqueta, valorHTML, vacio) =>
            `<div class="gh-conf-fila"><dt>${etiqueta}</dt><dd class="${vacio ? 'gh-conf-vacio' : ''}">${valorHTML}</dd></div>`;

        // El efecto sobre el cajón solo se muestra si el servidor pudo decir cuánto
        // hay: un número inventado acá sería peor que no mostrar ninguno. Los dos
        // casos sacan efectivo del cajón, el traslado también.
        const hayEfectivo = !!(efectivo && efectivo.hayCaja);
        const disponible  = hayEfectivo ? Number(efectivo.disponible) || 0 : 0;
        const queda       = disponible - valor;
        const bloqueSaldo = hayEfectivo
            ? `<div class="gh-conf-saldo">
                   <div class="gh-conf-saldo-bloque">
                       <span class="gh-conf-saldo-label">Efectivo en caja</span>
                       <span class="gh-conf-saldo-valor">${pesosConf(disponible)}</span>
                   </div>
                   <i class="fi fi-rr-arrow-right gh-conf-flecha"></i>
                   <div class="gh-conf-saldo-bloque gh-conf-saldo-bloque--final">
                       <span class="gh-conf-saldo-label">Queda en</span>
                       <span class="gh-conf-saldo-valor ${queda < 0 ? 'gh-conf-negativo' : ''}">${pesosConf(queda)}</span>
                   </div>
               </div>`
            : '';

        return Swal.fire({
            html: `
                <div class="gh-conf-html">
                    <div class="gh-conf-cabecera">
                        <span class="gh-conf-badge">
                            <i class="fi ${esTraslado ? 'fi-rr-exchange' : 'fi-rr-arrow-up'}" style="font-size:.625rem"></i>
                            ${esTraslado ? 'Transferencia' : 'Egreso'}
                        </span>
                        <p class="gh-conf-monto">− ${pesosConf(valor)}</p>
                        <p class="gh-conf-cuenta">${esTraslado
                            ? `sale del cajón y se consigna en <strong>${esc(cuenta)}</strong>`
                            : 'sale del cajón de la tienda'}</p>
                    </div>

                    ${bloqueSaldo}

                    <dl class="gh-conf-detalle">
                        ${fila('Fecha', esc(fechaLarga(new Date())))}
                        ${fila('Responsable', esc(nombreEmpleado || 'Sin verificar'), !nombreEmpleado)}
                        ${fila('Referencia', referencia ? `<span class="gh-conf-mono">${esc(referencia)}</span>` : 'Sin referencia', !referencia)}
                        ${fila('Descripción', descripcion ? esc(descripcion) : 'Sin descripción', !descripcion)}
                        ${destinoEsCuenta() ? fila('Comprobante', comprobante ? esc(comprobante.name) : 'Ninguno', !comprobante) : ''}
                    </dl>

                    <p class="gh-conf-aviso">
                        <i class="fi fi-rr-lock"></i>
                        <span>Una vez registrado no se puede editar ni eliminar, y entra al cuadre de caja de hoy. Para corregirlo habría que registrar el movimiento contrario.</span>
                    </p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: esTraslado ? 'Registrar transferencia' : 'Registrar egreso',
            cancelButtonText: 'Volver',
            // El Enter no debe asentar plata de un teclazo: el foco arranca en Volver.
            focusCancel: true,
            reverseButtons: true,
            buttonsStyling: false,
            width: '30rem',
            customClass: {
                popup:         `gh-conf-popup gh-conf--${esTraslado ? 'traslado' : 'egreso'}`,
                htmlContainer: 'gh-conf-html-container',
                actions:       'gh-conf-acciones',
                confirmButton: 'gh-conf-btn gh-conf-confirmar',
                cancelButton:  'gh-conf-btn gh-conf-cancelar'
            },
                        // Solo la entrada es propia. La salida la maneja SweetAlert2 con su `swal2-hide`:
                        // una clase de cierre propia que comparta @keyframes con la de entrada no
                        // dispara `animationend` y deja el contenedor tapando la página.
                        showClass: { popup: 'gh-conf-entra', backdrop: 'swal2-backdrop-show' }
        }).then(r => r.isConfirmed);
    };

    // ─── FORMULARIO ──────────────────────────────────────────────────────────
    document.getElementById('form-egreso').addEventListener('submit', async (ev) => {
        ev.preventDefault();

        const rawValor = inputValor.value.replace(/\./g, '');
        const valor = parseFloat(rawValor);
        const codigoEmpleado = document.getElementById('egr-empleado').value.trim().toUpperCase();
        const referencia = document.getElementById('egr-referencia').value.trim();
        const descripcion = document.getElementById('egr-descripcion').value.trim();

        if (!valor || valor <= 0) {
            return Swal.fire({ icon: 'warning', title: 'Valor inválido', text: 'Ingresa un valor mayor a $0.', confirmButtonColor: '#EC5FA3' });
        }
        if (!codigoEmpleado) {
            return Swal.fire({ icon: 'warning', title: 'Empleado requerido', text: 'Ingresa el código del responsable.', confirmButtonColor: '#EC5FA3' });
        }

        const metodoPago  = metodoElegido();
        const idCajaBanco = selEntidad?.value || '';
        if (metodoPago === 'Electronico') {
            if (!idCajaBanco) {
                errorEntidad.textContent = 'Elegí a qué cuenta se transfiere.';
                errorEntidad.classList.remove('hidden');
                selEntidad.focus();
                return;
            }
            if (!validarTope()) { inputValor.focus(); return; }
        }

        // Última parada antes de escribir. Si se vuelve, el formulario queda intacto.
        if (!await confirmarEgreso({ valor, metodoPago, referencia, descripcion })) return;

        const btn = document.getElementById('egr-submit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fi fi-rr-spinner animate-spin mr-2"></i>Guardando...';

        const esTraslado = metodoPago === 'Electronico';

        try {
            // Dos endpoints porque son dos operaciones distintas. El traslado viaja como
            // multipart —lleva el comprobante adjunto— y además del egreso escribe el
            // documento del traslado con su código y su bitácora. El egreso en efectivo
            // sigue siendo una petición JSON simple.
            //
            // El Content-Type NO se declara para el multipart: el navegador lo arma solo
            // con el boundary que corresponde, y ponerlo a mano rompe el parseo en el
            // servidor.
            let res;
            if (esTraslado) {
                const fd = new FormData();
                fd.append('valorTraslado', valor);
                fd.append('idCajaBanco', idCajaBanco);
                fd.append('codigoEmpleado', codigoEmpleado);
                fd.append('referencia', referencia);
                fd.append('descripcion', descripcion);
                if (comprobante) fd.append('voucher', comprobante);

                res = await fetch('/store/storebehivors/expenses/traslado', {
                    method: 'POST',
                    headers: { 'X-CSRF-Token': csrf() },
                    body: fd
                });
            } else {
                res = await fetch('/store/storebehivors/expenses/crear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
                    body: JSON.stringify({ valorEgreso: valor, referencia, codigoEmpleado, descripcion, metodoPago, idCajaBanco })
                });
            }
            const json = await res.json();

            if (!json.success) {
                Swal.fire({ icon: 'error', title: 'Error', text: json.mensaje || 'No se pudo registrar la operación.', confirmButtonColor: '#EC5FA3' });
                return;
            }

            // El traslado tiene su propio comprobante, con el código y los dos renglones
            // de firma; el egreso en efectivo abre el suyo.
            window.open(esTraslado
                ? `/store/storebehivors/expenses/traslado/${json.idTrasladoEfectivo}/pdf`
                : `/store/storebehivors/expenses/${json.idEgreso}/pdf`, '_blank');

            inputValor.value = '';
            document.getElementById('egr-referencia').value = '';
            document.getElementById('egr-empleado').value = '';
            document.getElementById('egr-descripcion').value = '';
            document.getElementById('egr-metodo-efectivo').checked = true;
            limpiarComprobante();
            pintarMetodo();
            cargarEfectivo();   // el traslado o el egreso ya movieron el cajón
            feedbackEmp.textContent = '';
            setEmpleadoOk(false);

            Swal.fire({
                icon: 'success',
                title: esTraslado ? 'Traslado registrado' : 'Egreso registrado',
                html: esTraslado
                    // El código es lo que se busca cuando alguien pregunta por un envío,
                    // así que se muestra acá y no solo en el PDF.
                    ? `Código <strong class="font-mono">${json.codigoTraslado}</strong>, despachado por <strong>${json.nombreEmpleado}</strong>.<br>Queda en tránsito hasta que lo acepten en destino.<br>El comprobante se abrió en una nueva pestaña.`
                    : `Registrado por <strong>${json.nombreEmpleado}</strong>.<br>El comprobante se abrió en una nueva pestaña.`,
                timer: esTraslado ? 6000 : 3000,
                showConfirmButton: false,
                confirmButtonColor: '#EC5FA3'
            });

        } catch (_) {
            Swal.fire({ icon: 'error', title: 'Error de red', text: 'No se pudo conectar con el servidor.', confirmButtonColor: '#EC5FA3' });
        } finally {
            revisar();
            // Se rearma el botón con su span adentro: el innerHTML plano de antes se
            // llevaba puesto el #egr-submit-texto, y desde el primer envío el botón se
            // quedaba diciendo "Registrar Egreso" aunque se pasara a Transferencia.
            btn.innerHTML = '<i class="fi fi-rr-disk"></i><span id="egr-submit-texto"></span>';
            textoSubmit = document.getElementById('egr-submit-texto');
            textoSubmit.textContent = metodoElegido() === 'Electronico' ? 'Registrar Transferencia' : 'Registrar Egreso';
        }
    });

    // ─── INIT ─────────────────────────────────────────────────────────────────
    cargarStatHoy();
    cargarEgresos();
    // El efectivo del cajón se pide de entrada y no solo al elegir transferencia: la
    // ventana de confirmación muestra en cuánto queda la caja también cuando el egreso
    // es en efectivo. `validarTope` sigue devolviendo true mientras el método sea
    // efectivo, así que tenerlo cargado no bloquea nada.
    cargarEfectivo();

})();
