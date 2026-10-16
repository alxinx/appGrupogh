import { opcionesConfirmacion, cabeceraConfirmacion, activarVerificacionCodigo } from './modalConfirmacion.js';
import { campoCodigoEmpleado, codigoRequerido } from './codigoCajitas.js';
import { escaparHtml as esc } from './escaparHtml.js';
import { initFechaInput } from './fechaInput.js';

// Orden de compra de insumos (admin/insumos/compra). El proveedor se busca en vivo contra
// PROVEDORES (nunca texto libre) y el color de cada línea sale del catálogo real de
// ATRIBUTOS ya filtrado a colores simples — el servidor es la garantía en los dos casos
// (controller/ordenesCompraController.js, helpers/ordenesCompra.js); esto solo evita un
// viaje al servidor con datos que ya se sabe que van a fallar.

const form = document.getElementById('form-orden-compra');
if (form) {
    const CSRF = form.dataset.csrf;
    const IVA_PCT = Number(form.dataset.iva) || 19;

    const UNIDAD_ETIQUETA = { kg: 'kg', metro: 'm', rollo: 'rollos', unidad: 'uds' };
    const money = (n) => `$ ${Math.round(n).toLocaleString('es-CO')}`;
    // Mismo patrón que round2 de helpers/formatMoney.js: redondea en cada paso, nunca al
    // final sobre una suma que ya arrastra error de punto flotante.
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    // ── Fechas (Flatpickr, identidad visual del panel) ─────────────────────────────────
    // La entrega nunca puede quedar antes de la fecha de la orden (mismo chequeo que
    // helpers/ordenesCompra.js validarCabeceraOrden, la garantía real). minDate evita
    // elegir una fecha inválida en el calendario, pero `fpEntrega.set('minDate', …)` en
    // Flatpickr SÍ limpia sola una entrega que ya estaba elegida si deja de cumplir el
    // nuevo mínimo (filtra `selectedDates` adentro del setter) — sin avisar. Por eso se
    // detecta ese caso antes de mover el mínimo y se avisa con el mismo campo de error,
    // en vez de dejar que la fecha desaparezca sin explicación.
    const validarFechas = () => {
        const ordenTxt   = document.getElementById('fechaOrden').value;
        const entregaTxt = document.getElementById('fechaEntregaEstimada').value;
        const errEl = document.getElementById('error-fechaEntregaEstimada');
        const invalido = Boolean(ordenTxt && entregaTxt && entregaTxt < ordenTxt);
        if (errEl) {
            errEl.textContent = invalido ? 'La entrega no puede ser antes de la fecha de la orden.' : '';
            errEl.classList.toggle('hidden', !invalido);
        }
        fpEntrega?.altInput?.classList.toggle('field-text-error', invalido);
        return !invalido;
    };

    const fpOrden = initFechaInput(document.getElementById('fechaOrden'), {
        defaultDate: new Date(),
        onChange: ([fecha]) => {
            if (fecha) {
                const entregaPrevia = fpEntrega?.selectedDates[0];
                const seLimpiaSola = entregaPrevia && entregaPrevia < fecha;
                fpEntrega?.set('minDate', fecha);
                if (seLimpiaSola) {
                    const errEl = document.getElementById('error-fechaEntregaEstimada');
                    if (errEl) {
                        errEl.textContent = 'La fecha de entrega quedó antes de la nueva fecha de la orden y se borró — elige una nueva.';
                        errEl.classList.remove('hidden');
                    }
                    return; // la entrega ya quedó vacía: nada que validarFechas() pueda marcar
                }
            }
            validarFechas();
        }
    });
    const fpEntrega = initFechaInput(document.getElementById('fechaEntregaEstimada'), {
        minDate: fpOrden?.selectedDates[0] || new Date(),
        onChange: validarFechas
    });

    // ── Proveedor(es) + tipo de orden (real) ────────────────────────────────────────────
    // Una orden de compra es de UN proveedor (tarjeta completa, como siempre). Una
    // cotización puede pedirse a varios a la vez: mismo buscador, pero cada resultado se
    // AGREGA a una lista en vez de reemplazar la selección — ordenesCompraController.js
    // crea una fila de ORDENES_COMPRA por proveedor (insertarOrden), todas unidas por
    // idGrupoCotizacion cuando hay más de una.
    (function () {
        const inputBuscar    = document.getElementById('input-buscar-proveedor');
        const panel          = document.getElementById('resultados-proveedor');
        const bloqueBuscar   = document.getElementById('buscador-proveedor');
        const tarjeta        = document.getElementById('tarjeta-proveedor');
        const listaMultiple  = document.getElementById('lista-proveedores-cotizacion');
        const inputIdProvs   = document.getElementById('idProveedores');
        const cardHistorial  = document.getElementById('card-historial-proveedor');
        const listaHist      = document.getElementById('lista-historial-proveedor');
        const helperProveedor = document.getElementById('helper-proveedor');
        const campoTipo      = document.getElementById('tipoOrden');
        if (!inputBuscar || !panel) return;

        let ultimaPeticion = 0;
        let timer = null;
        let modoMultiple = false;     // false = orden de compra (1 proveedor), true = cotización (1+)
        let proveedoresElegidos = []; // [{ idProveedor, razonSocial, iniciales, ciudad, departamento, activo, ... }]

        const ocultarPanel = () => { panel.classList.add('hidden'); panel.innerHTML = ''; };
        const sincronizarInputOculto = () => { inputIdProvs.value = JSON.stringify(proveedoresElegidos.map(p => p.idProveedor)); };

        const ESTADO_BADGE = {
            si: 'bg-emerald-100 text-emerald-600',
            no: 'bg-slate-100 text-slate-500'
        };
        const HISTORIAL_ESTADO = {
            borrador: ['Borrador', 'bg-slate-100 text-slate-500'],
            enviada: ['Enviada', 'bg-blue-100 text-blue-600'],
            confirmada: ['Confirmada', 'bg-indigo-100 text-indigo-600'],
            en_transito: ['En tránsito', 'bg-amber-100 text-amber-600'],
            recibida: ['Recibida', 'bg-emerald-100 text-emerald-600'],
            cancelada: ['Cancelada', 'bg-rose-100 text-rose-600']
        };

        const pintarResultados = (proveedores) => {
            if (!proveedores.length) {
                panel.innerHTML = `<p class="px-4 py-3 text-xs text-slate-400">Ningún proveedor coincide.</p>`;
                panel.classList.remove('hidden');
                return;
            }
            panel.innerHTML = proveedores.map(p => `
                <button type="button" data-id-proveedor="${esc(p.idProveedor)}"
                        class="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors cursor-pointer">
                    <span class="w-9 h-9 rounded-xl bg-gh-primarySoft flex items-center justify-center flex-shrink-0 text-xs font-bold text-gh-primaryHover">${esc(p.iniciales)}</span>
                    <span class="min-w-0 flex-1">
                        <span class="block text-sm font-semibold text-slate-800 truncate">${esc(p.razonSocial)}</span>
                        <span class="block text-xs text-slate-400 truncate">${esc(p.documento)}${p.ciudad ? ` · ${esc(p.ciudad)}` : ''}</span>
                    </span>
                    <span class="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${p.activo ? ESTADO_BADGE.si : ESTADO_BADGE.no}">${p.activo ? 'Activo' : 'Inactivo'}</span>
                </button>`).join('');
            panel.classList.remove('hidden');
            panel.querySelectorAll('[data-id-proveedor]').forEach(b =>
                b.addEventListener('click', () => elegirProveedor(b.dataset.idProveedor)));
        };

        const buscar = async () => {
            const q = inputBuscar.value.trim();
            if (q.length < 2) return ocultarPanel();
            const token = ++ultimaPeticion;
            try {
                const r = await fetch(`/admin/insumos/compra/proveedores?q=${encodeURIComponent(q)}`);
                const data = await r.json();
                if (token !== ultimaPeticion || !data.success) return;
                pintarResultados(data.proveedores);
            } catch { /* buscar es opcional: si falla, el campo sigue vacío */ }
        };

        const pintarHistorial = (historial) => {
            if (!historial.length) {
                cardHistorial.classList.add('hidden');
                listaHist.innerHTML = '';
                return;
            }
            listaHist.innerHTML = historial.map(h => {
                const [etiqueta, clase] = HISTORIAL_ESTADO[h.estado] || [h.estado, 'bg-slate-100 text-slate-500'];
                const fecha = new Date(h.fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
                return `
                    <div class="flex items-center justify-between gap-3 px-5 py-3">
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-slate-800">${esc(h.numeroOrden)}
                                <span class="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${clase}">${etiqueta}</span>
                            </p>
                            <p class="text-xs text-slate-400">${fecha} · ${h.nItems} ítem${h.nItems === 1 ? '' : 's'}</p>
                        </div>
                        <p class="text-sm font-bold text-slate-700 tabular-nums flex-shrink-0">${money(h.total)}</p>
                    </div>`;
            }).join('');
            cardHistorial.classList.remove('hidden');
        };

        const pintarTarjetaUnica = (p) => {
            document.getElementById('proveedor-iniciales').textContent = p.iniciales;
            document.getElementById('proveedor-nombre').textContent = p.razonSocial;
            document.getElementById('proveedor-ciudad').textContent = [p.ciudad, p.departamento].filter(Boolean).join(', ') || 'Sin ciudad registrada';
            document.getElementById('proveedor-documento').textContent = `${p.tipoDocumento} ${p.documento}`;
            document.getElementById('proveedor-telefono').textContent = p.telefono || '—';
            document.getElementById('proveedor-correo').textContent = p.correo || '—';
            document.getElementById('proveedor-contacto').textContent = p.nombreContacto || '—';
            document.getElementById('proveedor-antiguedad').textContent = p.antiguedad;
            const estadoEl = document.getElementById('proveedor-estado');
            estadoEl.textContent = p.activo ? 'Activo' : 'Inactivo';
            estadoEl.className = `inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${p.activo ? ESTADO_BADGE.si : ESTADO_BADGE.no}`;
            document.getElementById('proveedor-categorias').innerHTML = p.categorias
                .map(c => `<span class="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-violet-50 text-violet-600">${esc(c)}</span>`).join('');
        };

        const pintarListaMultiple = () => {
            listaMultiple.innerHTML = proveedoresElegidos.map(p => `
                <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                    <span class="w-9 h-9 rounded-xl bg-gh-primarySoft flex items-center justify-center flex-shrink-0 text-xs font-bold text-gh-primaryHover">${esc(p.iniciales)}</span>
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-semibold text-slate-800 truncate">${esc(p.razonSocial)}</p>
                        <p class="text-xs text-slate-400 truncate">${esc([p.ciudad, p.departamento].filter(Boolean).join(', ') || 'Sin ciudad registrada')}</p>
                    </div>
                    <span class="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${p.activo ? ESTADO_BADGE.si : ESTADO_BADGE.no}">${p.activo ? 'Activo' : 'Inactivo'}</span>
                    <button type="button" class="text-slate-300 hover:text-rose-500 transition-colors cursor-pointer flex-shrink-0" data-quitar-proveedor="${esc(p.idProveedor)}">
                        <i class="fi fi-rr-trash"></i>
                    </button>
                </div>`).join('');
        };
        listaMultiple?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-quitar-proveedor]');
            if (!btn) return;
            proveedoresElegidos = proveedoresElegidos.filter(p => p.idProveedor !== btn.dataset.quitarProveedor);
            pintarListaMultiple();
            sincronizarInputOculto();
            cardHistorial.classList.add('hidden'); // se vuelve a pintar solo si queda exactamente 1 (ver elegirProveedor)
        });

        const elegirProveedor = async (idProveedor) => {
            ocultarPanel();
            inputBuscar.value = '';
            if (proveedoresElegidos.some(p => p.idProveedor === idProveedor)) return; // ya está, no se duplica

            try {
                const r = await fetch(`/admin/insumos/compra/proveedores/${encodeURIComponent(idProveedor)}`);
                const data = await r.json();
                if (!data.success) return;
                const p = data.proveedor;
                document.getElementById('error-idProveedor')?.classList.add('hidden');

                if (modoMultiple) {
                    proveedoresElegidos.push(p);
                    sincronizarInputOculto();
                    pintarListaMultiple();
                    listaMultiple.classList.remove('hidden');
                    listaMultiple.classList.add('flex');
                    // El historial "con este proveedor" solo tiene sentido para exactamente uno.
                    if (proveedoresElegidos.length === 1) pintarHistorial(data.historial);
                    else cardHistorial.classList.add('hidden');
                    inputBuscar.focus(); // sigue buscando: en cotización se puede seguir agregando
                } else {
                    proveedoresElegidos = [p];
                    sincronizarInputOculto();
                    pintarTarjetaUnica(p);
                    bloqueBuscar.classList.add('hidden');
                    tarjeta.classList.remove('hidden');
                    tarjeta.classList.add('flex');
                    pintarHistorial(data.historial);
                }
            } catch {
                /* no se agrega nada; el buscador sigue disponible para reintentar */
            }
        };

        inputBuscar.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(buscar, 350); });
        inputBuscar.addEventListener('focus', () => { if (inputBuscar.value.trim().length >= 2) buscar(); });
        document.addEventListener('click', (e) => { if (!panel.contains(e.target) && e.target !== inputBuscar) ocultarPanel(); });

        document.getElementById('btn-cambiar-proveedor')?.addEventListener('click', () => {
            proveedoresElegidos = [];
            sincronizarInputOculto();
            tarjeta.classList.add('hidden');
            tarjeta.classList.remove('flex');
            cardHistorial.classList.add('hidden');
            bloqueBuscar.classList.remove('hidden');
            inputBuscar.focus();
        });

        // ── Toggle Cotización / Orden de compra: decide el modo del proveedor ───────────
        // Cambiar de tipo limpia la selección en vez de migrarla — una cotización a 3
        // proveedores no tiene un equivalente razonable al volver a "orden de compra" de
        // uno solo, así que es más claro empezar de nuevo que adivinar cuál se queda.
        document.querySelectorAll('.tipo-orden-btn').forEach(b => b.addEventListener('click', () => {
            if (campoTipo.value === b.dataset.tipo) return;
            campoTipo.value = b.dataset.tipo;
            modoMultiple = b.dataset.tipo === 'cotizacion';

            proveedoresElegidos = [];
            sincronizarInputOculto();
            tarjeta.classList.add('hidden');
            tarjeta.classList.remove('flex');
            listaMultiple.classList.add('hidden');
            listaMultiple.classList.remove('flex');
            listaMultiple.innerHTML = '';
            cardHistorial.classList.add('hidden');
            bloqueBuscar.classList.remove('hidden');
            document.getElementById('error-idProveedor')?.classList.add('hidden');
            helperProveedor.textContent = modoMultiple
                ? 'Agrega uno o más proveedores — se crea una orden independiente para cada uno.'
                : 'Solo proveedores que ya están dados de alta en Proveedores.';

            document.querySelectorAll('.tipo-orden-btn').forEach(x => {
                const activo = x === b;
                x.classList.toggle('bg-gh-primary', activo);
                x.classList.toggle('text-white', activo);
                x.classList.toggle('text-gh-grayText', !activo);
            });
        }));
    })();

    // ── Líneas de la orden (insumos a comprar) ────────────────────────────────────────
    const lineas = []; // { uid, idMaterial, nombreMaterial, codigoMaterialDxf, cantidad, unidadCompra, valorUnitario, valorTotal, idAtributoColor, colorNombre, caracteristicas }
    let proximoUid = 1;

    const tabla = document.getElementById('tabla-lineas-orden');
    const filaVacia = document.getElementById('sin-lineas-orden');

    const checkIvaIncluido = document.getElementById('iva-incluido');

    const recalcularResumen = () => {
        const ivaIncluido = Boolean(checkIvaIncluido?.checked);
        const subtotal = round2(lineas.reduce((acc, l) => acc + l.valorTotal, 0));
        const valorIva = ivaIncluido ? 0 : round2(subtotal * (IVA_PCT / 100));
        const total = round2(subtotal + valorIva);
        document.getElementById('resumen-items').textContent = lineas.length.toLocaleString('es-CO');
        document.getElementById('resumen-subtotal').textContent = money(subtotal);
        document.getElementById('resumen-iva-label').textContent = ivaIncluido ? 'IVA' : `IVA (${IVA_PCT}%)`;
        document.getElementById('resumen-iva').textContent = ivaIncluido ? 'Incluido' : money(valorIva);
        document.getElementById('resumen-total').textContent = money(total);
    };
    checkIvaIncluido?.addEventListener('change', recalcularResumen);

    const renderFilaLinea = (l) => {
        const caracTexto = [
            l.colorNombre ? `Color: ${l.colorNombre}` : null,
            ...Object.entries(l.caracteristicas || {}).map(([k, v]) => `${k}: ${v}`)
        ].filter(Boolean).map(esc).join('<br>') || '<span class="text-slate-400">—</span>';

        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100';
        tr.dataset.uid = l.uid;
        tr.innerHTML = `
            <td class="py-3 pr-3 text-slate-400 tabular-nums">${tabla.children.length + 1}</td>
            <td class="py-3 pr-3">
                <p class="font-semibold text-slate-800">${esc(l.nombreMaterial)}</p>
                <p class="text-xs text-slate-400">código ${esc(l.codigoMaterialDxf)}</p>
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

    const renumerar = () => Array.from(tabla.querySelectorAll('tr')).forEach((tr, i) => { tr.children[0].textContent = i + 1; });

    const agregarLinea = (l) => {
        lineas.push(l);
        filaVacia.classList.add('hidden');
        renderFilaLinea(l);
        recalcularResumen();
    };

    tabla.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-quitar-linea]');
        if (!btn) return;
        const uid = Number(btn.dataset.quitarLinea);
        const i = lineas.findIndex(l => l.uid === uid);
        if (i === -1) return;
        lineas.splice(i, 1);
        btn.closest('tr').remove();
        renumerar();
        if (!lineas.length) filaVacia.classList.remove('hidden');
        recalcularResumen();
    });

    // ── Modal "Agregar insumo" (también edita: mismo formulario, con los datos de la
    // línea precargados — ver abrirParaEditar más abajo) ───────────────────────────────
    (function () {
        const modal = document.getElementById('modal-agregar-insumo');
        const tituloModal    = document.getElementById('modal-agregar-insumo-titulo');
        const subtituloModal = document.getElementById('modal-agregar-insumo-subtitulo');
        const btnConfirmarLi = document.getElementById('btn-confirmar-li');
        const abrir  = () => { modal.classList.remove('hidden'); modal.classList.add('flex'); };
        const cerrar = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };
        document.getElementById('btn-agregar-insumo')?.addEventListener('click', abrir);
        document.getElementById('modal-agregar-insumo-cerrar')?.addEventListener('click', cerrar);
        modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

        // uid de la línea que se está editando, o null cuando el modal agrega una nueva.
        // limpiarModal() lo vuelve a null siempre (se llama tanto al abrir "Agregar
        // insumo" como al dar "Limpiar"), así que abrirParaEditar lo pisa después de
        // limpiar, no antes.
        let editandoUid = null;

        const selMaterial = document.getElementById('li-material');
        // Buscable como departamento/municipio (window.enhanceSelectBuscable, helpers.js):
        // el <select> real sigue mandando el idMaterial tal cual, esto solo agrega un
        // input de texto + lista filtrable encima.
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

        // Formato de miles mientras se escribe (window.initMoneyInput, helpers.js) — igual
        // que cualquier campo de precio del panel. Cantidad también, aunque no sea dinero:
        // es lo que se pidió, y simplifica no tener dos comportamientos de input distintos
        // en el mismo formulario.
        window.initMoneyInput?.(inpCantidad);
        window.initMoneyInput?.(inpValor);

        selMaterial.addEventListener('change', () => {
            const op = selMaterial.selectedOptions[0];
            sufijoUnidad.textContent = UNIDAD_ETIQUETA[op?.dataset.unidad] || '';
        });

        // ── Colores elegidos para este insumo (0, 1 o varios) ───────────────────────────
        let coloresElegidos = []; // [{ idAtributo, valor, codigo1 }]

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

        // Una fila de cantidad/valor por color — solo cuando hay 2 o más elegidos.
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

        // Lee cada fila de #li-filas-por-color; null si alguna cantidad/valor no es válido
        // (y pinta el borde en rojo de la fila que falló, para que se vea cuál es).
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
        // Mismo patrón que "Colores para Talla" en admin/inventario/ingreso
        // (views/administrador/inventarios/forms/product.pug): grilla de swatches +
        // buscador, acá además con alta de un color simple nuevo.
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

        // Dar de alta un color simple nuevo si no está en la grilla.
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

        // ── Otras características (libre, compartidas por todos los colores de este insumo) ──
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

        // Icono de lápiz de cada fila (renderFilaLinea, data-editar-linea): mismo modal de
        // "Agregar insumo", precargado con la línea — el color se busca en la grilla real
        // (gridColores) para recuperar su hex, que la línea guardada no trae.
        const abrirParaEditar = (l) => {
            limpiarModal();
            editandoUid = l.uid;
            if (tituloModal) tituloModal.textContent = 'Editar insumo';
            if (subtituloModal) subtituloModal.textContent = 'Los cambios reemplazan la línea actual.';
            if (btnConfirmarLi) btnConfirmarLi.textContent = 'Guardar cambios';

            selMaterial.value = l.idMaterial;
            materialBuscable.refresh();
            selMaterial.dispatchEvent(new Event('change'));

            if (l.idAtributoColor) {
                const chk = gridColores.querySelector(`.color-insumo-checkbox[value="${CSS.escape(l.idAtributoColor)}"]`);
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
            const l = lineas.find(x => x.uid === Number(btn.dataset.editarLinea));
            if (l) abrirParaEditar(l);
        });

        document.getElementById('btn-confirmar-li')?.addEventListener('click', () => {
            const op = selMaterial.selectedOptions[0];
            let huboError = false;
            if (!selMaterial.value) { pintarErrorLi('material', 'Elige un insumo.'); huboError = true; } else pintarErrorLi('material', '');

            // Una línea por color elegido (o una sola, sin color, si no se eligió ninguno) —
            // todas comparten insumo y características, cada una con su propia cantidad/valor.
            const nuevasLineas = [];

            if (coloresElegidos.length >= 2) {
                const filas = leerFilasPorColor();
                if (!filas) {
                    errorPorColor.textContent = 'Revisa la cantidad y el valor de cada color.';
                    errorPorColor.classList.remove('hidden');
                    huboError = true;
                } else {
                    errorPorColor.classList.add('hidden');
                    nuevasLineas.push(...filas);
                }
            } else {
                const cantidad = parseInt(inpCantidad.value.replace(/[^0-9]/g, ''), 10);
                const valorUnitario = parseInt(inpValor.value.replace(/[^0-9]/g, ''), 10);
                if (!Number.isFinite(cantidad) || cantidad <= 0) { pintarErrorLi('cantidad', 'Escribe una cantidad mayor a 0.'); huboError = true; } else pintarErrorLi('cantidad', '');
                if (!Number.isFinite(valorUnitario) || valorUnitario <= 0) { pintarErrorLi('valorUnitario', 'Escribe un valor mayor a 0.'); huboError = true; } else pintarErrorLi('valorUnitario', '');
                if (!huboError) {
                    const unico = coloresElegidos[0] || null;
                    nuevasLineas.push({ cantidad, valorUnitario, idAtributoColor: unico?.idAtributo || null, colorNombre: unico?.valor || null });
                }
            }

            if (huboError || !selMaterial.value) return;

            // Editar reemplaza la línea original por la(s) que salga del formulario — la
            // misma lógica de "una línea por color" de un alta nueva, así que si una edición
            // pasa de un color a dos, la línea se parte en dos sin un caso especial aparte.
            if (editandoUid !== null) {
                const i = lineas.findIndex(x => x.uid === editandoUid);
                if (i !== -1) lineas.splice(i, 1);
                tabla.querySelector(`tr[data-uid="${editandoUid}"]`)?.remove();
            }

            const caracteristicas = leerCaracteristicas();
            const unidadCompra = op.dataset.unidad || null;
            nuevasLineas.forEach(l => agregarLinea({
                uid: proximoUid++,
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
            }));
            renumerar();
            cerrar();
        });
    })();

    // ── Guardar borrador ────────────────────────────────────────────────────────────────
    const leerCabecera = () => ({
        idProveedores: JSON.parse(document.getElementById('idProveedores').value || '[]'),
        tipo: document.getElementById('tipoOrden').value,
        fechaOrden: document.getElementById('fechaOrden').value,
        fechaEntregaEstimada: document.getElementById('fechaEntregaEstimada').value || null,
        notas: document.getElementById('notas').value.trim() || null,
        ivaIncluido: Boolean(checkIvaIncluido?.checked)
    });

    const validarAntesDeEnviar = () => {
        let ok = true;
        const cab = leerCabecera();
        const errIdProv = document.getElementById('error-idProveedor');
        if (!cab.idProveedores.length) { errIdProv.classList.remove('hidden'); ok = false; } else errIdProv.classList.add('hidden');

        const errFecha = document.getElementById('error-fechaOrden');
        if (!cab.fechaOrden) { errFecha.textContent = 'Escribe la fecha de la orden.'; errFecha.classList.remove('hidden'); ok = false; } else errFecha.classList.add('hidden');

        if (!validarFechas()) ok = false;

        if (!lineas.length) {
            Swal.fire({ icon: 'warning', title: 'Agrega al menos un insumo', text: 'La orden no puede quedar vacía.', confirmButtonColor: '#E24C95' });
            ok = false;
        }
        return ok ? cab : null;
    };

    const payloadLineas = () => lineas.map(l => ({
        idMaterial: l.idMaterial,
        cantidad: l.cantidad,
        valorUnitario: l.valorUnitario,
        idAtributoColor: l.idAtributoColor,
        caracteristicas: l.caracteristicas
    }));

    const aviso = ({ variante, icono, badge, contexto = '' }) => Swal.fire({
        ...opcionesConfirmacion({ variante, html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono, badge, contexto: esc(contexto) })}</div>` }),
        showCancelButton: false,
        confirmButtonText: 'Entendido'
    });

    document.getElementById('btn-guardar-borrador')?.addEventListener('click', async () => {
        const cab = validarAntesDeEnviar();
        if (!cab) return;
        const btn = document.getElementById('btn-guardar-borrador');
        const textoOriginal = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Guardando…';
        try {
            const r = await fetch('/admin/insumos/compra/borrador', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                body: JSON.stringify({ ...cab, lineas: payloadLineas() })
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok || !data.success) throw new Error(data.mensaje || 'No se pudo guardar el borrador.');
            const numerosOrden = data.ordenes.map(o => o.numeroOrden).join(', ');
            await aviso({ variante: 'neutro', icono: 'fi-rr-check', badge: 'Borrador guardado', contexto: numerosOrden });
            window.location.href = '/admin/insumos';
        } catch (e) {
            await aviso({ variante: 'egreso', icono: 'fi-rr-exclamation', badge: 'No se guardó', contexto: e.message });
        } finally {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    });

    // ── Crear orden de compra (código de empleado imperativo) ──────────────────────────
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const cab = validarAntesDeEnviar();
        if (!cab) return;

        const CODIGO_ID = 'oc-codigo-empleado';
        const ESTADO_ID = 'oc-codigo-estado';
        const { isConfirmed, value } = await Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: `
                <div class="gh-conf-html">
                    ${cabeceraConfirmacion({ icono: 'fi-rr-file-signature', badge: 'Confirmar orden de compra', contexto: `${lineas.length} ítem${lineas.length === 1 ? '' : 's'} · ${document.getElementById('resumen-total').textContent}` })}
                    <div class="px-7 pt-1 pb-5">
                        <div class="gh-conf-aviso"><i class="fi fi-rr-info"></i>
                            <span>Queda registrada a nombre del empleado que la autoriza. No se puede deshacer, solo cancelar después.</span></div>
                    </div>
                    <p class="gh-conf-campo-label">Código de empleado que autoriza</p>
                    ${campoCodigoEmpleado(CODIGO_ID, '1.75rem')}
                    <p class="gh-conf-estado" id="${ESTADO_ID}"></p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Crear orden de compra',
            cancelButtonText: 'Cancelar',
            focusCancel: false,
            reverseButtons: true,
            didOpen: () => {
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                activarVerificacionCodigo(CODIGO_ID, ESTADO_ID, (emp) => { boton.disabled = !emp; }, {
                    urlValidar: (codigo) => `/admin/insumos/compra/empleado/validar/${encodeURIComponent(codigo)}`
                });
                document.getElementById(CODIGO_ID)?.focus();
            },
            preConfirm: async () => {
                const codigoEmpleado = codigoRequerido(CODIGO_ID, ESTADO_ID);
                if (!codigoEmpleado) return false;
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                boton.textContent = 'Creando…';
                try {
                    const r = await fetch('/admin/insumos/compra', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                        body: JSON.stringify({ ...cab, codigoEmpleado, lineas: payloadLineas() })
                    });
                    const d = await r.json().catch(() => ({}));
                    if (d.logout) { window.location.href = '/'; return false; }
                    if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo crear la orden.');
                    return d;
                } catch (e) {
                    boton.disabled = false;
                    boton.textContent = 'Crear orden de compra';
                    Swal.showValidationMessage(e.message);
                    return false;
                }
            }
        }));
        if (!isConfirmed) return;
        const numerosOrden = value.ordenes.map(o => o.numeroOrden).join(', ');
        await aviso({ variante: 'ingreso', icono: 'fi-rr-check', badge: value.ordenes.length > 1 ? 'Órdenes creadas' : 'Orden creada', contexto: numerosOrden });
        window.location.href = '/admin/insumos';
    });
}
