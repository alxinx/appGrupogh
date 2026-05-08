(function () {
    'use strict';

    const csrf = () => document.getElementById('csrf-token').value;

    const fmtMoney = (n) => {
        const num = Math.round(parseFloat(String(n).replace(/\./g, '').replace(',', '.')) || 0);
        return isNaN(num) ? '0' : num.toLocaleString('es-CO');
    };

    // ─── FORMATEAR VALOR AL ESCRIBIR (preserva cursor) ───────────────────────
    const inputValor = document.getElementById('egr-valor');
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
    const feedbackEmp = document.getElementById('egr-feedback-emp');
    document.getElementById('egr-empleado').addEventListener('input', (e) => {
        clearTimeout(empTimer);
        const cod = e.target.value.trim();
        feedbackEmp.textContent = '';
        if (cod.length < 3) return;
        empTimer = setTimeout(async () => {
            try {
                const r = await fetch(`/store/json/personal/codigo/${encodeURIComponent(cod.toUpperCase())}`);
                const json = await r.json();
                if (json.success) {
                    feedbackEmp.textContent = `✓ ${json.empleado.PrimerNombre} ${json.empleado.PrimerApellido}`;
                    feedbackEmp.className = 'text-xs ml-1 h-4 text-emerald-600';
                } else {
                    feedbackEmp.textContent = 'Empleado no encontrado';
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
        tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-8 text-center text-gray-400 text-sm"><i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando...</td></tr>`;

        const params = new URLSearchParams({ pagina });
        if (filtros.fechaA) params.append('fechaA', filtros.fechaA);
        if (filtros.fechaB) params.append('fechaB', filtros.fechaB);
        if (filtros.estado) params.append('estado', filtros.estado);

        try {
            const r = await fetch(`/store/storebehivors/expenses/json?${params}`);
            const json = await r.json();

            if (!json.success) {
                tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-8 text-center text-red-400 text-sm">Error al cargar los egresos.</td></tr>`;
                return;
            }

            if (!json.egresos.length) {
                tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-8 text-center text-slate-400 text-sm">No hay egresos registrados con estos filtros.</td></tr>`;
                document.getElementById('egr-paginacion').innerHTML = '';
                return;
            }

            tbody.innerHTML = json.egresos.map(egresoRow).join('');
            generarPaginacion('#egr-paginacion', json.totalPaginas, json.paginaActual, cargarEgresos);
        } catch (_) {
            tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-8 text-center text-red-400 text-sm">Error de red.</td></tr>`;
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

        const btn = document.getElementById('egr-submit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fi fi-rr-spinner animate-spin mr-2"></i>Guardando...';

        try {
            const res = await fetch('/store/storebehivors/expenses/crear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
                body: JSON.stringify({ valorEgreso: valor, referencia, codigoEmpleado, descripcion })
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
            feedbackEmp.textContent = '';

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
            btn.disabled = false;
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
