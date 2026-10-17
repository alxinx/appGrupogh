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
// Solo el paso 1 está completo hoy — el resto de los campos de la ficha (insumos, procesos,
// tallas...) todavía no está definido, así que "Continuar" en el último paso no guarda
// nada: no hay ni endpoint ni tabla todavía. De los tres archivos, solo el DXF sube de
// verdad (el molde y el video quedan de vista previa local, sin `data-subida-url`).

const CSRF = document.getElementById('asistente-ficha')?.dataset.csrf;
const INTERVALO_POLL_MS = 1500;

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

    input.addEventListener('change', () => {
        const archivo = input.files?.[0];
        if (!archivo) return;
        nombreEl.textContent = archivo.name;
        pesoEl.textContent = pesoLegible(archivo.size);
        zonaVacia.classList.add('hidden');
        zonaLlena.classList.remove('hidden');
        zonaLlena.classList.add('flex-col');

        if (urlSubida) subirYAnalizar(archivo);
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
    });
});

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
    btnContinuar?.addEventListener('click', () => {
        if (actual === pasos.length - 1) {
            Swal.fire({
                icon: 'info',
                title: 'Todavía no se puede guardar',
                text: 'Faltan definir los demás campos de la ficha (insumos, procesos, tallas...).',
                confirmButtonColor: '#E24C95'
            });
            return;
        }
        irA(actual + 1, 1);
    });
    indicadores.forEach((boton, i) => boton.addEventListener('click', () => irA(i, -1)));

    pintarIndicadores();
    pintarNav();
}
