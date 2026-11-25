import { crearModalElegirInsumo } from './modalElegirInsumo.js';
import { escaparHtml as esc } from './escaparHtml.js';
import { opcionesConfirmacion, cabeceraConfirmacion } from './modalConfirmacion.js';
import { crearModalColores } from './modalColores.js';
import { initFechaInput } from './fechaInput.js';

// Formulario de la orden de producción (views/administrador/produccion/ordenProduccionForm.pug).
// Lo que se valida acá es comodidad: la garantía está en el servidor (validarOrdenBody,
// helpers/ordenesProduccion.js). La revisión de material se pide al servidor mientras se
// escribe (POST /admin/procesos/ordenes/revisar-material), con la misma cuenta que el detalle.
(function () {
    const raiz = document.getElementById('orden-produccion-form');
    if (!raiz) return;

    const leerJson = (attr, defecto) => { try { return JSON.parse(raiz.dataset[attr] || ''); } catch { return defecto; } };
    const idFicha = raiz.dataset.idFicha;
    const idOrden = raiz.dataset.idOrden || null;
    const inicial = leerJson('inicial', { cantidades: [], insumos: [] });
    const tallas = leerJson('tallas', []);
    const coloresPrenda = leerJson('coloresPrenda', []);
    const coloresInsumo = leerJson('coloresInsumo', []);
    const catalogo = leerJson('catalogo', {});
    const maxCelda = Number(raiz.dataset.maxCelda) || 100000;

    const colorPrendaPorId = new Map(coloresPrenda.map((c) => [Number(c.idAtributo), c]));
    const colorInsumoIds = new Set(coloresInsumo.map((c) => Number(c.idAtributo)));
    const pastilla = (c) => {
        const fondo = c?.codigo2 ? `linear-gradient(135deg, ${c.codigo1} 50%, ${c.codigo2} 50%)` : (c?.codigo1 || '#ccc');
        return `<span class="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-black/10" style="background:${esc(fondo)}"></span>`;
    };

    // ── Errores ──────────────────────────────────────────────────────────────────────────
    const errorDe = (campo) => raiz.querySelector(`[data-error="${campo}"]`);
    const errorGeneral = document.getElementById('op-error-general');
    const limpiarErrores = () => {
        raiz.querySelectorAll('[data-error]').forEach((el) => el.classList.add('hidden'));
        errorGeneral.classList.add('hidden');
    };
    const mostrar = (el, texto) => { if (!el) return; el.textContent = texto; el.classList.remove('hidden'); };

    // ── Datos ────────────────────────────────────────────────────────────────────────────
    const inputFecha = document.getElementById('op-fecha');
    const inputNotas = document.getElementById('op-notas');
    inputFecha.value = inicial.fechaRequerida || '';
    inputNotas.value = inicial.notas || '';
    // Calendario del panel (Flatpickr con la piel de la marca), no el nativo del navegador.
    // El input sigue mandando 'Y-m-d'; la persona ve dd/mm/aaaa.
    const calendario = initFechaInput(inputFecha, { minDate: inputFecha.dataset.min || 'today' });

    // ── Cantidades ───────────────────────────────────────────────────────────────────────
    const cuerpo = document.getElementById('op-filas-color');
    const sinColores = document.getElementById('op-sin-colores');
    const totalGeneral = document.getElementById('op-total-general');

    const coloresEnUso = () => [...cuerpo.querySelectorAll('[data-fila-color]')].map((f) => Number(f.dataset.filaColor));

    const recalcularTotales = () => {
        let total = 0;
        const porTalla = Object.fromEntries(tallas.map((t) => [t.codigo, 0]));
        cuerpo.querySelectorAll('[data-fila-color]').forEach((fila) => {
            let totalFila = 0;
            fila.querySelectorAll('[data-celda]').forEach((inp) => {
                const n = parseInt(inp.value, 10) || 0;
                totalFila += n;
                porTalla[inp.dataset.celda] += n;
            });
            fila.querySelector('[data-total-fila]').textContent = totalFila.toLocaleString('es-CO');
            total += totalFila;
        });
        tallas.forEach((t) => { raiz.querySelector(`[data-total-talla="${CSS.escape(t.codigo)}"]`).textContent = porTalla[t.codigo].toLocaleString('es-CO'); });
        totalGeneral.textContent = total.toLocaleString('es-CO');
        sinColores.classList.toggle('hidden', coloresEnUso().length > 0);
    };

    const agregarFilaColor = (idColor, valores = {}) => {
        const color = colorPrendaPorId.get(Number(idColor));
        if (!color || coloresEnUso().includes(Number(idColor))) return;
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100';
        tr.dataset.filaColor = String(idColor);
        tr.innerHTML = `
            <td class="py-2 pr-3"><span class="inline-flex items-center gap-2 font-semibold text-slate-700">${pastilla(color)}${esc(color.valor)}</span></td>
            ${tallas.map((t) => `<td class="py-1.5 px-1"><input type="number" inputmode="numeric" min="0" max="${maxCelda}" step="1" data-celda="${esc(t.codigo)}" aria-label="${esc(color.valor)} talla ${esc(t.etiqueta)}" class="field-text !py-1.5 !px-2 w-16 text-center mx-auto block"></td>`).join('')}
            <td class="py-2 px-2 text-right font-bold text-slate-800" data-total-fila>0</td>
            <td class="py-2 pl-2"><button type="button" data-quitar-color aria-label="Quitar ${esc(color.valor)}" class="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"><i class="fi fi-rr-cross-small"></i></button></td>`;
        tr.querySelectorAll('[data-celda]').forEach((inp) => { if (valores[inp.dataset.celda]) inp.value = valores[inp.dataset.celda]; });
        cuerpo.appendChild(tr);
        recalcularTotales();
        repintarColoresInsumos();
    };

    cuerpo.addEventListener('input', (e) => { if (e.target.matches('[data-celda]')) { recalcularTotales(); pedirRevision(); } });
    cuerpo.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-quitar-color]');
        if (!btn) return;
        btn.closest('[data-fila-color]').remove();
        recalcularTotales();
        repintarColoresInsumos();
        pedirRevision();
    });

    // "Elegir colores": el mismo modal de casillas que el alta de productos. Lo que se marca
    // y no estaba se agrega como fila; lo que se desmarca se quita, preguntando antes si esa
    // fila ya tenía cantidades escritas.
    const prendasDeFila = (fila) => [...fila.querySelectorAll('[data-celda]')].reduce((s, i) => s + (parseInt(i.value, 10) || 0), 0);
    const modalColores = crearModalColores('op-modal-colores', async (ids) => {
        const elegidos = new Set(ids);
        const quitar = [...cuerpo.querySelectorAll('[data-fila-color]')].filter((f) => !elegidos.has(Number(f.dataset.filaColor)));
        const conDatos = quitar.filter((f) => prendasDeFila(f) > 0);
        if (conDatos.length) {
            const nombres = conDatos.map((f) => esc(colorPrendaPorId.get(Number(f.dataset.filaColor))?.valor)).join(', ');
            const r = await Swal.fire(opcionesConfirmacion({
                variante: 'egreso',
                html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono: 'fi-rr-palette', badge: 'Quitar colores', contexto: `${nombres} ya ${conDatos.length === 1 ? 'tiene' : 'tienen'} cantidades escritas. Si lo quitas, se borran.` })}</div>`,
                showCancelButton: true,
                confirmButtonText: 'Quitar',
                cancelButtonText: 'Volver'
            }));
            if (!r.isConfirmed) return false;
        }
        quitar.forEach((f) => f.remove());
        ids.forEach((id) => agregarFilaColor(id));
        recalcularTotales();
        repintarColoresInsumos();
        pedirRevision();
        return true;
    });
    document.getElementById('op-btn-elegir-colores')?.addEventListener('click', () => modalColores.abrir(coloresEnUso()));

    const leerCantidades = () => [...cuerpo.querySelectorAll('[data-fila-color]')].flatMap((fila) =>
        [...fila.querySelectorAll('[data-celda]')].map((inp) => ({
            idAtributoColor: Number(fila.dataset.filaColor),
            talla: inp.dataset.celda,
            cantidad: parseInt(inp.value, 10) || 0
        })).filter((c) => c.cantidad > 0));

    // ── Insumos ──────────────────────────────────────────────────────────────────────────
    const lista = document.getElementById('op-lista-insumos');
    const plantilla = document.getElementById('op-plantilla-insumo');
    const sinInsumos = document.getElementById('op-sin-insumos');

    const pintarInsumo = (fila, insumo) => {
        fila.dataset.idMaterial = insumo.idMaterial;
        fila.dataset.conColor = insumo.conColor ? '1' : '';
        const nombre = fila.querySelector('[data-insumo-nombre]');
        nombre.textContent = insumo.nombre;
        nombre.title = insumo.nombre;
        fila.querySelector('[data-insumo-unidad]').textContent = insumo.unidad ? `${insumo.unidad}/prenda` : '/prenda';
        fila.querySelector('[data-insumo-foto]').innerHTML = insumo.imagen
            ? `<img src="${esc(insumo.imagen)}" alt="" class="w-full h-full object-cover">`
            : '<i class="fi fi-rr-box text-xs"></i>';
        repintarColoresFila(fila, {});
    };

    // Por cada color de prenda, un selector con los colores simples de insumo. Arranca en el
    // mismo color de la prenda si existe como color de insumo; si no, hay que elegirlo.
    function repintarColoresFila(fila, elegidos) {
        const caja = fila.querySelector('[data-insumo-colores]');
        const listaColores = fila.querySelector('[data-insumo-colores-lista]');
        const conColor = fila.dataset.conColor === '1';
        const colores = coloresEnUso();
        caja.classList.toggle('hidden', !conColor || !colores.length);
        caja.classList.toggle('flex', conColor && colores.length > 0);
        if (!conColor) { listaColores.innerHTML = ''; return; }
        // Conserva lo que ya estaba elegido en pantalla.
        listaColores.querySelectorAll('select[data-color-prenda]').forEach((s) => {
            if (!(s.dataset.colorPrenda in elegidos) && s.value) elegidos[s.dataset.colorPrenda] = s.value;
        });
        listaColores.innerHTML = colores.map((idPrenda) => {
            const prenda = colorPrendaPorId.get(idPrenda);
            const actual = elegidos[idPrenda] ?? (colorInsumoIds.has(idPrenda) ? String(idPrenda) : '');
            return `<label class="flex items-center gap-2 text-xs text-slate-600">
                <span class="inline-flex items-center gap-1.5 w-28 truncate">${pastilla(prenda)}${esc(prenda?.valor)}</span>
                <i class="fi fi-rr-arrow-right text-[9px] text-slate-400"></i>
                <select data-color-prenda="${idPrenda}" class="field-text !py-1 !text-xs flex-1">
                    <option value="">Elige el color…</option>
                    ${coloresInsumo.map((c) => `<option value="${Number(c.idAtributo)}" ${String(c.idAtributo) === String(actual) ? 'selected' : ''}>${esc(c.valor)}</option>`).join('')}
                </select></label>`;
        }).join('');
    }
    function repintarColoresInsumos() {
        lista.querySelectorAll('[data-fila-insumo]').forEach((f) => repintarColoresFila(f, {}));
    }

    const selectorInsumo = crearModalElegirInsumo('op-modal-insumo', (insumo, fila) => {
        const repetido = [...lista.querySelectorAll('[data-fila-insumo]')].some((f) => f !== fila && f.dataset.idMaterial === insumo.idMaterial);
        if (repetido) { mostrar(errorDe('insumos'), `"${insumo.nombre}" ya está en la orden.`); return; }
        errorDe('insumos').classList.add('hidden');
        const destino = fila || nuevaFilaInsumo();
        pintarInsumo(destino, insumo);
        if (!fila) destino.querySelector('[data-insumo-cantidad]').focus();
        pedirRevision();
    });

    function nuevaFilaInsumo() {
        const fila = plantilla.content.firstElementChild.cloneNode(true);
        lista.appendChild(fila);
        sinInsumos.classList.add('hidden');
        return fila;
    }

    lista.addEventListener('click', (e) => {
        const fila = e.target.closest('[data-fila-insumo]');
        if (!fila) return;
        if (e.target.closest('[data-reemplazar-insumo]')) selectorInsumo.abrir(fila);
        if (e.target.closest('[data-quitar-insumo]')) {
            fila.remove();
            sinInsumos.classList.toggle('hidden', lista.children.length > 0);
            pedirRevision();
        }
    });
    lista.addEventListener('input', (e) => { if (e.target.matches('[data-insumo-cantidad]')) pedirRevision(); });
    lista.addEventListener('change', (e) => { if (e.target.matches('select[data-color-prenda]')) pedirRevision(); });
    document.getElementById('op-btn-agregar-insumo').addEventListener('click', () => selectorInsumo.abrir(null));

    const leerInsumos = () => [...lista.querySelectorAll('[data-fila-insumo]')].map((fila) => ({
        idMaterial: fila.dataset.idMaterial,
        cantidadTexto: fila.querySelector('[data-insumo-cantidad]').value,
        cantidadPorPrenda: window.leerDecimal(fila.querySelector('[data-insumo-cantidad]').value),
        nombre: fila.querySelector('[data-insumo-nombre]').textContent,
        colores: [...fila.querySelectorAll('select[data-color-prenda]')]
            .filter((s) => s.value)
            .map((s) => ({ idAtributoColorPrenda: Number(s.dataset.colorPrenda), idAtributoColorInsumo: Number(s.value) })),
        conColor: fila.dataset.conColor === '1'
    }));

    // ── Revisión de material ─────────────────────────────────────────────────────────────
    const panelRevision = document.getElementById('op-revision');
    const estadoRevision = document.getElementById('op-revision-estado');
    const ESTILO = {
        alcanza:        { texto: 'Alcanza',        clase: 'text-emerald-700 bg-emerald-50' },
        falta:          { texto: 'Falta',          clase: 'text-amber-700 bg-amber-50' },
        sin_existencia: { texto: 'Sin existencia', clase: 'text-rose-700 bg-rose-50' }
    };
    const num = (v) => window.mostrarDecimal(v);
    let temporizador = null;
    let pedido = 0;

    function pedirRevision() {
        clearTimeout(temporizador);
        temporizador = setTimeout(revisar, 450);
    }
    async function revisar() {
        const cantidades = leerCantidades();
        const insumos = leerInsumos().filter((i) => i.cantidadPorPrenda && Number(i.cantidadPorPrenda) > 0);
        if (!cantidades.length || !insumos.length) {
            panelRevision.innerHTML = `<p class="text-sm text-slate-400">${!insumos.length ? 'Sin insumos que revisar.' : 'Escribe cantidades para revisar.'}</p>`;
            estadoRevision.textContent = '';
            return;
        }
        const n = ++pedido;
        estadoRevision.textContent = 'Revisando…';
        try {
            const r = await fetch('/admin/procesos/ordenes/revisar-material', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idOrdenProduccion: idOrden, cantidades, insumos: insumos.map(({ idMaterial, cantidadPorPrenda, colores }) => ({ idMaterial, cantidadPorPrenda, colores })) })
            });
            const datos = await r.json();
            if (n !== pedido) return;   // llegó una respuesta vieja
            if (!r.ok || !datos.success) throw new Error(datos.mensaje || 'No se pudo revisar.');
            pintarRevision(datos);
        } catch (e) {
            if (n !== pedido) return;
            estadoRevision.textContent = '';
            panelRevision.innerHTML = `<p class="text-xs font-semibold text-rose-600">${esc(e.message)}</p>`;
        }
    }
    function pintarRevision({ lineas, conFaltante }) {
        estadoRevision.textContent = conFaltante ? `${conFaltante} con faltante` : 'Todo alcanza';
        panelRevision.innerHTML = lineas.map((l) => {
            const e = ESTILO[l.estado];
            return `<div class="rounded-xl border border-slate-100 px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-semibold text-slate-700 truncate">${esc(l.nombre)}${l.colorNombre ? ` <span class="font-normal text-slate-500">· ${esc(l.colorNombre)}</span>` : ''}</span>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${e.clase}">${e.texto}</span>
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">Necesita ${num(l.necesario)} ${esc(l.unidad)} · disponible ${num(l.disponible)}${Number(l.comprometido) > 0 ? ` · otras órdenes ${num(l.comprometido)}` : ''}</div>
                ${Number(l.faltante) > 0 ? `<div class="text-[11px] font-bold text-rose-600 mt-0.5">Faltan ${num(l.faltante)} ${esc(l.unidad)}</div>` : ''}
            </div>`;
        }).join('');
    }

    // ── Estado inicial ───────────────────────────────────────────────────────────────────
    const porColor = new Map();
    for (const c of inicial.cantidades || []) {
        if (!porColor.has(c.idAtributoColor)) porColor.set(c.idAtributoColor, {});
        porColor.get(c.idAtributoColor)[c.talla] = c.cantidad;
    }
    porColor.forEach((valores, idColor) => agregarFilaColor(idColor, valores));
    recalcularTotales();
    // Orden que nació de un corte: las cantidades son las que se cortaron (el servidor
    // tampoco las toma del formulario, controller/ordenProduccionController.js).
    if (raiz.dataset.bloquearCantidades) {
        cuerpo.querySelectorAll('[data-celda]').forEach((inp) => { inp.readOnly = true; inp.tabIndex = -1; inp.classList.add('bg-slate-50'); });
        cuerpo.querySelectorAll('[data-quitar-color]').forEach((b) => b.remove());
    }

    for (const ins of inicial.insumos || []) {
        const datos = catalogo[ins.idMaterial];
        if (!datos) continue;   // el insumo ya no está activo: no se ofrece
        const fila = nuevaFilaInsumo();
        pintarInsumo(fila, { idMaterial: ins.idMaterial, ...datos });
        fila.querySelector('[data-insumo-cantidad]').value = window.mostrarDecimal(ins.cantidadPorPrenda);
        repintarColoresFila(fila, Object.fromEntries((ins.colores || []).map((c) => [c.idAtributoColorPrenda, String(c.idAtributoColorInsumo)])));
    }
    sinInsumos.classList.toggle('hidden', lista.children.length > 0);
    pedirRevision();

    // ── Guardar ──────────────────────────────────────────────────────────────────────────
    const btnGuardar = document.getElementById('op-btn-guardar');
    btnGuardar.addEventListener('click', async () => {
        limpiarErrores();
        const cantidades = leerCantidades();
        const insumos = leerInsumos();
        let ok = true;
        if (!inputFecha.value) { mostrar(errorDe('fechaRequerida'), 'Elige para qué fecha se necesita la producción.'); ok = false; }
        if (!cantidades.length) { mostrar(errorDe('cantidades'), 'Escribe cuántas prendas se hacen, al menos en un color y una talla.'); ok = false; }
        const malCantidad = insumos.find((i) => !i.cantidadPorPrenda || Number(i.cantidadPorPrenda) <= 0);
        const sinColor = insumos.find((i) => i.conColor && i.colores.length < coloresEnUso().length);
        if (malCantidad) { mostrar(errorDe('insumos'), `"${malCantidad.nombre}" necesita una cantidad por prenda mayor a 0.`); ok = false; }
        else if (sinColor) { mostrar(errorDe('insumos'), `"${sinColor.nombre}" maneja colores: elige de qué color va en cada color de la prenda.`); ok = false; }
        if (!ok) return;

        const total = cantidades.reduce((s, c) => s + c.cantidad, 0);
        const confirmacion = await Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: `<div class="gh-conf-html">${cabeceraConfirmacion({
                icono: 'fi-rr-list-check',
                badge: idOrden ? 'Guardar cambios' : 'Nueva orden',
                contexto: `${total.toLocaleString('es-CO')} prendas · ${insumos.length} insumo(s) · para el ${esc(calendario?.altInput?.value || inputFecha.value)}. Queda en borrador.`
            })}</div>`,
            showCancelButton: true,
            confirmButtonText: 'Guardar',
            cancelButtonText: 'Seguir editando'
        }));
        if (!confirmacion.isConfirmed) return;

        btnGuardar.disabled = true;
        try {
            const cuerpoPeticion = {
                fechaRequerida: inputFecha.value,
                notas: inputNotas.value,
                cantidades,
                insumos: insumos.map(({ idMaterial, cantidadPorPrenda, colores }) => ({ idMaterial, cantidadPorPrenda, colores }))
            };
            if (!idOrden) cuerpoPeticion.idFicha = idFicha;
            const r = await fetch(idOrden ? `/admin/procesos/ordenes/${encodeURIComponent(idOrden)}/actualizar` : '/admin/procesos/ordenes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cuerpoPeticion)
            });
            const datos = await r.json().catch(() => ({}));
            if (!r.ok || !datos.success) {
                if (datos.errores) Object.entries(datos.errores).forEach(([campo, msj]) => mostrar(errorDe(campo) || errorGeneral, msj));
                else mostrar(errorGeneral, datos.mensaje || 'No se pudo guardar la orden.');
                btnGuardar.disabled = false;
                return;
            }
            window.location.href = datos.url;
        } catch {
            mostrar(errorGeneral, 'No hay conexión con el servidor. Intenta de nuevo.');
            btnGuardar.disabled = false;
        }
    });
})();
