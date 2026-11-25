import { escaparHtml as esc } from './escaparHtml.js';
import { activarFormularioInsumo } from './formularioInsumo.js';
import { crearModalColores } from './modalColores.js';

// Modal "Agregar insumo" de una orden de compra (también edita: mismo formulario, con los
// datos de la línea precargados). Lo usan la orden nueva (ordenCompra.js) y el detalle de
// una orden ya creada (ordenCompraDetalle.js): antes cada una tenía su copia de ~390 líneas
// —colores, sub-modal de colores con alta de color nuevo, características, validación— y
// solo se diferenciaban en dos cosas, que es lo que recibe esta función:
//
//   buscarLinea(uid)  → la línea que abre el lápiz de una fila (cada pantalla las guarda
//                       distinto: la nueva en un arreglo, el detalle separa existentes y nuevas).
//   alConfirmar({ filas, editandoUid }) → qué hacer con lo que salió del formulario. `filas`
//                       es una línea por color elegido (o una sola, sin color), todas con el
//                       mismo insumo y características; `editandoUid` es el uid de la línea
//                       que se está reemplazando, o null si es un alta.
//
// Editar es, por dentro, quitar la línea original y agregar la(s) que salga(n) del
// formulario: si una edición pasa de un color a dos, la línea se parte en dos sin un caso
// especial aparte.

export const UNIDAD_ETIQUETA = { kg: 'kg', metro: 'm', rollo: 'rollos', unidad: 'uds', bolsa: 'bolsas', caja: 'cajas' };

// Lo que viaja al servidor de una línea (nueva orden o línea nueva de una cotización). Una
// sola copia: las dos pantallas la tenían escrita igual, y a las dos les faltaba la
// presentación elegida en la línea (`unidadCompra`), así que siempre se guardaba la del
// insumo. Nombre y código no viajan: el servidor los toma del catálogo (validarLineaOrden).
export const aPayloadLinea = (l) => ({
    idMaterial: l.idMaterial,
    cantidad: l.cantidad,
    unidadCompra: l.unidadCompra,
    valorUnitario: l.valorUnitario,
    idAtributoColor: l.idAtributoColor,
    caracteristicas: l.caracteristicas
});

