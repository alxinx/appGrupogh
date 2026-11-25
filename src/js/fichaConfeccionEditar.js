import { crearModalElegirInsumo } from './modalElegirInsumo.js';
import { duracionVideo } from './duracionVideo.js';
import { subirArchivoMolde, iniciarGeneracionIa, consultarIntentoIa, aprobarIntentoIa } from './moldeIaCliente.js';
import { subirVideoProceso } from './subidaVideo.js';
import { opcionesConfirmacion, cabeceraConfirmacion } from './modalConfirmacion.js';
import { escaparHtml as esc } from './escaparHtml.js';

// Editor de una ficha de confección ya creada (admin/procesos/fichas-confeccion/:idFicha,
// "Abrir" desde la Biblioteca). La ficha describe la prenda: acá se ajustan los textos, el
// precio, los insumos (reemplazar y cantidad POR PRENDA, sin agregar ni quitar), las
// imágenes (foto de referencia e IA, una de cada) y los videos. Los talleres no se asignan
// acá: se asignan al iniciar el proceso.
(function () {
    const raiz = document.getElementById('asistente-ficha-editar');
    if (!raiz) return;

    const idFicha = raiz.dataset.idFicha;
    const idMolde = raiz.dataset.idMolde || null;   // solo si el molde es JPG (la IA parte de él)
    const idDxf = raiz.dataset.idDxf || null;
    const insumosIniciales = JSON.parse(raiz.dataset.insumosIniciales || '[]');
    const URL_FICHA = `/admin/procesos/fichas-confeccion/${idFicha}`;

    // Estado compartido: cada bloque expone lo suyo y el guardado del final lo junta.
    const estado = { obtenerInsumos: () => [] };

    const mostrarError = (el, mensaje) => { if (el) { el.textContent = mensaje; el.classList.remove('hidden'); } };

    // ── Modales simples (imagen en grande, video) ─────────────────────────────────────────
    // Se cierran con la X, con un clic en el fondo o con Escape.
    const abrirModal = (modal) => { modal?.classList.remove('hidden'); modal?.classList.add('flex'); };
    const cerrarModal = (modal) => {
        modal?.classList.add('hidden'); modal?.classList.remove('flex');
        modal?.dispatchEvent(new Event('cerrado'));
    };
    document.querySelectorAll('#modal-ampliar-imagen, #modal-ver-video').forEach((modal) => {
        modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-cerrar-modal]')) cerrarModal(modal); });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('#modal-ampliar-imagen.flex, #modal-ver-video.flex').forEach(cerrarModal);
    });

    // ── Insumos ──────────────────────────────────────────────────────────────────────────
    // Una fila por insumo que la ficha ya tiene. "Reemplazar" abre el catálogo y cambia el
    // insumo de ESA línea; la cantidad es por prenda. No hay agregar ni quitar: el servidor
    // también lo rechaza (actualizarFichaConfeccion).
    (function () {
        const lista = document.querySelector('[data-lista-insumos-editar]');
        const plantilla = document.getElementById('plantilla-fila-insumo-editar');
        if (!lista || !plantilla) return;

        const catalogo = crearModalElegirInsumo('modal-elegir-insumo-editar', (insumo, fila) => {
            if (fila) pintarInsumo(fila, insumo);
        });
        const abrirCatalogo = (fila) => catalogo.abrir(fila);

        function pintarInsumo(fila, insumo) {
            fila.querySelector('[data-insumo-id]').value = insumo.idMaterial;
            const nombre = fila.querySelector('[data-insumo-nombre]');
            nombre.textContent = insumo.nombre;
            nombre.title = insumo.nombre;   // en la columna angosta el nombre se corta
            const foto = fila.querySelector('[data-insumo-foto]');
            if (foto) {
                foto.innerHTML = insumo.imagen
                    ? `<img src="${esc(insumo.imagen)}" alt="" class="w-full h-full object-cover">`
                    : '<i class="fi fi-rr-box text-xs"></i>';
            }
        }

        insumosIniciales.forEach((ins) => {
            const fila = plantilla.content.firstElementChild.cloneNode(true);
            lista.appendChild(fila);
            fila.querySelector('[data-insumo-detalle]').value = ins.idDetalle;
            fila.querySelector('[data-insumo-cantidad]').value = ins.cantidad;
            fila.querySelector('[data-abrir-insumo]').addEventListener('click', () => abrirCatalogo(fila));
            pintarInsumo(fila, { idMaterial: ins.idMaterial, nombre: ins.nombre });
        });

        // El campo "Insumos" de Información general despliega el panel con las líneas.
        const btnInsumos = document.getElementById('btn-insumos-editar');
        const panel = document.getElementById('panel-insumos-editar');
        const chevron = btnInsumos?.querySelector('[data-chevron-insumos]');
        const desplegar = (abierto) => {
            panel?.classList.toggle('hidden', !abierto);
            panel?.classList.toggle('flex', abierto);
            chevron?.classList.toggle('rotate-180', abierto);
            btnInsumos?.setAttribute('aria-expanded', String(abierto));
        };
        btnInsumos?.addEventListener('click', () => desplegar(panel?.classList.contains('hidden')));

        const errorInsumos = document.querySelector('[data-error-insumos-editar]');
        estado.obtenerInsumos = () => [...lista.querySelectorAll('[data-fila-insumo]')].map((fila) => ({
            idDetalle: parseInt(fila.querySelector('[data-insumo-detalle]').value, 10),
            idMaterial: fila.querySelector('[data-insumo-id]').value,
            nombre: fila.querySelector('[data-insumo-nombre]').textContent,
            cantidad: parseInt(fila.querySelector('[data-insumo-cantidad]').value, 10)
        }));
        estado.validarInsumos = () => {
            const ok = estado.obtenerInsumos().every((i) => Number.isInteger(i.cantidad) && i.cantidad > 0);
            errorInsumos?.classList.toggle('hidden', ok);
            if (!ok) {
                desplegar(true);   // el error vive dentro del panel: que se vea
                mostrarError(errorInsumos, 'Cada insumo necesita una cantidad por prenda mayor a 0.');
            }
            return ok;
        };
    })();

    // ── Referencias visuales ─────────────────────────────────────────────────────────────
    // Ficha por terminar: familia y molde (views/.../fichaConfeccionEditar.pug,
    // #ficha-por-terminar). Cada uno se guarda solo y la página se recarga: con los dos, la
    // ficha pasa a activa en el servidor.
    (function () {
        const tarjeta = document.getElementById('ficha-por-terminar');
        if (!tarjeta) return;
        const errorEl = document.getElementById('error-por-terminar');
        const guardar = async (ruta, cuerpo) => {
            const r = await fetch(`${URL_FICHA}/${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo guardar.');
            window.location.reload();
        };
        const fallar = (boton, e) => { mostrarError(errorEl, e.message); if (boton) boton.disabled = false; };

        const btnFamilia = document.getElementById('btn-familia-ficha');
        btnFamilia?.addEventListener('click', async () => {
            const nombre = document.getElementById('input-familia-ficha').value.trim();
            if (!nombre) return fallar(null, new Error('Escribe el nombre de la familia.'));
            btnFamilia.disabled = true;
            try { await guardar('familia', { nombre }); } catch (e) { fallar(btnFamilia, e); }
        });

        const inputMolde = document.getElementById('input-molde-ficha');
        const btnMolde = document.getElementById('btn-molde-ficha');
        btnMolde?.addEventListener('click', () => inputMolde.click());
        inputMolde?.addEventListener('change', async () => {
            const archivo = inputMolde.files?.[0];
            inputMolde.value = '';
            if (!archivo) return;
            btnMolde.disabled = true;
            try {
                const d = await subirArchivoMolde(archivo, 'No se pudo subir el molde.');
                await guardar('imagenes', { tipo: 'molde', idMolde: d.idMolde });
            } catch (e) { fallar(btnMolde, e); }
        });
    })();

    // Clic en una imagen → en grande. "Foto de referencia" sube una imagen y la asigna;
    // "Generar con IA" parte del molde JPG de la ficha y, al aprobarla, la asigna. En los
    // dos casos la nueva reemplaza a la anterior y la página se recarga con el PDF ya
    // regenerado (asignarImagenFicha).
    (function () {
        const errorEl = document.querySelector('[data-error-imagenes]');
        const modalAmpliar = document.getElementById('modal-ampliar-imagen');
        const imgAmpliada = document.getElementById('modal-ampliar-img');
        const tituloAmpliado = document.getElementById('modal-ampliar-titulo');

        document.querySelectorAll('[data-ampliar-imagen]').forEach((boton) => boton.addEventListener('click', () => {
            imgAmpliada.src = boton.dataset.src;
            imgAmpliada.alt = boton.dataset.titulo;
            tituloAmpliado.textContent = boton.dataset.titulo;
            abrirModal(modalAmpliar);
        }));

        const asignar = async (cuerpo) => {
            const r = await fetch(`${URL_FICHA}/imagenes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cuerpo)
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo guardar la imagen.');
            window.location.reload();
        };

        // Foto de referencia: se sube por el mismo endpoint del molde (JPG o WebP, valida el
        // contenido real) y después se asigna a la ficha.
        const inputReferencia = document.getElementById('input-referencia-editar');
        const btnReferencia = document.getElementById('btn-referencia-editar');
        btnReferencia?.addEventListener('click', () => inputReferencia?.click());
        inputReferencia?.addEventListener('change', async () => {
            const archivo = inputReferencia.files?.[0];
            inputReferencia.value = '';
            if (!archivo) return;
            errorEl?.classList.add('hidden');
            btnReferencia.disabled = true;
            try {
                const d = await subirArchivoMolde(archivo, 'No se pudo subir la foto.');
                await asignar({ tipo: 'referencia', idMolde: d.idMolde });
            } catch (e) {
                mostrarError(errorEl, e.message);
                btnReferencia.disabled = false;
            }
        });

        // Generación con IA: mismo endpoint y mismo modal (patrón y colores) que el asistente.
        const btnIa = document.getElementById('btn-ia-editar');
        const modalIa = document.getElementById('modal-molde-ia');
        const inputPattern = document.getElementById('molde-ia-pattern');
        const inputColors = document.getElementById('molde-ia-colors');
        const btnGenerar = document.getElementById('btn-molde-ia-generar');
        const estadoIa = document.querySelector('[data-ia-estado]');
        const resultadoIa = document.querySelector('[data-ia-resultado]');
        const imagenIa = document.querySelector('[data-ia-imagen]');
        const btnRepetir = document.querySelector('[data-ia-repetir]');
        const btnAprobar = document.querySelector('[data-ia-aprobar]');
        if (!btnIa || !idMolde || !modalIa) return;

        let idIntento = null;
        let consulta = null;
        const verEstado = (generando) => {
            estadoIa.classList.toggle('hidden', !generando);
            estadoIa.classList.toggle('flex', generando);
        };
        const abrirIa = () => { modalIa.classList.remove('hidden'); modalIa.classList.add('flex'); };
        const cerrarIa = () => { modalIa.classList.add('hidden'); modalIa.classList.remove('flex'); };
        document.getElementById('modal-molde-ia-cerrar')?.addEventListener('click', cerrarIa);
        document.getElementById('btn-molde-ia-cancelar')?.addEventListener('click', cerrarIa);
        modalIa.addEventListener('click', (e) => { if (e.target === modalIa) cerrarIa(); });
        btnIa.addEventListener('click', abrirIa);
        btnRepetir?.addEventListener('click', abrirIa);

        // El servidor cierra solo un intento que quedó colgado (helpers/moldeIa.js), así que
        // esta consulta siempre termina en 'listo' o 'error'.
        const consultar = async () => {
            const intento = await consultarIntentoIa(idIntento);
            if (!intento || intento.estado === 'procesando') return;
            clearInterval(consulta);
            verEstado(false);
            if (intento.estado === 'error') {
                mostrarError(errorEl, intento.errorMensaje || 'No se pudo generar la imagen.');
                return;
            }
            imagenIa.src = intento.previewUrl;
            resultadoIa.classList.remove('hidden');
            resultadoIa.classList.add('flex');
        };

        btnGenerar?.addEventListener('click', async () => {
            cerrarIa();
            errorEl?.classList.add('hidden');
            resultadoIa.classList.add('hidden');
            resultadoIa.classList.remove('flex');
            verEstado(true);
            try {
                const d = await iniciarGeneracionIa(idMolde, { pattern: inputPattern.value.trim(), colors: inputColors.value.trim(), idDxf });
                idIntento = d.idIntento;
                clearInterval(consulta);
                consulta = setInterval(consultar, 4000);
            } catch (e) {
                verEstado(false);
                mostrarError(errorEl, e.message);
            }
        });

        btnAprobar?.addEventListener('click', async () => {
            if (!idIntento) return;
            btnAprobar.disabled = true;
            try {
                await aprobarIntentoIa(idIntento);
                await asignar({ tipo: 'ia', idIntento });
            } catch (e) {
                mostrarError(errorEl, e.message);
                btnAprobar.disabled = false;
            }
        });
    })();

    // ── Videos del proceso ───────────────────────────────────────────────────────────────
    // Mismo pipeline de Cloudflare Stream que el asistente (controller/
    // fichaConfeccionVideoController.js): pide una URL de subida directa, el navegador sube
    // el archivo DIRECTO a Cloudflare, confirma, y recién ahí se asocia a ESTA ficha. "Ver"
    // abre el reproductor en un modal; "Borrar" lo quita de la ficha y de Cloudflare.
    (function () {
        const input = document.getElementById('input-video-editar');
        const zona = document.getElementById('zona-agregar-video-editar');
        const lista = document.querySelector('[data-lista-videos-editar]');
        const progreso = document.querySelector('[data-progreso-video-editar]');
        const textoProgreso = document.querySelector('[data-texto-progreso-video-editar]');
        const errorVideo = document.querySelector('[data-error-video-editar]');
        const contador = document.getElementById('contador-videos-editar');
        if (!input || !lista) return;

        const total = lista.querySelectorAll('[data-fila-video]').length;
        if (contador) contador.textContent = total === 1 ? '1 archivo' : `${total} archivos`;
        zona?.classList.toggle('hidden', total >= 3);

        // Plegar / desplegar la tarjeta.
        const btnPlegar = document.getElementById('btn-plegar-videos');
        const cuerpo = document.getElementById('cuerpo-videos-editar');
        btnPlegar?.addEventListener('click', () => {
            const abierto = cuerpo.classList.toggle('hidden') === false;
            btnPlegar.setAttribute('aria-expanded', String(abierto));
            btnPlegar.querySelector('[data-chevron-videos]')?.classList.toggle('rotate-180', !abierto);
        });

        // Menú ⋮ de cada video: uno abierto a la vez; se cierra con un clic afuera o Escape.
        const cerrarMenus = () => lista.querySelectorAll('[data-menu-video-opciones]').forEach((m) => {
            m.classList.add('hidden');
            m.previousElementSibling?.setAttribute('aria-expanded', 'false');
        });
        lista.querySelectorAll('[data-menu-video]').forEach((boton) => boton.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = boton.nextElementSibling;
            const abrir = menu.classList.contains('hidden');
            cerrarMenus();
            menu.classList.toggle('hidden', !abrir);
            boton.setAttribute('aria-expanded', String(abrir));
        }));
        document.addEventListener('click', cerrarMenus);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenus(); });

        // Ver: el iframe se carga al abrir y se vacía al cerrar, para que el video no siga
        // sonando con el modal cerrado.
        const modalVideo = document.getElementById('modal-ver-video');
        const iframe = document.getElementById('modal-video-iframe');
        const tituloVideo = document.getElementById('modal-video-titulo');
        lista.querySelectorAll('[data-ver-video]').forEach((boton) => boton.addEventListener('click', () => {
            iframe.src = boton.dataset.verVideo;
            tituloVideo.textContent = boton.dataset.titulo;
            abrirModal(modalVideo);
        }));
        modalVideo?.addEventListener('cerrado', () => { iframe.src = 'about:blank'; });

        // Borrar: confirma (no se puede deshacer: también se borra de Cloudflare).
        lista.querySelectorAll('[data-eliminar-video]').forEach((boton) => boton.addEventListener('click', async (e) => {
            e.stopPropagation();
            const { isConfirmed } = await Swal.fire(opcionesConfirmacion({
                variante: 'egreso',
                html: `<div class="gh-conf-html">${cabeceraConfirmacion({
                    icono: 'fi-rr-trash',
                    badge: 'Borrar video',
                    contexto: `${esc(boton.dataset.nombre)} se borra de la ficha de forma definitiva. No se puede deshacer.`
                })}</div>`,
                showCancelButton: true,
                confirmButtonText: 'Borrar video',
                cancelButtonText: 'Cancelar'
            }));
            if (!isConfirmed) return;

            cerrarMenus();
            boton.disabled = true;
            errorVideo?.classList.add('hidden');
            try {
                const r = await fetch(`${URL_FICHA}/videos/${boton.dataset.eliminarVideo}/eliminar`, { method: 'POST' });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo borrar el video.');
                window.location.reload();
            } catch (e) {
                mostrarError(errorVideo, e.message);
                boton.disabled = false;
            }
        }));

        input.addEventListener('change', async () => {
            const archivo = input.files?.[0];
            input.value = '';
            if (!archivo || total >= 3) return;

            progreso?.classList.remove('hidden'); progreso?.classList.add('flex');
            errorVideo?.classList.add('hidden');
            if (textoProgreso) textoProgreso.textContent = 'Iniciando…';

            try {
                // Solicitar → subir → confirmar → esperar: src/js/subidaVideo.js. Asociar exige el
                // video listo, y el procesamiento puede tardar más que la subida.
                const idVideo = await subirVideoProceso(archivo, {
                    orden: total + 1,
                    duracionSegundos: await duracionVideo(archivo),
                    alProgreso: (p) => { if (textoProgreso) textoProgreso.textContent = p >= 100 ? 'Procesando…' : `Subiendo… ${p}%`; },
                    alEstado: (estado) => { if (estado === 'procesando' && textoProgreso) textoProgreso.textContent = 'Procesando…'; }
                });

                const rAsociar = await fetch(`${URL_FICHA}/videos/${idVideo}/asociar`, { method: 'POST' });
                const dAsociar = await rAsociar.json();
                if (!rAsociar.ok || !dAsociar.success) throw new Error(dAsociar.mensaje || 'No se pudo asociar el video a la ficha.');

                // Recargar trae la fila nueva con su reproductor y su botón de borrar.
                window.location.reload();
            } catch (e) {
                mostrarError(errorVideo, e.message);
                progreso?.classList.add('hidden'); progreso?.classList.remove('flex');
            }
        });
    })();

    // ── Guardar ──────────────────────────────────────────────────────────────────────────
    (function () {
        const inputReferencia = document.getElementById('ficha-editar-referencia');
        const inputComplementos = document.getElementById('ficha-editar-complementos');
        const inputObservaciones = document.getElementById('ficha-editar-observaciones');
        const inputPrecio = document.getElementById('ficha-editar-precio');
        const btnGuardar = document.getElementById('btn-guardar-ficha-editar');
        const errorEl = document.getElementById('error-ficha-editar');
        const exitoEl = document.getElementById('exito-ficha-editar');
        const linkVerPdf = document.getElementById('link-ver-pdf');
        if (!btnGuardar) return;

        window.initMoneyInput?.(inputPrecio);

        // Lo que la ficha tenía al abrirla (o al último guardado): contra esto se arma la
        // lista de cambios que se confirma antes de guardar.
        const leer = () => ({
            referencia: inputReferencia?.value.trim() || '',
            complementos: (inputComplementos?.value || '').trim(),
            observaciones: (inputObservaciones?.value || '').trim(),
            precio: window.parseMoney ? window.parseMoney(inputPrecio.value) : 0,
            insumos: estado.obtenerInsumos()
        });
        let guardado = leer();

        const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
        // De un texto largo, el pedazo donde empieza el cambio (no su comienzo, que no cambió).
        const tramoCambiado = (antes, ahora) => {
            if (!ahora) return '(vacío)';
            let i = 0;
            while (i < antes.length && i < ahora.length && antes[i] === ahora[i]) i++;
            const desde = Math.max(0, i - 20);
            const tramo = ahora.slice(desde, desde + 80);
            return `${desde > 0 ? '…' : ''}${tramo}${desde + 80 < ahora.length ? '…' : ''}`;
        };
        const describirCambios = (antes, ahora) => {
            const cambios = [];
            if (antes.referencia !== ahora.referencia) cambios.push(['Referencia', `${antes.referencia} → ${ahora.referencia}`]);
            if (antes.precio !== ahora.precio) cambios.push(['Precio de confección', `${pesos(antes.precio)} → ${pesos(ahora.precio)} por prenda`]);
            if (antes.complementos !== ahora.complementos) cambios.push(['Complementos', tramoCambiado(antes.complementos, ahora.complementos)]);
            if (antes.observaciones !== ahora.observaciones) cambios.push(['Observaciones', tramoCambiado(antes.observaciones, ahora.observaciones)]);
            const previos = new Map(antes.insumos.map((i) => [i.idDetalle, i]));
            ahora.insumos.forEach((i) => {
                const previo = previos.get(i.idDetalle);
                if (!previo) return;
                if (previo.idMaterial !== i.idMaterial) cambios.push(['Insumo reemplazado', `${previo.nombre} → ${i.nombre}`]);
                if (previo.cantidad !== i.cantidad) cambios.push([i.nombre, `${previo.cantidad} → ${i.cantidad} por prenda`]);
            });
            return cambios;
        };

        // Muestra los cambios y espera la confirmación. Sin cambios, solo avisa.
        const confirmarCambios = async (cambios) => {
            if (!cambios.length) {
                await Swal.fire(opcionesConfirmacion({
                    variante: 'neutro',
                    html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono: 'fi-rr-info', badge: 'Sin cambios', contexto: 'No hay nada nuevo para guardar en esta ficha.' })}</div>`,
                    confirmButtonText: 'Entendido'
                }));
                return false;
            }
            const filas = cambios.map(([campo, detalle]) => `
                <li style="display:flex;flex-direction:column;gap:2px;padding:8px 0;border-top:1px solid #f1f5f9;text-align:left">
                    <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8">${esc(campo)}</span>
                    <span style="font-size:13px;color:#1e293b">${esc(detalle)}</span>
                </li>`).join('');
            const { isConfirmed } = await Swal.fire(opcionesConfirmacion({
                variante: 'neutro',
                html: `<div class="gh-conf-html">${cabeceraConfirmacion({
                    icono: 'fi-rr-edit',
                    badge: cambios.length === 1 ? '1 cambio' : `${cambios.length} cambios`,
                    contexto: 'Revisa lo que vas a cambiar en la ficha antes de guardar.'
                })}<ul style="list-style:none;margin:12px 0 0;padding:0 4px">${filas}</ul></div>`,
                showCancelButton: true,
                confirmButtonText: 'Guardar cambios',
                cancelButtonText: 'Seguir editando'
            }));
            return isConfirmed;
        };

        btnGuardar.addEventListener('click', async () => {
            errorEl?.classList.add('hidden');
            exitoEl?.classList.add('hidden');

            const referencia = inputReferencia?.value.trim();
            if (!referencia) return mostrarError(errorEl, 'Escribe una referencia.');
            if (estado.validarInsumos && !estado.validarInsumos()) return;

            const precioConfeccion = window.parseMoney ? window.parseMoney(inputPrecio.value) : 0;
            if (precioConfeccion <= 0) return mostrarError(errorEl, 'El precio de confección debe ser mayor a $0.');

            const ahora = leer();
            if (!(await confirmarCambios(describirCambios(guardado, ahora)))) return;

            const textoOriginal = btnGuardar.innerHTML;
            btnGuardar.disabled = true;
            btnGuardar.textContent = 'Guardando…';

            try {
                const r = await fetch(`${URL_FICHA}/actualizar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        referencia,
                        complementos: inputComplementos?.value || '',
                        observaciones: inputObservaciones?.value || '',
                        precioConfeccion,
                        insumos: estado.obtenerInsumos()
                    })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo guardar los cambios.');
                guardado = ahora;   // el próximo guardado compara contra esto

                if (exitoEl) {
                    exitoEl.textContent = d.avisoPdf || 'Cambios guardados — el PDF ya quedó actualizado.';
                    exitoEl.classList.remove('hidden');
                }
                if (linkVerPdf) linkVerPdf.href = `${URL_FICHA}/pdf`;
            } catch (e) {
                mostrarError(errorEl, e.message);
            } finally {
                btnGuardar.disabled = false;
                btnGuardar.innerHTML = textoOriginal;
            }
        });
    })();

    // ── Borrar, anular, reactivar ────────────────────────────────────────────────────────
    // Borrar solo aparece si la ficha nunca se usó; anular, si ya tiene uso. El servidor lo
    // vuelve a verificar (fichaTieneUso). Cada acción pide confirmación.
    (function () {
        const accion = async (ruta, cuerpo) => {
            const r = await fetch(`${URL_FICHA}/${ruta}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cuerpo || {})
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo completar la acción.');
        };
        const avisarError = (mensaje) => Swal.fire(opcionesConfirmacion({
            variante: 'egreso',
            html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono: 'fi-rr-exclamation', badge: 'No se pudo', contexto: esc(mensaje) })}</div>`,
            confirmButtonText: 'Entendido'
        }));

        document.getElementById('btn-borrar-ficha')?.addEventListener('click', async (e) => {
            const referencia = e.currentTarget.dataset.referencia;
            const { isConfirmed } = await Swal.fire(opcionesConfirmacion({
                variante: 'egreso',
                html: `<div class="gh-conf-html">${cabeceraConfirmacion({
                    icono: 'fi-rr-trash',
                    badge: 'Borrar ficha',
                    contexto: `Se borran la ficha ${esc(referencia)} y sus videos. No se puede deshacer.`
                })}</div>`,
                showCancelButton: true,
                confirmButtonText: 'Borrar ficha',
                cancelButtonText: 'Cancelar',
                showLoaderOnConfirm: true,
                preConfirm: () => accion('borrar').catch((err) => Swal.showValidationMessage(err.message))
            }));
            if (isConfirmed) window.location.href = '/admin/procesos/fichas-confeccion/biblioteca';
        });

        document.getElementById('btn-anular-ficha')?.addEventListener('click', async (e) => {
            const referencia = e.currentTarget.dataset.referencia;
            const { isConfirmed } = await Swal.fire(opcionesConfirmacion({
                variante: 'egreso',
                html: `<div class="gh-conf-html">${cabeceraConfirmacion({
                    icono: 'fi-rr-ban',
                    badge: 'Anular ficha',
                    contexto: `${esc(referencia)} sale de la biblioteca y no se puede usar para iniciar procesos. Se puede reactivar.`
                })}</div>`,
                input: 'textarea',
                inputPlaceholder: 'Motivo (ej. referencia descontinuada)',
                inputAttributes: { maxlength: '500' },
                inputValidator: (v) => (String(v || '').trim().length < 3 ? 'Escribe el motivo.' : undefined),
                showCancelButton: true,
                confirmButtonText: 'Anular ficha',
                cancelButtonText: 'Cancelar',
                showLoaderOnConfirm: true,
                preConfirm: (motivo) => accion('anular', { motivo }).catch((err) => Swal.showValidationMessage(err.message))
            }));
            if (isConfirmed) window.location.reload();
        });

        document.getElementById('btn-reactivar-ficha')?.addEventListener('click', async () => {
            try {
                await accion('reactivar');
                window.location.reload();
            } catch (err) {
                avisarError(err.message);
            }
        });
    })();
})();
