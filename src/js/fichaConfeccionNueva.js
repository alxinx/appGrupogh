// Asistente "Nueva ficha de confección" (admin/procesos/fichas-confeccion/nueva).
//
// Motor de pasos PORTADO de /formularios/registroClientes (grupoghweb,
// src/components/registro/Piezas.tsx useTransicionPasos): lo que sale se desliza hacia un
// lado, desvanece y se encoge; lo que entra llega del otro lado con un leve rebote; avanzar
// dispara un destello. Allá corre en React con una `key` que fuerza el remount de la
// animación — acá no hay React, así que el remount se imita quitando y volviendo a poner la
// clase `.gh-paso-entra` (con un reflow forzado en el medio, si no el navegador no nota el
// cambio y no la vuelve a correr).
//
// Tres pasos: archivos, tela+colores, complementos/observaciones/precio. "Guardar ficha"
// en el último junta todo en POST .../finalizar (controller/fichaConfeccionController.js).
//
// La notificación en vivo de "la IA ya terminó" (sección "Molde: generación de imagen con
// IA", más abajo) reutiliza el canal de SSE que ya existe para todo el panel admin
// (helpers/sseManager.js, CLAUDE.md §13) — adminAlertas.js, cargado en todas las páginas
// del admin por leftMenu.pug, ya abre y conecta esa conexión compartida antes de que este
// archivo corra; acá solo hace falta suscribirse a un evento más.
import { adminSSE } from './sseCompartido.js';

const CSRF = document.getElementById('asistente-ficha')?.dataset.csrf;
const INTERVALO_POLL_MS = 1500;

// Estado compartido entre los distintos IIFE de este archivo (archivos, colores, envío
// final) — cada slot vive en su propio closure, así que lo que uno resuelve y otro necesita
// después (el material del DXF para el molde Y para el paso 2, el idMolde para el envío
// final, los videos listos...) pasa por acá en vez de variables globales sueltas.
const estadoFicha = {
    idArchivoDxf: null,
    idMolde: null,
    idMoldeIaIntentoAprobado: null,
    materialNombre: null,
    obtenerVideosListos: () => []
};

