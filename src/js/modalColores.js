import { escaparHtml as esc } from './escaparHtml.js';

// Lógica del modal "Elegir colores" (views/components/modalColores.pug). La usan el alta de
// productos (productDataForm.js), la caja de colores de la orden de compra
// (modalLineaInsumo.js) y la orden de producción (ordenProduccionForm.js).
//
//   const selector = crearModalColores('op-modal-colores', (ids, colores) => { … });
//   selector.abrir([12, 40], { resaltado: 'L' });   // marcados + texto destacado del título
//   selector.color(12)   // → { idAtributo, valor, codigo1, codigo2 } o null
//
// `alGuardar(ids, colores)` recibe los ids marcados (números) en el orden de la grilla y sus
// datos. Puede devolver false (o una promesa que resuelva a false) para que el modal no se
// cierre: así la pantalla puede pedir confirmación antes de quitar un color con datos.
// `alCerrar()` corre cuando se cierra sin guardar (X, fondo o Escape).

/** Fondo del círculo de un color: un tono, o los dos de un combinado. */
export const fondoColor = (c) => (c?.codigo2 ? `linear-gradient(135deg, ${c.codigo1} 50%, ${c.codigo2} 50%)` : (c?.codigo1 || '#ccc'));

// La misma casilla que pinta el mixin, para un color dado de alta en vivo.
const etiquetaColor = (c) => {
    const label = document.createElement('label');
    label.dataset.itemColor = '';
    label.dataset.buscar = String(c.valor).toLowerCase();
    label.className = 'flex items-center gap-2.5 p-2.5 border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-50 has-[:checked]:border-gh-primary has-[:checked]:bg-gh-primarySoft/40';
    label.innerHTML = `
        <input type="checkbox" value="${Number(c.idAtributo)}" data-nombre="${esc(c.valor)}" data-hex1="${esc(c.codigo1 || '')}" data-hex2="${esc(c.codigo2 || '')}" class="w-4 h-4 flex-shrink-0 accent-[#E24C95]">
        <span class="w-4 h-4 rounded-full border border-black/10 flex-shrink-0" style="background:${esc(fondoColor(c))}"></span>
        <span class="text-sm font-medium text-slate-700 truncate">${esc(c.valor)}</span>`;
    return label;
};

export function crearModalColores(idModal, alGuardar, { alCerrar = null } = {}) {
    const modal = document.getElementById(idModal);
    if (!modal) return { abrir: () => {}, cerrar: () => {}, color: () => null };
    const grid = modal.querySelector('[data-grid-colores]');
    const buscador = modal.querySelector('[data-buscador-colores]');
    const sinResultados = modal.querySelector('[data-sin-resultados-colores]');
    const conteo = modal.querySelector('[data-conteo-colores]');
    const resaltado = modal.querySelector('[data-titulo-resaltado]');

    const items = () => [...grid.querySelectorAll('[data-item-color]')];
    const casillas = () => items().map((i) => i.querySelector('input[type="checkbox"]'));
    const datos = (chk) => ({
        idAtributo: Number(chk.value),
        valor: chk.dataset.nombre,
        codigo1: chk.dataset.hex1 || null,
        codigo2: chk.dataset.hex2 || null
    });
    const color = (id) => {
        const chk = grid.querySelector(`input[type="checkbox"][value="${CSS.escape(String(id))}"]`);
        return chk ? datos(chk) : null;
    };

    const pintarConteo = () => {
        const n = casillas().filter((c) => c.checked).length;
        conteo.textContent = n ? `${n} ${n === 1 ? 'color elegido' : 'colores elegidos'}` : 'Ningún color elegido';
    };
    const filtrar = (texto) => {
        const t = texto.toLowerCase().trim();
        let visibles = 0;
        items().forEach((i) => {
            const ok = i.dataset.buscar.includes(t);
            i.style.display = ok ? '' : 'none';
            if (ok) visibles++;
        });
        sinResultados.classList.toggle('hidden', visibles > 0);
    };

    // ── Alta de un color nuevo (solo si el mixin la dibujó) ───────────────────────────────
    const alta = modal.querySelector('[data-alta-color]');
    const formAlta = alta?.querySelector('[data-form-alta-color]');
    const errorAlta = alta?.querySelector('[data-error-alta-color]');
    const ocultarAlta = () => {
        if (!alta) return;
        formAlta.classList.add('hidden');
        formAlta.classList.remove('flex');
        errorAlta.classList.add('hidden');
    };
    if (alta) {
        const inpNombre = alta.querySelector('[data-alta-nombre]');
        const inpHex = alta.querySelector('[data-alta-hex]');
        alta.querySelector('[data-mostrar-alta-color]').addEventListener('click', () => {
            if (!formAlta.classList.contains('hidden')) { ocultarAlta(); return; }
            formAlta.classList.remove('hidden');
            formAlta.classList.add('flex');
            inpNombre.focus();
        });
        const btn = alta.querySelector('[data-guardar-alta-color]');
        btn.addEventListener('click', async () => {
            const nombre = inpNombre.value.trim();
            if (!nombre) {
                errorAlta.textContent = 'Escribe el nombre del color.';
                errorAlta.classList.remove('hidden');
                inpNombre.focus();
                return;
            }
            const textoOriginal = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Agregando…';
            try {
                const r = await fetch(alta.dataset.altaColor, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ valor: nombre, codigo1: inpHex.value })
                });
                const data = await r.json().catch(() => ({}));
                if (!r.ok || !data.success) {
                    throw new Error(data.mensaje || data.errores?.valor || data.errores?.codigo1 || 'No se pudo agregar el color.');
                }
                const label = etiquetaColor(data.color);
                label.querySelector('input').checked = true;
                grid.prepend(label);
                inpNombre.value = '';
                inpHex.value = '#E24C95';
                ocultarAlta();
                buscador.value = '';
                filtrar('');
                pintarConteo();
            } catch (e) {
                errorAlta.textContent = e.message;
                errorAlta.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.textContent = textoOriginal;
            }
        });
    }

    // ── Abrir / cerrar / guardar ─────────────────────────────────────────────────────────
    const ocultar = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        buscador.value = '';
        filtrar('');
        ocultarAlta();
    };
    const cerrarSinGuardar = () => { ocultar(); alCerrar?.(); };
    const abrir = (marcados = [], { resaltado: texto = '' } = {}) => {
        const set = new Set(marcados.map(Number));
        casillas().forEach((c) => { c.checked = set.has(Number(c.value)); });
        if (resaltado) resaltado.textContent = texto;
        pintarConteo();
        ocultarAlta();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        buscador.focus();
    };

    buscador.addEventListener('input', (e) => filtrar(e.target.value));
    grid.addEventListener('change', (e) => { if (e.target.matches('input[type="checkbox"]')) pintarConteo(); });
    modal.querySelector('[data-cerrar-colores]').addEventListener('click', cerrarSinGuardar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrarSinGuardar(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarSinGuardar(); });
    modal.querySelector('[data-guardar-colores]').addEventListener('click', async () => {
        const marcadas = casillas().filter((c) => c.checked);
        if ((await alGuardar(marcadas.map((c) => Number(c.value)), marcadas.map(datos))) === false) return;
        ocultar();
    });

    return { abrir, cerrar: ocultar, color };
}
