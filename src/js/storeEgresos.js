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

    // ─── FORMATEAR VALOR AL ESCRIBIR (preserva cursor) ───────────────────────
    // Rojo para un gasto real, ámbar para un traslado: la plata del traslado no se
                // perdió, cambió de lugar, y a simple vista tienen que verse distintos.
                const badgeTipo = (t) => t === 'Traslado'
                    ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap bg-amber-100 text-amber-700">Traslado</span>`
                    : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap bg-red-100 text-red-600">Egreso</span>`;

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

    const pintarMetodo = () => {
        const electronico = metodoElegido() === 'Electronico';
        bloqueEntidad?.classList.toggle('hidden', !electronico);
        if (ayudaMetodo) ayudaMetodo.textContent = electronico
            ? 'No descuenta del cajón: la plata sale de la cuenta.'
            : 'Sale del cajón de la tienda.';
        if (titulo)     titulo.textContent     = electronico ? 'Nueva Transferencia' : 'Nuevo Egreso';
        if (labelValor) labelValor.textContent = electronico ? 'Valor de la transferencia *' : 'Valor del Egreso *';
        if (!electronico && selEntidad) { selEntidad.value = ''; errorEntidad?.classList.add('hidden'); }
    };
    radiosMetodo.forEach(r => r.addEventListener('change', pintarMetodo));
    selEntidad?.addEventListener('change', () => errorEntidad?.classList.add('hidden'));
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
    let empleadoOk = false;
    const feedbackEmp = document.getElementById('egr-feedback-emp');
    const btnSubmit    = document.getElementById('egr-submit');

    const setEmpleadoOk = (ok) => {
        empleadoOk = ok;
        btnSubmit.disabled = !ok;
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
                } else {
                    feedbackEmp.textContent = json.mensaje || 'Empleado no encontrado';
                    feedbackEmp.className = 'text-xs ml-1 h-4 text-red-500';
                }
            } catch (_) {}
        }, 400);
    });

    // ─── STAT TOTAL HOY ──────────────────────────────────────────────────────
    const actualizarStatHoy = (total) => {
        const el = document.getElementById('stat-total-hoy');
        if (el) el.textContent = `$${fmtMoney(total)}`;
    };

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

    // ─── TABLA EGRESOS ────────────────────────────────────────────────────────
    let paginaActual = 1;
    const filtros = { fechaA: '', fechaB: '', estado: '' };

    const egresoRow = (e) => {
        const fecha = new Date(e.createdAt).toLocaleString('es-CO', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'America/Bogota'
        });
        const badge = e.estado === 'pendiente'
            ? `<span class="table-badge table-badge-pending"><span class="table-badge-dot"></span>Pendiente</span>`
            : `<span class="table-badge table-badge-active"><span class="table-badge-dot"></span>Liquidada</span>`;
        const desc = e.descripcion
            ? `<span title="${e.descripcion.replace(/"/g, '&quot;')}" class="cursor-help">${e.descripcion.length > 28 ? e.descripcion.slice(0, 28) + '…' : e.descripcion}</span>`
            : '—';
        return `
            <tr class="border-b border-slate-100 hover:bg-pink-50/30 transition-colors">
                <td class="px-3 py-3 text-slate-700 font-mono text-xs">${e.referencia || '—'}</td>
                <td class="px-3 py-3 text-slate-500 text-xs whitespace-nowrap">${fecha}</td>
                <td class="px-3 py-3 text-slate-600 text-xs">${desc}</td>
                <td class="px-3 py-3 text-right font-bold text-slate-800 text-sm whitespace-nowrap">$${fmtMoney(e.valorEgreso)}</td>
                <td class="px-3 py-3 text-center">${badgeTipo(e.tipo)}</td>
                <td class="px-3 py-3 text-center">${badge}</td>
                <td class="px-3 py-3 text-center">
                    <a href="/store/storebehivors/expenses/${e.idEgreso}/pdf" target="_blank"
                       class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-600 transition-colors">
                        <i class="fi fi-rr-file-pdf text-sm"></i>
                    </a>
                </td>
            </tr>`;
    };

    const cargarEgresos = async (pagina = 1) => {
        paginaActual = pagina;
        const tbody = document.getElementById('egr-tbody');
        tbody.innerHTML = `<tr><td colspan="7" class="px-3 py-8 text-center text-gray-400 text-sm"><i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando...</td></tr>`;

        const params = new URLSearchParams({ pagina });
        if (filtros.fechaA) params.append('fechaA', filtros.fechaA);
        if (filtros.fechaB) params.append('fechaB', filtros.fechaB);
        if (filtros.estado) params.append('estado', filtros.estado);

        try {
            const r = await fetch(`/store/storebehivors/expenses/json?${params}`);
            const json = await r.json();

            if (!json.success) {
                tbody.innerHTML = `<tr><td colspan="7" class="px-3 py-8 text-center text-red-400 text-sm">Error al cargar los egresos.</td></tr>`;
                return;
            }

            if (!json.egresos.length) {
                tbody.innerHTML = `<tr><td colspan="7" class="px-3 py-8 text-center text-slate-400 text-sm">No hay egresos registrados con estos filtros.</td></tr>`;
                document.getElementById('egr-paginacion').innerHTML = '';
                return;
            }

            tbody.innerHTML = json.egresos.map(egresoRow).join('');
            generarPaginacion('#egr-paginacion', json.totalPaginas, json.paginaActual, cargarEgresos);
        } catch (_) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-3 py-8 text-center text-red-400 text-sm">Error de red.</td></tr>`;
        }
    };

    const prependarEgreso = (e) => {
        const tbody = document.getElementById('egr-tbody');
        const emptyRow = tbody.querySelector('[colspan]');
        if (emptyRow) tbody.innerHTML = '';
        const tmp = document.createElement('tbody');
        tmp.innerHTML = egresoRow(e);
        const tr = tmp.querySelector('tr');
        tr.style.transition = 'background 1.5s';
        tr.style.background = '#fff0f6';
        tbody.insertBefore(tr, tbody.firstChild);
        setTimeout(() => { tr.style.background = ''; }, 1500);
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

        const metodoPago = metodoElegido();
        const idEntidad  = selEntidad?.value || '';
        if (metodoPago === 'Electronico' && !idEntidad) {
            errorEntidad.textContent = 'Elegí con qué cuenta se pagó.';
            errorEntidad.classList.remove('hidden');
            selEntidad.focus();
            return;
        }

        const btn = document.getElementById('egr-submit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fi fi-rr-spinner animate-spin mr-2"></i>Guardando...';

        try {
            const res = await fetch('/store/storebehivors/expenses/crear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
                body: JSON.stringify({ valorEgreso: valor, referencia, codigoEmpleado, descripcion, metodoPago, idEntidad })
            });
            const json = await res.json();

            if (!json.success) {
                Swal.fire({ icon: 'error', title: 'Error', text: json.mensaje || 'No se pudo registrar el egreso.', confirmButtonColor: '#EC5FA3' });
                return;
            }

            window.open(`/store/storebehivors/expenses/${json.idEgreso}/pdf`, '_blank');

            inputValor.value = '';
            document.getElementById('egr-referencia').value = '';
            document.getElementById('egr-empleado').value = '';
            document.getElementById('egr-descripcion').value = '';
            document.getElementById('egr-metodo-efectivo').checked = true;
            pintarMetodo();
            feedbackEmp.textContent = '';
            setEmpleadoOk(false);

            Swal.fire({
                icon: 'success',
                title: 'Egreso registrado',
                html: `Registrado por <strong>${json.nombreEmpleado}</strong>.<br>El comprobante se abrió en una nueva pestaña.`,
                timer: 3000,
                showConfirmButton: false,
                confirmButtonColor: '#EC5FA3'
            });

        } catch (_) {
            Swal.fire({ icon: 'error', title: 'Error de red', text: 'No se pudo conectar con el servidor.', confirmButtonColor: '#EC5FA3' });
        } finally {
            btn.disabled = !empleadoOk;
            btn.innerHTML = '<i class="fi fi-rr-disk mr-2"></i>Registrar Egreso';
        }
    });

    // ─── FILTROS ─────────────────────────────────────────────────────────────
    document.getElementById('filtro-fecha-a').addEventListener('change', (e) => { filtros.fechaA = e.target.value; cargarEgresos(1); });
    document.getElementById('filtro-fecha-b').addEventListener('change', (e) => { filtros.fechaB = e.target.value; cargarEgresos(1); });
    document.getElementById('filtro-estado').addEventListener('change', (e) => { filtros.estado = e.target.value; cargarEgresos(1); });

    // ─── INIT ─────────────────────────────────────────────────────────────────
    cargarStatHoy();
    cargarEgresos(1);

})();