// ── Campos de archivo (DXF / molde / video) ─────────────────────────────────────────────
// Cada slot es independiente: caja punteada vacía (data-zona-vacia, con el <input
// type=file> real y transparente encima — soltar un archivo arriba también funciona, sin
// JS de arrastre propio) y una tarjeta con nombre+peso cuando ya hay uno elegido
// (data-zona-llena). Mismo input real en los dos estados: "Quitar" solo limpia su `.value`.
document.querySelectorAll('[data-slot-archivo]').forEach((slot) => {
    const input = slot.querySelector('[data-input-archivo]');
    const zonaVacia = slot.querySelector('[data-zona-vacia]');
    const zonaLlena = slot.querySelector('[data-zona-llena]');
    const nombreEl = slot.querySelector('[data-nombre-archivo]');
    const pesoEl = slot.querySelector('[data-peso-archivo]');
    const btnQuitar = slot.querySelector('[data-quitar-archivo]');
    const urlSubida = slot.dataset.subidaUrl || null;
    const estadoAnalisis = slot.querySelector('[data-estado-analisis]');
    const resultadoAnalisis = slot.querySelector('[data-resultado-analisis]');
    const errorAnalisis = slot.querySelector('[data-error-analisis]');
    if (!input) return;

    let timerPoll = null;
    const detenerPoll = () => { clearInterval(timerPoll); timerPoll = null; };

    const pesoLegible = (bytes) => {
        if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    };

    // Solo para slots con `data-subida-url` (hoy, el DXF): manda el archivo, muestra
    // "Analizando…" y hace polling de GET `${urlSubida}/${id}` hasta 'listo' o 'error'. El
    // parseo + la subida a R2 corren en segundo plano en el servidor (controller/
    // fichaConfeccionDxfController.js procesarDxfEnSegundoPlano) — este polling es la otra
    // mitad de ese mismo diseño asíncrono, no una barra de progreso de la subida en sí.
    // Vuelve las dos filas de asociación a su estado inicial (viñeta amarilla, "Buscando…")
    // — hace falta al elegir un archivo nuevo sobre uno que ya se había analizado antes, si
    // no los textos/colores de la vez anterior se quedan pegados un instante.
    const TEXTO_ASOCIACION_INICIAL = {
        material: 'Buscando el insumo por código DXF…',
        familia: 'Buscando la familia por nombre…'
    };
    const reiniciarAsociaciones = () => {
        slot.querySelectorAll('[data-asociacion]').forEach((fila) => {
            fila.querySelector('[data-marca-pendiente]')?.classList.remove('hidden');
            const marcaResuelta = fila.querySelector('[data-marca-resuelta]');
            if (marcaResuelta) marcaResuelta.className = 'hidden w-3.5 h-3.5 rounded-full items-center justify-center flex-shrink-0';
            const texto = fila.querySelector('[data-texto-asociacion]');
            if (texto) { texto.textContent = TEXTO_ASOCIACION_INICIAL[fila.dataset.asociacion] || ''; texto.className = 'text-slate-600'; }
        });
    };

    const subirYAnalizar = async (archivo) => {
        estadoAnalisis?.classList.remove('hidden');
        estadoAnalisis?.classList.add('flex');
        resultadoAnalisis?.classList.add('hidden');
        errorAnalisis?.classList.add('hidden');
        reiniciarAsociaciones();

        try {
            const formData = new FormData();
            formData.append('dxf', archivo);
            const r = await fetch(urlSubida, { method: 'POST', headers: { 'CSRF-Token': CSRF }, body: formData });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo subir el archivo.');
            estadoFicha.idArchivoDxf = d.idArchivoDxf;

            timerPoll = setInterval(async () => {
                try {
                    const rEstado = await fetch(`${urlSubida}/${d.idArchivoDxf}`);
                    const dEstado = await rEstado.json().catch(() => ({}));
                    if (!rEstado.ok || !dEstado.success) throw new Error(dEstado.mensaje || 'No se pudo consultar el análisis.');

                    if (dEstado.archivo.estado === 'procesando') return;
                    detenerPoll();
                    estadoAnalisis?.classList.add('hidden');
                    estadoAnalisis?.classList.remove('flex');

                    if (dEstado.archivo.estado === 'error') {
                        if (errorAnalisis) {
                            errorAnalisis.textContent = dEstado.archivo.errorMensaje || 'No se pudo analizar el archivo.';
                            errorAnalisis.classList.remove('hidden');
                        }
                        return;
                    }

                    // 'listo' — un campo puede quedar vacío si el heurístico no lo encontró
                    // en el DXF (ver el aviso en helpers/dxf.js); se muestra igual con un "—".
                    // `talla` es siempre una lista (helpers/dxf.js normalizarTallas: ["Talla
                    // S", "Talla M"] si el DXF venía graduado, ["Talla Única"] si no).
                    ['estiloNombre', 'material'].forEach((campo) => {
                        const el = slot.querySelector(`[data-campo-${campo}]`);
                        if (el) el.textContent = dEstado.archivo[campo] || '—';
                    });
                    const elTalla = slot.querySelector('[data-campo-talla]');
                    if (elTalla) elTalla.textContent = (dEstado.archivo.talla || []).join(', ') || '—';

                    // Asociación automática contra el catálogo (helpers/dxf.js
                    // asociarCamposDxf): viñeta amarilla → check verde si encontró, check
                    // rojo si no. Tres mensajes posibles por campo: el heurístico no
                    // detectó nada en el DXF, lo detectó pero no hay fila que coincida, o
                    // coincidió — cada uno necesita su propio texto para no confundir "no
                    // se leyó" con "no existe en el catálogo".
                    const pintarAsociacion = (tipo, encontrada, detectado, textoEncontrada, textoNoHayFila, textoNoDetectado) => {
                        const fila = slot.querySelector(`[data-asociacion="${tipo}"]`);
                        if (!fila) return;
                        const marcaPendiente = fila.querySelector('[data-marca-pendiente]');
                        const marcaResuelta = fila.querySelector('[data-marca-resuelta]');
                        const texto = fila.querySelector('[data-texto-asociacion]');
                        marcaPendiente?.classList.add('hidden');
                        marcaResuelta?.classList.remove('hidden');
                        marcaResuelta?.classList.add('flex');
                        if (encontrada) {
                            marcaResuelta.className = 'flex w-3.5 h-3.5 rounded-full items-center justify-center flex-shrink-0 bg-emerald-500';
                            if (texto) { texto.textContent = textoEncontrada; texto.className = 'text-emerald-600 font-semibold'; }
                        } else {
                            marcaResuelta.className = 'flex w-3.5 h-3.5 rounded-full items-center justify-center flex-shrink-0 bg-rose-500';
                            if (texto) { texto.textContent = detectado ? textoNoHayFila : textoNoDetectado; texto.className = 'text-rose-600 font-semibold'; }
                        }
                    };

                    const material = dEstado.archivo.materialAsociado;
                    pintarAsociacion('material', material, dEstado.archivo.material,
                        `Insumo: ${material?.nombre} (código ${material?.codigoMaterial})`,
                        `No hay ningún insumo con el código ${dEstado.archivo.material}.`,
                        'No se detectó un código de material en el DXF.');

                    const familia = dEstado.archivo.familiaAsociada;
                    pintarAsociacion('familia', familia, dEstado.archivo.estiloNombre,
                        `Familia: ${familia?.nombreFamilia}`,
                        `No hay ninguna familia llamada "${dEstado.archivo.estiloNombre}".`,
                        'No se detectó un Style Name en el DXF.');

                    // El paso 2 (tela + colores) necesita el material ya resuelto — nunca
                    // se vuelve a preguntar (mismo criterio que el Fabric del prompt de IA).
                    // La foto sale del mismo catálogo que /admin/insumos (controller/
                    // fichaConfeccionDxfController.js, helpers/insumos.js urlImagenMaterial).
                    estadoFicha.materialNombre = material?.nombre || null;
                    const elMaterialPaso2 = document.getElementById('paso2-material');
                    if (elMaterialPaso2) {
                        elMaterialPaso2.textContent = estadoFicha.materialNombre || 'No se identificó un material en el DXF — revísalo.';
                        elMaterialPaso2.classList.toggle('text-rose-600', !estadoFicha.materialNombre);
                    }
                    const elFotoPaso2 = document.getElementById('paso2-material-foto');
                    if (elFotoPaso2 && material?.imagenUrl) {
                        elFotoPaso2.innerHTML = `<img src="${material.imagenUrl}" alt="${estadoFicha.materialNombre || ''}" class="w-full h-full object-cover">`;
                    }

                    resultadoAnalisis?.classList.remove('hidden');
                    resultadoAnalisis?.classList.add('flex-col');
                } catch (e) {
                    detenerPoll();
                    estadoAnalisis?.classList.add('hidden');
                    estadoAnalisis?.classList.remove('flex');
                    if (errorAnalisis) {
                        errorAnalisis.textContent = e.message;
                        errorAnalisis.classList.remove('hidden');
                    }
                }
            }, INTERVALO_POLL_MS);
        } catch (e) {
            estadoAnalisis?.classList.add('hidden');
            estadoAnalisis?.classList.remove('flex');
            if (errorAnalisis) {
                errorAnalisis.textContent = e.message;
                errorAnalisis.classList.remove('hidden');
            }
        }
    };

    const generaIa = slot.dataset.generaIa === '1';

    input.addEventListener('change', () => {
        const archivo = input.files?.[0];
        if (!archivo) return;
        nombreEl.textContent = archivo.name;
        pesoEl.textContent = pesoLegible(archivo.size);
        zonaVacia.classList.add('hidden');
        zonaLlena.classList.remove('hidden');
        zonaLlena.classList.add('flex-col');

        // El molde no se analiza solo (no hay nada que leer de un JPG/PDF) — sube y después
        // pregunta Pattern/Colors por el modal. Ver la sección "Molde + generación con IA"
        // más abajo, que escucha este evento.
        if (generaIa) slot.dispatchEvent(new CustomEvent('archivo-molde-elegido', { detail: { archivo } }));
        else if (urlSubida) subirYAnalizar(archivo);
    });

    btnQuitar?.addEventListener('click', () => {
        detenerPoll();
        input.value = '';
        zonaLlena.classList.add('hidden');
        zonaLlena.classList.remove('flex-col');
        zonaVacia.classList.remove('hidden');
        estadoAnalisis?.classList.add('hidden');
        resultadoAnalisis?.classList.add('hidden');
        errorAnalisis?.classList.add('hidden');
        reiniciarAsociaciones();
        if (generaIa) slot.dispatchEvent(new CustomEvent('archivo-molde-quitado'));
    });
});

