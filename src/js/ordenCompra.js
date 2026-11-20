import { opcionesConfirmacion, cabeceraConfirmacion, activarVerificacionCodigo, avisoConfirmacion } from './modalConfirmacion.js';
import { campoCodigoEmpleado, codigoRequerido } from './codigoCajitas.js';
import { escaparHtml as esc } from './escaparHtml.js';
import { initFechaInput } from './fechaInput.js';
import { iniciarModalLineaInsumo, UNIDAD_ETIQUETA, aPayloadLinea } from './modalLineaInsumo.js';
import { pedirRecepcion, factorFijoDe } from './recepcionOrden.js';
import { confirmarProveedor } from './confirmarProveedor.js';

// Orden de compra de insumos (admin/insumos/compra). El proveedor se busca en vivo contra
// PROVEDORES (nunca texto libre) y el color de cada línea sale del catálogo real de
// ATRIBUTOS ya filtrado a colores simples — el servidor es la garantía en los dos casos
// (controller/ordenesCompraController.js, helpers/ordenesCompra.js); esto solo evita un
// viaje al servidor con datos que ya se sabe que van a fallar.

const form = document.getElementById('form-orden-compra');
if (form) {
    const IVA_PCT = Number(form.dataset.iva) || 19;

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

        // "Crear proveedor": solo existe si la vista dibujó el modal (permiso Provedores
        // CREATE, components/modalNuevoProveedor.pug). Sin el modal no se ofrece nada.
        const modalProveedor = document.getElementById('modal-nuevo-proveedor');
        const opcionCrear = (destacada) => modalProveedor ? `
            <button type="button" data-crear-proveedor
                    class="w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition-colors ${destacada ? 'hover:bg-gh-primarySoft' : 'border-t border-slate-100 mt-1 hover:bg-slate-50'}">
                <span class="w-9 h-9 rounded-xl bg-gh-primary flex items-center justify-center flex-shrink-0 text-white"><i class="fi fi-rr-user-add text-xs"></i></span>
                <span class="min-w-0 flex-1">
                    <span class="block text-sm font-semibold text-gh-primaryHover truncate">Crear proveedor «${esc(inputBuscar.value.trim())}»</span>
                    <span class="block text-xs text-slate-400">${destacada ? 'No está registrado: créalo sin salir de la orden.' : '¿No es ninguno de estos?'}</span>
                </span>
            </button>` : '';

        const pintarResultados = (proveedores) => {
            if (!proveedores.length) {
                panel.innerHTML = `<p class="px-4 py-3 text-xs text-slate-400">Ningún proveedor coincide.</p>${opcionCrear(true)}`;
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
                </button>`).join('') + opcionCrear(false);
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

        // ── Modal "Crear proveedor" ───────────────────────────────────────────────────
        // Guarda por el mismo endpoint y con la misma confirmación que la página de alta
        // (saveSupplier, confirmarProveedor.js). Al guardar, el proveedor queda elegido en
        // la orden igual que si se hubiera buscado (elegirProveedor).
        if (modalProveedor) {
            const formProv = document.getElementById('form-nuevo-proveedor');
            const btnGuardarProv = document.getElementById('btn-guardar-proveedor');
            const textoBtnProv = btnGuardarProv.innerHTML;

            const abrirModalProveedor = (texto) => {
                formProv.reset();
                // reset() no dispara change: el tipo vuelve a CC y la ciudad a "elige primero".
                formProv.querySelector('[data-tipo-documento]')?.dispatchEvent(new Event('change'));
                formProv.querySelector('#departamentoSelect')?.dispatchEvent(new Event('change'));
                // Lo que se buscó se aprovecha: un número va al documento, un texto al nombre.
                const limpio = texto.replace(/[\s.-]/g, '');
                const campo = /^\d{4,}$/.test(limpio) ? formProv.querySelector('[data-numero-documento]') : formProv.querySelector('[name="razonSocial"]');
                if (campo) {
                    campo.value = campo.matches('[data-numero-documento]') ? limpio : texto;
                    campo.dispatchEvent(new Event('input'));
                }
                ocultarPanel();
                modalProveedor.classList.remove('hidden');
                modalProveedor.classList.add('flex');
                formProv.querySelector('[name="razonSocial"]')?.focus();
            };
            const cerrarModalProveedor = () => {
                modalProveedor.classList.add('hidden');
                modalProveedor.classList.remove('flex');
            };

            panel.addEventListener('click', (e) => {
                if (e.target.closest('[data-crear-proveedor]')) abrirModalProveedor(inputBuscar.value.trim());
            });
            modalProveedor.querySelectorAll('[data-cerrar-modal-proveedor]').forEach(b => b.addEventListener('click', cerrarModalProveedor));
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !modalProveedor.classList.contains('hidden') && !Swal.isVisible()) cerrarModalProveedor();
            });

            formProv.addEventListener('submit', async (e) => {
                e.preventDefault();
                // Los mismos obligatorios que exige el modelo (models/Provedores.js); el
                // servidor los vuelve a revisar.
                const v = (n) => formProv.elements[n]?.value.trim() || '';
                const falta = !v('razonSocial') ? 'Escribe la razón social del proveedor.'
                    : !v('nit') ? 'Escribe el número de identificación.'
                    : !v('departamentoSelect') || !v('ciudadSelect') ? 'Elige el departamento y la ciudad.'
                    : !v('direccionProvedor') ? 'Escribe la dirección del proveedor.'
                    : !formProv.elements.emailProvedor.checkValidity() || !v('emailProvedor') ? 'Escribe un email válido.'
                    : !formProv.querySelector('input[name="categorias"]:checked') ? 'Elige al menos una categoría de lo que vende.'
                    : !v('nombreContacto') ? 'Escribe el nombre del contacto.'
                    : '';
                if (falta) {
                    await avisoConfirmacion({ variante: 'neutro', icono: 'fi-rr-info', badge: 'Falta un dato', contexto: falta });
                    return;
                }
                if (!(await confirmarProveedor(formProv, { modo: 'alta' }))) return;

                btnGuardarProv.disabled = true;
                btnGuardarProv.innerHTML = '<i class="fi fi-rr-spinner animate-spin"></i> Guardando...';
                try {
                    const r = await fetch('/admin/provedores/new', { method: 'POST', body: new FormData(formProv) });
                    if (r.status === 403) throw new Error('Tu usuario no tiene permiso para crear proveedores.');
                    const data = await r.json().catch(() => ({}));
                    if (!r.ok || !data.success) throw new Error(data.mensaje || 'No se pudo guardar el proveedor.');
                    cerrarModalProveedor();
                    await elegirProveedor(data.idProveedor);
                } catch (err) {
                    await avisoConfirmacion({ variante: 'egreso', icono: 'fi-rr-exclamation', badge: 'No se guardó el proveedor', contexto: err.message });
                } finally {
                    btnGuardarProv.disabled = false;
                    btnGuardarProv.innerHTML = textoBtnProv;
                }
            });
        }

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
            // "La mercancía ya llegó" solo existe para una orden de compra: una cotización no se recibe.
            document.getElementById('caja-recibir-ahora')?.classList.toggle('hidden', modoMultiple);

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

    // ── Modal "Agregar insumo" (también edita) — src/js/modalLineaInsumo.js ────────────
    iniciarModalLineaInsumo({
        tabla,
        buscarLinea: (uid) => lineas.find(x => x.uid === uid),
        alConfirmar: ({ filas, editandoUid }) => {
            if (editandoUid !== null) {
                const i = lineas.findIndex(x => x.uid === editandoUid);
                if (i !== -1) lineas.splice(i, 1);
            }
            filas.forEach(f => agregarLinea({ uid: proximoUid++, ...f }));
            renumerar();
        }
    });

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

    const payloadLineas = () => lineas.map(aPayloadLinea);

    const aviso = avisoConfirmacion;

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
                headers: { 'Content-Type': 'application/json'},
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
    // ── "La mercancía ya llegó": crear y recibir en un solo paso ───────────────────────
    // Para cuando la factura llega con la mercancía: en vez de crear la orden, ir al
    // historial y recibirla, se confirma acá cuánto llegó (misma ventana que "Recibir orden",
    // src/js/recepcionOrden.js) y el servidor crea y recibe en una sola transacción.
    const chkRecibirAhora = document.getElementById('recibir-ahora');
    const campoTipoOrden = () => document.getElementById('tipoOrden');
    const datosRecepcion = JSON.parse(document.getElementById('datos-recepcion')?.textContent || '{}');
    const lineasParaRecibir = () => lineas.map((l, i) => {
        const op = document.querySelector(`#li-material option[value="${CSS.escape(l.idMaterial)}"]`);
        const unidadConsumo = op?.dataset.consumo || 'unidad';
        const presentacion = l.unidadCompra || 'unidad';
        return {
            clave: i,
            nombreMaterial: l.nombreMaterial,
            colorNombre: l.colorNombre,
            cantidad: l.cantidad,
            unidadCompra: presentacion,
            cantidadRecibida: 0,
            unidadConsumo,
            factorFijo: factorFijoDe(datosRecepcion.factores, presentacion, unidadConsumo),
            contenidoSugerido: datosRecepcion.recordadas?.[l.idMaterial]?.[presentacion] ?? null,
            valorUnitario: l.valorUnitario
        };
    });

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const cab = validarAntesDeEnviar();
        if (!cab) return;

        const recibirAhora = Boolean(chkRecibirAhora?.checked) && campoTipoOrden()?.value === 'orden_compra';
        let recepcion = null;
        if (recibirAhora) {
            const datos = await pedirRecepcion(lineasParaRecibir());
            if (!datos) return;
            recepcion = datos.map(d => ({ cantidadLlega: d.cantidadLlega, contenido: d.contenido }));
        }

        const CODIGO_ID = 'oc-codigo-empleado';
        const ESTADO_ID = 'oc-codigo-estado';
        const { isConfirmed, value } = await Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: `
                <div class="gh-conf-html">
                    ${cabeceraConfirmacion({ icono: recibirAhora ? 'fi-rr-box-check' : 'fi-rr-file-signature', badge: recibirAhora ? 'Crear y recibir orden de compra' : 'Confirmar orden de compra', contexto: `${lineas.length} ítem${lineas.length === 1 ? '' : 's'} · ${document.getElementById('resumen-total').textContent}` })}
                    <div class="px-7 pt-1 pb-5">
                        <div class="gh-conf-aviso"><i class="fi fi-rr-info"></i>
                            <span>${recibirAhora
                                ? 'Se crea la orden y lo que llegó entra al inventario de una vez. Queda a nombre del empleado que lo autoriza, que también necesita permiso para recibir.'
                                : 'Queda registrada a nombre del empleado que la autoriza. No se puede deshacer, solo cancelar después.'}</span></div>
                    </div>
                    <p class="gh-conf-campo-label">Código de empleado que autoriza</p>
                    ${campoCodigoEmpleado(CODIGO_ID, '1.75rem')}
                    <p class="gh-conf-estado" id="${ESTADO_ID}"></p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: recibirAhora ? 'Crear y recibir' : 'Crear orden de compra',
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
                        headers: { 'Content-Type': 'application/json'},
                        body: JSON.stringify({ ...cab, codigoEmpleado, lineas: payloadLineas(), ...(recibirAhora ? { recibirAhora: true, recepcion } : {}) })
                    });
                    const d = await r.json().catch(() => ({}));
                    if (d.logout) { window.location.href = '/'; return false; }
                    if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo crear la orden.');
                    return d;
                } catch (e) {
                    boton.disabled = false;
                    boton.textContent = recibirAhora ? 'Crear y recibir' : 'Crear orden de compra';
                    Swal.showValidationMessage(e.message);
                    return false;
                }
            }
        }));
        if (!isConfirmed) return;
        const numerosOrden = value.ordenes.map(o => o.numeroOrden).join(', ');
        await aviso({ variante: 'ingreso', icono: 'fi-rr-check', badge: value.ordenes.length > 1 ? 'Órdenes creadas' : value.recibida ? 'Orden creada y recibida' : 'Orden creada', contexto: value.recibida ? `${numerosOrden} · ya está en el inventario` : numerosOrden });
        window.location.href = '/admin/insumos';
    });
}
