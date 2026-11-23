import { opcionesConfirmacion, cabeceraConfirmacion, activarVerificacionCodigo } from './modalConfirmacion.js';
import { campoCodigoEmpleado, codigoRequerido } from './codigoCajitas.js';
import { escaparHtml as esc } from './escaparHtml.js';
import { initFechaInput } from './fechaInput.js';
import { iniciarModalLineaInsumo, UNIDAD_ETIQUETA, aPayloadLinea } from './modalLineaInsumo.js';
import { pedirRecepcion, avisoRecepcion } from './recepcionOrden.js';

// Detalle/edición de UNA orden de compra o cotización ya creada
// (admin/insumos/compra/:idOrdenCompra, controller/ordenesCompraController.js). Estado,
// notas y fecha estimada de entrega siempre se pueden cambiar; agregar/quitar insumos solo
// cuando el servidor marcó `data-permite-lineas="1"` (helpers/ordenesCompra.js
// permiteEditarLineasOrden) — el botón "Agregar insumo" ni siquiera se pinta si no, pero el
// servidor es la garantía real (CLAUDE.md §12), esto solo evita que el navegador construya
// un payload que de todas formas se iba a ignorar.

const form = document.getElementById('form-orden-detalle');
if (form) {
    const ID_ORDEN = form.dataset.idOrden;
    const PERMITE_LINEAS = form.dataset.permiteLineas === '1';
    const FECHA_ORDEN = form.dataset.fechaOrden; // 'YYYY-MM-DD', de solo lectura en esta pantalla
    const PORCENTAJE_IVA = Number(form.dataset.porcentajeIva) || 0;

    const money = (n) => `$ ${Math.round(n).toLocaleString('es-CO')}`;
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    // Al abrir una ventana que pide código de empleado: el botón arranca apagado y se prende
    // cuando el código es válido para esta orden. Lo usan guardar, convertir y recibir.
    const abrirConCodigoEmpleado = (codigoId, estadoId) => {
        const boton = Swal.getConfirmButton();
        boton.disabled = true;
        activarVerificacionCodigo(codigoId, estadoId, (emp) => { boton.disabled = !emp; }, {
            urlValidar: (codigo) => `/admin/insumos/compra/${ID_ORDEN}/empleado/validar/${encodeURIComponent(codigo)}`
        });
        document.getElementById(codigoId)?.focus();
    };

    // ── Fecha estimada de entrega (Flatpickr) ───────────────────────────────────────────
    // La fecha de la orden es fija (ya pasó, es de solo lectura) — acá solo hay una fecha
    // que mover, así que no hace falta el aviso de "se limpió sola" de ordenCompra.js: el
    // minDate nunca cambia después de cargada la página.
    const fpEntrega = initFechaInput(document.getElementById('fechaEntregaEstimada'), {
        minDate: FECHA_ORDEN || new Date()
    });

    const validarFechas = () => {
        const entregaTxt = document.getElementById('fechaEntregaEstimada').value;
        const errEl = document.getElementById('error-fechaEntregaEstimada');
        const invalido = Boolean(entregaTxt && FECHA_ORDEN && entregaTxt < FECHA_ORDEN);
        if (errEl) {
            errEl.textContent = invalido ? 'La entrega no puede ser antes de la fecha de la orden.' : '';
            errEl.classList.toggle('hidden', !invalido);
        }
        fpEntrega?.altInput?.classList.toggle('field-text-error', invalido);
        return !invalido;
    };

    // ── Estado (tarjetas de color, no <select>) ─────────────────────────────────────────
    // Mismo patrón que el toggle de régimen fiscal en dataCliente.js: swap de className
    // completo por tarjeta, leyendo el color de cada una de su propio data-attribute
    // (ordenCompraDetalle.pug ya lo pintó ahí, uno por ESTADOS_ORDEN). Así una tarjeta
    // nueva en el catálogo no necesita tocar este archivo.
    (function () {
        const contenedorEstado = document.getElementById('estadoOrden');
        if (!contenedorEstado) return;

        const BASE = 'gh-estado-opcion relative flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 cursor-pointer overflow-hidden transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-gh-primary';
        // Activa: color propio + sombra + el barrido de brillo de .gh-estado-shine (CSS,
        // un solo barrido por `::before`, no en bucle). Inactiva: se ve apagada —
        // opacity-60, sube a 100 solo en hover — para que la elegida resalte de verdad y
        // no compita con cinco tarjetas iguales de "disponibles".
        const INACTIVO = 'border-slate-200 bg-white opacity-60 hover:opacity-100 hover:border-slate-300 hover:bg-slate-50';

        const repintar = () => {
            contenedorEstado.querySelectorAll('.gh-estado-opcion').forEach((tarjeta) => {
                const activa = tarjeta.querySelector('input[name="estado"]').checked;
                tarjeta.className = `${BASE} ${activa ? `${tarjeta.dataset.borde} ${tarjeta.dataset.fondo} opacity-100 shadow-sm gh-estado-shine` : INACTIVO}`;
                const texto = tarjeta.querySelector('.gh-estado-texto');
                if (texto) texto.className = `gh-estado-texto text-xs font-semibold flex-1 truncate ${activa ? tarjeta.dataset.texto : 'text-slate-600'}`;
                const check = tarjeta.querySelector('.gh-estado-check');
                if (check) check.className = `gh-estado-check w-4 h-4 rounded-full items-center justify-center flex-shrink-0 ${tarjeta.dataset.check} ${activa ? 'flex' : 'hidden'}`;
            });
        };
        // "Recibida" no se elige a mano: la tarjeta abre "Recibir orden", que es lo que mete la
        // mercancía al inventario (el servidor rechaza el cambio manual igual). El estado
        // vuelve al que estaba hasta que la recepción se confirme.
        const estadoInicial = contenedorEstado.querySelector('input[name="estado"]:checked')?.value;
        contenedorEstado.querySelectorAll('input[name="estado"]').forEach((radio) => radio.addEventListener('change', () => {
            if (radio.value === 'recibida' && estadoInicial !== 'recibida') {
                const anterior = contenedorEstado.querySelector(`input[name="estado"][value="${estadoInicial}"]`);
                if (anterior) anterior.checked = true;
                repintar();
                document.getElementById('btn-recibir-orden')?.click();
                return;
            }
            repintar();
        }));
    })();

    // ── Líneas (insumos) ────────────────────────────────────────────────────────────────
    const tabla = document.getElementById('tabla-lineas-orden');
    const filaVacia = document.getElementById('sin-lineas-orden');
    // uid negativo para una línea nueva todavía no guardada: nunca choca con un
    // idDetalleOrdenCompra real (siempre positivo, autoincrement).
    let proximoUidNueva = -1;

    // Base de las líneas que YA existían al cargar la página — valorTotal sale del
    // data-attribute que pintó el servidor (ordenCompraDetalle.pug), no se vuelve a leer
    // el texto formateado de la celda.
    const lineasExistentesBase = Array.from(tabla.querySelectorAll('tr[data-origen="existente"]')).map(tr => ({
        idDetalleOrdenCompra: Number(tr.dataset.uid),
        valorTotal: Number(tr.dataset.valorTotal)
    }));
    let idsLineasEliminar = [];

    // Datos completos de esas mismas líneas (insumo, color, características) para poder
    // precargar el modal al editar una — vienen de un <script type="application/json">, no
    // de una asignación `window.x = …`, así que nada de su contenido corre como JS.
    const elDatosLineas = document.getElementById('datos-lineas-orden');
    const mapaLineasExistentes = new Map(
        (elDatosLineas ? JSON.parse(elDatosLineas.textContent) : []).map(l => [l.idDetalleOrdenCompra, l])
    );
    let lineasNuevas = []; // { uid, idMaterial, nombreMaterial, codigoMaterialDxf, cantidad, unidadCompra, valorUnitario, valorTotal, idAtributoColor, colorNombre, caracteristicas }

    const renumerar = () => Array.from(tabla.querySelectorAll('tr[data-origen]')).forEach((tr, i) => { tr.children[0].textContent = i + 1; });

    const recalcularResumen = () => {
        const subtotalExistente = lineasExistentesBase
            .filter(l => !idsLineasEliminar.includes(l.idDetalleOrdenCompra))
            .reduce((acc, l) => acc + l.valorTotal, 0);
        const subtotalNuevas = lineasNuevas.reduce((acc, l) => acc + l.valorTotal, 0);
        const subtotal = round2(subtotalExistente + subtotalNuevas);
        const valorIva = PORCENTAJE_IVA > 0 ? round2(subtotal * (PORCENTAJE_IVA / 100)) : 0;
        const total = round2(subtotal + valorIva);
        const totalItems = tabla.querySelectorAll('tr[data-origen]').length;

        document.getElementById('resumen-items').textContent = totalItems.toLocaleString('es-CO');
        document.getElementById('resumen-subtotal').textContent = money(subtotal);
        const elIva = document.getElementById('resumen-iva');
        if (elIva) elIva.textContent = PORCENTAJE_IVA > 0 ? money(valorIva) : 'Incluido';
        document.getElementById('resumen-total').textContent = money(total);
    };

    const renderFilaNueva = (l) => {
        const caracTexto = [
            l.colorNombre ? `Color: ${l.colorNombre}` : null,
            ...Object.entries(l.caracteristicas || {}).map(([k, v]) => `${k}: ${v}`)
        ].filter(Boolean).map(esc).join('<br>') || '<span class="text-slate-400">—</span>';

        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100';
        tr.dataset.uid = l.uid;
        tr.dataset.origen = 'nueva';
        tr.dataset.valorTotal = l.valorTotal;
        tr.innerHTML = `
            <td class="py-3 pr-3 text-slate-400 tabular-nums"></td>
            <td class="py-3 pr-3">
                <p class="font-semibold text-slate-800">${esc(l.nombreMaterial)}
                    <span class="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600 align-middle">Nuevo</span></p>
                <p class="text-xs text-slate-400">código ${esc(String(l.codigoMaterialDxf))}</p>
            </td>
            <td class="py-3 pr-3 text-center tabular-nums">${l.cantidad.toLocaleString('es-CO')} ${esc(UNIDAD_ETIQUETA[l.unidadCompra] || '')}</td>
            <td class="py-3 pr-3 text-xs text-slate-600 leading-relaxed">${caracTexto}</td>
            <td class="py-3 pr-3 text-right tabular-nums">${money(l.valorUnitario)}</td>
            <td class="py-3 pr-3 text-right font-semibold tabular-nums">${money(l.valorTotal)}</td>
            <td class="py-3 text-right">
                <div class="flex items-center justify-end gap-2.5">
                    <button type="button" data-editar-linea="${l.uid}" class="text-slate-300 hover:text-gh-primaryHover transition-colors cursor-pointer">
                        <i class="fi fi-rr-pencil"></i>
                    </button>
                    <button type="button" data-quitar-linea="${l.uid}" class="text-slate-300 hover:text-rose-500 transition-colors cursor-pointer">
                        <i class="fi fi-rr-trash"></i>
                    </button>
                </div>
            </td>`;
        tabla.appendChild(tr);
    };

    if (PERMITE_LINEAS) {
        tabla.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-quitar-linea]');
            if (!btn) return;
            const uid = Number(btn.dataset.quitarLinea);
            const tr = btn.closest('tr');
            if (tr.dataset.origen === 'existente') {
                idsLineasEliminar.push(uid);
            } else {
                lineasNuevas = lineasNuevas.filter(l => l.uid !== uid);
            }
            tr.remove();
            renumerar();
            if (!tabla.querySelector('tr[data-origen]')) filaVacia.classList.remove('hidden');
            recalcularResumen();
        });
    }

    // ── Modal "Agregar insumo" (solo si permiteEditarLineas; también edita) ─────────────
    // src/js/modalLineaInsumo.js. Editar una línea que ya existía en la base la marca en
    // idsLineasEliminar; una nueva de esta sesión simplemente se saca de lineasNuevas.
    if (PERMITE_LINEAS) iniciarModalLineaInsumo({
        tabla,
        buscarLinea: (uid) => (uid > 0 ? mapaLineasExistentes.get(uid) : lineasNuevas.find(x => x.uid === uid)),
        alConfirmar: ({ filas, editandoUid }) => {
            if (editandoUid !== null) {
                if (editandoUid > 0) idsLineasEliminar.push(editandoUid);
                else lineasNuevas = lineasNuevas.filter(x => x.uid !== editandoUid);
            }
            filas.forEach(f => {
                const nueva = { uid: proximoUidNueva--, ...f };
                lineasNuevas.push(nueva);
                filaVacia.classList.add('hidden');
                renderFilaNueva(nueva);
            });
            renumerar();
            recalcularResumen();
        }
    });

    // ── Guardar cambios (código de empleado imperativo, mismo candado que crear la orden) ──
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();

        let ok = true;
        if (!validarFechas()) ok = false;
        if (PERMITE_LINEAS && !tabla.querySelector('tr[data-origen]')) {
            Swal.fire({ icon: 'warning', title: 'La orden no puede quedar sin insumos', text: 'Agrega al menos uno antes de guardar.', confirmButtonColor: '#E24C95' });
            ok = false;
        }
        if (!ok) return;

        const estado = document.querySelector('#estadoOrden input[name="estado"]:checked')?.value;
        const notas = document.getElementById('notas').value.trim() || null;
        const fechaEntregaEstimada = document.getElementById('fechaEntregaEstimada').value || null;
        const payloadLineasNuevas = lineasNuevas.map(aPayloadLinea);

        const CODIGO_ID = 'oc-codigo-empleado';
        const ESTADO_ID = 'oc-codigo-estado';
        const { isConfirmed } = await Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: `
                <div class="gh-conf-html">
                    ${cabeceraConfirmacion({ icono: 'fi-rr-file-signature', badge: 'Confirmar cambios', contexto: document.getElementById('resumen-total').textContent })}
                    <div class="px-7 pt-1 pb-5">
                        <div class="gh-conf-aviso"><i class="fi fi-rr-info"></i>
                            <span>Los cambios quedan registrados a nombre del empleado que los autoriza.</span></div>
                    </div>
                    <p class="gh-conf-campo-label">Código de empleado que autoriza</p>
                    ${campoCodigoEmpleado(CODIGO_ID, '1.75rem')}
                    <p class="gh-conf-estado" id="${ESTADO_ID}"></p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Guardar cambios',
            cancelButtonText: 'Cancelar',
            focusCancel: false,
            reverseButtons: true,
            didOpen: () => abrirConCodigoEmpleado(CODIGO_ID, ESTADO_ID),
            preConfirm: async () => {
                const codigoEmpleado = codigoRequerido(CODIGO_ID, ESTADO_ID);
                if (!codigoEmpleado) return false;
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                boton.textContent = 'Guardando…';
                try {
                    const r = await fetch(`/admin/insumos/compra/${ID_ORDEN}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json'},
                        body: JSON.stringify({ estado, notas, fechaEntregaEstimada, lineasNuevas: payloadLineasNuevas, idsLineasEliminar, codigoEmpleado })
                    });
                    const d = await r.json().catch(() => ({}));
                    if (d.logout) { window.location.href = '/'; return false; }
                    if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo guardar.');
                    return d;
                } catch (e) {
                    boton.disabled = false;
                    boton.textContent = 'Guardar cambios';
                    Swal.showValidationMessage(e.message);
                    return false;
                }
            }
        }));
        if (!isConfirmed) return;

        const etiquetaEstadoGuardado = document.querySelector('#estadoOrden input[name="estado"]:checked')?.dataset.etiqueta || '';
        await Swal.fire({
            ...opcionesConfirmacion({ variante: 'ingreso', html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono: 'fi-rr-check', badge: 'Cambios guardados', contexto: etiquetaEstadoGuardado ? `Estado: ${etiquetaEstadoGuardado}` : '' })}</div>` }),
            showCancelButton: false,
            confirmButtonText: 'Entendido'
        });
        window.location.reload();
    });

    // ── Convertir a orden de compra (acción propia, con su propio código de empleado) ────
    // Convertir SOLO cambia `tipo` (ver convertirACompra en el controlador) — un insumo
    // agregado/editado/quitado en esta misma visita que todavía no se mandó con "Guardar
    // cambios" vive nada más en el navegador y se perdería en silencio al recargar después
    // de convertir. Por eso se bloquea acá si hay algo pendiente, en vez de dejar que
    // desaparezca sin aviso.
    document.getElementById('btn-convertir-compra')?.addEventListener('click', async () => {
        if (lineasNuevas.length || idsLineasEliminar.length) {
            await Swal.fire({
                icon: 'warning',
                title: 'Hay cambios en los insumos sin guardar',
                text: 'Guarda los cambios antes de convertir — si conviertes ahora, lo que agregaste o quitaste en esta visita se pierde.',
                confirmButtonColor: '#E24C95'
            });
            return;
        }

        const CODIGO_ID = 'oc-convertir-codigo';
        const ESTADO_ID = 'oc-convertir-estado';
        const { isConfirmed } = await Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: `
                <div class="gh-conf-html">
                    ${cabeceraConfirmacion({ icono: 'fi-rr-exchange', badge: 'Convertir a orden de compra', contexto: '' })}
                    <div class="px-7 pt-1 pb-5">
                        <div class="gh-conf-aviso"><i class="fi fi-rr-info"></i>
                            <span>Deja de ser una cotización: ya no se pueden agregar ni quitar insumos. No se puede deshacer.</span></div>
                    </div>
                    <p class="gh-conf-campo-label">Código de empleado que autoriza</p>
                    ${campoCodigoEmpleado(CODIGO_ID, '1.75rem')}
                    <p class="gh-conf-estado" id="${ESTADO_ID}"></p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Convertir',
            cancelButtonText: 'Cancelar',
            focusCancel: false,
            reverseButtons: true,
            didOpen: () => abrirConCodigoEmpleado(CODIGO_ID, ESTADO_ID),
            preConfirm: async () => {
                const codigoEmpleado = codigoRequerido(CODIGO_ID, ESTADO_ID);
                if (!codigoEmpleado) return false;
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                boton.textContent = 'Convirtiendo…';
                try {
                    const r = await fetch(`/admin/insumos/compra/${ID_ORDEN}/convertir`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json'},
                        body: JSON.stringify({ codigoEmpleado })
                    });
                    const d = await r.json().catch(() => ({}));
                    if (d.logout) { window.location.href = '/'; return false; }
                    if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo convertir.');
                    return d;
                } catch (e) {
                    boton.disabled = false;
                    boton.textContent = 'Convertir';
                    Swal.showValidationMessage(e.message);
                    return false;
                }
            }
        }));
        if (!isConfirmed) return;

        await Swal.fire({
            ...opcionesConfirmacion({ variante: 'ingreso', html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono: 'fi-rr-check', badge: 'Convertida a orden de compra', contexto: '' })}</div>` }),
            showCancelButton: false,
            confirmButtonText: 'Entendido'
        });
        window.location.reload();
    });

    // ── Recibir orden = entrada al inventario de insumos ────────────────────────────────
    // Acumulativa (ordenesCompraController.js recibirOrden): cada vez se dice cuánto llega
    // AHORA. La ventana es compartida con la creación de una orden (src/js/recepcionOrden.js).
    (function () {
        const elDatos = document.getElementById('datos-lineas-recibir');
        if (!elDatos) return;
        const lineasRecibir = JSON.parse(elDatos.textContent).map(l => ({ ...l, clave: l.idDetalleOrdenCompra }));

        document.getElementById('btn-recibir-orden')?.addEventListener('click', async () => {
            const recepcion = await pedirRecepcion(lineasRecibir);
            if (!recepcion) return;
            const payloadLineas = recepcion.map(r => ({ idDetalleOrdenCompra: r.clave, cantidadLlega: r.cantidadLlega, contenido: r.contenido, rollos: r.rollos }));

            const CODIGO_ID = 'oc-recibir-codigo';
            const ESTADO_ID = 'oc-recibir-estado';
            const { isConfirmed, value } = await Swal.fire(opcionesConfirmacion({
                variante: 'neutro',
                html: `
                    <div class="gh-conf-html">
                        ${cabeceraConfirmacion({ icono: 'fi-rr-box-check', badge: 'Confirmar recepción', contexto: '' })}
                        <div class="px-7 pt-1 pb-5">
                            <div class="gh-conf-aviso"><i class="fi fi-rr-info"></i>
                                <span>Queda registrado a nombre del empleado que lo autoriza.</span></div>
                        </div>
                        <p class="gh-conf-campo-label">Código de empleado que autoriza</p>
                        ${campoCodigoEmpleado(CODIGO_ID, '1.75rem')}
                        <p class="gh-conf-estado" id="${ESTADO_ID}"></p>
                    </div>`,
                showCancelButton: true,
                confirmButtonText: 'Confirmar recepción',
                cancelButtonText: 'Cancelar',
                focusCancel: false,
                reverseButtons: true,
                didOpen: () => abrirConCodigoEmpleado(CODIGO_ID, ESTADO_ID),
                preConfirm: async () => {
                    const codigoEmpleado = codigoRequerido(CODIGO_ID, ESTADO_ID);
                    if (!codigoEmpleado) return false;
                    const boton = Swal.getConfirmButton();
                    boton.disabled = true;
                    boton.textContent = 'Registrando…';
                    try {
                        const r = await fetch(`/admin/insumos/compra/${ID_ORDEN}/recibir`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json'},
                            body: JSON.stringify({ lineas: payloadLineas, codigoEmpleado })
                        });
                        const d = await r.json().catch(() => ({}));
                        if (d.logout) { window.location.href = '/'; return false; }
                        if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo registrar la recepción.');
                        return d;
                    } catch (e) {
                        boton.disabled = false;
                        boton.textContent = 'Confirmar recepción';
                        Swal.showValidationMessage(e.message);
                        return false;
                    }
                }
            }));
            if (!isConfirmed) return;

            await avisoRecepcion({ badge: 'Recepción registrada', rollos: value?.rollos || [] });
            window.location.reload();
        });
    })();
}
