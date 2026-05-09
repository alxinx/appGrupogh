(function () {
    const csrfToken = document.getElementById('csrf-token')?.value || '';
    const R2 = 'https://pub-f89c3f57ac314e868860b81774b10373.r2.dev/productos/';

    // ─── ESTADO ──────────────────────────────────────────────────────────────
    let paginaActual    = 1;
    let busqueda        = '';
    let searchTimer     = null;
    let empleadoVal     = null;
    let empLookupTimer  = null;
    let packsSeleccionados = [];

    // ─── REFERENCIAS DOM ─────────────────────────────────────────────────────
    const tbody       = document.getElementById('inv-tbody');
    const inputSearch = document.getElementById('inv-search');

    const modalTras       = document.getElementById('modal-traslado');
    const selDestino      = document.getElementById('tras-destino');
    const inputEmpTras    = document.getElementById('tras-empleado');
    const feedbackEmpTras = document.getElementById('tras-feedback-emp');
    const inputNotasTras  = document.getElementById('tras-notas');
    const btnConfirmTras  = document.getElementById('tras-confirmar');
    const lblPacksCount   = document.getElementById('tras-packs-count');

    // ─── CARGAR INVENTARIO ───────────────────────────────────────────────────
    const loadInventario = async () => {
        if (!tbody) return;
        tbody.innerHTML = `<tr>
            <td colspan="6" class="p-8 text-center text-gray-500">
                <i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando inventario...
            </td></tr>`;

        try {
            const params = new URLSearchParams({ busqueda, pagina: paginaActual });
            const res    = await fetch(`/store/inventario/json?${params}`);
            const data   = await res.json();
            if (!data.success) throw new Error();

            renderTabla(data.packs || [], data.productos || []);

            generarPaginacion('#inv-paginacion', data.totalPaginas, data.paginaActual, (p) => {
                paginaActual = p;
                loadInventario();
            });
        } catch {
            tbody.innerHTML = `<tr>
                <td colspan="6" class="p-8 text-center text-gray-500">Error al cargar el inventario.</td>
            </tr>`;
        }
    };

    // ─── RENDER ───────────────────────────────────────────────────────────────
    const renderTabla = (packs, productos) => {
        if (!packs.length && !productos.length) {
            tbody.innerHTML = `<tr>
                <td colspan="6" class="p-8 text-center text-gray-500">No hay productos en inventario.</td>
            </tr>`;
            return;
        }
        tbody.innerHTML = packs.map(renderRowPack).join('') + productos.map(renderRowProducto).join('');
        bindAcciones();
    };

    const renderRowPack = (stock) => {
        const pack    = stock.packOrigen;
        const detalles = pack?.DETALLES_PACKs || [];
        const precio  = detalles.reduce((s, d) => s + (parseFloat(d.producto?.precioVentaMayorista || 0) * d.cantidad), 0);
        const contenido = detalles.map(d => `${d.producto?.nombreProducto || '—'} ×${d.cantidad}`).join(', ');

        return `
        <tr class="border-b border-purple-100 hover:bg-purple-50/60 transition-colors bg-purple-50/30"
            data-id-pack="${pack?.idPack || ''}"
            data-detalles='${JSON.stringify(detalles.map(d => ({ nombre: d.producto?.nombreProducto, cantidad: d.cantidad })))}'>
            <td class="p-4">
                <img src="/img/avatars/pack.webp" class="w-12 h-12 object-contain rounded-lg shadow-sm bg-purple-100 p-1">
            </td>
            <td class="p-4">
                <div class="flex items-center gap-2 mb-0.5">
                    <span class="text-xs font-bold text-white bg-purple-500 rounded px-1.5 py-0.5">PACK</span>
                    <span class="font-bold text-gray-800 font-mono">${pack?.codigoEtiqueta || '—'}</span>
                </div>
                <div class="text-xs text-gray-400 max-w-xs truncate" title="${contenido}">${contenido}</div>
            </td>
            <td class="p-4 text-sm font-semibold text-gh-primary">
                ${window.formatMoney(precio, 0)}
                <div class="text-xs text-gray-400 font-normal">Pack completo</div>
            </td>
            <td class="p-4 text-center text-sm">${stock.cantidadExistente ?? 0}</td>
            <td class="p-4 text-center text-sm text-gray-400">—</td>
            <td class="p-4">
                <div class="relative inline-block accion-dropdown">
                    <button type="button" class="btn btn-secondary cursor-pointer btn-acciones">
                        <i class="fi-rr-menu-dots-vertical text-lg"></i>
                        Acciones
                    </button>
                    <ul class="hidden absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg z-50 w-40 p-1 border border-gray-100 text-sm accion-menu">
                        <li><a class="btn-trasladar-pack flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                            data-id-pack="${pack?.idPack}">
                            <i class="fi fi-rr-convert-shapes text-purple-500"></i>Trasladar
                        </a></li>
                        <li><a class="btn-desempacar flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer"
                            data-id-pack="${pack?.idPack}"
                            data-codigo="${pack?.codigoEtiqueta}"
                            data-detalles='${JSON.stringify(detalles.map(d => ({ nombre: d.producto?.nombreProducto, cantidad: d.cantidad })))}'>
                            <i class="fi fi-rr-box-open-full"></i>Desempacar
                        </a></li>
                    </ul>
                </div>
            </td>
        </tr>`;
    };

    const renderRowProducto = (p) => {
        const img     = p.imagenes?.find(i => i.tipo === 'principal') || p.imagenes?.[0];
        const imgUrl  = img?.nombreImagen ? `${R2}${img.nombreImagen}` : '/img/image-default.webp';

        return `
        <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
            <td class="p-4">
                <img src="${imgUrl}" class="w-12 h-12 object-cover rounded-lg shadow-sm">
            </td>
            <td class="p-4">
                <div class="font-bold text-gray-800">${p.nombreProducto}</div>
                <div class="text-xs text-gray-400">SKU: ${p.sku}</div>
            </td>
            <td class="p-4 text-sm font-semibold text-gh-primary">
                ${window.formatMoney(p.precioVentaPublicoFinal, 0)}
                <div class="text-xs text-gray-400 font-normal">Mayorista: ${window.formatMoney(p.precioVentaMayorista, 0)}</div>
            </td>
            <td class="p-4 text-center text-sm">${p.stockTienda ?? 0}</td>
            <td class="p-4 text-center text-sm">${p.stockGlobal ?? 0}</td>
            <td class="p-4">
                <a href="/store/inventario/perfilProducto/${p.idProducto}"
                   class="btn btn-secondary text-sm cursor-pointer flex items-center gap-2 w-fit">
                    <i class="fi fi-rr-eye"></i>
                    Ver más
                </a>
            </td>
        </tr>`;
    };

    // ─── BIND ACCIONES ────────────────────────────────────────────────────────
    const cerrarTodosMenus = () => {
        document.querySelectorAll('.accion-menu').forEach(m => m.classList.add('hidden'));
    };

    const bindAcciones = () => {
        document.querySelectorAll('.btn-desempacar').forEach(btn =>
            btn.addEventListener('click', () => confirmarDesempacar(btn))
        );
        document.querySelectorAll('.btn-trasladar-pack').forEach(btn =>
            btn.addEventListener('click', () => abrirModalTraslado([btn.dataset.idPack]))
        );
        document.querySelectorAll('.accion-dropdown').forEach(dd => {
            const btn  = dd.querySelector('.btn-acciones');
            const menu = dd.querySelector('.accion-menu');
            let closeTimer = null;

            // Mover el menú al body para escapar del overflow del contenedor
            document.body.appendChild(menu);
            menu.style.position = 'fixed';
            menu.style.zIndex   = '9999';

            const posicionarMenu = () => {
                const rect = btn.getBoundingClientRect();
                menu.style.top  = `${rect.bottom + 4}px`;
                menu.style.left = `${rect.right - menu.offsetWidth}px`;
            };

            const cancelClose = () => clearTimeout(closeTimer);
            const scheduleClose = () => { closeTimer = setTimeout(() => menu.classList.add('hidden'), 120); };

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const abierto = !menu.classList.contains('hidden');
                cerrarTodosMenus();
                if (!abierto) {
                    menu.classList.remove('hidden');
                    posicionarMenu();
                }
            });

            btn.addEventListener('mouseleave', scheduleClose);
            btn.addEventListener('mouseenter', cancelClose);
            menu.addEventListener('mouseenter', cancelClose);
            menu.addEventListener('mouseleave', () => menu.classList.add('hidden'));
        });
    };

    document.addEventListener('click', cerrarTodosMenus);

    // ─── DESEMPACAR ───────────────────────────────────────────────────────────
    const confirmarDesempacar = async (btn) => {
        const idPack = btn.dataset.idPack;
        const codigo = btn.dataset.codigo;
        let detalles = [];
        try { detalles = JSON.parse(btn.dataset.detalles); } catch {}

        const listaHtml = detalles.map(d =>
            `<li class="text-sm py-0.5 text-left"><span class="font-semibold">${d.nombre || '—'}</span> <span class="text-gray-400">×${d.cantidad}</span></li>`
        ).join('');

        const { value: codigoEmp } = await Swal.fire({
            title:             `Desempacar ${codigo}`,
            html: `
                <p class="text-sm text-gray-500 mb-3">Esto separará el pack en productos individuales en stock:</p>
                <ul class="list-disc list-inside mb-4">${listaHtml}</ul>
                <label class="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1 text-left">Código empleado responsable *</label>
                <input id="swal-emp" class="swal2-input font-mono uppercase tracking-widest" maxlength="5" placeholder="Ej: 12345" autocomplete="new-password">`,
            showCancelButton:  true,
            confirmButtonText: 'Confirmar desempacar',
            cancelButtonText:  'Cancelar',
            confirmButtonColor: '#E24C95',
            focusConfirm: false,
            preConfirm: () => {
                const val = document.getElementById('swal-emp')?.value?.trim();
                if (!val) { Swal.showValidationMessage('El código de empleado es obligatorio'); return false; }
                return val;
            }
        });

        if (!codigoEmp) return;

        try {
            const r = await fetch('/store/inventario/desempacar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ idPack, codigoEmpleado: codigoEmp.toUpperCase() })
            });
            const data = await r.json();
            if (data.success) {
                await Swal.fire({ icon: 'success', title: 'Pack desempacado', text: 'Los productos quedaron disponibles en stock.', confirmButtonColor: '#E24C95' });
                loadInventario();
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: data.mensaje || 'Error interno.', confirmButtonColor: '#E24C95' });
            }
        } catch {
            Swal.fire({ icon: 'error', title: 'Error de conexión', confirmButtonColor: '#E24C95' });
        }
    };

    // ─── MODAL TRASLADO ───────────────────────────────────────────────────────
    const abrirModalTraslado = async (packs) => {
        packsSeleccionados = packs;
        if (lblPacksCount) lblPacksCount.textContent = packs.length;
        if (inputEmpTras)  inputEmpTras.value = '';
        if (feedbackEmpTras) feedbackEmpTras.innerHTML = '';
        if (inputNotasTras) inputNotasTras.value = '';
        empleadoVal = null;

        if (selDestino && selDestino.options.length <= 1) {
            try {
                const res      = await fetch('/store/json/destinos');
                const destinos = await res.json();
                destinos.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.idPuntoDeVenta;
                    opt.text  = d.nombreComercial;
                    selDestino.add(opt);
                });
            } catch {}
        }

        modalTras?.classList.remove('hidden');
    };

    const cerrarModalTraslado = () => {
        modalTras?.classList.add('hidden');
        if (selDestino) selDestino.value = '';
    };

    document.querySelectorAll('#tras-cancelar').forEach(b => b.addEventListener('click', cerrarModalTraslado));
    document.getElementById('modal-traslado-overlay')?.addEventListener('click', cerrarModalTraslado);

    inputEmpTras?.addEventListener('input', () => {
        clearTimeout(empLookupTimer);
        empleadoVal = null;
        const code = inputEmpTras.value.trim();
        if (!code) { feedbackEmpTras.innerHTML = ''; return; }

        feedbackEmpTras.innerHTML = `<span class="text-gray-400 text-xs"><i class="fi fi-rr-spinner animate-spin mr-1"></i>Buscando...</span>`;
        empLookupTimer = setTimeout(async () => {
            try {
                const r = await fetch(`/store/json/personal/codigo/${encodeURIComponent(code.toUpperCase())}`);
                const d = await r.json();
                if (d.success) {
                    empleadoVal = code.toUpperCase();
                    feedbackEmpTras.innerHTML = `<span class="text-green-600 text-xs font-semibold"><i class="fi fi-rr-check mr-1"></i>${d.nombre}</span>`;
                } else {
                    feedbackEmpTras.innerHTML = `<span class="text-red-500 text-xs">No encontrado</span>`;
                }
            } catch {
                feedbackEmpTras.innerHTML = `<span class="text-red-500 text-xs">Error al buscar</span>`;
            }
        }, 500);
    });

    btnConfirmTras?.addEventListener('click', async () => {
        const idDestino = selDestino?.value;
        if (!idDestino) { window.showToast?.('Selecciona un destino.', 'warning'); return; }
        if (!empleadoVal) { window.showToast?.('Ingresa un código de empleado válido.', 'warning'); inputEmpTras?.focus(); return; }

        btnConfirmTras.disabled  = true;
        btnConfirmTras.textContent = 'Procesando...';

        try {
            const r = await fetch('/store/inventario/trasladar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({
                    packs:          packsSeleccionados,
                    idDestino,
                    codigoEmpleado: empleadoVal,
                    notas:          inputNotasTras?.value?.trim() || ''
                })
            });
            const data = await r.json();
            if (data.success) {
                cerrarModalTraslado();
                await Swal.fire({ icon: 'success', title: `Traslado ${data.codigo}`, text: 'Pack trasladado correctamente.', confirmButtonColor: '#E24C95' });
                if (data.idTraslado) window.open(`/store/traslados/comprobante/${data.idTraslado}`, '_blank');
                loadInventario();
            } else {
                window.showToast?.(data.mensaje || 'Error al trasladar.', 'error');
            }
        } catch {
            window.showToast?.('Error de conexión.', 'error');
        } finally {
            btnConfirmTras.disabled  = false;
            btnConfirmTras.textContent = 'Confirmar Traslado';
        }
    });

    // ─── BUSCADOR ─────────────────────────────────────────────────────────────
    inputSearch?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            busqueda     = inputSearch.value;
            paginaActual = 1;
            loadInventario();
        }, 400);
    });

    // ─── INIT ─────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', loadInventario);

})();