// Mismo patrón que round2 de helpers/formatMoney.js.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function iniciarModalLineaInsumo({ tabla, buscarLinea, alConfirmar }) {
    const modal = document.getElementById('modal-agregar-insumo');
    if (!modal) return;
    const tituloModal    = document.getElementById('modal-agregar-insumo-titulo');
    const subtituloModal = document.getElementById('modal-agregar-insumo-subtitulo');
    const btnConfirmarLi = document.getElementById('btn-confirmar-li');
    const abrir  = () => { modal.classList.remove('hidden'); modal.classList.add('flex'); };
    const cerrar = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };
    document.getElementById('btn-agregar-insumo')?.addEventListener('click', abrir);
    document.getElementById('modal-agregar-insumo-cerrar')?.addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

    // uid de la línea que se está editando, o null cuando el modal agrega una nueva.
    // limpiarModal() lo vuelve a null siempre (se llama tanto al abrir "Agregar insumo" como
    // al dar "Limpiar"), así que abrirParaEditar lo pisa después de limpiar, no antes.
    let editandoUid = null;

    const selMaterial = document.getElementById('li-material');
    // Buscable como departamento/municipio (window.enhanceSelectBuscable, helpers.js): el
    // <select> real sigue mandando el idMaterial tal cual, esto solo agrega un input de
    // texto + lista filtrable encima.
    // Cada opción con la foto del material (o el ícono de su tipo). Si la vista dibujó el modal
    // "Nuevo insumo" (components/modalNuevoInsumo.pug, solo con permiso Insumos CREATE), la
    // lista termina con "Crear insumo «…»" para el que no existe.
    const modalAlta = document.getElementById('modal-nuevo-insumo');
    const abrirAltaInsumo = (termino) => {
        document.getElementById('btn-limpiar-insumo')?.click();   // formulario en blanco
        const nombre = document.getElementById('nombre');
        if (nombre) { nombre.value = termino; nombre.dispatchEvent(new Event('input')); }
        modalAlta.classList.remove('hidden');
        modalAlta.classList.add('flex');
        nombre?.focus();
    };
    const materialBuscable = window.enhanceSelectBuscable?.(selMaterial, {
        placeholder: 'Escribe o elige un insumo',
        conImagen: true,
        accion: modalAlta && {
            etiqueta: (t) => t ? `Crear insumo «${t}»` : 'Crear un insumo nuevo',
            alElegir: abrirAltaInsumo
        }
    }) || { refresh() {} };

    if (modalAlta) {
        const cerrarAlta = () => { modalAlta.classList.add('hidden'); modalAlta.classList.remove('flex'); };
        document.getElementById('modal-nuevo-insumo-cerrar')?.addEventListener('click', cerrarAlta);
        modalAlta.addEventListener('click', (e) => { if (e.target === modalAlta) cerrarAlta(); });

        // Mismo formulario, validación y endpoint que el catálogo (src/js/insumos.js). Al
        // guardar, el material entra a la lista y queda elegido en la línea.
        activarFormularioInsumo({
            formId: 'form-insumo',
            urlGuardar: '/admin/insumos',
            badgeConfirmacion: 'Nuevo material',
            confirmarTexto: 'Guardar insumo',
            badgeExito: 'Material guardado',
            alGuardar: ({ material: m }) => {
                const op = new Option(`${m.nombre} · código ${m.codigoMaterial}`, m.idMaterial);
                // Los mismos data-* que pinta el servidor (components/modalInsumoOrden.pug): sin
                // `consumo`, la ventana de recepción tomaba "unidad" y preguntaba cuántas
                // unidades trae un metro.
                Object.assign(op.dataset, { unidad: m.unidadCompra || '', consumo: m.unidadConsumo || 'unidad', nombre: m.nombre, codigo: m.codigoMaterial, imagen: m.imagenUrl || m.icono });
                if (!m.imagenUrl) op.dataset.sinFoto = '';
                // En su lugar alfabético, como llega la lista del servidor.
                const siguiente = [...selMaterial.options].find(o => o.value && o.dataset.nombre.localeCompare(m.nombre, 'es') > 0);
                selMaterial.add(op, siguiente || null);
                selMaterial.value = m.idMaterial;
                selMaterial.dispatchEvent(new Event('change'));
                materialBuscable.refresh();
                cerrarAlta();
            }
        });
    }

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

    // Formato de miles mientras se escribe (window.initMoneyInput, helpers.js) — igual que
    // cualquier campo de precio del panel. Cantidad también, aunque no sea dinero: es lo que
    // se pidió, y simplifica no tener dos comportamientos de input distintos en el mismo
    // formulario.
    window.initMoneyInput?.(inpCantidad);
    window.initMoneyInput?.(inpValor);

    // Presentación de la línea (kg, bolsa…): arranca en la del insumo y se puede cambiar.
    // Todo sufijo de unidad del modal la sigue (`data-sufijo-unidad` en las filas por color).
    const selPresentacion = document.getElementById('li-presentacion');
    const presentacionActual = () => selPresentacion?.value || selMaterial.selectedOptions[0]?.dataset.unidad || '';
    const pintarSufijos = () => {
        const u = UNIDAD_ETIQUETA[presentacionActual()] || '';
        sufijoUnidad.textContent = u;
        modal.querySelectorAll('[data-sufijo-unidad]').forEach(el => { el.textContent = u; });
    };
    selMaterial.addEventListener('change', () => {
        if (selPresentacion) selPresentacion.value = selMaterial.selectedOptions[0]?.dataset.unidad || '';
        pintarSufijos();
    });
    selPresentacion?.addEventListener('change', pintarSufijos);

    // ── Colores elegidos para este insumo (0, 1 o varios) ───────────────────────────────
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
        const unidad = UNIDAD_ETIQUETA[presentacionActual()] || '';
        const fila = document.createElement('div');
        fila.className = 'flex items-center gap-3';
        fila.dataset.filaColor = color.idAtributo;
        fila.dataset.nombreColor = color.valor;
        fila.innerHTML = `
            <span class="w-4 h-4 rounded-full border border-black/10 flex-shrink-0" style="background-color:${color.codigo1 || '#ccc'}"></span>
            <span class="text-xs font-semibold text-slate-700 w-20 flex-shrink-0 truncate">${esc(color.valor)}</span>
            <div class="relative flex-1">
                <input type="text" inputmode="numeric" autocomplete="off" placeholder="Cantidad" class="field-text text-sm" data-cant>
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400" data-sufijo-unidad>${esc(unidad)}</span>
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

    // Lee cada fila de #li-filas-por-color; null si alguna cantidad/valor no es válido (y
    // pinta el borde en rojo de la fila que falló, para que se vea cuál es).
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

    // ── Sub-modal "Elegir colores" ──────────────────────────────────────────────────────
    // El componente compartido de colores (views/components/modalColores.pug), con alta de
    // un color simple nuevo. `coloresElegidos` guarda { idAtributo, valor, codigo1 } como antes.
    const selectorColores = crearModalColores('modal-colores-insumo', (_ids, colores) => {
        coloresElegidos = colores.map(c => ({ idAtributo: String(c.idAtributo), valor: c.valor, codigo1: c.codigo1 }));
        renderChipsColores();
        renderSeccionCantidadValor();
    });
    document.getElementById('li-btn-elegir-colores')?.addEventListener('click', () => {
        selectorColores.abrir(coloresElegidos.map(c => c.idAtributo));
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
        if (selPresentacion) selPresentacion.value = '';
        inpCantidad.value = '';
        inpValor.value = '';
        sufijoUnidad.textContent = '';
        contCaracteristicas.innerHTML = '';
        coloresElegidos = [];
        renderChipsColores();
        renderSeccionCantidadValor();
        ['material', 'cantidad', 'valorUnitario'].forEach(c => pintarErrorLi(c, ''));
        errorPorColor.classList.add('hidden');
    };
    document.getElementById('btn-limpiar-li')?.addEventListener('click', limpiarModal);
    document.getElementById('btn-agregar-insumo')?.addEventListener('click', limpiarModal);

    // Lápiz de una fila: mismo modal precargado con la línea. El color se busca en el modal
    // de colores (selectorColores.color) para recuperar su hex, que la línea guardada no trae. El uid viene
    // siempre del dataset del botón, nunca del objeto: en el detalle una línea existente se
    // identifica por `idDetalleOrdenCompra` y una nueva por `uid`.
    const abrirParaEditar = (l, uid) => {
        limpiarModal();
        editandoUid = uid;
        if (tituloModal) tituloModal.textContent = 'Editar insumo';
        if (subtituloModal) subtituloModal.textContent = 'Los cambios reemplazan la línea actual.';
        if (btnConfirmarLi) btnConfirmarLi.textContent = 'Guardar cambios';

        selMaterial.value = l.idMaterial;
        materialBuscable.refresh();
        selMaterial.dispatchEvent(new Event('change'));
        // La presentación que se eligió en esa línea, no la del insumo hoy.
        if (selPresentacion && l.unidadCompra) { selPresentacion.value = l.unidadCompra; pintarSufijos(); }

        if (l.idAtributoColor) {
            const c = selectorColores.color(l.idAtributoColor);
            coloresElegidos = [c
                ? { idAtributo: l.idAtributoColor, valor: c.valor, codigo1: c.codigo1 }
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
        const l = buscarLinea(uid);
        if (l) abrirParaEditar(l, uid);
    });

    btnConfirmarLi?.addEventListener('click', () => {
        const op = selMaterial.selectedOptions[0];
        let huboError = false;
        if (!selMaterial.value) { pintarErrorLi('material', 'Elige un insumo.'); huboError = true; } else pintarErrorLi('material', '');

        // Una línea por color elegido (o una sola, sin color, si no se eligió ninguno) —
        // todas comparten insumo y características, cada una con su propia cantidad/valor.
        const porColor = [];

        if (coloresElegidos.length >= 2) {
            const filas = leerFilasPorColor();
            if (!filas) {
                errorPorColor.textContent = 'Revisa la cantidad y el valor de cada color.';
                errorPorColor.classList.remove('hidden');
                huboError = true;
            } else {
                errorPorColor.classList.add('hidden');
                porColor.push(...filas);
            }
        } else {
            const cantidad = parseInt(inpCantidad.value.replace(/[^0-9]/g, ''), 10);
            const valorUnitario = parseInt(inpValor.value.replace(/[^0-9]/g, ''), 10);
            if (!Number.isFinite(cantidad) || cantidad <= 0) { pintarErrorLi('cantidad', 'Escribe una cantidad mayor a 0.'); huboError = true; } else pintarErrorLi('cantidad', '');
            if (!Number.isFinite(valorUnitario) || valorUnitario <= 0) { pintarErrorLi('valorUnitario', 'Escribe un valor mayor a 0.'); huboError = true; } else pintarErrorLi('valorUnitario', '');
            if (!huboError) {
                const unico = coloresElegidos[0] || null;
                porColor.push({ cantidad, valorUnitario, idAtributoColor: unico?.idAtributo || null, colorNombre: unico?.valor || null });
            }
        }

        if (huboError || !selMaterial.value) return;

        const caracteristicas = leerCaracteristicas();
        const unidadCompra = presentacionActual() || null;
        const filas = porColor.map(l => ({
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

        // La fila original se saca de la tabla acá; cada pantalla saca la línea de su
        // propio estado en alConfirmar.
        if (editandoUid !== null) tabla.querySelector(`tr[data-uid="${editandoUid}"]`)?.remove();
        alConfirmar({ filas, editandoUid });
        cerrar();
    });
}