// ── Molde: generación de imagen con IA ──────────────────────────────────────────────────
// Sube el molde (arriba, igual que el DXF) y, apenas termina, abre el modal de Pattern/
// Colors. Al confirmar, POST a .../molde/:id/generar — responde de inmediato (202, "ya lo
// metí a la cola") y el resultado real llega después por dos caminos a la vez: el push de
// SSE (adminSSE, canal del usuario — helpers/sseManager.js, mismo mecanismo que permisos en
// vivo, CLAUDE.md §13) y, de respaldo, un polling lento por si la pestaña se perdió el
// evento (red caída un segundo, SSE reconectando). El que llegue primero gana — el otro
// encuentra el intento ya resuelto y no hace nada.
(function () {
    const slotMolde = document.querySelector('[data-slot-archivo="molde"][data-genera-ia="1"]');
    if (!slotMolde) return;

    const URL_MOLDE = slotMolde.dataset.subidaUrl; // /admin/procesos/fichas-confeccion/molde
    const estadoGeneracion = slotMolde.querySelector('[data-estado-generacion]');
    const resultadoGeneracion = slotMolde.querySelector('[data-resultado-generacion]');
    const imagenGenerada = slotMolde.querySelector('[data-imagen-generada]');
    const accionesGeneracion = slotMolde.querySelector('[data-acciones-generacion]');
    const btnRepetir = slotMolde.querySelector('[data-btn-repetir]');
    const btnAprobar = slotMolde.querySelector('[data-btn-aprobar]');
    const avisoAprobado = slotMolde.querySelector('[data-aprobado-aviso]');
    const errorGeneracion = slotMolde.querySelector('[data-error-generacion]');

    const modal = document.getElementById('modal-molde-ia');
    const inputPattern = document.getElementById('molde-ia-pattern');
    const inputColors = document.getElementById('molde-ia-colors');
    const btnGenerar = document.getElementById('btn-molde-ia-generar');

    let idMoldeActual = null;
    let idIntentoActual = null;
    let ultimoPattern = '';
    let ultimoColors = '';
    let timerPollGeneracion = null;
    let suscritoSSE = false;

    const detenerPollGeneracion = () => { clearInterval(timerPollGeneracion); timerPollGeneracion = null; };

    const abrirModal = () => { modal.classList.remove('hidden'); modal.classList.add('flex'); };
    const cerrarModal = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };

    document.getElementById('modal-molde-ia-cerrar')?.addEventListener('click', cerrarModal);
    document.getElementById('btn-molde-ia-cancelar')?.addEventListener('click', cerrarModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });

    // ── Subir el molde (igual patrón que el DXF, pero sin análisis: solo guarda el
    // archivo) y, apenas termina, abrir el modal para la primera generación. ────────────
    slotMolde.addEventListener('archivo-molde-elegido', async (e) => {
        errorGeneracion?.classList.add('hidden');
        try {
            const formData = new FormData();
            formData.append('molde', e.detail.archivo);
            const r = await fetch(URL_MOLDE, { method: 'POST', headers: { 'CSRF-Token': CSRF }, body: formData });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo subir el molde.');

            idMoldeActual = d.idMolde;
            idIntentoActual = null;
            estadoFicha.idMolde = d.idMolde;
            estadoFicha.idMoldeIaIntentoAprobado = null;
            inputPattern.value = '';
            inputColors.value = '';
            abrirModal();
        } catch (e2) {
            if (errorGeneracion) { errorGeneracion.textContent = e2.message; errorGeneracion.classList.remove('hidden'); }
        }
    });

    slotMolde.addEventListener('archivo-molde-quitado', () => {
        detenerPollGeneracion();
        idMoldeActual = null;
        idIntentoActual = null;
        estadoFicha.idMolde = null;
        estadoFicha.idMoldeIaIntentoAprobado = null;
        estadoGeneracion?.classList.add('hidden');
        resultadoGeneracion?.classList.add('hidden');
        avisoAprobado?.classList.add('hidden');
        accionesGeneracion?.classList.remove('hidden');
        errorGeneracion?.classList.add('hidden');
    });

    // ── Confirmar el modal: arranca un intento nuevo (primera vez o "Repetir") ──────────
    btnGenerar?.addEventListener('click', async () => {
        if (!idMoldeActual) return;
        const pattern = inputPattern.value.trim();
        const colors = inputColors.value.trim();

        cerrarModal();
        detenerPollGeneracion();
        estadoGeneracion?.classList.remove('hidden');
        estadoGeneracion?.classList.add('flex');
        resultadoGeneracion?.classList.add('hidden');
        avisoAprobado?.classList.add('hidden');
        errorGeneracion?.classList.add('hidden');

        try {
            const r = await fetch(`${URL_MOLDE}/${idMoldeActual}/generar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                body: JSON.stringify({ pattern, colors, idDxf: estadoFicha.idArchivoDxf })
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo iniciar la generación.');

            idIntentoActual = d.idIntento;
            ultimoPattern = pattern;
            ultimoColors = colors;
            suscribirseASSE();

            // Respaldo de SSE: una consulta lenta por si el push no llega (pestaña en
            // segundo plano, reconexión). SSE normalmente gana primero.
            timerPollGeneracion = setInterval(() => consultarIntento(idIntentoActual), 4000);
        } catch (e2) {
            estadoGeneracion?.classList.add('hidden');
            estadoGeneracion?.classList.remove('flex');
            if (errorGeneracion) { errorGeneracion.textContent = e2.message; errorGeneracion.classList.remove('hidden'); }
        }
    });

    // ── "Repetir": mismo modal, precargado con lo último usado ──────────────────────────
    btnRepetir?.addEventListener('click', () => {
        inputPattern.value = ultimoPattern;
        inputColors.value = ultimoColors;
        abrirModal();
    });

    // ── "Aprobar": copia el borrador a moldesIa/{timestamp}.png ─────────────────────────
    btnAprobar?.addEventListener('click', async () => {
        if (!idIntentoActual) return;
        btnAprobar.disabled = true;
        btnAprobar.textContent = 'Aprobando…';
        try {
            const r = await fetch(`${URL_MOLDE}/intento/${idIntentoActual}/aprobar`, {
                method: 'POST',
                headers: { 'CSRF-Token': CSRF }
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo aprobar la imagen.');

            estadoFicha.idMoldeIaIntentoAprobado = idIntentoActual;
            accionesGeneracion?.classList.add('hidden');
            avisoAprobado?.classList.remove('hidden');
        } catch (e2) {
            if (errorGeneracion) { errorGeneracion.textContent = e2.message; errorGeneracion.classList.remove('hidden'); }
        } finally {
            btnAprobar.disabled = false;
            btnAprobar.textContent = 'Aprobar';
        }
    });

    // ── Resultado: SSE push + polling de respaldo llegan acá los dos ────────────────────
    async function consultarIntento(idIntento) {
        if (idIntento !== idIntentoActual) return; // una respuesta de un intento viejo, ignorarla
        try {
            const r = await fetch(`${URL_MOLDE}/intento/${idIntento}`);
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) return;
            if (d.intento.estado === 'procesando') return;

            detenerPollGeneracion();
            estadoGeneracion?.classList.add('hidden');
            estadoGeneracion?.classList.remove('flex');

            if (d.intento.estado === 'error') {
                if (errorGeneracion) { errorGeneracion.textContent = d.intento.errorMensaje || 'No se pudo generar la imagen.'; errorGeneracion.classList.remove('hidden'); }
                return;
            }

            if (imagenGenerada) imagenGenerada.src = d.intento.previewUrl;
            resultadoGeneracion?.classList.remove('hidden');
            resultadoGeneracion?.classList.add('flex-col');
        } catch (_) {
            // Un fallo de red en una consulta de respaldo no es un error del intento — se
            // reintenta en la próxima vuelta del polling.
        }
    }

    function suscribirseASSE() {
        if (suscritoSSE) return;
        suscritoSSE = true;
        adminSSE().on('molde_ia_listo', (e) => {
            try {
                const data = JSON.parse(e.data);
                consultarIntento(data.idIntento);
            } catch (_) { /* evento mal formado, el polling de respaldo lo resuelve igual */ }
        });
    }
})();

// ── Video del proceso: Direct Creator Upload de Cloudflare Stream ──────────────────────
// A diferencia del DXF y el molde, el archivo nunca llega a este servidor — el backend solo
// entrega una URL de subida de un solo uso (POST .../video/solicitar-subida) y el navegador
// sube el archivo DIRECTO a Cloudflare con esa URL (helpers/cloudflareStream.js explica por
// qué: evitar que un video pesado consuma recursos de este backend). Hasta 3 videos, cada
// uno en su propia fila con progreso individual (pendiente → subiendo % → completado ✓ →
// error + reintentar) — y el indicador de arriba (#indicador-videos, afuera de los pasos)
// se mantiene visible aunque el usuario avance al paso 2 mientras todavía hay algo subiendo.
(function () {
    const MAX_VIDEOS = 3;
    const slotVideo = document.querySelector('[data-slot-video]');
    if (!slotVideo) return;

    const URL_VIDEO = '/admin/procesos/fichas-confeccion/video';
    const input = slotVideo.querySelector('[data-input-video]');
    const zonaVacia = slotVideo.querySelector('[data-zona-vacia-video]');
    const listaVideos = slotVideo.querySelector('[data-lista-videos]');
    const plantillaFila = document.getElementById('plantilla-fila-video');
    const indicador = document.getElementById('indicador-videos');
    const indicadorTexto = indicador?.querySelector('[data-indicador-videos-texto]');

    // clave local (no es el idVideo del servidor hasta que responde solicitar-subida) → fila
    // + estado, para poder reintentar sin pedirle el archivo de nuevo al usuario.
    const videos = new Map();

    // El envío final (POST .../finalizar) necesita los idVideo ya confirmados como
    // 'completado' — el backend los revalida igual (CLAUDE.md §12), esto es solo lo que se
    // manda a pedir.
    estadoFicha.obtenerVideosListos = () => [...videos.values()].filter((v) => v.estado === 'completado' && v.idVideo).map((v) => v.idVideo);

    const pesoLegible = (bytes) => {
        if (!bytes) return '';
        if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    };

    const actualizarZonaVacia = () => {
        const llenos = videos.size >= MAX_VIDEOS;
        zonaVacia.classList.toggle('hidden', llenos);
        input.disabled = llenos;
    };

    const actualizarIndicador = () => {
        const subiendo = [...videos.values()].filter((v) => v.estado === 'pendiente' || v.estado === 'subiendo').length;
        const conError = [...videos.values()].filter((v) => v.estado === 'error').length;
        if (!subiendo && !conError) { indicador.classList.add('hidden'); indicador.classList.remove('flex'); return; }

        indicador.classList.remove('hidden');
        indicador.classList.add('flex');
        const partes = [];
        if (subiendo) partes.push(`Subiendo ${subiendo} video${subiendo > 1 ? 's' : ''}…`);
        if (conError) partes.push(`${conError} con error`);
        if (indicadorTexto) indicadorTexto.textContent = partes.join(' · ');
    };

    const pintarFila = (v) => {
        v.nombreEl.textContent = v.nombreOriginal;
        v.spinnerEl.classList.toggle('hidden', v.estado !== 'pendiente' && v.estado !== 'subiendo');
        v.checkEl.classList.toggle('hidden', v.estado !== 'completado');
        v.checkEl.classList.toggle('flex', v.estado === 'completado');
        v.barraEl.style.width = `${v.estado === 'completado' ? 100 : v.porcentaje}%`;
        v.barraEl.classList.toggle('bg-rose-500', v.estado === 'error');
        v.barraEl.classList.toggle('bg-gh-primary', v.estado !== 'error');
        v.btnReintentar.classList.toggle('hidden', v.estado !== 'error');
        v.iconoEl.classList.toggle('text-rose-400', v.estado === 'error');
        v.iconoEl.classList.toggle('text-slate-400', v.estado !== 'error');

        if (v.estado === 'pendiente') v.textoEl.textContent = 'Pendiente…';
        else if (v.estado === 'subiendo') v.textoEl.textContent = `Subiendo… ${v.porcentaje}%`;
        else if (v.estado === 'completado') v.textoEl.textContent = 'Completado';
        else v.textoEl.textContent = v.errorMensaje || 'Error al subir el video.';
        v.textoEl.classList.toggle('text-rose-600', v.estado === 'error');
        v.textoEl.classList.toggle('font-semibold', v.estado === 'error');
        v.textoEl.classList.toggle('text-slate-500', v.estado !== 'error');

        actualizarIndicador();
    };

    const crearFila = (clave, archivo) => {
        const nodo = plantillaFila.content.firstElementChild.cloneNode(true);
        listaVideos.appendChild(nodo);
        const v = {
            clave,
            archivo,
            idVideo: null,
            nombreOriginal: archivo.name,
            modoSubida: null,
            estado: 'pendiente',
            porcentaje: 0,
            errorMensaje: null,
            filaEl: nodo,
            iconoEl: nodo.querySelector('[data-icono-fila]'),
            nombreEl: nodo.querySelector('[data-nombre-fila]'),
            spinnerEl: nodo.querySelector('[data-spinner-fila]'),
            checkEl: nodo.querySelector('[data-check-fila]'),
            barraEl: nodo.querySelector('[data-barra-fila]'),
            textoEl: nodo.querySelector('[data-texto-estado-fila]'),
            btnReintentar: nodo.querySelector('[data-btn-reintentar-fila]')
        };
        v.btnReintentar.addEventListener('click', () => reintentar(v));
        videos.set(clave, v);
        pintarFila(v);
        return v;
    };

    // Modo simulado (uploadURL === null, sin CLOUDFLARE_STREAM_API_TOKEN/
    // CLOUDFLARE_ACCOUNT_ID — helpers/cloudflareStream.js): imita el progreso con un
    // intervalo, así el flujo completo se puede probar sin la clave.
    const simularSubida = (v) => new Promise((resolve) => {
        let pct = 0;
        const t = setInterval(() => {
            pct = Math.min(100, pct + 10 + Math.random() * 15);
            v.porcentaje = Math.round(pct);
            pintarFila(v);
            if (pct >= 100) { clearInterval(t); resolve(); }
        }, 180);
    });

    // POST simple de un solo request — Cloudflare le pone un tope DURO de 200MB (confirmado
    // en sesión: un archivo más grande vuelve un 4xx acá). El backend ya decide por
    // adelantado si el archivo entra en este método o necesita TUS (controller/
    // fichaConfeccionVideoController.js crearSesionSubida), así que si esto se llama es
    // porque el archivo mide menos de ese tope.
    const subirArchivoDirectoSimple = (v, uploadURL) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadURL);
        xhr.upload.addEventListener('progress', (e) => {
            if (!e.lengthComputable) return;
            v.porcentaje = Math.round((e.loaded / e.total) * 100);
            pintarFila(v);
        });
        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) return resolve();
            reject(new Error(`Cloudflare rechazó la subida (HTTP ${xhr.status})${detalleError(xhr)}`));
        });
        xhr.addEventListener('error', () => reject(new Error('Se perdió la conexión subiendo el video (red o CORS).')));

        const formData = new FormData();
        formData.append('file', v.archivo);
        xhr.send(formData);
    });

    // TUS (resumable, por partes) — para un archivo que pasó los ~200MB del método simple.
    // La sesión ya se creó en el backend (crearSubidaTus); acá solo se manda el archivo en
    // pedazos con PATCH directo a `uploadURL`, respetando el offset que Cloudflare confirma
    // en cada respuesta (protocolo TUS 1.0.0). Los bytes tampoco pasan por este backend.
    const TAMANO_PARTE_TUS = 50 * 1024 * 1024;
    const subirArchivoDirectoTus = (v, uploadURL) => new Promise((resolve, reject) => {
        const total = v.archivo.size;

        const enviarParte = (offset) => {
            const parte = v.archivo.slice(offset, Math.min(offset + TAMANO_PARTE_TUS, total));
            const xhr = new XMLHttpRequest();
            xhr.open('PATCH', uploadURL);
            xhr.setRequestHeader('Tus-Resumable', '1.0.0');
            xhr.setRequestHeader('Upload-Offset', String(offset));
            xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
            xhr.upload.addEventListener('progress', (e) => {
                if (!e.lengthComputable) return;
                v.porcentaje = Math.round(((offset + e.loaded) / total) * 100);
                pintarFila(v);
            });
            xhr.addEventListener('load', () => {
                console.debug('[video-tus]', v.idVideo, `parte [${offset},${offset + parte.size}) → HTTP ${xhr.status}, Upload-Offset recibido:`, xhr.getResponseHeader('Upload-Offset'));
                if (xhr.status < 200 || xhr.status >= 300) {
                    return reject(new Error(`Cloudflare rechazó una parte de la subida (HTTP ${xhr.status})${detalleError(xhr)}`));
                }
                const nuevoOffset = Number(xhr.getResponseHeader('Upload-Offset'));
                const siguiente = Number.isFinite(nuevoOffset) ? nuevoOffset : offset + parte.size;
                if (siguiente >= total) { v.porcentaje = 100; pintarFila(v); console.debug('[video-tus]', v.idVideo, 'todas las partes enviadas, resolviendo.'); return resolve(); }
                enviarParte(siguiente);
            });
            xhr.addEventListener('error', (ev) => { console.error('[video-tus]', v.idVideo, `parte [${offset},...) tiró error de red/CORS:`, ev); reject(new Error('Se perdió la conexión subiendo el video (red o CORS).')); });
            xhr.send(parte);
        };

        enviarParte(0);
    });

    // Cloudflare devuelve el motivo real del rechazo en el cuerpo (JSON `errors[].message`,
    // o texto plano) — mostrarlo tal cual en vez de un genérico es lo que de verdad ayuda a
    // diagnosticar (tamaño, formato, URL vencida...).
    const detalleError = (xhr) => {
        let detalle = '';
        try {
            const cuerpo = JSON.parse(xhr.responseText);
            detalle = cuerpo?.errors?.[0]?.message || cuerpo?.messages?.[0]?.message || '';
        } catch (_) {
            detalle = (xhr.responseText || '').slice(0, 200);
        }
        return detalle ? `: ${detalle}` : '.';
    };

    const subirArchivoDirecto = (v, uploadURL) => {
        if (!uploadURL) return simularSubida(v);
        return v.modoSubida === 'tus' ? subirArchivoDirectoTus(v, uploadURL) : subirArchivoDirectoSimple(v, uploadURL);
    };

    // Transcodeando puede tardar más que la subida misma — se consulta cada pocos segundos
    // hasta 'ready'/'error' en vez de darlo por completado apenas terminan los bytes.
    const esperarListo = async (v) => {
        console.debug('[video]', v.idVideo, 'esperando a que Cloudflare termine de procesar…');
        let vuelta = 0;
        for (;;) {
            vuelta += 1;
            const r = await fetch(`${URL_VIDEO}/${v.idVideo}`).catch((err) => { console.debug('[video]', v.idVideo, 'consulta de estado falló (red), reintenta:', err); return null; });
            if (r) {
                const d = await r.json().catch(() => ({}));
                if (r.ok && d.success) {
                    if (vuelta % 5 === 1) console.debug('[video]', v.idVideo, 'vuelta', vuelta, 'estado actual:', d.video.estado);
                    if (d.video.estado === 'ready') return;
                    if (d.video.estado === 'error') throw new Error(d.video.errorMensaje || 'Cloudflare no pudo procesar el video.');
                } else {
                    console.debug('[video]', v.idVideo, 'consulta de estado respondió sin éxito:', r.status, d);
                }
            }
            // Una consulta fallida (red cortada un instante) no es un error del video — se
            // reintenta en la próxima vuelta en vez de tirar la fila a error por eso.
            await new Promise((res) => setTimeout(res, 3000));
        }
    };

    const procesarVideo = async (v) => {
        try {
            v.estado = 'pendiente';
            pintarFila(v);

            const r = await fetch(`${URL_VIDEO}/solicitar-subida`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                body: JSON.stringify({ orden: [...videos.values()].indexOf(v) + 1, nombreOriginal: v.archivo.name, pesoBytes: v.archivo.size })
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo iniciar la subida.');
            v.idVideo = d.idVideo;
            v.modoSubida = d.modo;

            v.estado = 'subiendo';
            pintarFila(v);
            console.debug('[video]', v.idVideo, 'subida directa iniciada, modo', v.modoSubida);
            await subirArchivoDirecto(v, d.uploadURL);
            console.debug('[video]', v.idVideo, 'subida directa resuelta, confirmando con el backend…');

            const rConfirmar = await fetch(`${URL_VIDEO}/${v.idVideo}/confirmar`, { method: 'POST', headers: { 'CSRF-Token': CSRF } });
            const dConfirmar = await rConfirmar.json().catch(() => ({}));
            if (!rConfirmar.ok || !dConfirmar.success) throw new Error(dConfirmar.mensaje || 'No se pudo confirmar la subida.');
            console.debug('[video]', v.idVideo, 'confirmar respondió estado =', dConfirmar.estado);

            if (dConfirmar.estado === 'error') throw new Error(dConfirmar.errorMensaje || 'Cloudflare no pudo procesar el video.');
            if (dConfirmar.estado !== 'ready') await esperarListo(v);

            v.estado = 'completado';
            v.porcentaje = 100;
            pintarFila(v);
        } catch (e) {
            console.error('[video]', v.idVideo, 'procesarVideo falló:', e);
            v.estado = 'error';
            v.errorMensaje = e.message;
            pintarFila(v);
            // Si la subida directa falló del lado del navegador, Cloudflare puede no tener
            // nada que reportar todavía — se avisa al backend para que el estado no se quede
            // en 'uploading' para siempre.
            if (v.idVideo) {
                fetch(`${URL_VIDEO}/${v.idVideo}/marcar-error`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                    body: JSON.stringify({ mensaje: e.message })
                }).catch(() => {});
            }
        } finally {
            actualizarZonaVacia();
        }
    };

    const reintentar = async (v) => {
        v.estado = 'pendiente';
        v.errorMensaje = null;
        v.porcentaje = 0;
        pintarFila(v);
        try {
            const r = await fetch(`${URL_VIDEO}/${v.idVideo}/reintentar`, { method: 'POST', headers: { 'CSRF-Token': CSRF } });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo reintentar.');
            v.modoSubida = d.modo;

            v.estado = 'subiendo';
            pintarFila(v);
            await subirArchivoDirecto(v, d.uploadURL);

            const rConfirmar = await fetch(`${URL_VIDEO}/${v.idVideo}/confirmar`, { method: 'POST', headers: { 'CSRF-Token': CSRF } });
            const dConfirmar = await rConfirmar.json().catch(() => ({}));
            if (!rConfirmar.ok || !dConfirmar.success) throw new Error(dConfirmar.mensaje || 'No se pudo confirmar la subida.');
            if (dConfirmar.estado === 'error') throw new Error(dConfirmar.errorMensaje || 'Cloudflare no pudo procesar el video.');
            if (dConfirmar.estado !== 'ready') await esperarListo(v);

            v.estado = 'completado';
            v.porcentaje = 100;
            pintarFila(v);
        } catch (e) {
            v.estado = 'error';
            v.errorMensaje = e.message;
            pintarFila(v);
        }
    };

    input?.addEventListener('change', () => {
        const disponibles = MAX_VIDEOS - videos.size;
        const archivos = Array.from(input.files || []).slice(0, Math.max(0, disponibles));
        input.value = '';
        archivos.forEach((archivo) => {
            const clave = `${Date.now()}-${Math.random()}`;
            const v = crearFila(clave, archivo);
            procesarVideo(v);
        });
        actualizarZonaVacia();
    });
})();

// ── Paso 2: tela (auto-cargada, ver más arriba) + colores y cantidades ─────────────────
// "mayatext verde 200, mayatext azul 140": una fila por color con una cantidad — se
// agregan y quitan libremente, sin tope. El color se elige en #modal-elegir-color (pastilla
// con su círculo de color, buscador arriba) en vez de un <select> plano — mismo lenguaje
// visual que #modalColores en views/administrador/inventarios/forms/product.pug, adaptado a
// una sola elección por fila en vez de multi-selección por talla.
(function () {
    const lista = document.querySelector('[data-lista-colores]');
    const plantilla = document.getElementById('plantilla-fila-color');
    const btnAgregar = document.getElementById('btn-agregar-color');
    const errorColores = document.querySelector('[data-error-colores]');
    const modal = document.getElementById('modal-elegir-color');
    const buscador = document.getElementById('buscador-color-ficha');
    const grid = document.getElementById('grid-colores-ficha');
    const btnCerrarModalColor = document.getElementById('cerrar-modal-color');
    if (!lista || !plantilla || !btnAgregar) return;

    let filaActual = null; // qué fila está esperando la elección del modal

    const cerrarModalColor = () => {
        modal?.classList.add('hidden');
        modal?.classList.remove('flex');
        filaActual = null;
        if (buscador) buscador.value = '';
        grid?.querySelectorAll('[data-opcion-color]').forEach((b) => { b.style.display = ''; });
    };

    const abrirModalColor = (fila) => {
        filaActual = fila;
        modal?.classList.remove('hidden');
        modal?.classList.add('flex');
        buscador?.focus();
    };

    btnCerrarModalColor?.addEventListener('click', cerrarModalColor);
    modal?.addEventListener('click', (e) => { if (e.target === modal) cerrarModalColor(); });

    buscador?.addEventListener('input', (e) => {
        const termino = e.target.value.toLowerCase().trim();
        grid?.querySelectorAll('[data-opcion-color]').forEach((b) => {
            const coincide = (b.dataset.nombre || '').toLowerCase().includes(termino);
            b.style.display = coincide ? '' : 'none';
        });
    });

    grid?.addEventListener('click', (e) => {
        const opcion = e.target.closest('[data-opcion-color]');
        if (!opcion || !filaActual) return;

        const swatch = filaActual.querySelector('[data-color-swatch]');
        const nombreEl = filaActual.querySelector('[data-color-nombre]');
        const inputId = filaActual.querySelector('[data-color-id]');
        if (inputId) inputId.value = opcion.dataset.id;
        if (nombreEl) { nombreEl.textContent = opcion.dataset.nombre; nombreEl.classList.remove('text-slate-400'); nombreEl.classList.add('text-slate-800', 'font-semibold'); }
        if (swatch) {
            swatch.style.backgroundColor = opcion.querySelector('span')?.style.backgroundColor || '#ccc';
            swatch.classList.remove('hidden');
        }
        errorColores?.classList.add('hidden');
        cerrarModalColor();
    });

    const agregarFila = () => {
        const nodo = plantilla.content.firstElementChild.cloneNode(true);
        lista.appendChild(nodo);
        nodo.querySelector('[data-abrir-color]')?.addEventListener('click', () => abrirModalColor(nodo));
        nodo.querySelector('[data-quitar-color]')?.addEventListener('click', () => nodo.remove());
        errorColores?.classList.add('hidden');
    };

    btnAgregar.addEventListener('click', agregarFila);
    agregarFila(); // arranca con una fila lista para no obligar a tocar "Agregar color".

    // Lee las filas con color Y cantidad > 0 elegidos — una fila vacía (recién agregada, sin
    // tocar) simplemente no cuenta, no es un error.
    estadoFicha.obtenerColores = () => [...lista.querySelectorAll('[data-fila-color]')]
        .map((fila) => ({
            idAtributoColor: parseInt(fila.querySelector('[data-color-id]')?.value, 10),
            cantidad: parseInt(fila.querySelector('[data-color-cantidad]')?.value, 10)
        }))
        .filter((f) => Number.isInteger(f.idAtributoColor) && f.idAtributoColor > 0 && Number.isInteger(f.cantidad) && f.cantidad > 0);

    estadoFicha.validarColores = () => {
        const validas = estadoFicha.obtenerColores();
        const ok = validas.length > 0;
        errorColores?.classList.toggle('hidden', ok);
        if (errorColores) errorColores.textContent = 'Agrega al menos un color con su cantidad.';
        return ok;
    };
})();

// ── Paso 3 → envío final: junta todo en POST .../finalizar ─────────────────────────────
(function () {
    const inputComplementos = document.getElementById('ficha-complementos');
    const inputObservaciones = document.getElementById('ficha-observaciones');
    const inputPrecio = document.getElementById('ficha-precio');
    const errorFinalizar = document.querySelector('[data-error-finalizar]');
    const modalListo = document.getElementById('modal-ficha-lista');
    const modalListoTexto = modalListo?.querySelector('[data-ficha-lista-texto]');
    const modalListoPdf = modalListo?.querySelector('[data-ficha-lista-pdf]');
    if (!inputPrecio) return;

    window.initMoneyInput?.(inputPrecio);

    estadoFicha.validarPrecio = () => {
        const valor = window.parseMoney ? window.parseMoney(inputPrecio.value) : parseInt(inputPrecio.value.replace(/\D/g, ''), 10) || 0;
        const ok = valor > 0;
        errorFinalizar?.classList.toggle('hidden', ok);
        if (errorFinalizar) errorFinalizar.textContent = 'El precio de confección debe ser mayor a $0.';
        return ok;
    };

    estadoFicha.enviarFichaFinal = async (btnContinuar) => {
        if (!estadoFicha.idArchivoDxf) {
            if (errorFinalizar) { errorFinalizar.textContent = 'Falta el DXF del paso 1.'; errorFinalizar.classList.remove('hidden'); }
            return false;
        }
        if (!estadoFicha.validarColores() || !estadoFicha.validarPrecio()) return false;

        const precio = window.parseMoney ? window.parseMoney(inputPrecio.value) : 0;
        const textoOriginal = btnContinuar.textContent;
        btnContinuar.disabled = true;
        btnContinuar.textContent = 'Guardando…';
        errorFinalizar?.classList.add('hidden');

        try {
            const r = await fetch('/admin/procesos/fichas-confeccion/finalizar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                body: JSON.stringify({
                    idDxf: estadoFicha.idArchivoDxf,
                    idMolde: estadoFicha.idMolde,
                    idMoldeIaIntento: estadoFicha.idMoldeIaIntentoAprobado,
                    colores: estadoFicha.obtenerColores(),
                    idsVideos: estadoFicha.obtenerVideosListos(),
                    complementos: inputComplementos?.value || '',
                    observaciones: inputObservaciones?.value || '',
                    precioConfeccion: precio
                })
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo guardar la ficha.');

            if (modalListoTexto) {
                modalListoTexto.textContent = d.pdfUrl
                    ? 'Ya quedó en la Biblioteca de fichas de confección.'
                    : (d.avisoPdf || 'Ya quedó en la Biblioteca — el PDF se genera al abrirla.');
            }
            if (modalListoPdf) {
                if (d.pdfUrl) { modalListoPdf.href = d.pdfUrl; modalListoPdf.classList.remove('hidden'); }
                else modalListoPdf.classList.add('hidden');
            }
            modalListo?.classList.remove('hidden');
            modalListo?.classList.add('flex');
            return true;
        } catch (e) {
            if (errorFinalizar) { errorFinalizar.textContent = e.message; errorFinalizar.classList.remove('hidden'); }
            return false;
        } finally {
            btnContinuar.disabled = false;
            btnContinuar.textContent = textoOriginal;
        }
    };
})();

const SALIDA_MS = 200;
const contenedor = document.getElementById('asistente-ficha');

if (contenedor) {
    const pasos = Array.from(contenedor.querySelectorAll('[data-paso]'));
    const indicadores = Array.from(document.querySelectorAll('[data-indicador-paso]'));
    const btnAtras = document.getElementById('btn-paso-atras');
    const btnContinuar = document.getElementById('btn-paso-continuar');

    let actual = 0;
    let enTransicion = false;
    const movimientoReducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const pintarIndicadores = () => {
        indicadores.forEach((boton, i) => {
            const circulo = boton.querySelector('.gh-paso-ind-circulo');
            boton.disabled = i >= actual;
            boton.className = `gh-paso-ind flex items-center gap-2 text-xs font-bold transition-colors ${i === actual ? 'text-slate-800' : i < actual ? 'text-slate-500 cursor-pointer hover:text-slate-800' : 'text-slate-400'}`;
            if (circulo) circulo.className = `gh-paso-ind-circulo w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${i === actual ? 'bg-gh-primary text-white' : i < actual ? 'bg-gh-primarySoft text-gh-primaryHover' : 'bg-slate-100 text-slate-400'}`;
        });
    };

    const pintarNav = () => {
        btnAtras.disabled = actual === 0;
        btnContinuar.textContent = actual === pasos.length - 1 ? 'Guardar ficha' : 'Continuar';
    };

    const mostrarPaso = (i) => {
        pasos.forEach((paso, idx) => paso.classList.toggle('hidden', idx !== i));
    };

    const irA = (destino, dir) => {
        if (enTransicion || destino === actual || destino < 0 || destino >= pasos.length) return;

        if (movimientoReducido()) {
            actual = destino;
            mostrarPaso(actual);
            pintarIndicadores();
            pintarNav();
            return;
        }

        enTransicion = true;
        const elQueSale = pasos[actual];
        elQueSale.style.setProperty('--gh-paso-salida', `${-dir * 50}px`);
        elQueSale.classList.remove('gh-paso-entra');
        elQueSale.classList.add('gh-paso-sale');

        setTimeout(() => {
            elQueSale.classList.remove('gh-paso-sale');
            actual = destino;
            mostrarPaso(actual);

            const elQueEntra = pasos[actual];
            elQueEntra.style.setProperty('--gh-paso-entrada', `${dir * 50}px`);
            elQueEntra.classList.remove('gh-paso-entra');
            void elQueEntra.offsetWidth; // reflow: sin esto el navegador no repite la animación
            elQueEntra.classList.add('gh-paso-entra');

            // El destello solo al avanzar, igual que en Piezas.tsx (`if (dir === 1) setDestello(...)`).
            if (dir === 1) {
                const destello = document.createElement('div');
                destello.className = 'gh-paso-destello';
                elQueEntra.appendChild(destello);
                destello.addEventListener('animationend', () => destello.remove());
            }

            pintarIndicadores();
            pintarNav();
            enTransicion = false;
        }, SALIDA_MS);
    };

    btnAtras?.addEventListener('click', () => irA(actual - 1, -1));
    btnContinuar?.addEventListener('click', async () => {
        if (actual === pasos.length - 1) {
            await estadoFicha.enviarFichaFinal?.(btnContinuar);
            return;
        }
        // Salir del paso 2 (colores) sin al menos uno cargado no tiene nada que guardar
        // después — se valida acá, no al final, para no dejar al usuario llegar hasta
        // "Guardar ficha" y recién ahí enterarse.
        if (actual === 1 && estadoFicha.validarColores && !estadoFicha.validarColores()) return;
        irA(actual + 1, 1);
    });
    indicadores.forEach((boton, i) => boton.addEventListener('click', () => irA(i, -1)));

    pintarIndicadores();
    pintarNav();
}