// ─── FORMULARIO TRASLADO EN PERFIL DE PRODUCTO ───────────────────────────────
(function () {
    const csrfToken   = document.getElementById('csrf-token')?.value || '';
    const btnSubmit   = document.getElementById('ptp-submit');
    const inputEmp    = document.getElementById('ptp-empleado');
    const feedbackEmp = document.getElementById('ptp-feedback-emp');

    if (!btnSubmit) return; // Solo ejecutar en perfilProducto

    let empleadoValido = false;
    let empTimer = null;

    const setFeedback = (msg, ok) => {
        if (!feedbackEmp) return;
        feedbackEmp.textContent = msg;
        feedbackEmp.className = `text-xs h-4 ml-1 transition-colors ${ok ? 'text-green-600 font-semibold' : 'text-rose-500'}`;
    };

    const checkBtn = () => {
        const cantidad  = parseInt(document.getElementById('ptp-cantidad')?.value) || 0;
        const destino   = document.getElementById('ptp-destino')?.value || '';
        if (btnSubmit) btnSubmit.disabled = !(empleadoValido && cantidad >= 1 && destino);
    };

    inputEmp?.addEventListener('input', () => {
        clearTimeout(empTimer);
        empleadoValido = false;
        checkBtn();
        const code = inputEmp.value.trim();
        if (!code) { setFeedback('', false); return; }

        setFeedback('Verificando...', false);
        empTimer = setTimeout(async () => {
            try {
                const r = await fetch(`/store/inventario/json/empleado-traslado?codigo=${encodeURIComponent(code.toUpperCase())}`);
                const d = await r.json();
                if (d.success) {
                    empleadoValido = true;
                    setFeedback(`✓ ${d.nombre}`, true);
                } else {
                    empleadoValido = false;
                    setFeedback(d.mensaje || 'Sin permiso.', false);
                }
            } catch {
                setFeedback('Error de conexión.', false);
            }
            checkBtn();
        }, 500);
    });

    document.getElementById('ptp-cantidad')?.addEventListener('input', checkBtn);
    document.getElementById('ptp-destino')?.addEventListener('change', checkBtn);

    btnSubmit?.addEventListener('click', async () => {
        const idProducto     = document.getElementById('ptp-id-producto')?.value;
        const cantidad       = parseInt(document.getElementById('ptp-cantidad')?.value);
        const idDestino      = document.getElementById('ptp-destino')?.value;
        const codigoEmpleado = inputEmp?.value?.trim().toUpperCase();
        const notas          = document.getElementById('ptp-notas')?.value?.trim() || '';

        if (!idProducto || !cantidad || !idDestino || !codigoEmpleado) return;

        const { isConfirmed } = await Swal.fire({
            title:             'Confirmar traslado',
            html:              `<p class="text-sm text-gray-600">¿Trasladar <strong>${cantidad}</strong> unidad(es) al destino seleccionado?</p>`,
            icon:              'question',
            showCancelButton:  true,
            confirmButtonText: 'Sí, trasladar',
            cancelButtonText:  'Cancelar',
            confirmButtonColor: '#EC5FA3'
        });
        if (!isConfirmed) return;

        btnSubmit.disabled   = true;
        btnSubmit.innerHTML  = '<i class="fi fi-rr-spinner animate-spin mr-2"></i>Procesando...';

        try {
            const r = await fetch('/store/inventario/traslado-producto', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body:    JSON.stringify({ idProducto, cantidad, idDestino, codigoEmpleado, notas })
            });
            const data = await r.json();

            if (data.success) {
                await Swal.fire({
                    icon:              'success',
                    title:             `Traslado ${data.codigo}`,
                    text:              'Traslado creado correctamente.',
                    confirmButtonColor: '#EC5FA3'
                });
                if (data.idTraslado) {
                    window.open(`/store/traslados/comprobante/${data.idTraslado}`, '_blank');
                }
                // Recargar para actualizar stock
                window.location.reload();
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: data.mensaje || 'Error al crear el traslado.', confirmButtonColor: '#EC5FA3' });
                btnSubmit.disabled  = false;
                btnSubmit.innerHTML = '<i class="fi fi-rr-paper-plane mr-2"></i>Hacer Traslado';
            }
        } catch {
            Swal.fire({ icon: 'error', title: 'Error de conexión', confirmButtonColor: '#EC5FA3' });
            btnSubmit.disabled  = false;
            btnSubmit.innerHTML = '<i class="fi fi-rr-paper-plane mr-2"></i>Hacer Traslado';
        }
    });
})();
