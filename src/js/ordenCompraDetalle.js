import { opcionesConfirmacion, cabeceraConfirmacion, activarVerificacionCodigo } from './modalConfirmacion.js';
import { campoCodigoEmpleado, codigoRequerido } from './codigoCajitas.js';
import { escaparHtml as esc } from './escaparHtml.js';
import { initFechaInput } from './fechaInput.js';

// Detalle/edición de UNA orden de compra o cotización ya creada
// (admin/insumos/compra/:idOrdenCompra, controller/ordenesCompraController.js). Estado,
// notas y fecha estimada de entrega siempre se pueden cambiar; agregar/quitar insumos solo
// cuando el servidor marcó `data-permite-lineas="1"` (helpers/ordenesCompra.js
// permiteEditarLineasOrden) — el botón "Agregar insumo" ni siquiera se pinta si no, pero el
// servidor es la garantía real (CLAUDE.md §12), esto solo evita que el navegador construya
// un payload que de todas formas se iba a ignorar.

const form = document.getElementById('form-orden-detalle');
if (form) {
    const CSRF = form.dataset.csrf;
    const ID_ORDEN = form.dataset.idOrden;
    const PERMITE_LINEAS = form.dataset.permiteLineas === '1';
    const FECHA_ORDEN = form.dataset.fechaOrden; // 'YYYY-MM-DD', de solo lectura en esta pantalla
    const PORCENTAJE_IVA = Number(form.dataset.porcentajeIva) || 0;

    const UNIDAD_ETIQUETA = { kg: 'kg', metro: 'm', rollo: 'rollos', unidad: 'uds' };
    const money = (n) => `$ ${Math.round(n).toLocaleString('es-CO')}`;
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

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
        contenedorEstado.querySelectorAll('input[name="estado"]').forEach((radio) => radio.addEventListener('change', repintar));
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
    // Agrega una línea nueva a la orden. El lápiz de cada fila (renderFilaNueva y el
    // data-editar-linea server-side) abre el mismo modal precargado — "editar" es, por
    // dentro, borrar la línea (si ya existía, a idsLineasEliminar; si era nueva, se saca de
    // lineasNuevas) y agregar la que salga del formulario, igual mecanismo que src/js/
    // ordenCompra.js. Si la edición pasa de un color a dos, la línea se parte en dos sin un
    // caso especial aparte — misma razón que allá.
    if (PERMITE_LINEAS) (function () {
        const modal = document.getElementById('modal-agregar-insumo');
        const tituloModal    = document.getElementById('modal-agregar-insumo-titulo');
        const subtituloModal = document.getElementById('modal-agregar-insumo-subtitulo');
        const btnConfirmarLi = document.getElementById('btn-confirmar-li');
        const abrir  = () => { modal.classList.remove('hidden'); modal.classList.add('flex'); };
        const cerrar = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };
        document.getElementById('btn-agregar-insumo')?.addEventListener('click', abrir);
        document.getElementById('modal-agregar-insumo-cerrar')?.addEventListener('click', cerrar);
        modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

        // uid de la línea que se está editando (positivo = existente, negativo = nueva de
        // esta misma sesión), o null cuando el modal agrega una desde cero.
        let editandoUid = null;

        const selMaterial = document.getElementById('li-material');
        const materialBuscable = window.enhanceSelectBuscable?.(selMaterial, { placeholder: 'Escribe o elige un insumo' }) || { refresh() {} };

        const inpCantidad = document.getElementById('li-cantidad');
        const inpValor    = document.getElementById('li-valorUnitario');
        const sufijoUnidad = document.getElementById('li-unidad-suffix');
        const contCaracteristicas = document.getElementById('li-caracteristicas');
        const seccionSimple   = document.getElementById('li-cantidad-valor-simple');
        const seccionPorColor = document.getElementById('li-cantidad-valor-por-color');
        const contFilasColor  = document.getElementById('li-filas-por-color');
        const errorPorColor   = document.getElementById('error-li-por-color');
        const contChips  = document.getElementById('li-colores-chips');
        const chipVacio  = document.getElementById('li-colores-vacio');

        window.initMoneyInput?.(inpCantidad);
        window.initMoneyInput?.(inpValor);

        selMaterial.addEventListener('change', () => {
            const op = selMaterial.selectedOptions[0];
            sufijoUnidad.textContent = UNIDAD_ETIQUETA[op?.dataset.unidad] || '';
        });

        // ── Colores elegidos para este insumo (0, 1 o varios) ───────────────────────────
        let coloresElegidos = [];

        const renderChipsColores = () => {
            contChips.querySelectorAll('[data-chip-color]').forEach(c => c.remove());
            chipVacio.classList.toggle('hidden', coloresElegidos.length > 0);
            coloresElegidos.forEach(c => {
                const chip = document.createElement('span');
                chip.dataset.chipColor = c.idAtributo;
                chip.className = 'inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-full bg-slate-100 text-xs font-semibold text-slate-700';
                chip.innerHTML = `
                    <span class="w-3 h-3 rounded-full border border-black/10 flex-shrink-0" style="background-color:${c.codigo1 || '#ccc'}"></span>
                    ${esc(c.valor)}
                    <button type="button" class="text-slate-400 hover:text-rose-500 ml-0.5 cursor-pointer" data-quitar-color="${c.idAtributo}">
                        <i class="fi fi-rr-cross-small text-[10px]"></i>
                    </button>`;
                contChips.appendChild(chip);
            });
        };
        contChips.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-quitar-color]');
            if (!btn) return;
            coloresElegidos = coloresElegidos.filter(c => String(c.idAtributo) !== btn.dataset.quitarColor);
            renderChipsColores();
            renderSeccionCantidadValor();
        });

        const construirFilaColor = (color) => {
            const op = selMaterial.selectedOptions[0];
            const unidad = UNIDAD_ETIQUETA[op?.dataset.unidad] || '';
            const fila = document.createElement('div');
            fila.className = 'flex items-center gap-3';
            fila.dataset.filaColor = color.idAtributo;
            fila.dataset.nombreColor = color.valor;
            fila.innerHTML = `
                <span class="w-4 h-4 rounded-full border border-black/10 flex-shrink-0" style="background-color:${color.codigo1 || '#ccc'}"></span>
                <span class="text-xs font-semibold text-slate-700 w-20 flex-shrink-0 truncate">${esc(color.valor)}</span>
                <div class="relative flex-1">
                    <input type="text" inputmode="numeric" autocomplete="off" placeholder="Cantidad" class="field-text text-sm" data-cant>
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400">${esc(unidad)}</span>
                </div>
                <div class="relative flex-1">
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                    <input type="text" inputmode="numeric" autocomplete="off" placeholder="Valor unitario" class="field-text text-sm pl-6" data-val>
                </div>`;
            window.initMoneyInput?.(fila.querySelector('[data-cant]'));
            window.initMoneyInput?.(fila.querySelector('[data-val]'));
            return fila;
        };

        const renderSeccionCantidadValor = () => {
            if (coloresElegidos.length >= 2) {
                seccionSimple.classList.add('hidden');
                seccionPorColor.classList.remove('hidden');
                seccionPorColor.classList.add('flex');
                contFilasColor.innerHTML = '';
                coloresElegidos.forEach(c => contFilasColor.appendChild(construirFilaColor(c)));
            } else {
                seccionPorColor.classList.add('hidden');
                seccionPorColor.classList.remove('flex');
                seccionSimple.classList.remove('hidden');
            }
        };

        const leerFilasPorColor = () => {
            const filas = [];
            let ok = true;
            contFilasColor.querySelectorAll('[data-fila-color]').forEach(fila => {
                const inpCant = fila.querySelector('[data-cant]');
                const inpVal  = fila.querySelector('[data-val]');
                const cantidad = parseInt(inpCant.value.replace(/[^0-9]/g, ''), 10);
                const valorUnitario = parseInt(inpVal.value.replace(/[^0-9]/g, ''), 10);
                const cantidadOk = Number.isFinite(cantidad) && cantidad > 0;
                const valorOk = Number.isFinite(valorUnitario) && valorUnitario > 0;
                inpCant.classList.toggle('field-text-error', !cantidadOk);
                inpVal.classList.toggle('field-text-error', !valorOk);
                if (!cantidadOk || !valorOk) ok = false;
                filas.push({ idAtributoColor: fila.dataset.filaColor, colorNombre: fila.dataset.nombreColor, cantidad, valorUnitario });
            });
            return ok ? filas : null;
        };

        // ── Sub-modal "Elegir colores" ──────────────────────────────────────────────────
        const modalColores = document.getElementById('modal-colores-insumo');
        const inputBuscadorColor = document.getElementById('buscador-color-insumo');
        const gridColores = document.getElementById('grid-colores-insumo');
        const formNuevoColor = document.getElementById('form-nuevo-color');

        const abrirModalColores = () => { modalColores.classList.remove('hidden'); modalColores.classList.add('flex'); };
        const cerrarModalColores = () => { modalColores.classList.add('hidden'); modalColores.classList.remove('flex'); };

        const filtrarColoresInsumo = (texto) => {
            const termino = texto.toLowerCase().trim();
            gridColores.querySelectorAll('.color-insumo-item').forEach(label => {
                const nombre = label.querySelector('span:last-child')?.textContent.toLowerCase() || '';
                label.style.display = nombre.includes(termino) ? '' : 'none';
            });
        };
        inputBuscadorColor?.addEventListener('input', (e) => filtrarColoresInsumo(e.target.value));

        const ocultarFormNuevoColor = () => {
            formNuevoColor.classList.add('hidden');
            formNuevoColor.classList.remove('flex');
            document.getElementById('error-nuevo-color')?.classList.add('hidden');
        };

        document.getElementById('li-btn-elegir-colores')?.addEventListener('click', () => {
            gridColores.querySelectorAll('.color-insumo-checkbox').forEach(chk => {
                chk.checked = coloresElegidos.some(c => String(c.idAtributo) === chk.value);
            });
            inputBuscadorColor.value = '';
            filtrarColoresInsumo('');
            ocultarFormNuevoColor();
            abrirModalColores();
        });
        document.getElementById('modal-colores-insumo-cerrar')?.addEventListener('click', cerrarModalColores);
        modalColores.addEventListener('click', (e) => { if (e.target === modalColores) cerrarModalColores(); });

        document.getElementById('btn-usar-colores')?.addEventListener('click', () => {
            coloresElegidos = Array.from(gridColores.querySelectorAll('.color-insumo-checkbox:checked')).map(chk => ({
                idAtributo: chk.value, valor: chk.dataset.nombre, codigo1: chk.dataset.hex
            }));
            cerrarModalColores();
            renderChipsColores();
            renderSeccionCantidadValor();
        });

        document.getElementById('btn-mostrar-nuevo-color')?.addEventListener('click', () => {
            const visible = !formNuevoColor.classList.contains('hidden');
            if (visible) { ocultarFormNuevoColor(); return; }
            formNuevoColor.classList.remove('hidden');
            formNuevoColor.classList.add('flex');
            document.getElementById('nuevo-color-nombre')?.focus();
        });

        document.getElementById('btn-guardar-nuevo-color')?.addEventListener('click', async () => {
            const inpNombre = document.getElementById('nuevo-color-nombre');
            const inpHex    = document.getElementById('nuevo-color-hex');
            const errEl     = document.getElementById('error-nuevo-color');
            const btn       = document.getElementById('btn-guardar-nuevo-color');

            const nombre = inpNombre.value.trim();
            if (!nombre) {
                errEl.textContent = 'Escribe el nombre del color.';
                errEl.classList.remove('hidden');
                inpNombre.focus();
                return;
            }

            const textoOriginal = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Agregando…';
            try {
                const r = await fetch('/admin/insumos/compra/colores', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                    body: JSON.stringify({ valor: nombre, codigo1: inpHex.value })
                });
                const data = await r.json().catch(() => ({}));
                if (!r.ok || !data.success) {
                    throw new Error(data.mensaje || data.errores?.valor || data.errores?.codigo1 || 'No se pudo agregar el color.');
                }

                const c = data.color;
                const label = document.createElement('label');
                label.className = 'color-insumo-item flex items-center gap-2.5 p-2.5 border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-50';
                label.innerHTML = `
                    <input type="checkbox" value="${c.idAtributo}" data-nombre="${esc(c.valor)}" data-hex="${c.codigo1}" checked class="color-insumo-checkbox w-4 h-4 flex-shrink-0">
                    <span class="w-4 h-4 rounded-full border border-black/10 flex-shrink-0" style="background-color:${c.codigo1}"></span>
                    <span class="text-sm font-medium text-slate-700 truncate">${esc(c.valor)}</span>`;
                gridColores.prepend(label);

                inpNombre.value = '';
                inpHex.value = '#E24C95';
                ocultarFormNuevoColor();
                inputBuscadorColor.value = '';
                filtrarColoresInsumo('');
            } catch (e) {
                errEl.textContent = e.message;
                errEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.textContent = textoOriginal;
            }
        });

        // ── Otras características ────────────────────────────────────────────────────
        const filaCaracteristica = (etiqueta = '', valor = '') => {
            const fila = document.createElement('div');
            fila.className = 'flex items-center gap-2';
            fila.innerHTML = `
                <input type="text" placeholder="Ej. Composición" value="${esc(etiqueta)}" class="field-text text-sm flex-1" data-carac-etiqueta>
                <input type="text" placeholder="Ej. 92% poliéster, 8% elastano" value="${esc(valor)}" class="field-text text-sm flex-1" data-carac-valor>
                <button type="button" class="text-slate-300 hover:text-rose-500 transition-colors cursor-pointer flex-shrink-0" data-quitar-carac>
                    <i class="fi fi-rr-cross-small"></i>
                </button>`;
            fila.querySelector('[data-quitar-carac]').addEventListener('click', () => fila.remove());
            contCaracteristicas.appendChild(fila);
        };
        document.getElementById('li-agregar-caracteristica')?.addEventListener('click', () => filaCaracteristica());

        const leerCaracteristicas = () => {
            const obj = {};
            contCaracteristicas.querySelectorAll(':scope > div').forEach(fila => {
                const k = fila.querySelector('[data-carac-etiqueta]').value.trim();
                const v = fila.querySelector('[data-carac-valor]').value.trim();
                if (k && v) obj[k] = v;
            });
            return obj;
        };

        const pintarErrorLi = (campo, mensaje) => {
            const el = document.getElementById(`error-li-${campo}`);
            if (el) { el.textContent = mensaje || ''; el.classList.toggle('hidden', !mensaje); }
            document.getElementById(`li-${campo}`)?.classList.toggle('field-text-error', Boolean(mensaje));
        };

        const limpiarModal = () => {
            editandoUid = null;
            if (tituloModal) tituloModal.textContent = 'Agregar insumo';
            if (subtituloModal) subtituloModal.textContent = 'Se agrega a la orden al confirmar.';
            if (btnConfirmarLi) btnConfirmarLi.textContent = 'Agregar a la orden';
            selMaterial.value = '';
            materialBuscable.refresh();
            inpCantidad.value = '';
            inpValor.value = '';
            sufijoUnidad.textContent = '';
            contCaracteristicas.innerHTML = '';
            coloresElegidos = [];
            renderChipsColores();
            renderSeccionCantidadValor();
            ['material', 'cantidad', 'valorUnitario'].forEach(c => pintarErrorLi(c, ''));
            errorPorColor.classList.add('hidden');
            ocultarFormNuevoColor();
        };
        document.getElementById('btn-limpiar-li')?.addEventListener('click', limpiarModal);
        document.getElementById('btn-agregar-insumo')?.addEventListener('click', limpiarModal);

        // Lápiz de una fila (existente o nueva): precarga el modal con esa línea. El color
        // se busca en la grilla real (gridColores) para recuperar su hex, que la línea
        // guardada no trae — igual criterio que ordenCompra.js.
        //
        // `uid` se recibe aparte de `l`: una línea existente (del JSON embebido) se
        // identifica por `idDetalleOrdenCompra`, una nueva de esta sesión por `uid` — dos
        // nombres de campo distintos según el origen, así que el identificador real para
        // borrar/reemplazar viene siempre del dataset del botón, nunca de adivinar cuál de
        // los dos campos tiene el objeto.
        const abrirParaEditar = (l, uid) => {
            limpiarModal();
            editandoUid = uid;
            if (tituloModal) tituloModal.textContent = 'Editar insumo';
            if (subtituloModal) subtituloModal.textContent = 'Los cambios reemplazan la línea actual.';
            if (btnConfirmarLi) btnConfirmarLi.textContent = 'Guardar cambios';

            selMaterial.value = l.idMaterial;
            materialBuscable.refresh();
            selMaterial.dispatchEvent(new Event('change'));

            if (l.idAtributoColor) {
                const chk = gridColores.querySelector(`.color-insumo-checkbox[value="${CSS.escape(String(l.idAtributoColor))}"]`);
                coloresElegidos = [chk
                    ? { idAtributo: l.idAtributoColor, valor: chk.dataset.nombre, codigo1: chk.dataset.hex }
                    : { idAtributo: l.idAtributoColor, valor: l.colorNombre, codigo1: null }];
                renderChipsColores();
                renderSeccionCantidadValor();
            }

            inpCantidad.value = l.cantidad.toLocaleString('es-CO');
            inpValor.value = l.valorUnitario.toLocaleString('es-CO');

            const entradas = Object.entries(l.caracteristicas || {});
            if (entradas.length) {
                contCaracteristicas.innerHTML = '';
                entradas.forEach(([k, v]) => filaCaracteristica(k, v));
            }

            abrir();
        };
        tabla.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-editar-linea]');
            if (!btn) return;
            const uid = Number(btn.dataset.editarLinea);
            const l = uid > 0 ? mapaLineasExistentes.get(uid) : lineasNuevas.find(x => x.uid === uid);
            if (l) abrirParaEditar(l, uid);
        });

        document.getElementById('btn-confirmar-li')?.addEventListener('click', () => {
            const op = selMaterial.selectedOptions[0];
            let huboError = false;
            if (!selMaterial.value) { pintarErrorLi('material', 'Elige un insumo.'); huboError = true; } else pintarErrorLi('material', '');

            const filasNuevas = [];
            if (coloresElegidos.length >= 2) {
                const filas = leerFilasPorColor();
                if (!filas) {
                    errorPorColor.textContent = 'Revisa la cantidad y el valor de cada color.';
                    errorPorColor.classList.remove('hidden');
                    huboError = true;
                } else {
                    errorPorColor.classList.add('hidden');
                    filasNuevas.push(...filas);
                }
            } else {
                const cantidad = parseInt(inpCantidad.value.replace(/[^0-9]/g, ''), 10);
                const valorUnitario = parseInt(inpValor.value.replace(/[^0-9]/g, ''), 10);
                if (!Number.isFinite(cantidad) || cantidad <= 0) { pintarErrorLi('cantidad', 'Escribe una cantidad mayor a 0.'); huboError = true; } else pintarErrorLi('cantidad', '');
                if (!Number.isFinite(valorUnitario) || valorUnitario <= 0) { pintarErrorLi('valorUnitario', 'Escribe un valor mayor a 0.'); huboError = true; } else pintarErrorLi('valorUnitario', '');
                if (!huboError) {
                    const unico = coloresElegidos[0] || null;
                    filasNuevas.push({ cantidad, valorUnitario, idAtributoColor: unico?.idAtributo || null, colorNombre: unico?.valor || null });
                }
            }

            if (huboError || !selMaterial.value) return;

            // Editar reemplaza la línea original por la(s) que salga del formulario — misma
            // lógica que agregar una desde cero, así que partir en dos colores no necesita
            // un caso aparte. Si la línea editada ya existía en la base, su id se marca para
            // borrar; si era nueva de esta sesión, simplemente se saca de lineasNuevas.
            if (editandoUid !== null) {
                if (editandoUid > 0) idsLineasEliminar.push(editandoUid);
                else lineasNuevas = lineasNuevas.filter(x => x.uid !== editandoUid);
                tabla.querySelector(`tr[data-uid="${editandoUid}"]`)?.remove();
            }

            const caracteristicas = leerCaracteristicas();
            const unidadCompra = op.dataset.unidad || null;
            filasNuevas.forEach(l => {
                const nueva = {
                    uid: proximoUidNueva--,
                    idMaterial: selMaterial.value,
                    nombreMaterial: op.dataset.nombre,
                    codigoMaterialDxf: op.dataset.codigo,
                    cantidad: l.cantidad,
                    unidadCompra,
                    valorUnitario: l.valorUnitario,
                    valorTotal: round2(l.cantidad * l.valorUnitario),
                    idAtributoColor: l.idAtributoColor,
                    colorNombre: l.colorNombre,
                    caracteristicas
                };
                lineasNuevas.push(nueva);
                filaVacia.classList.add('hidden');
                renderFilaNueva(nueva);
            });
            renumerar();
            recalcularResumen();
            cerrar();
        });
    })();

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
        const payloadLineasNuevas = lineasNuevas.map(l => ({
            idMaterial: l.idMaterial,
            cantidad: l.cantidad,
            valorUnitario: l.valorUnitario,
            idAtributoColor: l.idAtributoColor,
            caracteristicas: l.caracteristicas
        }));

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
            didOpen: () => {
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                activarVerificacionCodigo(CODIGO_ID, ESTADO_ID, (emp) => { boton.disabled = !emp; }, {
                    urlValidar: (codigo) => `/admin/insumos/compra/${ID_ORDEN}/empleado/validar/${encodeURIComponent(codigo)}`
                });
                document.getElementById(CODIGO_ID)?.focus();
            },
            preConfirm: async () => {
                const codigoEmpleado = codigoRequerido(CODIGO_ID, ESTADO_ID);
                if (!codigoEmpleado) return false;
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                boton.textContent = 'Guardando…';
                try {
                    const r = await fetch(`/admin/insumos/compra/${ID_ORDEN}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
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
            didOpen: () => {
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                activarVerificacionCodigo(CODIGO_ID, ESTADO_ID, (emp) => { boton.disabled = !emp; }, {
                    urlValidar: (codigo) => `/admin/insumos/compra/${ID_ORDEN}/empleado/validar/${encodeURIComponent(codigo)}`
                });
                document.getElementById(CODIGO_ID)?.focus();
            },
            preConfirm: async () => {
                const codigoEmpleado = codigoRequerido(CODIGO_ID, ESTADO_ID);
                if (!codigoEmpleado) return false;
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                boton.textContent = 'Convirtiendo…';
                try {
                    const r = await fetch(`/admin/insumos/compra/${ID_ORDEN}/convertir`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
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

    // ── Recibir orden (cuánto llegó de verdad por línea, aparte de lo pedido) ───────────
    // Independiente de PERMITE_LINEAS: el botón solo se pinta si el servidor marcó
    // `permiteRecibir` (cualquier estado salvo cancelada, helpers/ordenesCompra.js
    // permiteRecibirOrden) — se puede volver a abrir para corregir una recepción ya
    // registrada, no hace falta cancelar y crear otra orden.
    (function () {
        const modal = document.getElementById('modal-recibir-orden');
        if (!modal) return;

        const contFilas = document.getElementById('filas-recibir-orden');
        const elDatos = document.getElementById('datos-lineas-recibir');
        const lineasRecibir = elDatos ? JSON.parse(elDatos.textContent) : [];

        const abrir = () => { modal.classList.remove('hidden'); modal.classList.add('flex'); };
        const cerrar = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };

        const renderFilas = () => {
            contFilas.innerHTML = '';
            lineasRecibir.forEach(l => {
                const unidad = UNIDAD_ETIQUETA[l.unidadCompra] || '';
                const carac = [l.colorNombre ? `Color: ${l.colorNombre}` : null].filter(Boolean).join(' · ');
                const prellenado = l.cantidadRecibida !== null ? l.cantidadRecibida : l.cantidad;
                const fila = document.createElement('div');
                fila.className = 'flex items-center gap-3';
                fila.dataset.filaRecibir = l.idDetalleOrdenCompra;
                fila.innerHTML = `
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-semibold text-slate-800 truncate">${esc(l.nombreMaterial)}</p>
                        <p class="text-xs text-slate-400">${carac ? esc(carac) + ' · ' : ''}Pedido: ${l.cantidad.toLocaleString('es-CO')} ${esc(unidad)}</p>
                    </div>
                    <div class="relative w-36 flex-shrink-0">
                        <input type="text" inputmode="numeric" autocomplete="off" class="field-text text-sm text-right pr-10" data-cantidad-recibida value="${prellenado.toLocaleString('es-CO')}">
                        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400">${esc(unidad)}</span>
                    </div>`;
                contFilas.appendChild(fila);
                window.initMoneyInput?.(fila.querySelector('[data-cantidad-recibida]'));
            });
        };

        document.getElementById('btn-recibir-orden')?.addEventListener('click', () => { renderFilas(); abrir(); });
        document.getElementById('modal-recibir-orden-cerrar')?.addEventListener('click', cerrar);
        document.getElementById('btn-cancelar-recibir')?.addEventListener('click', cerrar);
        modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

        document.getElementById('btn-confirmar-recibir')?.addEventListener('click', async () => {
            let huboError = false;
            const payloadLineas = Array.from(contFilas.querySelectorAll('[data-fila-recibir]')).map(fila => {
                const input = fila.querySelector('[data-cantidad-recibida]');
                const cantidadRecibida = parseInt(input.value.replace(/[^0-9]/g, ''), 10);
                const valido = Number.isFinite(cantidadRecibida) && cantidadRecibida >= 0;
                input.classList.toggle('field-text-error', !valido);
                if (!valido) huboError = true;
                return { idDetalleOrdenCompra: Number(fila.dataset.filaRecibir), cantidadRecibida: valido ? cantidadRecibida : 0 };
            });
            if (huboError) return;
            cerrar();

            const CODIGO_ID = 'oc-recibir-codigo';
            const ESTADO_ID = 'oc-recibir-estado';
            const { isConfirmed } = await Swal.fire(opcionesConfirmacion({
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
                didOpen: () => {
                    const boton = Swal.getConfirmButton();
                    boton.disabled = true;
                    activarVerificacionCodigo(CODIGO_ID, ESTADO_ID, (emp) => { boton.disabled = !emp; }, {
                        urlValidar: (codigo) => `/admin/insumos/compra/${ID_ORDEN}/empleado/validar/${encodeURIComponent(codigo)}`
                    });
                    document.getElementById(CODIGO_ID)?.focus();
                },
                preConfirm: async () => {
                    const codigoEmpleado = codigoRequerido(CODIGO_ID, ESTADO_ID);
                    if (!codigoEmpleado) return false;
                    const boton = Swal.getConfirmButton();
                    boton.disabled = true;
                    boton.textContent = 'Registrando…';
                    try {
                        const r = await fetch(`/admin/insumos/compra/${ID_ORDEN}/recibir`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
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

            await Swal.fire({
                ...opcionesConfirmacion({ variante: 'ingreso', html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono: 'fi-rr-check', badge: 'Recepción registrada', contexto: '' })}</div>` }),
                showCancelButton: false,
                confirmButtonText: 'Entendido'
            });
            window.location.reload();
        });
    })();
}
