// Nuevo corte (admin/procesos/cortes/nuevo): el operador arma la orden de corte y la
// pantalla genera la guía que lee el cortador en el taller. Todo pasa en el navegador —la
// guía no pide nada al servidor— y todavía no se guarda en la base.
//
// El DOM es la fuente de verdad del formulario: los bloques salen de los <template> de
// views/administrador/produccion/corteNuevo.pug y `leerOrden()` los recorre al generar.
// Los totales salen de corteCalculos.js (funciones puras, con tests).
import { calcularOrden } from './corteCalculos.js';
import { initFechaInput } from './fechaInput.js';
import { escaparHtml as esc } from './escaparHtml.js';

const MAX_REFERENCIAS = 8;
const MAX_MATERIALES = 3;
const MAX_PIEZAS = 20;

// Un acento por material, en el orden MAT 1 / 2 / 3. Clases literales completas: Tailwind
// solo genera las que encuentra escritas tal cual en el código.
const ACENTOS = [
    { caja: 'border-sky-200 border-l-sky-400 bg-sky-50/40',         badge: 'bg-sky-100 text-sky-700',         guia: 'border-l-sky-400 bg-sky-50',         texto: 'text-sky-700' },
    { caja: 'border-emerald-200 border-l-emerald-400 bg-emerald-50/40', badge: 'bg-emerald-100 text-emerald-700', guia: 'border-l-emerald-400 bg-emerald-50', texto: 'text-emerald-700' },
    { caja: 'border-orange-200 border-l-orange-400 bg-orange-50/40',   badge: 'bg-orange-100 text-orange-700',   guia: 'border-l-orange-400 bg-orange-50',   texto: 'text-orange-700' }
];
const TODAS_LAS_CLASES_ACENTO = ACENTOS.flatMap(a => `${a.caja} ${a.badge}`.split(' '));

const EJEMPLO = {
    tela: 'Polilicra', proveedor: 'Textiles Jara', trazos: 1,
    referencias: [
        { codigo: '0438', prenda: 'Body Dulce', tipos: ['Body'], tallas: ['UNICA'], veces: 3, materiales: [
            { nombre: 'Polilicra', piezas: [['Frente'], ['Espalda']] },
            { nombre: 'Forro', piezas: [['Forro frente'], ['Tira sesgo', 3, '3cm × Ancho']] }
        ] },
        { codigo: '0085', prenda: 'Blusa Paris', tipos: ['Blusa'], tallas: ['UNICA'], veces: 3, materiales: [
            { nombre: 'Polilicra', piezas: [['Frente'], ['Espalda'], ['Mangas']] },
            { nombre: 'Forro', piezas: [['Forro frente']] },
            { nombre: 'RIB', piezas: [['Cuello']] }
        ] },
        { codigo: '0389', prenda: 'Top Daniela', tipos: ['Top'], tallas: ['UNICA'], veces: 3, materiales: [
            { nombre: 'Polilicra', piezas: [['Frente'], ['Espalda'], ['Copa', 2]] }
        ] }
    ]
};

const raiz = document.getElementById('corte-nuevo');
if (raiz) iniciar();

