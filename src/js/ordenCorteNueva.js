import { escaparHtml as esc } from './escaparHtml.js';
import { initFechaInput } from './fechaInput.js';
import { opcionesConfirmacion, cabeceraConfirmacion } from './modalConfirmacion.js';
import { crearModalFichaCorte } from './fichaCorteModal.js';
import { aplicarEspejos, referenciasDeTrazo, recetaConEspejos, resultadoReferencia } from '../../helpers/trazo.js';

// Nuevo corte desde el trazo (views/administrador/produccion/ordenCorteNueva.pug). El
// servidor lee el DXF (POST /admin/procesos/cortes/analizar) y esta pantalla junta lo que el
// sistema no puede adivinar. Las cuentas (prendas por capa, piezas sueltas) salen de
// helpers/trazo.js, la misma copia que usa el servidor al guardar: lo que se ve aquí es lo que
// se guarda. Al crear, el archivo viaja otra vez y el servidor vuelve a leerlo y a validar todo.
(function () {
    const raiz = document.getElementById('corte-nuevo');
    if (!raiz) return;

    const $ = (id) => document.getElementById(id);
    const num = (n, d = 2) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: d });
    const metros = (cm) => `${num(cm / 100)} m`;
    const tallaVisible = (t) => (t === 'UNICA' ? 'Única' : t);
    const chip = (hex, nombre) => `<span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded-full border border-slate-300 flex-shrink-0" style="background:${esc(hex || '#e2e8f0')}"></span>${esc(nombre || 'Sin color')}</span>`;

    const estado = {
        archivo: null,
        analisis: null,
        espejos: {},          // 'estilo|pieza' → true/false
        refs: {},             // estilo → { modo, idFicha, faltanPiezas, piezasSueltas, ficha: datos del modal "Crear la ficha" (fichaCorteModal.js) }
        rollos: new Map()     // idRollo → capas
    };
    const calendario = initFechaInput($('fecha-requerida'), { minDate: raiz.dataset.hoy || 'today', onChange: () => pintarBoton() });

    // ── 1. Subir y leer el trazo ─────────────────────────────────────────────────────────
    // Prefiltro barato antes de mandar el archivo: el mismo tope que middlewares/uploadDxf.js
    // (20 MB). Quien decide si es un DXF de verdad es el servidor (esDxfValido), no la extensión.
    const DXF_MAX_BYTES = Number(raiz.dataset.dxfMaxBytes) || 20 * 1024 * 1024;
    const mostrarErrorTrazo = (mensaje) => {
        $('error-trazo').textContent = mensaje;
        $('error-trazo').classList.remove('hidden');
    };
    let leyendo = false;
    // Un fetch sin red lanza TypeError con el texto del navegador, en inglés.
    const mensajeDe = (err, porDefecto) => (err instanceof TypeError ? 'No hubo conexión con el servidor. Revisa la red e inténtalo otra vez.' : err?.message || porDefecto);
    // Tope razonable para un precio por prenda; FICHAS_CONFECCION.precioConfeccion es DECIMAL(15,2).
    const CAPAS_MAX = Number(raiz.dataset.capasMax) || 500;
    const NOTAS_MAX = Number(raiz.dataset.notasMax) || 2000;
    const PRECIO_CONFECCION_MAX = Number(raiz.dataset.precioMax) || 99999999;

    $('input-trazo').addEventListener('change', async (e) => {
        const archivo = e.target.files?.[0];
        e.target.value = '';
        if (!archivo || leyendo) return;
        $('error-trazo').classList.add('hidden');
        if (!/\.dxf$/i.test(archivo.name)) return mostrarErrorTrazo(`"${archivo.name}" no es un .dxf. Exporta el trazo desde Optitex en formato DXF.`);
        if (!archivo.size) return mostrarErrorTrazo('El archivo está vacío.');
        if (archivo.size > DXF_MAX_BYTES) return mostrarErrorTrazo(`El archivo pesa ${num(archivo.size / 1048576, 1)} MB: el máximo es ${num(DXF_MAX_BYTES / 1048576, 0)} MB.`);
        leyendo = true;
        $('zona-trazo').classList.add('pointer-events-none', 'opacity-60');
        $('estado-trazo').classList.replace('hidden', 'flex');
        try {
            const datos = new FormData();
            datos.append('dxf', archivo);
            const r = await fetch('/admin/procesos/cortes/analizar', { method: 'POST', body: datos });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo leer el trazo.');
            Object.assign(estado, { archivo, analisis: d.analisis, espejos: {}, refs: {}, rollos: new Map(), escaneo: null });
            pintarTodo();
        } catch (err) {
            mostrarErrorTrazo(mensajeDe(err, 'No se pudo leer el trazo.'));
        } finally {
            leyendo = false;
            $('zona-trazo').classList.remove('pointer-events-none', 'opacity-60');
            $('estado-trazo').classList.replace('flex', 'hidden');
        }
    });

    function pintarResumen() {
        const { trazo, tela } = estado.analisis;
        $('zona-trazo').classList.add('hidden');
        $('resumen-trazo').classList.remove('hidden');
        $('resumen-trazo').innerHTML = `
            <div class="flex flex-col md:flex-row md:items-center gap-4 border-2 border-gh-primary bg-gh-primarySoft/40 rounded-2xl px-5 py-4">
                <div class="w-11 h-11 rounded-full bg-white flex items-center justify-center text-gh-primaryHover flex-shrink-0"><i class="fi fi-rr-file-code"></i></div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-slate-800 truncate">${esc(estado.archivo.name)}</p>
                    <p class="text-xs text-slate-500">${trazo.piezas} piezas · ${estado.analisis.referencias.length} referencia(s)</p>
                </div>
                <dl class="grid grid-cols-3 gap-4 text-center">
                    <div><dt class="text-[11px] text-slate-500">Tela</dt><dd class="text-sm font-bold text-slate-800">${esc(tela.nombre)}</dd></div>
                    <div><dt class="text-[11px] text-slate-500">Trazo</dt><dd class="text-sm font-bold text-slate-800 tabular-nums">${metros(trazo.largoCm)} × ${metros(trazo.anchoCm)}</dd></div>
                    <div><dt class="text-[11px] text-slate-500">Aprovechamiento</dt><dd class="text-sm font-bold text-slate-800 tabular-nums">${num(trazo.aprovechamiento, 1)} %</dd></div>
                </dl>
                <label class="btn btn-secondary btn-sm cursor-pointer relative">Cambiar trazo<input type="file" accept=".dxf" class="absolute inset-0 opacity-0 cursor-pointer" data-cambiar-trazo></label>
            </div>`;
        $('resumen-trazo').querySelector('[data-cambiar-trazo]').addEventListener('change', (e) => {
            $('input-trazo').files = e.target.files;
            $('input-trazo').dispatchEvent(new Event('change'));
        });
    }

    // ── 2. Referencias ───────────────────────────────────────────────────────────────────

    const espejosSet = () => new Set(Object.entries(estado.espejos).filter(([, v]) => v === true).map(([k]) => k));
    const fichaDe = (ref) => {
        if (ref.ficha) return ref.ficha;
        const r = estado.refs[ref.estilo];
        return r?.modo === 'vincular' ? estado.analisis.fichas.find(f => f.idFicha === r.idFicha) || null : null;
    };

    /** Lo que da cada referencia con las respuestas de ahora (misma cuenta que el servidor). */
    function calcular() {
        const espejos = espejosSet();
        const refsTrazo = new Map(referenciasDeTrazo(aplicarEspejos(estado.analisis.piezas, espejos)).map(r => [r.estilo, r]));
        return estado.analisis.referencias.map(ref => {
            const r = estado.refs[ref.estilo] || {};
            const trazo = refsTrazo.get(ref.estilo);
            const ficha = fichaDe(ref);
            const receta = ficha?.receta?.length ? recetaConEspejos(ficha.receta, ref.estilo, espejos) : null;
            const faltanPiezas = !ficha && r.faltanPiezas === true;
            const resultado = resultadoReferencia({ colocadas: trazo.piezas, receta, faltanPiezas, piezasSueltas: r.piezasSueltas || null });
            return { ref, r, trazo, ficha, receta, faltanPiezas, resultado };
        });
    }

    const radio = (nombre, valor, marcado, texto, ayuda = '') => `
        <label class="flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${marcado ? 'border-gh-primary bg-gh-primarySoft/40' : 'border-slate-200 hover:border-gh-primary'}">
            <input type="radio" name="${esc(nombre)}" value="${esc(valor)}" ${marcado ? 'checked' : ''} class="mt-0.5 accent-[#E24C95]">
            <span class="text-sm"><span class="font-semibold text-slate-800">${texto}</span>${ayuda ? `<span class="block text-xs text-slate-500">${ayuda}</span>` : ''}</span>
        </label>`;

    function pintarReferencias() {
        const cont = $('paso-referencias');
        cont.classList.remove('hidden');
        const calculos = calcular();
        cont.innerHTML = `
            <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 md:p-6">
                <h2 class="text-base font-bold text-slate-800 mb-1 flex items-center gap-2">
                    <span class="w-6 h-6 rounded-full bg-gh-primarySoft text-gh-primaryHover text-xs font-black flex items-center justify-center">2</span>
                    Las referencias del trazo
                </h2>
                <p class="text-xs text-slate-500">Cada referencia se cruza con la ficha cuyo DXF tiene el mismo nombre de estilo. Responde lo que el sistema no puede saber solo.</p>
            </div>
            ${calculos.map(pintarReferencia).join('')}`;
    }

    // Lo que se respondió en "Crear la ficha", de un vistazo, con el acceso para editarlo.
    function resumenFicha(f) {
        const piezas = [
            ['fi-rr-vector', `Molde: ${f.nombreMolde || 'cargado'}`],
            f.idMoldeReferencia && ['fi-rr-picture', 'Foto de referencia'],
            f.idMoldeIaIntento && ['fi-rr-sparkles', 'Vista previa con IA'],
            f.videos?.length && ['fi-rr-video-camera', `${f.videos.length} video(s)`],
            f.insumos?.length && ['fi-rr-box', `${f.insumos.length} insumo(s)`],
            f.precioConfeccion && ['fi-rr-sack-dollar', `$${f.precioConfeccion} por prenda`]
        ].filter(Boolean);
        return `
            <div class="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-emerald-800"><i class="fi fi-rr-check-circle mr-1"></i>Ficha lista: ${esc(f.nombreFamilia)}</p>
                    <ul class="mt-1.5 flex flex-wrap gap-1.5">${piezas.map(([icono, texto]) => `<li class="inline-flex items-center gap-1 rounded-full bg-white border border-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"><i class="fi ${icono} text-[10px] text-emerald-600"></i>${esc(texto)}</li>`).join('')}</ul>
                </div>
                <button type="button" class="btn btn-secondary btn-sm text-xs flex-shrink-0" data-abrir-ficha><i class="fi fi-rr-pencil text-xs"></i>Editar ficha</button>
            </div>`;
    }

    /** La prenda va en más de una tela: este trazo solo trae las piezas de una. */
    function avisoOtrosMateriales(ficha) {
        const otros = ficha?.otrosMateriales || [];
        if (!otros.length) return '';
        const lista = otros.length === 1 ? `del material ${esc(otros[0])}` : `de los materiales ${otros.slice(0, -1).map(esc).join(', ')} y ${esc(otros.at(-1))}`;
        return `<p class="mt-2 text-xs text-slate-500 flex items-start gap-1.5"><i class="fi fi-rr-info mt-0.5"></i><span>Las piezas ${lista} se cortan en otro trazo. Aquí salen las piezas de ${esc(estado.analisis.tela.nombre)}.</span></p>`;
    }

    function pintarReferencia({ ref, r, trazo, ficha, resultado }, i) {
        const id = `ref-${i}`;
        const preguntas = estado.analisis.preguntasEspejo.filter(p => p.estilo === ref.estilo);
        const estiloAttr = esc(ref.estilo);
        let cabeceraFicha;
        if (ref.ficha) {
            cabeceraFicha = ref.ficha.faltan.length
                ? `<span class="table-badge table-badge-pending"><span class="table-badge-dot"></span>Ficha por terminar: ${esc(ref.ficha.referencia)}</span>`
                : `<span class="table-badge table-badge-active"><span class="table-badge-dot"></span>Ficha: ${esc(ref.ficha.referencia)}</span>`;
        } else {
            cabeceraFicha = '<span class="table-badge table-badge-low"><span class="table-badge-dot"></span>Sin ficha</span>';
        }

        const piezas = trazo.piezas.map(p => `
            <tr class="border-b border-slate-100 last:border-0">
                <td class="py-2 pr-3 font-semibold text-slate-700">${esc(p.nombre)}</td>
                <td class="py-2 pr-3 text-slate-600">${esc(tallaVisible(p.talla))}</td>
                <td class="py-2 pr-3 text-right tabular-nums">${p.colocadas}</td>
                <td class="py-2 text-right tabular-nums text-slate-500">${p.porPrenda}</td>
            </tr>`).join('');

        const bloqueEspejos = preguntas.map(p => {
            const clave = `${p.estilo}|${p.pieza}`;
            const v = estado.espejos[clave];
            return `
                <div class="mt-4 rounded-xl bg-amber-50 border border-amber-100 p-4" data-espejo="${esc(clave)}">
                    <p class="text-sm font-semibold text-amber-800 mb-2"><i class="fi fi-rr-interrogation mr-1"></i>¿"@${esc(p.pieza)}" es el espejo de "${esc(p.pieza)}"?</p>
                    <div class="grid sm:grid-cols-2 gap-2">
                        ${radio(`espejo-${id}-${p.pieza}`, 'si', v === true, 'Sí, es la misma pieza volteada', 'Cuentan juntas para armar la prenda')}
                        ${radio(`espejo-${id}-${p.pieza}`, 'no', v === false, 'No, son piezas distintas', 'Cada una tiene que completarse por su lado')}
                    </div>
                </div>`;
        }).join('');

        let bloqueFicha = '';
        if (!ref.ficha) {
            const modo = r.modo;
            const opcionesFichas = estado.analisis.fichas.map(f => `<option value="${esc(f.idFicha)}" ${r.idFicha === f.idFicha ? 'selected' : ''}>${esc(f.referencia)}${f.estado === 'pendiente' ? ' (por terminar)' : ''}</option>`).join('');
            const resumenAhora = modo === 'ahora' && r.ficha ? resumenFicha(r.ficha) : '';
            bloqueFicha = `
                <div class="mt-4 rounded-xl bg-slate-50 border border-slate-100 p-4" data-bloque-ficha>
                    <p class="text-sm font-semibold text-slate-700 mb-2">Esta referencia no tiene ficha. ¿Qué hacemos?</p>
                    <div class="grid md:grid-cols-3 gap-2">
                        ${radio(`modo-${id}`, 'ahora', modo === 'ahora', 'Crear la ficha ahora', 'Con la familia y el molde: queda lista para confección')}
                        ${radio(`modo-${id}`, 'despues', modo === 'despues', 'Crearla más adelante', 'Queda una ficha base pendiente. No pasa a confección sin molde y familia')}
                        ${radio(`modo-${id}`, 'vincular', modo === 'vincular', 'Ya existe con otro nombre', 'Elige la ficha a la que corresponde')}
                    </div>
                    ${resumenAhora}
                    ${modo === 'vincular' ? `<select class="field-text mt-3" data-vincular aria-label="Ficha a la que corresponde"><option value="">Elige la ficha…</option>${opcionesFichas}</select>` : ''}
                    ${modo && modo !== 'vincular' ? `
                        <label class="flex items-center gap-2 mt-3 text-sm text-slate-700 cursor-pointer">
                            <input type="checkbox" data-faltan-piezas ${r.faltanPiezas ? 'checked' : ''} class="accent-[#E24C95]">
                            La prenda lleva piezas que no vienen en este trazo
                        </label>` : ''}
                </div>`;
        } else if (ref.ficha.faltan.length) {
            bloqueFicha = `<p class="mt-3 text-xs text-amber-700"><i class="fi fi-rr-info mr-1"></i>A esta ficha le falta ${esc(ref.ficha.faltan.join(' y '))}: el corte se puede hacer, pero su orden de confección no se confirma hasta completarla.</p>`;
        }

        const tallasRes = Object.entries(resultado.porTalla).map(([t, n]) => `${n} ${n === 1 ? 'prenda' : 'prendas'} talla ${esc(tallaVisible(t))}`).join(' · ');
        let bloqueSueltas = '';
        if (resultado.necesitaDecision) {
            const faltan = resultado.faltantes.length ? `<p class="text-xs text-rose-700">Le falta: ${resultado.faltantes.map(f => `${esc(f.nombre)} (${esc(tallaVisible(f.talla))})`).join(', ')}.</p>` : '';
            const sueltas = resultado.sueltas.length ? `<p class="text-xs text-slate-600">Piezas sueltas por capa: ${resultado.sueltas.map(s => `${s.cantidad} ${esc(s.nombre)} (${esc(tallaVisible(s.talla))})`).join(', ')}.</p>` : '';
            bloqueSueltas = `
                <div class="mt-4 rounded-xl bg-rose-50/60 border border-rose-100 p-4">
                    <p class="text-sm font-semibold text-rose-800 mb-1"><i class="fi fi-rr-triangle-warning mr-1"></i>Hay piezas que no forman prendas completas</p>
                    ${faltan}${sueltas}
                    <div class="grid sm:grid-cols-2 gap-2 mt-3">
                        ${radio(`sueltas-${id}`, 'pendientes', r.piezasSueltas === 'pendientes', 'Cortarlas y dejarlas pendientes', 'Se completan con las piezas de otro corte')}
                        ${radio(`sueltas-${id}`, 'excluir', r.piezasSueltas === 'excluir', 'No cortar esta referencia aquí', 'Sale de este corte: no da prendas ni gasta su parte de tela')}
                    </div>
                </div>`;
        }

        return `
            <article class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 md:p-6" data-referencia="${estiloAttr}">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 class="text-sm font-black text-slate-800">${esc(ref.estilo)}</h3>
                        <p class="text-xs text-slate-500">${num(ref.areaCm2 / 10000)} m² de piezas por capa (${num(ref.areaCm2 / estado.analisis.trazo.areaPiezasCm2 * 100, 1)} % del trazo)</p>
                    </div>
                    ${cabeceraFicha}
                </div>
                <div class="overflow-x-auto mt-3">
                    <table class="w-full text-sm">
                        <thead><tr class="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">
                            <th class="py-2 pr-3">Pieza</th><th class="py-2 pr-3">Talla</th><th class="py-2 pr-3 text-right">Por capa</th><th class="py-2 text-right">Por prenda</th>
                        </tr></thead>
                        <tbody>${piezas}</tbody>
                    </table>
                </div>
                ${bloqueEspejos}
                ${bloqueFicha}
                ${bloqueSueltas}
                <p class="mt-4 text-sm font-semibold ${resultado.excluida ? 'text-slate-400' : resultado.prendasPorCapa ? 'text-emerald-700' : 'text-rose-600'}">
                    ${resultado.excluida ? 'No se corta en este trazo.' : resultado.prendasPorCapa ? `Por capa: ${tallasRes}.` : 'No da prendas completas por capa.'}
                </p>
                ${avisoOtrosMateriales(ficha)}
            </article>`;
    }

    // Respuestas de las referencias (delegado: la sección se vuelve a pintar entera).
    $('paso-referencias').addEventListener('change', (e) => {
        const tarjeta = e.target.closest('[data-referencia]');
        if (!tarjeta) return;
        const estilo = tarjeta.dataset.referencia;
        const r = (estado.refs[estilo] ||= {});
        const espejo = e.target.closest('[data-espejo]');
        if (espejo && e.target.type === 'radio') estado.espejos[espejo.dataset.espejo] = e.target.value === 'si';
        else if (e.target.name?.startsWith('modo-')) {
            r.modo = e.target.value;
            if (r.modo === 'ahora' && !r.ficha) { abrirModalFicha(estilo); return; }
        } else if (e.target.name?.startsWith('sueltas-')) r.piezasSueltas = e.target.value;
        else if (e.target.matches('[data-vincular]')) r.idFicha = e.target.value || null;
        else if (e.target.matches('[data-faltan-piezas]')) r.faltanPiezas = e.target.checked;
        refrescar();
    });
    $('paso-referencias').addEventListener('click', (e) => {
        if (!e.target.closest('[data-abrir-ficha]')) return;
        abrirModalFicha(e.target.closest('[data-referencia]').dataset.referencia);
    });

    // "Crear la ficha ahora": lo mismo que el asistente de ficha nueva, menos el DXF
    // (src/js/fichaCorteModal.js). La ficha se crea en el servidor junto con el corte.
    const modalFicha = crearModalFichaCorte({ precioMax: PRECIO_CONFECCION_MAX, videosMax: Number(raiz.dataset.videosMax) || 3 });

    async function abrirModalFicha(estilo) {
        const r = (estado.refs[estilo] ||= {});
        const ref = estado.analisis.referencias.find(x => x.estilo === estilo);
        const piezas = new Set(estado.analisis.piezas.filter(p => p.estilo === estilo).map(p => p.nombre)).size;   // moldes distintos, no colocaciones
        const datos = await modalFicha.abrir({
            estilo,
            idMaterial: estado.analisis.tela.idMaterial,
            detalleDxf: `${piezas} pieza(s) · talla ${(ref?.tallas || []).map(tallaVisible).join(', ') || '—'} · ${estado.analisis.tela.nombre}`,
            datos: r.ficha || { nombreFamilia: estilo.replace(/^REF\s*\d+\s*/i, '') }
        });
        if (datos) Object.assign(r, { modo: 'ahora', ficha: datos });
        else if (!r.ficha) r.modo = undefined;
        refrescar();
    }

    // ── 3. Rollos y capas ────────────────────────────────────────────────────────────────
    function pintarRollos() {
        const cont = $('paso-rollos');
        cont.classList.remove('hidden');
        const { rollos, tela, trazo, rollosEnReposo } = estado.analisis;
        const filas = rollos.map(r => {
            const elegido = estado.rollos.has(r.idRollo);
            const capas = estado.rollos.get(r.idRollo);
            const sinColor = !r.idAtributoColor;
            const sinTela = !sinColor && r.capasMax < 1;
            const motivo = sinColor ? 'Sin color' : sinTela ? 'No le cabe una capa' : '';
            const invalido = elegido && !capasValidas(r, capas);
            return `
                <tr class="border-b border-slate-100 last:border-0 ${elegido ? 'bg-gh-primarySoft/30' : ''} ${motivo ? 'text-slate-400' : ''}" data-rollo="${esc(r.idRollo)}" data-codigo="${esc(r.codigo)}">
                    <td class="py-2.5 pr-3 pl-2"><input type="checkbox" data-elegir ${elegido ? 'checked' : ''} ${motivo ? 'disabled' : ''} aria-label="Usar ${esc(r.codigo)}" class="accent-[#E24C95] w-4 h-4"></td>
                    <td class="py-2.5 pr-3 font-bold ${motivo ? '' : 'text-slate-800'}">${esc(r.codigo)}</td>
                    <td class="py-2.5 pr-3 text-slate-600">${chip(r.colorHex, r.color)}</td>
                    <td class="py-2.5 pr-3 text-right tabular-nums">${metros(r.metrajeCm)}</td>
                    <td class="py-2.5 pr-3 text-right tabular-nums text-slate-500">${motivo ? `<span class="text-rose-600 text-xs font-semibold">${motivo}</span>` : r.capasMax}</td>
                    <td class="py-2.5 text-right pr-2">
                        <input type="number" inputmode="numeric" min="1" max="${r.capasMax}" step="1" data-capas value="${elegido && Number.isFinite(capas) ? capas : ''}" ${elegido ? '' : 'disabled'}
                            ${invalido ? 'aria-invalid="true"' : ''} aria-describedby="capas-ayuda-${esc(r.idRollo)}"
                            class="field-text !w-24 text-right tabular-nums ${invalido ? '!border-rose-400 !ring-rose-200' : ''}" aria-label="Capas de ${esc(r.codigo)}">
                        <span id="capas-ayuda-${esc(r.idRollo)}" data-capas-ayuda class="block text-[11px] text-rose-600 mt-0.5 ${invalido ? '' : 'hidden'}">Entre 1 y ${r.capasMax}</span>
                    </td>
                </tr>`;
        }).join('');
        cont.innerHTML = `
            <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <h2 class="text-base font-bold text-slate-800 mb-1 flex items-center gap-2">
                        <span class="w-6 h-6 rounded-full bg-gh-primarySoft text-gh-primaryHover text-xs font-black flex items-center justify-center">3</span>
                        Rollos y capas
                    </h2>
                    <p class="text-xs text-slate-500">Rollos de ${esc(tela.nombre)} listos para cortar. Cada capa gasta ${metros(trazo.largoCm)}; las prendas salen del color del rollo.</p>
                </div>
                ${rollos.length ? `
                <div class="flex flex-col gap-1 w-full sm:w-auto">
                    <label class="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <i class="fi fi-rr-barcode-read" aria-hidden="true"></i>
                        <input id="escanear-rollo" class="field-text w-full sm:!w-56 text-sm" placeholder="Escanea la etiqueta del rollo" autocomplete="off" maxlength="40" aria-describedby="escaneo-estado">
                    </label>
                    <p id="escaneo-estado" class="text-[11px] font-semibold min-h-4 sm:text-right ${esc(estado.escaneo?.clase || '')}" role="status">${esc(estado.escaneo?.texto || '')}</p>
                </div>` : ''}
            </div>
            ${rollos.length ? `
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead><tr class="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">
                            <th class="py-2 pr-3"></th><th class="py-2 pr-3">Rollo</th><th class="py-2 pr-3">Color</th><th class="py-2 pr-3 text-right">Tiene</th><th class="py-2 pr-3 text-right">Caben</th><th class="py-2 text-right">Capas</th>
                        </tr></thead>
                        <tbody>${filas}</tbody>
                    </table>
                </div>
                <div id="totales-rollos" class="mt-4"></div>`
            : `<div class="rounded-xl bg-amber-50 border border-amber-100 px-4 py-6 text-center">
                    <p class="text-sm font-semibold text-amber-800">No hay rollos de ${esc(tela.nombre)} listos para cortar.</p>
                    <p class="text-xs text-amber-700 mt-1">${rollosEnReposo ? `${rollosEnReposo} rollo(s) siguen en reposo o sin tender.` : 'No hay rollos en bodega.'} <a class="font-bold underline" href="/admin/insumos/${encodeURIComponent(tela.idMaterial)}">Ir a la tela</a></p>
               </div>`}`;
        pintarTotales();
        $('escanear-rollo')?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const codigo = e.target.value.trim().toUpperCase();
            e.target.value = '';
            if (!codigo) return;
            const rollo = rollos.find(r => r.codigo.toUpperCase() === codigo);
            const aviso = (texto, clase) => { estado.escaneo = { texto, clase }; };
            if (!rollo) aviso(`${codigo} no está entre los rollos listos para cortar de esta tela.`, 'text-rose-600');
            else if (!rollo.idAtributoColor) aviso(`${rollo.codigo} no tiene color: no se puede usar.`, 'text-rose-600');
            else if (rollo.capasMax < 1) aviso(`A ${rollo.codigo} no le cabe ni una capa del trazo.`, 'text-rose-600');
            else if (estado.rollos.has(rollo.idRollo)) aviso(`${rollo.codigo} ya estaba en el tendido.`, 'text-slate-500');
            else {
                estado.rollos.set(rollo.idRollo, rollo.capasMax);
                aviso(`${rollo.codigo} agregado con ${rollo.capasMax} capa(s).`, 'text-emerald-700');
            }
            pintarRollos();
            refrescar(false);
            $('escanear-rollo').focus();
        });
    }

    $('paso-rollos').addEventListener('change', (e) => {
        const fila = e.target.closest('[data-rollo]');
        if (!fila) return;
        const rollo = estado.analisis.rollos.find(r => r.idRollo === fila.dataset.rollo);
        if (e.target.matches('[data-elegir]')) {
            if (e.target.checked) estado.rollos.set(rollo.idRollo, rollo.capasMax);
            else estado.rollos.delete(rollo.idRollo);
            pintarRollos();
            refrescar(false);
        }
    });
    // Las capas se escriben: solo se actualizan los totales, sin volver a pintar la tabla. El
    // valor se guarda tal cual (aunque esté mal) para marcarlo: corregirlo en silencio
    // escondería un error de digitación. Mismo rango que valida el servidor (validarCorte).
    $('paso-rollos').addEventListener('input', (e) => {
        if (!e.target.matches('[data-capas]')) return;
        const fila = e.target.closest('[data-rollo]');
        const rollo = estado.analisis.rollos.find(r => r.idRollo === fila.dataset.rollo);
        const n = e.target.value === '' ? null : Number(e.target.value);
        estado.rollos.set(rollo.idRollo, n);
        const invalido = !capasValidas(rollo, n);
        e.target.toggleAttribute('aria-invalid', invalido);
        e.target.classList.toggle('!border-rose-400', invalido);
        e.target.classList.toggle('!ring-rose-200', invalido);
        fila.querySelector('[data-capas-ayuda]').classList.toggle('hidden', !invalido);
        pintarTotales();
        pintarResultado();
        pintarBoton();
    });

    /** Capas que el servidor acepta para ese rollo: entero de 1 a lo que le cabe. */
    function capasValidas(rollo, capas) {
        return Number.isInteger(capas) && capas >= 1 && capas <= Math.min(rollo.capasMax, CAPAS_MAX);
    }

    const rollosElegidos = () => estado.analisis.rollos
        .filter(r => estado.rollos.has(r.idRollo) && capasValidas(r, estado.rollos.get(r.idRollo)))
        .map(r => ({ ...r, capas: estado.rollos.get(r.idRollo) }));
    const rollosConCapasMal = () => estado.analisis.rollos
        .filter(r => estado.rollos.has(r.idRollo) && !capasValidas(r, estado.rollos.get(r.idRollo)));

    function capasPorColor() {
        const colores = new Map();
        for (const r of rollosElegidos()) {
            if (!colores.has(r.idAtributoColor)) colores.set(r.idAtributoColor, { idAtributoColor: r.idAtributoColor, nombre: r.color, hex: r.colorHex, capas: 0 });
            colores.get(r.idAtributoColor).capas += r.capas;
        }
        return [...colores.values()];
    }

    function pintarTotales() {
        const cont = $('totales-rollos');
        if (!cont) return;
        const elegidos = rollosElegidos();
        const capas = elegidos.reduce((s, r) => s + r.capas, 0);
        cont.innerHTML = capas
            ? `<div class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm">
                    <span><span class="text-slate-500">Capas:</span> <b class="tabular-nums">${capas}</b></span>
                    <span><span class="text-slate-500">Tela:</span> <b class="tabular-nums">${metros(capas * estado.analisis.trazo.largoCm)}</b></span>
                    ${capasPorColor().map(c => `<span>${chip(c.hex, c.nombre)} <b class="tabular-nums">${c.capas}</b></span>`).join('')}
               </div>`
            : '<p class="text-xs text-slate-400">Elige los rollos que se tienden en este corte.</p>';
    }

    // ── 4. Resultado ─────────────────────────────────────────────────────────────────────
    function pintarResultado() {
        $('paso-resultado').classList.remove('hidden');
        const colores = capasPorColor();
        const filas = calcular().filter(c => !c.resultado.excluida && c.resultado.prendasPorCapa > 0);
        if (!filas.length || !colores.length) {
            $('tabla-resultado').innerHTML = '<p class="text-sm text-slate-400">Cuando respondas las referencias y elijas los rollos, aquí verás cuántas prendas salen.</p>';
            return;
        }
        let total = 0;
        const bloques = filas.map(({ ref, ficha, r, resultado }) => {
            const tallas = Object.keys(resultado.porTalla).filter(t => resultado.porTalla[t] > 0);
            const cuerpo = colores.map(c => {
                const celdas = tallas.map(t => { const n = resultado.porTalla[t] * c.capas; total += n; return `<td class="py-2 px-3 text-right tabular-nums">${n}</td>`; }).join('');
                return `<tr class="border-b border-slate-100 last:border-0"><td class="py-2 pr-3">${chip(c.hex, c.nombre)}</td>${celdas}</tr>`;
            }).join('');
            const nombre = ficha?.referencia || (r.modo === 'ahora' ? r.ficha?.nombreFamilia : ref.estilo);
            return `
                <div class="rounded-xl border border-slate-100 p-4">
                    <p class="text-sm font-bold text-slate-800 mb-2">${esc(nombre)} <span class="font-normal text-xs text-slate-400">${esc(ref.estilo)}</span></p>
                    <table class="w-full text-sm">
                        <thead><tr class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">
                            <th class="py-2 pr-3 text-left">Color</th>${tallas.map(t => `<th class="py-2 px-3 text-right">${esc(tallaVisible(t))}</th>`).join('')}
                        </tr></thead>
                        <tbody>${cuerpo}</tbody>
                    </table>
                </div>`;
        }).join('');
        $('tabla-resultado').innerHTML = `<div class="grid md:grid-cols-2 gap-3">${bloques}</div>
            <p class="mt-3 text-sm text-slate-600">Total: <b class="tabular-nums">${total.toLocaleString('es-CO')}</b> prendas completas.</p>`;
    }

    // ── Validación y guardar ─────────────────────────────────────────────────────────────
    /** Lo primero que falta responder, o null. Mismo orden que valida el servidor. */
    function pendiente() {
        if (!estado.analisis) return 'Sube el trazo.';
        for (const p of estado.analisis.preguntasEspejo) {
            if (typeof estado.espejos[`${p.estilo}|${p.pieza}`] !== 'boolean') return `Responde si "@${p.pieza}" de ${p.estilo} es un espejo.`;
        }
        let seCorta = false;
        for (const c of calcular()) {
            if (!c.ref.ficha) {
                if (!c.r.modo) return `Elige qué hacer con la ficha de ${c.ref.estilo}.`;
                if (c.r.modo === 'ahora' && !c.r.ficha) return `Completa la ficha de ${c.ref.estilo}.`;
                if (c.r.modo === 'vincular' && !c.r.idFicha) return `Elige la ficha de ${c.ref.estilo}.`;
            }
            if (c.resultado.necesitaDecision && !c.r.piezasSueltas) return `Decide qué hacer con las piezas sueltas de ${c.ref.estilo}.`;
            if (!c.resultado.excluida) seCorta = true;
        }
        if (!seCorta) return 'Todas las referencias quedaron fuera del corte.';
        const mal = rollosConCapasMal();
        if (mal.length) return `Revisa las capas de ${mal.map(r => r.codigo).join(', ')}: entre 1 y lo que le cabe a cada rollo.`;
        if (!rollosElegidos().length) return 'Elige al menos un rollo y sus capas.';
        const fecha = $('fecha-requerida').value;
        if (!fecha) return 'Elige para cuándo se necesitan las prendas.';
        if (fecha < (raiz.dataset.hoy || '')) return 'La fecha no puede ser anterior a hoy.';
        if ($('notas-corte').value.trim().length > NOTAS_MAX) return `Las notas no pueden pasar de ${NOTAS_MAX.toLocaleString('es-CO')} caracteres.`;
        return null;
    }

    function pintarBoton() {
        const falta = pendiente();
        $('btn-crear-corte').disabled = Boolean(falta);
        $('btn-crear-corte').title = falta || '';
        $('falta-corte').textContent = falta && estado.analisis ? falta : '';
    }

    // Contador de las notas: aparece solo cuando se acerca al tope, para no hacer ruido.
    $('notas-corte').addEventListener('input', (e) => {
        const n = e.target.value.length;
        $('notas-contador').textContent = n > NOTAS_MAX * 0.8 ? `${n.toLocaleString('es-CO')} / ${NOTAS_MAX.toLocaleString('es-CO')}` : '';
        pintarBoton();
    });

    function refrescar(conReferencias = true) {
        if (conReferencias) pintarReferencias();
        pintarResultado();
        pintarBoton();
    }

    function pintarTodo() {
        pintarResumen();
        pintarReferencias();
        pintarRollos();
        pintarResultado();
        pintarBoton();
    }

    const cuerpoParaServidor = () => {
        const referencias = {};
        for (const ref of estado.analisis.referencias) {
            const r = estado.refs[ref.estilo] || {};
            // Solo los ids y textos: nombres y vistas previas son de la pantalla. El servidor
            // revalida cada id (molde y videos del mismo usuario, intento de IA aprobado…).
            const f = r.modo === 'ahora' ? r.ficha || {} : {};
            referencias[ref.estilo] = {
                modo: r.modo, idFicha: r.idFicha,
                nombreFamilia: f.nombreFamilia, idMolde: f.idMolde, precioConfeccion: f.precioConfeccion,
                idMoldeReferencia: f.idMoldeReferencia || null, idMoldeIaIntento: f.idMoldeIaIntento || null,
                idsVideos: (f.videos || []).map(v => v.idVideo),
                insumos: (f.insumos || []).map(i => ({ idMaterial: i.idMaterial, cantidad: i.cantidad })),
                complementos: f.complementos || '', observaciones: f.observaciones || '',
                faltanPiezas: r.faltanPiezas === true, piezasSueltas: r.piezasSueltas || null
            };
        }
        return {
            fechaRequerida: $('fecha-requerida').value,
            notas: $('notas-corte').value,
            espejos: estado.espejos,
            referencias,
            rollos: rollosElegidos().map(r => ({ idRollo: r.idRollo, capas: r.capas }))
        };
    };

    $('btn-crear-corte').addEventListener('click', async () => {
        const falta = pendiente();
        if (falta) return;
        const calculos = calcular();
        const nuevas = calculos.filter(c => !c.ref.ficha && c.r.modo !== 'vincular');
        const elegidos = rollosElegidos();
        const capas = elegidos.reduce((s, r) => s + r.capas, 0);
        const contexto = [
            `${capas} capa(s) de ${metros(estado.analisis.trazo.largoCm)} en ${elegidos.length} rollo(s): ${metros(capas * estado.analisis.trazo.largoCm)} de ${esc(estado.analisis.tela.nombre)}.`,
            nuevas.length ? `Se crean ${nuevas.length} ficha(s): ${nuevas.map(c => esc(c.ref.estilo)).join(', ')}.` : '',
            'La orden queda en borrador: la tela sale de los rollos cuando registres el corte.'
        ].filter(Boolean).join('<br>');
        const res = await Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono: 'fi-rr-scissors', badge: 'Crear orden de corte', contexto })}</div>`,
            showCancelButton: true,
            confirmButtonText: 'Crear orden de corte',
            cancelButtonText: 'Volver',
            showLoaderOnConfirm: true,
            preConfirm: async () => {
                try {
                    const datos = new FormData();
                    datos.append('dxf', estado.archivo);
                    datos.append('datos', JSON.stringify(cuerpoParaServidor()));
                    const r = await fetch('/admin/procesos/cortes', { method: 'POST', body: datos });
                    const d = await r.json().catch(() => ({}));
                    if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo crear la orden de corte.');
                    return d;
                } catch (err) {
                    Swal.showValidationMessage(esc(mensajeDe(err, 'No se pudo crear la orden de corte.')));
                    return false;
                }
            }
        }));
        if (res.isConfirmed) window.location.href = res.value.url;
    });

    // Mantiene `calendario` vivo (Flatpickr lo necesita referenciado).
    raiz.calendario = calendario;
})();
