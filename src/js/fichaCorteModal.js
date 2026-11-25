import { escaparHtml as esc } from './escaparHtml.js';
import { crearModalElegirInsumo } from './modalElegirInsumo.js';
import { duracionVideo } from './duracionVideo.js';
import { subirVideoProceso, reintentarVideoProceso } from './subidaVideo.js';
import { subirArchivoMolde, iniciarGeneracionIa, consultarIntentoIa, aprobarIntentoIa, pedirDatosIa } from './moldeIaCliente.js';

// "Crear la ficha" del corte nuevo (#modal-ficha-corte en views/administrador/produccion/
// ordenCorteNueva.pug). Pide lo mismo que los pasos 1 y 3 del asistente de ficha nueva, menos
// el DXF, que sale del trazo: familia, molde (+ foto de referencia o vista previa con IA),
// hasta 3 videos, complementos, insumos por prenda, observaciones y precio.
//
// Las subidas (molde, referencia, videos) y la IA van a los mismos endpoints que el asistente
// (moldeIaCliente.js, subidaVideo.js): quedan sueltas hasta que el servidor crea la ficha junto
// con el corte y las reclama. Acá no se guarda nada en la base.
//
//   const modal = crearModalFichaCorte({ precioMax });
//   const datos = await modal.abrir({ estilo, detalleDxf, datos: previos });   // null = canceló

const CANTIDAD_INSUMO_MAX = 9999;
const FAMILIA_MAX = 150;

const pesoLegible = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const spinner = 'w-3.5 h-3.5 rounded-full border-2 border-slate-300 border-t-gh-primaryHover animate-spin flex-shrink-0';
const botonChico = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-gh-primary hover:text-gh-primaryHover transition-colors cursor-pointer';
const botonQuitar = 'w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors flex-shrink-0 cursor-pointer';