function iniciar() {
    let catalogos;
    try { catalogos = JSON.parse(raiz.dataset.catalogos || '{}'); } catch { catalogos = {}; }
    const { familias = [], tiposPrenda = [], tallas = [], piezasSugeridas = [] } = catalogos;
    const tallaExclusiva = new Set(tallas.filter(t => t.exclusiva).map(t => t.codigo));
    const etiquetaTalla = new Map(tallas.map(t => [t.codigo, t.etiqueta]));

    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
    const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    const num = (n) => Number(n).toLocaleString('es-CO');
    const plural = (n, uno, varios) => `${num(n)} ${n === 1 ? uno : varios}`;

    const lista = $('#lista-referencias');
    const tplRef = $('#tpl-referencia');
    const tplMat = $('#tpl-material');
    const btnAgregarRef = $('#btn-agregar-referencia');

    // ── Cabecera ──────────────────────────────────────────────────────────────
    const selTela = $('#corte-tela');
    const selProveedor = $('#corte-proveedor');
    const inpTrazos = $('#corte-trazos');
    const fpFecha = initFechaInput($('#corte-fecha'), { defaultDate: new Date() });
    window.enhanceSelectBuscable?.(selTela, { placeholder: 'Busca la tela…' });
    window.enhanceSelectBuscable?.(selProveedor, { placeholder: 'Busca el proveedor…' });

    // ── Errores en el campo (sin alert) ─────────────────────────────────────────
    const marcarError = (ctx, clave, mensaje, campo) => {
        const p = $(`[data-error-de="${clave}"]`, ctx);
        if (p) { p.textContent = mensaje; p.classList.remove('hidden'); }
        campo?.classList.add('field-text-error');
        campo?.closest('.select-buscable-wrap')?.querySelector('.select-buscable-input')?.classList.add('field-text-error');
    };
    const limpiarErrores = (ctx = document) => {
        $$('[data-error-de]', ctx).forEach(p => { p.textContent = ''; p.classList.add('hidden'); });
        $$('.field-text-error', ctx).forEach(el => el.classList.remove('field-text-error'));
    };
    // Al corregir un campo se le quita su error, no hace falta volver a generar para verlo.
    const limpiarErrorDe = (campo) => {
        campo.classList.remove('field-text-error');
        const clave = campo.dataset.campo || campo.id;
        const ctx = campo.closest('[data-material]') || campo.closest('[data-ref]') || document;
        $(`[data-error-de="${clave}"]`, ctx)?.classList.add('hidden');
    };
    raiz.addEventListener('input', (e) => limpiarErrorDe(e.target));
    raiz.addEventListener('change', (e) => {
        if (e.target.tagName !== 'SELECT') return;
        limpiarErrorDe(e.target);
        e.target.closest('.select-buscable-wrap')?.querySelector('.select-buscable-input')?.classList.remove('field-text-error');
    });

    // ── Píldoras (tipos de prenda y tallas) ─────────────────────────────────────
    const pildora = ({ valor, texto, grupo }) => `
        <label class="cursor-pointer select-none">
            <input type="checkbox" class="peer sr-only" value="${esc(valor)}" data-grupo="${esc(grupo)}">
            <span class="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-gh-primary peer-checked:border-gh-primaryHover peer-checked:bg-gh-primaryHover peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-gh-primary">${esc(texto)}</span>
        </label>`;

    const gruposTipos = tiposPrenda.reduce((m, t) => m.set(t.grupo, [...(m.get(t.grupo) || []), t]), new Map());
    const htmlTipos = [...gruposTipos].map(([grupo, tipos]) => `
        <div class="flex flex-wrap items-center gap-2">
            <span class="w-20 text-xs font-semibold uppercase tracking-wide text-slate-400">${esc(grupo)}</span>
            ${tipos.map(t => pildora({ valor: t.id, texto: t.nombre, grupo: 'tipo' })).join('')}
        </div>`).join('') || '<p class="text-sm text-slate-400">No hay subcategorías de prenda cargadas.</p>';
    const htmlTallas = tallas.map(t => pildora({ valor: t.codigo, texto: t.etiqueta, grupo: 'talla' })).join('');

    // ── Referencias ────────────────────────────────────────────────────────────
    const agregarReferencia = () => {
        if ($$('[data-ref]', lista).length >= MAX_REFERENCIAS) return null;
        const ref = tplRef.content.firstElementChild.cloneNode(true);

        const sel = $('[data-campo="familia"]', ref);
        sel.innerHTML = '<option value="">Elige la prenda</option>' +
            familias.map(f => `<option value="${esc(f.id)}">${esc(f.nombre)}</option>`).join('');
        $('[data-tipos]', ref).innerHTML = htmlTipos;
        $('[data-tallas]', ref).innerHTML = htmlTallas;

        lista.appendChild(ref);
        window.enhanceSelectBuscable?.(sel, { placeholder: 'Busca la referencia…' });
        agregarMaterial(ref);
        renumerar();
        return ref;
    };

    const renumerar = () => {
        const refs = $$('[data-ref]', lista);
        refs.forEach((ref, i) => {
            $('[data-ref-numero]', ref).textContent = `Referencia ${i + 1}`;
            $('[data-quitar-ref]', ref).classList.toggle('invisible', refs.length === 1);
            const mats = $$('[data-material]', ref);
            mats.forEach((mat, j) => {
                const a = ACENTOS[j];
                mat.classList.remove(...TODAS_LAS_CLASES_ACENTO);
                mat.classList.add(...a.caja.split(' '));
                const badge = $('[data-mat-numero]', mat);
                badge.classList.remove(...TODAS_LAS_CLASES_ACENTO);
                badge.classList.add(...a.badge.split(' '));
                badge.textContent = `MAT ${j + 1}`;
                $('[data-quitar-material]', mat).classList.toggle('invisible', mats.length === 1);
            });
            $('[data-contador-materiales]', ref).textContent = `${mats.length}/${MAX_MATERIALES}`;
            $('[data-agregar-material]', ref).disabled = mats.length >= MAX_MATERIALES;
        });
        $('#contador-referencias').textContent = `${refs.length}/${MAX_REFERENCIAS}`;
        btnAgregarRef.disabled = refs.length >= MAX_REFERENCIAS;
        actualizarResumenes();
    };

    // ── Materiales y piezas (chips) ────────────────────────────────────────────
    const agregarMaterial = (ref) => {
        if ($$('[data-material]', ref).length >= MAX_MATERIALES) return null;
        const mat = tplMat.content.firstElementChild.cloneNode(true);
        $('[data-materiales]', ref).appendChild(mat);
        pintarSugerencias(mat);
        renumerar();
        return mat;
    };

    const piezasDe = (mat) => $$('[data-pieza]', mat);

    const agregarPieza = (mat, nombre, cantidad = 1, dimension = '') => {
        const limpio = String(nombre || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!limpio) return;
        // La misma pieza dos veces en un material se suma, no se duplica el chip.
        const existente = piezasDe(mat).find(c => normalizar(c.dataset.nombre) === normalizar(limpio));
        if (existente) {
            const inp = $('[data-pieza-cantidad]', existente);
            inp.value = Math.min(99, Number(inp.value || 1) + Number(cantidad || 1));
            existente.classList.add('ring-2', 'ring-gh-primary');
            setTimeout(() => existente.classList.remove('ring-2', 'ring-gh-primary'), 600);
            actualizarResumenes();
            return;
        }
        if (piezasDe(mat).length >= MAX_PIEZAS) return;

        const chip = document.createElement('span');
        chip.dataset.pieza = '';
        chip.dataset.nombre = limpio;
        chip.className = 'inline-flex flex-wrap items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm text-slate-700';
        chip.innerHTML = `
            <span class="font-semibold">${esc(limpio)}</span>
            <span class="text-slate-400">×</span>
            <input type="number" min="1" max="99" step="1" value="${Number(cantidad) || 1}" data-pieza-cantidad
                aria-label="Cantidad de ${esc(limpio)} por prenda"
                class="w-11 rounded-md border border-slate-200 bg-white px-1 py-0.5 text-center text-sm">
            <input type="text" maxlength="40" data-pieza-dimension value="${esc(dimension)}" placeholder="Ej: 3cm × Ancho"
                aria-label="Medida especial de ${esc(limpio)}"
                class="${dimension ? '' : 'hidden'} w-32 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
            <button type="button" data-pieza-dim title="Medida especial" aria-label="Medida especial de ${esc(limpio)}"
                class="rounded-full p-1 ${dimension ? 'text-amber-600' : 'text-slate-400'} hover:bg-amber-100 hover:text-amber-600 cursor-pointer">
                <i class="fi fi-rr-ruler-horizontal text-xs leading-none"></i>
            </button>
            <button type="button" data-pieza-quitar title="Quitar pieza" aria-label="Quitar ${esc(limpio)}"
                class="rounded-full p-1 text-slate-400 hover:bg-red-100 hover:text-red-500 cursor-pointer">
                <i class="fi fi-rr-cross-small text-xs leading-none"></i>
            </button>`;
        $('[data-chips]', mat).insertBefore(chip, $('[data-pieza-input]', mat));
        $('[data-error-de="piezas"]', mat).classList.add('hidden');
        $('[data-chips]', mat).classList.remove('field-text-error');
        pintarSugerencias(mat);
        actualizarResumenes();
    };

    const pintarSugerencias = (mat) => {
        const usadas = new Set(piezasDe(mat).map(c => normalizar(c.dataset.nombre)));
        $('[data-sugerencias]', mat).innerHTML = piezasSugeridas
            .filter(p => !usadas.has(normalizar(p)))
            .map(p => `<button type="button" data-sugerencia="${esc(p)}" class="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-500 hover:border-gh-primary hover:text-gh-primaryHover cursor-pointer">+ ${esc(p)}</button>`)
            .join('');
    };

    // ── Resúmenes en vivo ───────────────────────────────────────────────────────
    const leerReferencia = (ref) => {
        const sel = $('[data-campo="familia"]', ref);
        return {
            codigo: $('[data-campo="codigo"]', ref).value.trim(),
            idFamilia: sel.value,
            nombre: sel.value ? sel.options[sel.selectedIndex].text : '',
            tipos: $$('[data-grupo="tipo"]:checked', ref).map(c => ({ id: c.value, nombre: c.nextElementSibling.textContent })),
            tallas: $$('[data-grupo="talla"]:checked', ref).map(c => c.value),
            veces: Number($('[data-campo="veces"]', ref).value),
            separar: $('[data-campo="separar"]', ref).value.trim(),
            materiales: $$('[data-material]', ref).map(mat => ({
                nombre: $('[data-campo="nombre-material"]', mat).value.trim(),
                piezas: piezasDe(mat).map(c => ({
                    nombre: c.dataset.nombre,
                    cantidad: Number($('[data-pieza-cantidad]', c).value),
                    dimension: $('[data-pieza-dimension]', c).value.trim()
                }))
            }))
        };
    };

    const leerOrden = () => ({
        fecha: $('#corte-fecha').value,
        tela: selTela.value ? selTela.options[selTela.selectedIndex].text : '',
        proveedor: selProveedor.value ? selProveedor.options[selProveedor.selectedIndex].text : '',
        trazos: Number(inpTrazos.value),
        referencias: $$('[data-ref]', lista).map(leerReferencia)
    });

    const actualizarResumenes = () => {
        const orden = calcularOrden(leerOrden());
        $$('[data-ref]', lista).forEach((ref, i) => {
            const r = orden.referencias[i];
            const tallasN = new Set(r.tallas).size;
            $('[data-resumen-ref]', ref).innerHTML = `
                <span><strong class="text-slate-800">${plural(r.unidades, 'prenda', 'prendas')}</strong> a cortar
                    <span class="text-slate-400">(${plural(tallasN, 'talla', 'tallas')} × ${num(r.veces || 0)})</span></span>
                <span><strong class="text-slate-800">${plural(r.totalPiezas, 'pieza', 'piezas')}</strong> en total</span>`;
        });
        $('#resumen-orden').innerHTML = `
            <span><strong class="text-2xl font-black text-slate-800">${num(orden.totalReferencias)}</strong> ${orden.totalReferencias === 1 ? 'referencia' : 'referencias'}</span>
            <span><strong class="text-2xl font-black text-slate-800">${num(orden.totalPrendas)}</strong> prendas</span>
            <span><strong class="text-2xl font-black text-gh-primaryHover">${num(orden.totalPiezas)}</strong> piezas</span>`;
    };

    // ── Eventos delegados del formulario ────────────────────────────────────────
    btnAgregarRef.addEventListener('click', () => {
        const ref = agregarReferencia();
        ref?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('[data-campo="codigo"]', ref || document)?.focus({ preventScroll: true });
    });

    lista.addEventListener('click', async (e) => {
        const ref = e.target.closest('[data-ref]');
        const mat = e.target.closest('[data-material]');

        if (e.target.closest('[data-quitar-ref]')) {
            const tieneDatos = leerReferencia(ref).codigo || leerReferencia(ref).materiales.some(m => m.piezas.length);
            if (tieneDatos && !(await confirmar('¿Quitar esta referencia?', 'Se pierde todo lo que cargaste en ella.'))) return;
            ref.remove(); renumerar(); return;
        }
        if (e.target.closest('[data-agregar-material]')) {
            const nuevo = agregarMaterial(ref);
            $('[data-campo="nombre-material"]', nuevo || document)?.focus();
            return;
        }
        if (e.target.closest('[data-quitar-material]')) { mat.remove(); renumerar(); return; }
        const sug = e.target.closest('[data-sugerencia]');
        if (sug) { agregarPieza(mat, sug.dataset.sugerencia); $('[data-pieza-input]', mat).focus(); return; }
        const chip = e.target.closest('[data-pieza]');
        if (e.target.closest('[data-pieza-quitar]')) { chip.remove(); pintarSugerencias(mat); actualizarResumenes(); return; }
        if (e.target.closest('[data-pieza-dim]')) {
            const inp = $('[data-pieza-dimension]', chip);
            inp.classList.toggle('hidden');
            if (!inp.classList.contains('hidden')) inp.focus();
            else { inp.value = ''; e.target.closest('[data-pieza-dim]').classList.replace('text-amber-600', 'text-slate-400'); }
            return;
        }
        // Clic en el área de chips = escribir otra pieza.
        if (e.target.closest('[data-chips]') && !e.target.closest('input, button')) $('[data-pieza-input]', mat).focus();
    });

    lista.addEventListener('keydown', (e) => {
        const inp = e.target.closest('[data-pieza-input]');
        if (!inp) return;
        const mat = inp.closest('[data-material]');
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            agregarPieza(mat, inp.value);
            inp.value = '';
        } else if (e.key === 'Backspace' && !inp.value) {
            const ultimo = piezasDe(mat).pop();
            if (ultimo) { ultimo.remove(); pintarSugerencias(mat); actualizarResumenes(); }
        }
    });
    // Lo que quedó escrito sin Enter también es una pieza: no se pierde al salir del campo.
    lista.addEventListener('focusout', (e) => {
        const inp = e.target.closest('[data-pieza-input]');
        if (inp?.value.trim()) { agregarPieza(inp.closest('[data-material]'), inp.value); inp.value = ''; }
        const dim = e.target.closest('[data-pieza-dimension]');
        if (dim) {
            const btn = $('[data-pieza-dim]', dim.closest('[data-pieza]'));
            btn.classList.toggle('text-amber-600', !!dim.value.trim());
            btn.classList.toggle('text-slate-400', !dim.value.trim());
            if (!dim.value.trim()) dim.classList.add('hidden');
        }
    });

    lista.addEventListener('change', (e) => {
        // ÚNICA excluye a las demás tallas, y una talla concreta desmarca ÚNICA.
        const c = e.target;
        if (c.dataset?.grupo === 'talla' && c.checked) {
            const ref = c.closest('[data-ref]');
            $$('[data-grupo="talla"]:checked', ref).forEach(o => {
                if (o !== c && (tallaExclusiva.has(c.value) || tallaExclusiva.has(o.value))) o.checked = false;
            });
        }
        if (c.dataset?.grupo) {
            const ref = c.closest('[data-ref]');
            $(`[data-error-de="${c.dataset.grupo === 'talla' ? 'tallas' : 'tipos'}"]`, ref).classList.add('hidden');
        }
        actualizarResumenes();
    });
    lista.addEventListener('input', actualizarResumenes);

    // ── Validación ──────────────────────────────────────────────────────────────
    const entero = (v, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;

    const validar = () => {
        limpiarErrores(raiz);
        $$('[data-chips]', lista).forEach(c => c.classList.remove('field-text-error'));
        let primero = null;
        // Un <select> buscable está oculto: el foco y el scroll van a su input visible.
        const visible = (campo) => campo?.closest('.select-buscable-wrap')?.querySelector('.select-buscable-input') || campo;
        const error = (ctx, clave, msg, campo) => { marcarError(ctx, clave, msg, campo); primero ??= visible(campo) || $(`[data-error-de="${clave}"]`, ctx); };

        if (!$('#corte-fecha').value) error(document, 'corte-fecha', 'Elige la fecha del corte.', fpFecha?.altInput);
        if (!selTela.value) error(document, 'corte-tela', 'Elige la tela.', selTela);
        if (!selProveedor.value) error(document, 'corte-proveedor', 'Elige el proveedor de la tela.', selProveedor);
        if (!entero(inpTrazos.value, 1, 99)) error(document, 'corte-trazos', 'Debe ser un número entero de 1 a 99.', inpTrazos);

        $$('[data-ref]', lista).forEach(ref => {
            const r = leerReferencia(ref);
            if (!r.codigo) error(ref, 'codigo', 'Escribe el código.', $('[data-campo="codigo"]', ref));
            if (!r.idFamilia) error(ref, 'familia', 'Elige la prenda.', $('[data-campo="familia"]', ref));
            if (!entero(r.veces, 1, 99)) error(ref, 'veces', 'Número entero de 1 a 99.', $('[data-campo="veces"]', ref));
            if (!r.tipos.length) error(ref, 'tipos', 'Marca al menos un tipo de prenda.');
            if (!r.tallas.length) error(ref, 'tallas', 'Marca al menos una talla.');
            $$('[data-material]', ref).forEach((mat, j) => {
                const m = r.materiales[j];
                if (!m.nombre) error(mat, 'nombre-material', 'Escribe el nombre del material.', $('[data-campo="nombre-material"]', mat));
                if (!m.piezas.length) error(mat, 'piezas', 'Agrega al menos una pieza.', $('[data-chips]', mat));
                if (m.piezas.some(p => !entero(p.cantidad, 1, 99))) error(mat, 'piezas', 'La cantidad de cada pieza va de 1 a 99.', $('[data-chips]', mat));
            });
        });

        if (primero) {
            primero.scrollIntoView({ behavior: 'smooth', block: 'center' });
            window.Swal?.fire({ toast: true, position: 'top-end', icon: 'warning', title: 'Revisa los campos marcados', showConfirmButton: false, timer: 2600 });
        }
        return !primero;
    };

    // ── Guía de corte ──────────────────────────────────────────────────────────
    const guia = $('#guia-corte');
    const contenido = $('#guia-contenido');
    // Colgada directo de <body>: la impresión oculta todo lo demás con
    // `body > *:not(#guia-corte)` (ver el <style> de corteNuevo.pug).
    document.body.appendChild(guia);

    const fechaLarga = (ymd) => {
        const [y, m, d] = String(ymd || '').split('-').map(Number);
        if (!y) return '';
        return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
    };
    const textoTallas = (cods) => cods.map(c => etiquetaTalla.get(c) || c).join(' · ');
    const casilla = '<span class="inline-block h-4 w-4 flex-shrink-0 rounded border-2 border-slate-400 bg-white"></span>';

    const htmlGuia = (o) => `
        <header class="guia-bloque flex flex-col gap-4 border-b-4 border-gh-primaryHover pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div class="flex items-center gap-4">
                <img src="/img/logo.png" alt="Grupo GH" class="h-14 w-auto">
                <h1 id="guia-titulo" class="text-3xl font-black tracking-tight text-gh-primaryHover md:text-4xl">GUÍA DE CORTE</h1>
            </div>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <dt class="text-slate-500">Fecha</dt><dd class="font-bold">${esc(fechaLarga(o.fecha))}</dd>
                <dt class="text-slate-500">Tela</dt><dd class="font-bold">${esc(o.tela)}</dd>
                <dt class="text-slate-500">Proveedor</dt><dd class="font-bold">${esc(o.proveedor)}</dd>
                <dt class="text-slate-500">Trazo #</dt><dd class="font-bold">${num(o.trazos)}</dd>
            </dl>
        </header>

        <section class="guia-bloque my-6 grid grid-cols-3 gap-3 text-center">
            ${[['Referencias', o.totalReferencias], ['Prendas a cortar', o.totalPrendas], ['Piezas en total', o.totalPiezas]].map(([t, n], i) => `
                <div class="rounded-2xl border-2 ${i === 2 ? 'border-gh-primaryHover bg-gh-primarySoft' : 'border-slate-200'} px-2 py-3">
                    <div class="text-3xl font-black ${i === 2 ? 'text-gh-primaryHover' : 'text-slate-800'} md:text-4xl">${num(n)}</div>
                    <div class="text-xs font-bold uppercase tracking-wide text-slate-500">${t}</div>
                </div>`).join('')}
        </section>

        <div class="space-y-6">${o.referencias.map(htmlTarjeta).join('')}</div>

        <section class="guia-bloque mt-8">
            <h2 class="mb-2 text-lg font-black text-gh-primaryHover">RESUMEN DE LA ORDEN</h2>
            <table class="w-full border-collapse text-left">
                <thead><tr class="border-b-2 border-slate-800 text-sm uppercase tracking-wide">
                    <th class="py-2 pr-2">Referencia</th><th class="py-2 px-2 text-right">Prendas</th><th class="py-2 pl-2 text-right">Total piezas</th>
                </tr></thead>
                <tbody>${o.referencias.map(r => `
                    <tr class="border-b border-slate-200">
                        <td class="py-2 pr-2"><span class="font-mono font-bold">${esc(r.codigo)}</span> ${esc(r.nombre)}</td>
                        <td class="py-2 px-2 text-right tabular-nums">${num(r.unidades)}</td>
                        <td class="py-2 pl-2 text-right font-bold tabular-nums">${num(r.totalPiezas)}</td>
                    </tr>`).join('')}</tbody>
                <tfoot><tr class="border-t-2 border-slate-800 text-lg font-black">
                    <td class="py-2 pr-2">TOTAL</td>
                    <td class="py-2 px-2 text-right tabular-nums">${num(o.totalPrendas)}</td>
                    <td class="py-2 pl-2 text-right tabular-nums text-gh-primaryHover">${num(o.totalPiezas)}</td>
                </tr></tfoot>
            </table>
        </section>

        <!-- Observaciones y firmas van en un solo bloque: al imprimir no se separan, así las
             firmas nunca quedan solas en una hoja. -->
        <section class="guia-bloque mt-8">
            <label for="guia-observaciones" class="mb-2 block text-lg font-black text-gh-primaryHover">OBSERVACIONES</label>
            <textarea id="guia-observaciones" rows="4" maxlength="1000" placeholder="Escribe aquí lo que pasó durante el corte…"
                class="w-full rounded-xl border-2 border-slate-200 p-3 text-base focus:border-gh-primary focus:outline-none">${esc(observaciones)}</textarea>
            <div class="guia-obs-impresa">
                <p class="whitespace-pre-wrap text-base">${esc(observaciones)}</p>
                ${'<div class="h-7 border-b border-slate-400"></div>'.repeat(3)}
            </div>
            <div class="mt-6 grid grid-cols-2 gap-10 text-center">
                ${['Cortador', 'Encargado'].map(f => `
                    <div><div class="h-10 border-b-2 border-slate-800"></div><p class="mt-1 font-bold">${f}</p></div>`).join('')}
            </div>
        </section>`;

    const htmlTarjeta = (r) => `
        <article class="guia-card overflow-hidden rounded-2xl border-2 border-slate-200">
            <header class="flex flex-col gap-3 bg-gh-primarySoft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div class="flex flex-wrap items-baseline gap-x-3">
                        <span class="rounded-lg bg-white px-2 py-0.5 font-mono text-lg font-black text-gh-primaryHover">${esc(r.codigo)}</span>
                        <h2 class="text-2xl font-black uppercase text-slate-900">${esc(r.nombre)}</h2>
                    </div>
                    <p class="mt-1 text-sm text-slate-600">${esc(r.tipos.map(t => t.nombre).join(', '))} · <strong>Tallas:</strong> ${esc(textoTallas(r.tallas))}</p>
                </div>
                <div class="text-left sm:text-right">
                    <div class="text-4xl font-black leading-none text-gh-primaryHover">${num(r.unidades)}</div>
                    <div class="text-xs font-bold uppercase tracking-wide text-slate-500">prendas a cortar</div>
                    <div class="text-xs text-slate-400">${plural(new Set(r.tallas).size, 'talla', 'tallas')} × ${num(r.veces)}</div>
                </div>
            </header>

            <div class="space-y-3 p-5">
                ${r.materiales.map((m, j) => `
                    <div class="rounded-xl border-l-8 ${ACENTOS[j].guia} p-4">
                        <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                            <h3 class="text-lg font-black ${ACENTOS[j].texto}">MAT ${j + 1} — ${esc(m.nombre)}</h3>
                            <span class="whitespace-nowrap text-sm font-bold text-slate-600">${plural(m.totalPiezas, 'pieza', 'piezas')}</span>
                        </div>
                        <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            ${m.piezas.map(p => `
                                <li class="flex flex-wrap items-center gap-2 text-base">
                                    ${casilla}
                                    <span class="font-semibold">${esc(p.nombre)}</span>
                                    ${p.cantidad > 1 ? `<span class="text-sm text-slate-500">×${num(p.cantidad)} por prenda</span>` : ''}
                                    ${p.dimension ? `<span class="rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-sm font-bold text-amber-800">📏 ${esc(p.dimension)}</span>` : ''}
                                </li>`).join('')}
                        </ul>
                    </div>`).join('')}

                ${r.separar ? `
                    <div class="flex gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                        <span class="text-2xl leading-none">⚠️</span>
                        <div><p class="text-sm font-black uppercase tracking-wide text-amber-800">Separar piezas</p>
                        <p class="whitespace-pre-wrap text-base text-amber-900">${esc(r.separar)}</p></div>
                    </div>` : ''}

                <div class="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4">
                    <p class="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Al terminar de cortar debes tener:</p>
                    <div class="space-y-2">
                        ${r.materiales.map((m, j) => `
                            <div>
                                <p class="text-xs font-bold uppercase ${ACENTOS[j].texto}">MAT ${j + 1} — ${esc(m.nombre)}</p>
                                <ul class="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                                    ${m.piezas.map(p => `<li class="flex items-center gap-2">${casilla}<span><strong class="tabular-nums">${num(p.total)}</strong> ${esc(p.nombre)}</span></li>`).join('')}
                                </ul>
                            </div>`).join('')}
                    </div>
                    <p class="mt-4 flex items-center justify-between border-t-2 border-slate-300 pt-3 text-lg font-black">
                        <span>TOTAL ${esc(r.nombre).toUpperCase()}</span>
                        <span class="whitespace-nowrap text-gh-primaryHover">${plural(r.totalPiezas, 'pieza', 'piezas')}</span>
                    </p>
                </div>
            </div>
        </article>`;

    // Observaciones: se conservan si el operador vuelve a editar y regenera la guía.
    let observaciones = '';
    contenido.addEventListener('input', (e) => {
        if (e.target.id !== 'guia-observaciones') return;
        observaciones = e.target.value;
        const espejo = $('.guia-obs-impresa p', contenido);
        if (espejo) espejo.textContent = observaciones;
    });

    let ultimoFoco = null;
    const abrirGuia = () => {
        contenido.innerHTML = htmlGuia(calcularOrden(leerOrden()));
        ultimoFoco = document.activeElement;
        guia.classList.remove('hidden');
        document.documentElement.classList.add('guia-abierta', 'overflow-hidden');
        guia.scrollTop = 0;
        $('#guia-imprimir').focus();
    };
    const cerrarGuia = () => {
        guia.classList.add('hidden');
        document.documentElement.classList.remove('guia-abierta', 'overflow-hidden');
        ultimoFoco?.focus?.();
    };

    $('#btn-generar-guia').addEventListener('click', () => { if (validar()) abrirGuia(); });
    $('#guia-editar').addEventListener('click', cerrarGuia);
    $('#guia-imprimir').addEventListener('click', () => window.print());
    guia.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarGuia(); });
    $('#guia-nueva').addEventListener('click', async () => {
        if (!(await confirmar('¿Empezar una orden nueva?', 'Se borra todo lo que cargaste, también las observaciones.'))) return;
        cerrarGuia();
        limpiarFormulario();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // ── Limpiar / ejemplo ──────────────────────────────────────────────────────
    const limpiarFormulario = () => {
        lista.innerHTML = '';
        observaciones = '';
        fpFecha?.setDate(new Date(), true);
        selTela.value = ''; selTela.buscable?.refresh();
        selProveedor.value = ''; selProveedor.buscable?.refresh();
        inpTrazos.value = 1;
        limpiarErrores(raiz);
        agregarReferencia();
    };

    const elegirPorNombre = (select, nombre) => {
        const op = [...select.options].find(o => o.value && normalizar(o.text) === normalizar(nombre));
        select.value = op ? op.value : '';
        select.buscable?.refresh();
        return !!op;
    };

    $('#btn-cargar-ejemplo').addEventListener('click', async () => {
        const hayDatos = leerOrden().referencias.some(r => r.codigo || r.materiales.some(m => m.piezas.length));
        if (hayDatos && !(await confirmar('¿Reemplazar lo cargado por el ejemplo?', 'Se borra la orden que estás armando.'))) return;

        limpiarFormulario();
        lista.innerHTML = '';
        const faltantes = [];
        if (!elegirPorNombre(selTela, EJEMPLO.tela)) faltantes.push(`la tela "${EJEMPLO.tela}"`);
        if (!elegirPorNombre(selProveedor, EJEMPLO.proveedor)) faltantes.push(`el proveedor "${EJEMPLO.proveedor}"`);
        inpTrazos.value = EJEMPLO.trazos;

        EJEMPLO.referencias.forEach(datos => {
            const ref = agregarReferencia();
            $('[data-campo="codigo"]', ref).value = datos.codigo;
            if (!elegirPorNombre($('[data-campo="familia"]', ref), datos.prenda)) faltantes.push(`la referencia "${datos.prenda}"`);
            $('[data-campo="veces"]', ref).value = datos.veces;
            datos.tipos.forEach(t => {
                const c = $$('[data-grupo="tipo"]', ref).find(x => normalizar(x.nextElementSibling.textContent) === normalizar(t));
                if (c) c.checked = true; else faltantes.push(`el tipo de prenda "${t}"`);
            });
            datos.tallas.forEach(t => { const c = $(`[data-grupo="talla"][value="${t}"]`, ref); if (c) c.checked = true; });
            $('[data-material]', ref).remove();
            datos.materiales.forEach(m => {
                const mat = agregarMaterial(ref);
                $('[data-campo="nombre-material"]', mat).value = m.nombre;
                m.piezas.forEach(([nombre, cantidad, dimension]) => agregarPieza(mat, nombre, cantidad, dimension));
            });
        });
        renumerar();

        // Lo que no existe en la base no se inventa: queda vacío y se avisa.
        const unicos = [...new Set(faltantes)];
        window.Swal?.fire(unicos.length ? {
            icon: 'info', title: 'Ejemplo cargado a medias',
            html: `No existe${unicos.length > 1 ? 'n' : ''} en la base ${unicos.map(esc).join(', ')}. Elige un valor real en ${unicos.length > 1 ? 'esos campos' : 'ese campo'} para generar la guía.`,
            confirmButtonColor: '#E24C95'
        } : { toast: true, position: 'top-end', icon: 'success', title: 'Ejemplo cargado', showConfirmButton: false, timer: 2200 });
    });

    // ── Arranque ───────────────────────────────────────────────────────────────
    agregarReferencia();
}

function confirmar(titulo, texto) {
    if (!window.Swal) return Promise.resolve(window.confirm(`${titulo}\n${texto}`));
    return window.Swal.fire({
        icon: 'question', title: titulo, text: texto,
        showCancelButton: true, confirmButtonText: 'Sí, continuar', cancelButtonText: 'Cancelar',
        confirmButtonColor: '#E24C95', cancelButtonColor: '#94a3b8', reverseButtons: true
    }).then(r => r.isConfirmed);
}
