import { tituloLista as tc } from '../../helpers/textoLista.js';
import { crearSeleccionMultiple } from './seleccionMultiple.js';
import { escaparHtml as esc } from './escaparHtml.js';
import { opcionesConfirmacion, cabeceraConfirmacion, filaConfirmacion, activarVerificacionCodigo } from './modalConfirmacion.js';
(function () {
    const csrfToken = document.getElementById('csrf-token')?.value || '';
    const R2 = 'https://pub-f89c3f57ac314e868860b81774b10373.r2.dev/productos/';

    // ─── ESTADO ──────────────────────────────────────────────────────────────
    let paginaActual    = 1;
    let busqueda        = '';
    let searchTimer     = null;

    // ─── REFERENCIAS DOM ─────────────────────────────────────────────────────
    const tbody       = document.getElementById('inv-tbody');
    const inputSearch = document.getElementById('inv-search');

    const btnTrasladarSel  = document.getElementById('inv-trasladar-seleccionados');
    const btnDesempacarSel = document.getElementById('inv-desempacar-seleccionados');

    const seleccion = crearSeleccionMultiple({
        selectorCheckbox: '.checkbox-pack-inv',
        selectAll: document.getElementById('inv-select-all'),
        botones: [
            { el: btnTrasladarSel },
            // Con un solo pack marcado está la acción de su fila; el botón en masa aparece de dos
            // en adelante, que es cuando ahorra abrir el menú una vez por bulto.
            { el: btnDesempacarSel, minimo: 2 }
        ]
    });

    // Código y contenido de cada pack que pasó por la tabla. Hace falta guardarlo: la selección
    // sobrevive a filtrar, así que al confirmar puede haber packs elegidos que ya no están
    // pintados y de los que igual hay que mostrar el código.
    const infoPacks = new Map();

    // ─── CARGAR INVENTARIO ───────────────────────────────────────────────────
    const loadInventario = async () => {
        if (!tbody) return;
        tbody.innerHTML = `<tr>
            <td colspan="7" class="p-8 text-center text-gray-500">
                <i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando inventario...
            </td></tr>`;

        try {
            const params = new URLSearchParams({ busqueda, pagina: paginaActual });
            const res    = await fetch(`/store/inventario/json?${params}`);
            const data   = await res.json();
            if (!data.success) throw new Error();

            // Los packs no se paginan: sin búsqueda llega la lista completa de la tienda, y lo
            // que ya no está (lo trasladó, vendió o desempacó otra caja) sale de la selección.
            if (!busqueda.trim()) {
                seleccion.conservarSolo((data.packs || []).map(s => s.packOrigen?.idPack).filter(Boolean));
            }
            renderTabla(data.packs || [], data.productos || []);

            generarPaginacion('#inv-paginacion', data.totalPaginas, data.paginaActual, (p) => {
                paginaActual = p;
                loadInventario();
            });
        } catch {
            tbody.innerHTML = `<tr>
                <td colspan="7" class="p-8 text-center text-gray-500">Error al cargar el inventario.</td>
            </tr>`;
        }
    };

    // ─── RENDER ───────────────────────────────────────────────────────────────
    const renderTabla = (packs, productos) => {
        if (!packs.length && !productos.length) {
            tbody.innerHTML = `<tr>
                <td colspan="7" class="p-8 text-center text-gray-500">No hay productos en inventario.</td>
            </tr>`;
            seleccion.enlazar();
            return;
        }
        tbody.innerHTML = packs.map(renderRowPack).join('') + productos.map(renderRowProducto).join('');
        bindAcciones();
        seleccion.enlazar();
    };

    const renderRowPack = (stock) => {
        const pack    = stock.packOrigen;
        const detalles = pack?.DETALLES_PACKs || [];
        const precio  = detalles.reduce((s, d) => s + (parseFloat(d.producto?.precioVentaMayorista || 0) * d.cantidad), 0);
        const contenido = detalles.map(d => `${tc(d.producto?.nombreProducto) || '—'} ×${d.cantidad}`).join(', ');

        if (pack?.idPack) {
            infoPacks.set(String(pack.idPack), {
                codigo: pack.codigoEtiqueta || '—',
                lineas: detalles.map(d => ({ nombre: tc(d.producto?.nombreProducto), cantidad: d.cantidad }))
            });
        }

        return `
        <tr class="border-b border-purple-100 hover:bg-purple-50/60 transition-colors bg-purple-50/30"
            data-id-pack="${pack?.idPack || ''}">
            <td class="p-4 text-center">
                <input type="checkbox" value="${pack?.idPack || ''}" ${seleccion.estaMarcado(pack?.idPack) ? 'checked' : ''}
                       title="Seleccionar ${pack?.codigoEtiqueta || 'pack'}"
                       class="checkbox-pack-inv checkbox cursor-pointer">
            </td>
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
                            data-id-pack="${pack?.idPack}">
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
            <td class="p-4"></td>
            <td class="p-4">
                <img src="${imgUrl}" class="w-12 h-12 object-cover rounded-lg shadow-sm">
            </td>
            <td class="p-4">
                <div class="font-bold text-gray-800">${tc(p.nombreProducto)}</div>
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
            btn.addEventListener('click', () => confirmarDesempacar([btn.dataset.idPack]))
        );
        document.querySelectorAll('.btn-trasladar-pack').forEach(btn =>
            btn.addEventListener('click', () => confirmarTraslado([btn.dataset.idPack]))
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

    // ─── VENTANA DE PACKS ─────────────────────────────────────────────────────
    // Desempacar y trasladar confirman lo mismo —qué bultos salen de este inventario y quién
    // lo autoriza—, así que comparten una ventana: la de views/components/modalConfirmacion.pug,
    // la misma con la que se confirma un abono o un egreso. Cambia el verbo, el total y los
    // campos que cada una necesita (el traslado pide destino y notas).
    //
    // Uno o varios: el menú de la fila manda un solo id y los botones de selección mandan los
    // marcados. El servidor resuelve cada acción en una transacción: o salen todos o ninguno.
    const unidadesDe = (info) => (info?.lineas || []).reduce((s, l) => s + (parseInt(l.cantidad) || 0), 0);

    const listaHtml = (idsPack) => {
        // Un solo pack: se listan sus prendas, que es lo que el operario va a tener en la mano.
        if (idsPack.length === 1) {
            return (infoPacks.get(idsPack[0])?.lineas || []).map(l => filaConfirmacion({
                icono: 'fi-rr-tags', fondo: '#F1F5F9', color: '#475569',
                titulo: esc(l.nombre || '—'),
                derecha: `×${esc(l.cantidad)}`
            })).join('');
        }
        // Varios: se listan los bultos y no sus prendas — diez packs de doce serían 120 filas.
        return idsPack.map((id) => {
            const info = infoPacks.get(id);
            return filaConfirmacion({
                icono: 'fi-rr-box-open-full', fondo: '#F3E8FF', color: '#7E22CE',
                titulo: esc(info?.codigo || id),
                sub: esc((info?.lineas || []).map(l => `${l.nombre || '—'} ×${l.cantidad}`).join(', ')),
                derecha: `${unidadesDe(info)} u.`
            });
        }).join('');
    };

    /**
     * Abre la ventana y devuelve lo confirmado ({ codigoEmpleado, ...extras }) o null.
     *
     * @param campos   HTML de los campos propios de la acción; van antes del código de
     *                 empleado, que es la firma y cierra la ventana.
     * @param listo    condición extra para habilitar el botón (además del código verificado).
     * @param recoger  lee los campos al confirmar: devuelve un objeto, o un texto con lo que falta.
     */
    const ventanaPacks = async ({ packs, icono, badge, contexto, totalLabel, confirmar, campos = '', listo = () => true, recoger = () => ({}) }) => {
        let empleado = null;
        const { value } = await Swal.fire(opcionesConfirmacion({
            variante: 'pack',
            html: `
                <div class="gh-conf-html">
                    ${cabeceraConfirmacion({ icono, badge, contexto })}
                    <div class="gh-conf-lista">${listaHtml(packs)}</div>
                    <div class="gh-conf-total">
                        <span class="gh-conf-total-label">${totalLabel}</span>
                        <span class="gh-conf-total-valor">${packs.reduce((s, id) => s + unidadesDe(infoPacks.get(id)), 0)}</span>
                    </div>
                    ${campos}
                    <p class="gh-conf-campo-label">Código del empleado responsable:</p>
                    <div class="gh-conf-campo">
                        <input id="gh-packs-codigo" type="password" class="gh-conf-input"
                               placeholder="Código de empleado" autocomplete="new-password">
                    </div>
                    <p id="gh-packs-estado" class="gh-conf-estado"></p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: confirmar,
            cancelButtonText: 'Cancelar',
            didOpen: (popup) => {
                const boton = Swal.getConfirmButton();
                const actualizar = () => { if (boton) boton.disabled = !(empleado && listo()); };
                actualizar();
                // Cualquier campo propio de la acción (el destino) vuelve a evaluar el botón.
                popup.addEventListener('change', actualizar);
                popup.addEventListener('input', actualizar);
                activarVerificacionCodigo('gh-packs-codigo', 'gh-packs-estado', (emp) => { empleado = emp; actualizar(); });
                (popup.querySelector('[data-foco]') || document.getElementById('gh-packs-codigo'))?.focus();
            },
            preConfirm: () => {
                const extras = recoger();
                if (typeof extras === 'string') { Swal.showValidationMessage(extras); return false; }
                if (!empleado) { Swal.showValidationMessage('Verificá el código del empleado.'); return false; }
                return { codigoEmpleado: empleado.codigoEmpleado, ...extras };
            }
        }));
        return value || null;
    };

    // POST de una acción sobre packs y su respuesta, igual para las dos.
    const enviarPacks = async (url, body) => {
        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify(body)
            });
            const data = await r.json();
            if (!data.success) {
                Swal.fire({ icon: 'error', title: 'No se completó', text: data.mensaje || 'Error interno.', confirmButtonColor: '#7E22CE' });
                return null;
            }
            seleccion.quitar(body.packs);
            return data;
        } catch {
            Swal.fire({ icon: 'error', title: 'Error de conexión', confirmButtonColor: '#7E22CE' });
            return null;
        }
    };

    // ─── DESEMPACAR ───────────────────────────────────────────────────────────
    const confirmarDesempacar = async (idsPack) => {
        const packs = [...new Set(idsPack.map(String).filter(Boolean))];
        if (!packs.length) return;
        const unSolo = packs.length === 1;

        const ok = await ventanaPacks({
            packs,
            icono: 'fi-rr-box-open-full',
            badge: unSolo ? 'Desempacar pack' : `Desempacar ${packs.length} packs`,
            contexto: unSolo
                ? `<strong>${esc(infoPacks.get(packs[0])?.codigo || '')}</strong> se abre y sus prendas quedan sueltas en esta tienda.`
                : `${packs.length} bultos se abren y sus prendas quedan sueltas en esta tienda.`,
            totalLabel: 'Unidades que quedan sueltas',
            confirmar: unSolo ? 'Desempacar' : `Desempacar los ${packs.length}`
        });
        if (!ok) return;

        const unidades = packs.reduce((s, id) => s + unidadesDe(infoPacks.get(id)), 0);
        const data = await enviarPacks('/store/inventario/desempacar', { packs, codigoEmpleado: ok.codigoEmpleado });
        if (!data) return;
        await Swal.fire({
            icon: 'success',
            title: unSolo ? 'Pack desempacado' : `${packs.length} packs desempacados`,
            text: `${unidades} unidades quedaron disponibles en stock.`,
            confirmButtonColor: '#7E22CE'
        });
        loadInventario();
    };

    btnDesempacarSel?.addEventListener('click', () => confirmarDesempacar([...seleccion.seleccionados]));

    // ─── TRASLADAR ────────────────────────────────────────────────────────────
    // Los destinos se piden una vez por visita: son las otras sedes, no cambian mientras se usa
    // la pantalla.
    let destinos = null;
    const cargarDestinos = async () => {
        if (destinos) return destinos;
        try {
            const r = await fetch('/store/json/destinos');
            destinos = await r.json();
        } catch {
            destinos = null;
        }
        return destinos || [];
    };

    const confirmarTraslado = async (idsPack) => {
        const packs = [...new Set(idsPack.map(String).filter(Boolean))];
        if (!packs.length) return;
        const unSolo = packs.length === 1;

        const lista = await cargarDestinos();
        if (!lista.length) {
            Swal.fire({ icon: 'error', title: 'No hay destinos', text: 'No se pudieron cargar las sedes de destino.', confirmButtonColor: '#7E22CE' });
            return;
        }

        const ok = await ventanaPacks({
            packs,
            icono: 'fi-rr-convert-shapes',
            badge: unSolo ? 'Trasladar pack' : `Trasladar ${packs.length} packs`,
            contexto: unSolo
                ? `<strong>${esc(infoPacks.get(packs[0])?.codigo || '')}</strong> sale de esta tienda y queda en tránsito hasta que el destino lo reciba.`
                : `${packs.length} bultos salen de esta tienda y quedan en tránsito hasta que el destino los reciba.`,
            totalLabel: 'Unidades que salen',
            confirmar: unSolo ? 'Trasladar' : `Trasladar los ${packs.length}`,
            // `required` + opción vacía: el select se ve en gris mientras no hay destino
            // (select:invalid en la hoja), como un placeholder.
            campos: `
                <p class="gh-conf-campo-label">Destino:</p>
                <div class="gh-conf-campo">
                    <select id="gh-traslado-destino" class="gh-conf-input" required data-foco>
                        <option value="">Selecciona bodega o almacén…</option>
                        ${lista.map(d => `<option value="${esc(d.idPuntoDeVenta)}">${esc(d.nombreComercial)}</option>`).join('')}
                    </select>
                </div>
                <p class="gh-conf-campo-label">Notas <span class="gh-conf-opcional">(opcional)</span>:</p>
                <div class="gh-conf-campo">
                    <textarea id="gh-traslado-notas" class="gh-conf-input" rows="2" placeholder="Observaciones del traslado…"></textarea>
                </div>`,
            listo: () => !!document.getElementById('gh-traslado-destino')?.value,
            recoger: () => {
                const idDestino = document.getElementById('gh-traslado-destino')?.value;
                if (!idDestino) return 'Elegí el destino.';
                return { idDestino, notas: document.getElementById('gh-traslado-notas')?.value.trim() || '' };
            }
        });
        if (!ok) return;

        const data = await enviarPacks('/store/inventario/trasladar', { packs, ...ok });
        if (!data) return;
        await Swal.fire({
            icon: 'success',
            title: `Traslado ${data.codigo}`,
            text: unSolo ? 'Pack trasladado correctamente.' : `${packs.length} packs trasladados correctamente.`,
            confirmButtonColor: '#7E22CE'
        });
        if (data.idTraslado) window.open(`/store/traslados/comprobante/${data.idTraslado}`, '_blank');
        loadInventario();
    };

    btnTrasladarSel?.addEventListener('click', () => confirmarTraslado([...seleccion.seleccionados]));

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