export function crearModalFichaCorte({ precioMax = 99999999, videosMax: MAX_VIDEOS = 3 } = {}) {
    const modal = document.getElementById('modal-ficha-corte');
    if (!modal) return { abrir: async () => null };
    const $ = (id) => document.getElementById(id);
    const campos = {
        titulo: $('modal-ficha-titulo'), dxf: $('ficha-dxf-detalle'), familia: $('ficha-familia'),
        moldeVacio: $('ficha-molde-vacio'), moldeLleno: $('ficha-molde-lleno'), molde: $('ficha-molde'), referencia: $('ficha-referencia'),
        videoVacio: $('ficha-video-vacio'), video: $('ficha-video'), videos: $('ficha-videos'),
        insumos: $('ficha-insumos'), agregarInsumo: $('ficha-agregar-insumo'),
        complementos: $('ficha-complementos'), observaciones: $('ficha-observaciones'), precio: $('ficha-precio'),
        error: $('ficha-error'), guardar: $('ficha-guardar')
    };
    window.initMoneyInput(campos.precio);

    let borrador = null;      // lo que se edita; se entrega solo al confirmar
    let resolver = null;
    let pollIa = null;

    // ── Abrir / cerrar ───────────────────────────────────────────────────────────────────
    let idMaterialTela = null;   // la tela del trazo: la IA la usa para describir la prenda

    function abrir({ estilo, detalleDxf = '', idMaterial = null, datos = {} }) {
        idMaterialTela = idMaterial;
        borrador = {
            nombreFamilia: datos.nombreFamilia ?? '',
            molde: datos.idMolde ? { idMolde: datos.idMolde, nombre: datos.nombreMolde, peso: datos.pesoMolde, estado: 'listo' } : null,
            referencia: datos.idMoldeReferencia ? { idMolde: datos.idMoldeReferencia, nombre: datos.nombreReferencia, preview: datos.previewReferencia, estado: 'listo' } : null,
            ia: datos.idMoldeIaIntento ? { idIntento: datos.idMoldeIaIntento, preview: datos.previewIa, pattern: datos.iaPattern, colors: datos.iaColors, estado: 'listo', aprobado: true } : null,
            videos: (datos.videos || []).map((v) => ({ ...v, clave: v.idVideo, estado: 'completado', porcentaje: 100 })),
            insumos: (datos.insumos || []).map((i) => ({ ...i }))
        };
        campos.titulo.textContent = `Crear la ficha · ${estilo}`;
        campos.dxf.textContent = detalleDxf;
        campos.familia.value = borrador.nombreFamilia;
        campos.complementos.value = datos.complementos || '';
        campos.observaciones.value = datos.observaciones || '';
        campos.precio.value = datos.precioConfeccion || '';
        mostrarError('');
        pintarMolde();
        pintarVideos();
        pintarInsumos();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.classList.add('overflow-hidden');
        campos.familia.focus();
        if (borrador.ia?.estado === 'procesando') vigilarIa(borrador);
        return new Promise((r) => { resolver = r; });
    }

    function cerrar(valor) {
        clearInterval(pollIa);
        pollIa = null;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.classList.remove('overflow-hidden');
        borrador = null;
        const r = resolver;
        resolver = null;
        r?.(valor);
    }

    modal.querySelectorAll('[data-cerrar-ficha]').forEach((b) => b.addEventListener('click', () => cerrar(null)));
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(null); });

    const mostrarError = (texto, campo = null) => {
        campos.error.textContent = texto;
        campo?.focus();
        campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    // ── Molde, foto de referencia e IA ───────────────────────────────────────────────────
    function pintarMolde() {
        const { molde, referencia, ia } = borrador;
        campos.moldeVacio.classList.toggle('hidden', Boolean(molde));
        campos.moldeLleno.classList.toggle('hidden', !molde);
        campos.moldeLleno.classList.toggle('flex', Boolean(molde));
        if (!molde) { campos.moldeLleno.innerHTML = ''; return; }

        const fila = `
            <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-full bg-white flex items-center justify-center flex-shrink-0 text-gh-primaryHover"><i class="fi fi-rr-vector text-sm"></i></div>
                <div class="flex-1 min-w-0">
                    <p class="text-xs font-bold text-slate-800 truncate">${esc(molde.nombre || 'Molde')}</p>
                    <p class="text-[11px] ${molde.estado === 'error' ? 'text-rose-600 font-semibold' : 'text-slate-500'}">${molde.estado === 'subiendo' ? 'Subiendo…' : molde.estado === 'error' ? esc(molde.error) : molde.peso ? pesoLegible(molde.peso) : 'Molde cargado'}</p>
                </div>
                ${molde.estado === 'subiendo' ? `<span class="${spinner}"></span>` : `<button type="button" data-quitar-molde aria-label="Quitar el molde" class="${botonQuitar}"><i class="fi fi-rr-cross-small"></i></button>`}
            </div>`;

        let bloqueRef = '';
        if (referencia) {
            bloqueRef = `
                <div class="flex items-center gap-2.5 pt-3 border-t border-gh-primary/20">
                    ${referencia.preview ? `<img src="${esc(referencia.preview)}" alt="" class="w-10 h-10 rounded-lg object-cover border border-slate-200 flex-shrink-0">` : `<span class="w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0 text-slate-400"><i class="fi fi-rr-picture"></i></span>`}
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-bold text-slate-800 truncate">${esc(referencia.nombre || 'Foto de referencia')}</p>
                        <p class="text-[11px] font-semibold ${referencia.estado === 'error' ? 'text-rose-600' : referencia.estado === 'subiendo' ? 'text-slate-500' : 'text-emerald-600'}">${referencia.estado === 'subiendo' ? 'Subiendo…' : referencia.estado === 'error' ? esc(referencia.error) : 'Foto de referencia cargada'}</p>
                    </div>
                    ${referencia.estado === 'subiendo' ? `<span class="${spinner}"></span>` : `<button type="button" data-quitar-referencia aria-label="Quitar la foto de referencia" class="${botonQuitar}"><i class="fi fi-rr-cross-small"></i></button>`}
                </div>`;
        }

        let bloqueIa = '';
        if (ia) {
            if (ia.estado === 'procesando') {
                bloqueIa = `<div class="flex items-center gap-2 pt-3 border-t border-gh-primary/20 text-xs font-semibold text-slate-500" role="status"><span class="${spinner}"></span>Generando la vista previa con IA (hasta un minuto)…</div>`;
            } else if (ia.estado === 'error') {
                bloqueIa = `<div class="pt-3 border-t border-rose-200 flex items-start justify-between gap-2"><p class="text-xs font-semibold text-rose-600">${esc(ia.error)}</p><button type="button" data-repetir-ia class="text-xs font-bold text-gh-primaryHover hover:underline flex-shrink-0">Reintentar</button></div>`;
            } else {
                bloqueIa = `
                    <div class="flex flex-col gap-2.5 pt-3 border-t border-gh-primary/20">
                        <img src="${esc(ia.preview)}" alt="Vista previa generada con IA" class="w-full rounded-xl border border-slate-200 bg-white">
                        ${ia.aprobado
                            ? `<div class="flex items-center justify-between gap-2"><p class="text-xs font-semibold text-emerald-600 flex items-center gap-1.5"><i class="fi fi-rr-check-circle"></i>Imagen aprobada</p><button type="button" data-quitar-ia class="text-xs font-bold text-slate-500 hover:text-rose-600">Quitar</button></div>`
                            : `<div class="grid grid-cols-2 gap-2">
                                    <button type="button" data-repetir-ia class="btn btn-secondary btn-sm justify-center text-xs px-2"><i class="fi fi-rr-refresh text-xs"></i>Repetir</button>
                                    <button type="button" data-aprobar-ia class="btn btn-danger btn-sm justify-center text-xs px-2" ${ia.aprobando ? 'disabled' : ''}><i class="fi fi-rr-check text-xs"></i>${ia.aprobando ? 'Aprobando…' : 'Aprobar'}</button>
                               </div>
                               <p class="text-[11px] text-slate-500">Solo va en la ficha si la apruebas.</p>`}
                    </div>`;
            }
        }

        const extras = molde.estado === 'listo' && (!referencia || !ia)
            ? `<div class="flex flex-wrap gap-2 pt-3 border-t border-gh-primary/20">
                    ${referencia ? '' : `<button type="button" data-agregar-referencia class="${botonChico}"><i class="fi fi-rr-picture text-xs"></i>Agregar foto de referencia</button>`}
                    ${ia ? '' : `<button type="button" data-generar-ia class="${botonChico}"><i class="fi fi-rr-sparkles text-xs"></i>Generar con IA</button>`}
               </div>`
            : '';

        campos.moldeLleno.innerHTML = fila + bloqueRef + bloqueIa + extras;
    }

    campos.molde.addEventListener('change', async () => {
        const archivo = campos.molde.files?.[0];
        campos.molde.value = '';
        if (!archivo || !borrador) return;
        const b = borrador;
        // Cambiar el molde invalida la vista previa con IA, que sale de él.
        b.molde = { nombre: archivo.name, peso: archivo.size, estado: 'subiendo' };
        b.ia = null;
        pintarMolde();
        try {
            const d = await subirArchivoMolde(archivo, 'No se pudo subir el molde.');
            Object.assign(b.molde, { idMolde: d.idMolde, estado: 'listo' });
        } catch (e) {
            Object.assign(b.molde, { estado: 'error', error: e.message });
        }
        if (b === borrador) pintarMolde();
    });

    campos.referencia.addEventListener('change', async () => {
        const archivo = campos.referencia.files?.[0];
        campos.referencia.value = '';
        if (!archivo || !borrador) return;
        const b = borrador;
        b.referencia = { nombre: archivo.name, preview: URL.createObjectURL(archivo), estado: 'subiendo' };
        pintarMolde();
        try {
            const d = await subirArchivoMolde(archivo, 'No se pudo subir la foto de referencia.');
            Object.assign(b.referencia, { idMolde: d.idMolde, estado: 'listo' });
        } catch (e) {
            Object.assign(b.referencia, { estado: 'error', error: e.message });
        }
        if (b === borrador) pintarMolde();
    });

    async function generarIa() {
        const b = borrador;
        const datos = await pedirDatosIa({ pattern: b.ia?.pattern, colors: b.ia?.colors });
        if (!datos || b !== borrador || !b.molde?.idMolde) return;
        b.ia = { ...datos, estado: 'procesando' };
        pintarMolde();
        try {
            const d = await iniciarGeneracionIa(b.molde.idMolde, { ...datos, idMaterial: idMaterialTela });
            b.ia.idIntento = d.idIntento;
            vigilarIa(b);
        } catch (e) {
            Object.assign(b.ia, { estado: 'error', error: e.message });
            if (b === borrador) pintarMolde();
        }
    }

    // La generación corre en el servidor: se consulta cada 4 s hasta que termine.
    function vigilarIa(b) {
        clearInterval(pollIa);
        pollIa = setInterval(async () => {
            if (b !== borrador || !b.ia?.idIntento) return clearInterval(pollIa);
            const intento = await consultarIntentoIa(b.ia.idIntento);
            if (!intento || intento.estado === 'procesando') return;
            clearInterval(pollIa);
            if (intento.estado === 'error') Object.assign(b.ia, { estado: 'error', error: intento.errorMensaje || 'No se pudo generar la imagen.' });
            else Object.assign(b.ia, { estado: 'listo', preview: intento.previewUrl, aprobado: false });
            if (b === borrador) pintarMolde();
        }, 4000);
    }

    campos.moldeLleno.addEventListener('click', async (e) => {
        const b = borrador;
        if (!b) return;
        if (e.target.closest('[data-quitar-molde]')) { b.molde = null; b.referencia = null; b.ia = null; clearInterval(pollIa); }
        else if (e.target.closest('[data-quitar-referencia]')) b.referencia = null;
        else if (e.target.closest('[data-quitar-ia]')) b.ia = null;
        else if (e.target.closest('[data-agregar-referencia]')) return campos.referencia.click();
        else if (e.target.closest('[data-generar-ia], [data-repetir-ia]')) return generarIa();
        else if (e.target.closest('[data-aprobar-ia]')) {
            b.ia.aprobando = true;
            pintarMolde();
            try {
                await aprobarIntentoIa(b.ia.idIntento);
                b.ia.aprobado = true;
            } catch (err) {
                mostrarError(err.message);
            }
            b.ia.aprobando = false;
        } else return;
        if (b === borrador) pintarMolde();
    });

    // ── Videos ───────────────────────────────────────────────────────────────────────────
    function pintarVideos() {
        const { videos } = borrador;
        const lleno = videos.length >= MAX_VIDEOS;
        campos.videoVacio.classList.toggle('hidden', lleno);
        campos.video.disabled = lleno;
        campos.videos.innerHTML = videos.map((v) => {
            const enCurso = v.estado === 'pendiente' || v.estado === 'subiendo';
            const texto = v.estado === 'completado' ? 'Listo'
                : v.estado === 'error' ? esc(v.error || 'No se pudo subir el video.')
                    : v.estado === 'pendiente' ? 'Preparando…'
                        : v.porcentaje >= 100 ? 'Procesando…' : `Subiendo… ${v.porcentaje}%`;
            return `
                <div class="flex flex-col gap-1.5 border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50" data-video="${esc(v.clave)}">
                    <div class="flex items-center gap-2">
                        <i class="fi fi-rr-video-camera text-sm flex-shrink-0 ${v.estado === 'error' ? 'text-rose-500' : 'text-slate-400'}"></i>
                        <p class="flex-1 min-w-0 text-xs font-semibold text-slate-700 truncate">${esc(v.nombre)}</p>
                        ${enCurso ? `<span class="${spinner}"></span>` : ''}
                        ${v.estado === 'completado' ? '<span class="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0"><i class="fi fi-rr-check text-white text-[8px]"></i></span>' : ''}
                        ${enCurso ? '' : `<button type="button" data-quitar-video aria-label="Quitar ${esc(v.nombre)}" class="${botonQuitar} !w-6 !h-6"><i class="fi fi-rr-cross-small text-xs"></i></button>`}
                    </div>
                    ${enCurso ? `<div class="h-1.5 bg-slate-200 rounded-full overflow-hidden"><div class="h-full bg-gh-primary rounded-full transition-all" style="width:${v.porcentaje}%"></div></div>` : ''}
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-[11px] ${v.estado === 'error' ? 'text-rose-600 font-semibold' : 'text-slate-500'}" role="status">${texto}</span>
                        ${v.estado === 'error' && v.idVideo && v.archivo ? '<button type="button" data-reintentar-video class="text-[11px] font-bold text-gh-primaryHover hover:underline">Reintentar</button>' : ''}
                    </div>
                </div>`;
        }).join('');
    }

    const avisos = (b, v) => ({
        alProgreso: (p) => { v.porcentaje = p; if (b === borrador) pintarVideos(); },
        alEstado: (estado, idVideo) => {
            if (idVideo) v.idVideo = idVideo;
            v.estado = estado === 'pendiente' ? 'pendiente' : 'subiendo';
            if (estado === 'procesando') v.porcentaje = 100;
            if (b === borrador) pintarVideos();
        }
    });

    async function subir(b, v, intento) {
        try {
            await intento();
            v.estado = 'completado';
        } catch (e) {
            if (e.idVideo) v.idVideo = e.idVideo;
            Object.assign(v, { estado: 'error', error: e.message });
        }
        if (b === borrador) pintarVideos();
    }

    campos.video.addEventListener('change', () => {
        const b = borrador;
        const archivos = [...(campos.video.files || [])];
        campos.video.value = '';
        if (!b) return;
        const libres = MAX_VIDEOS - b.videos.length;
        if (archivos.length > libres) mostrarError(`Una ficha lleva hasta ${MAX_VIDEOS} videos: se tomaron los primeros ${libres}.`);
        archivos.slice(0, libres).forEach((archivo) => {
            const v = { clave: `${Date.now()}-${Math.random()}`, archivo, nombre: archivo.name, estado: 'pendiente', porcentaje: 0, idVideo: null };
            b.videos.push(v);
            subir(b, v, async () => {
                const duracionSegundos = await duracionVideo(archivo);
                await subirVideoProceso(archivo, { orden: b.videos.indexOf(v) + 1, duracionSegundos, ...avisos(b, v) });
            });
        });
        pintarVideos();
    });

    campos.videos.addEventListener('click', (e) => {
        const b = borrador;
        const fila = e.target.closest('[data-video]');
        if (!b || !fila) return;
        const v = b.videos.find((x) => x.clave === fila.dataset.video);
        if (e.target.closest('[data-quitar-video]')) {
            b.videos = b.videos.filter((x) => x !== v);
            pintarVideos();
        } else if (e.target.closest('[data-reintentar-video]')) {
            Object.assign(v, { estado: 'pendiente', porcentaje: 0, error: null });
            pintarVideos();
            subir(b, v, () => reintentarVideoProceso(v.idVideo, v.archivo, avisos(b, v)));
        }
    });

    // ── Insumos por prenda ───────────────────────────────────────────────────────────────
    const selector = crearModalElegirInsumo('modal-elegir-insumo', (insumo, indice) => {
        if (!borrador) return;
        const fila = borrador.insumos[indice];
        if (!fila) return;
        Object.assign(fila, { idMaterial: insumo.idMaterial, nombre: insumo.nombre, imagen: insumo.imagen, unidad: insumo.unidad });
        pintarInsumos();
        campos.insumos.querySelector(`[data-insumo="${indice}"] [data-cantidad]`)?.focus();
    });

    function pintarInsumos() {
        campos.insumos.innerHTML = borrador.insumos.map((i, n) => `
            <div class="flex items-center gap-2" data-insumo="${n}">
                <button type="button" data-elegir-insumo class="field-text bg-white flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer">
                    <span class="w-6 h-6 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden flex items-center justify-center text-slate-400">
                        ${i.imagen ? `<img src="${esc(i.imagen)}" alt="" class="w-full h-full object-cover">` : '<i class="fi fi-rr-box text-xs"></i>'}
                    </span>
                    <span class="truncate ${i.idMaterial ? 'text-slate-800 font-semibold' : 'text-slate-400'}">${i.idMaterial ? esc(i.nombre) : 'Elige un insumo…'}</span>
                </button>
                <label class="relative flex-shrink-0">
                    <input type="number" inputmode="numeric" min="1" max="${CANTIDAD_INSUMO_MAX}" step="1" data-cantidad value="${i.cantidad ?? ''}"
                        placeholder="Por prenda" aria-label="Cantidad por prenda${i.nombre ? ` de ${esc(i.nombre)}` : ''}"
                        class="field-text bg-white w-28 text-right tabular-nums ${i.unidad ? 'pr-10' : ''}">
                    ${i.unidad ? `<span class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">${esc(i.unidad)}</span>` : ''}
                </label>
                <button type="button" data-quitar-insumo aria-label="Quitar insumo" class="${botonQuitar} !w-8 !h-8"><i class="fi fi-rr-cross-small"></i></button>
            </div>`).join('');
    }

    campos.agregarInsumo.addEventListener('click', () => {
        if (!borrador) return;
        borrador.insumos.push({ idMaterial: null, cantidad: null });
        pintarInsumos();
        selector.abrir(borrador.insumos.length - 1);
    });
    campos.insumos.addEventListener('click', (e) => {
        const fila = e.target.closest('[data-insumo]');
        if (!fila || !borrador) return;
        const n = Number(fila.dataset.insumo);
        if (e.target.closest('[data-elegir-insumo]')) selector.abrir(n);
        else if (e.target.closest('[data-quitar-insumo]')) { borrador.insumos.splice(n, 1); pintarInsumos(); }
    });
    campos.insumos.addEventListener('input', (e) => {
        if (!e.target.matches('[data-cantidad]') || !borrador) return;
        const n = Number(e.target.closest('[data-insumo]').dataset.insumo);
        borrador.insumos[n].cantidad = e.target.value === '' ? null : Number(e.target.value);
    });

    // ── Confirmar: valida lo mismo que el servidor (validarCorte / finalizarFicha) ───────
    campos.guardar.addEventListener('click', () => {
        const b = borrador;
        if (!b) return;
        const nombreFamilia = campos.familia.value.trim().replace(/\s+/g, ' ');
        if (!nombreFamilia) return mostrarError('Escribe la familia de la prenda.', campos.familia);
        if (nombreFamilia.length > FAMILIA_MAX) return mostrarError(`La familia no puede pasar de ${FAMILIA_MAX} caracteres.`, campos.familia);

        if (!b.molde) return mostrarError('Sube el molde de la prenda.', campos.molde);
        if (b.molde.estado === 'subiendo') return mostrarError('Espera a que termine de subir el molde.');
        if (b.molde.estado === 'error') return mostrarError('El molde no se pudo subir: quítalo y vuelve a cargarlo.');
        if (b.referencia?.estado === 'subiendo') return mostrarError('Espera a que termine de subir la foto de referencia.');
        if (b.referencia?.estado === 'error') return mostrarError('La foto de referencia no se pudo subir: quítala o vuelve a cargarla.');
        if (b.ia?.estado === 'procesando') return mostrarError('Espera a que termine la vista previa con IA.');
        if (b.ia?.aprobando) return mostrarError('Espera a que termine de aprobarse la imagen con IA.');

        if (b.videos.some((v) => v.estado === 'pendiente' || v.estado === 'subiendo')) return mostrarError('Espera a que terminen de subir los videos.');
        if (b.videos.some((v) => v.estado === 'error')) return mostrarError('Hay un video que no se pudo subir: reinténtalo o quítalo.');

        const vistos = new Set();
        for (const [n, i] of b.insumos.entries()) {
            const campo = campos.insumos.querySelector(`[data-insumo="${n}"] [data-cantidad]`);
            if (!i.idMaterial) return mostrarError('Elige el insumo de cada fila o quita la que sobra.', campos.insumos.querySelector(`[data-insumo="${n}"] [data-elegir-insumo]`));
            if (vistos.has(i.idMaterial)) return mostrarError(`${i.nombre} está dos veces: deja una sola fila.`, campo);
            vistos.add(i.idMaterial);
            if (!Number.isInteger(i.cantidad) || i.cantidad < 1 || i.cantidad > CANTIDAD_INSUMO_MAX) return mostrarError(`Escribe cuántas unidades de ${i.nombre} lleva cada prenda (de 1 a ${CANTIDAD_INSUMO_MAX.toLocaleString('es-CO')}).`, campo);
        }

        const precio = campos.precio.value.trim();
        if (precio && window.parseMoney(precio) > precioMax) return mostrarError(`El precio de confección no puede pasar de ${window.fmtCOP(precioMax)} por prenda.`, campos.precio);

        const iaAprobada = b.ia?.estado === 'listo' && b.ia.aprobado;
        cerrar({
            nombreFamilia,
            idMolde: b.molde.idMolde, nombreMolde: b.molde.nombre, pesoMolde: b.molde.peso,
            idMoldeReferencia: b.referencia?.idMolde || null, nombreReferencia: b.referencia?.nombre || null, previewReferencia: b.referencia?.preview || null,
            idMoldeIaIntento: iaAprobada ? b.ia.idIntento : null, previewIa: iaAprobada ? b.ia.preview : null, iaPattern: b.ia?.pattern, iaColors: b.ia?.colors,
            videos: b.videos.map((v) => ({ idVideo: v.idVideo, nombre: v.nombre })),
            insumos: b.insumos.map((i) => ({ idMaterial: i.idMaterial, nombre: i.nombre, imagen: i.imagen, unidad: i.unidad, cantidad: i.cantidad })),
            complementos: campos.complementos.value.trim(),
            observaciones: campos.observaciones.value.trim(),
            precioConfeccion: precio
        });
    });

    return { abrir };
}
