import { duracionVideo } from './duracionVideo.js';

// Editor de una ficha de confección ya creada (admin/procesos/fichas-confeccion/:idFicha,
// "Abrir" desde la Biblioteca). Colores e insumos reusan el mismo mecanismo de
// src/js/fichaConfeccionNueva.js (modal con buscador + grilla, una fila por elegido) ya
// prepoblado con lo que la ficha trae; talleres y videos son nuevos acá.
(function () {
    const raiz = document.getElementById('asistente-ficha-editar');
    if (!raiz) return;

    const idFicha = raiz.dataset.idFicha;
    const materiales = JSON.parse(raiz.dataset.materiales || '[]');
    const insumosIniciales = JSON.parse(raiz.dataset.insumosIniciales || '[]');
    const talleresIniciales = JSON.parse(raiz.dataset.talleresIniciales || '[]');

    // Estado compartido entre los bloques de abajo — mismo criterio que estadoFicha en
    // fichaConfeccionNueva.js: cada bloque resuelve lo suyo y expone una función para que
    // el bloque de guardado al final junte todo en un solo POST.
    const estado = {
        obtenerColores: () => [],
        obtenerInsumos: () => [],
        obtenerTalleres: () => [],
        actualizarColoresEnTalleres: () => {}
    };

    // Colores y cantidades ya no son de la ficha: la ficha describe la prenda y los insumos
    // van por prenda; cuántas y en qué colores lo dice la orden de producción (wiki
    // "Proceso de confección"). Los talleres siguen acá mientras esa orden no exista.

    // ── Insumos ──────────────────────────────────────────────────────────────────────────
    (function () {
        const lista = document.querySelector('[data-lista-insumos-editar]');
        const plantilla = document.getElementById('plantilla-fila-insumo-editar');
        const btnAgregar = document.getElementById('btn-agregar-insumo-editar');
        const vacio = document.getElementById('insumos-editar-vacio');
        const errorInsumos = document.querySelector('[data-error-insumos-editar]');
        const modal = document.getElementById('modal-elegir-insumo-editar');
        const buscador = document.getElementById('buscador-insumo-ficha-editar');
        const grid = document.getElementById('grid-insumos-ficha-editar');
        const btnCerrarModal = document.getElementById('cerrar-modal-insumo-editar');
        if (!lista || !plantilla || !btnAgregar) return;

        let filaActual = null;
        const actualizarVacio = () => vacio?.classList.toggle('hidden', lista.children.length > 0);

        const cerrarModal = () => {
            modal?.classList.add('hidden'); modal?.classList.remove('flex');
            filaActual = null;
            if (buscador) buscador.value = '';
            grid?.querySelectorAll('[data-opcion-insumo]').forEach((b) => { b.style.display = ''; });
        };
        const abrirModal = (fila) => {
            filaActual = fila;
            modal?.classList.remove('hidden'); modal?.classList.add('flex');
            buscador?.focus();
        };
        btnCerrarModal?.addEventListener('click', cerrarModal);
        modal?.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });
        buscador?.addEventListener('input', (e) => {
            const termino = e.target.value.toLowerCase().trim();
            grid?.querySelectorAll('[data-opcion-insumo]').forEach((b) => {
                b.style.display = (b.dataset.nombre || '').toLowerCase().includes(termino) ? '' : 'none';
            });
        });
        grid?.addEventListener('click', (e) => {
            const opcion = e.target.closest('[data-opcion-insumo]');
            if (!opcion || !filaActual) return;
            pintarInsumoEnFila(filaActual, { idMaterial: opcion.dataset.id, nombre: opcion.dataset.nombre, imagen: opcion.dataset.imagen });
            cerrarModal();
        });

        function pintarInsumoEnFila(fila, insumo) {
            const foto = fila.querySelector('[data-insumo-foto]');
            const nombreEl = fila.querySelector('[data-insumo-nombre]');
            const inputId = fila.querySelector('[data-insumo-id]');
            if (inputId) inputId.value = insumo.idMaterial;
            if (nombreEl) { nombreEl.textContent = insumo.nombre; nombreEl.classList.remove('text-slate-400'); nombreEl.classList.add('text-slate-800', 'font-semibold'); }
            if (foto) foto.innerHTML = insumo.imagen ? `<img src="${insumo.imagen}" alt="${insumo.nombre}" class="w-full h-full object-cover">` : '<i class="fi fi-rr-box text-xs"></i>';
        }

        const agregarFila = (datosIniciales) => {
            const nodo = plantilla.content.firstElementChild.cloneNode(true);
            lista.appendChild(nodo);
            nodo.querySelector('[data-abrir-insumo]')?.addEventListener('click', () => abrirModal(nodo));
            nodo.querySelector('[data-quitar-insumo]')?.addEventListener('click', () => { nodo.remove(); actualizarVacio(); });
            if (datosIniciales) {
                pintarInsumoEnFila(nodo, { idMaterial: datosIniciales.idMaterial, nombre: datosIniciales.nombre });
                const inputCantidad = nodo.querySelector('[data-insumo-cantidad]');
                if (inputCantidad) inputCantidad.value = datosIniciales.cantidad;
            }
            actualizarVacio();
        };

        btnAgregar.addEventListener('click', () => agregarFila());
        insumosIniciales.forEach((i) => agregarFila(i));

        estado.obtenerInsumos = () => [...lista.querySelectorAll('[data-fila-insumo]')]
            .map((fila) => ({
                idMaterial: fila.querySelector('[data-insumo-id]')?.value || null,
                nombre: fila.querySelector('[data-insumo-nombre]')?.textContent,
                cantidad: parseInt(fila.querySelector('[data-insumo-cantidad]')?.value, 10)
            }))
            .filter((f) => f.idMaterial && Number.isInteger(f.cantidad) && f.cantidad > 0);

    })();

    // ── Talleres de confección ───────────────────────────────────────────────────────────
    // Cada taller es un PROVEDORES de categoría 'Confeccionista' con su propio precio y los
    // colores de la ficha que le tocan — las casillas de color se repintan cada vez que la
    // lista de colores cambia (agregar/quitar arriba), así un color que se borró no se
    // queda "fantasma" asignado a un taller. "Agregar taller" abre una grilla y se elige con
    // un click, mismo lenguaje que colores/insumos (un <select> plano no se leía como botón).
    (function () {
        const lista = document.querySelector('[data-lista-talleres-editar]');
        const plantilla = document.getElementById('plantilla-taller-editar');
        const btnAgregar = document.getElementById('btn-agregar-taller-editar');
        const vacio = document.getElementById('talleres-editar-vacio');
        const errorTalleres = document.querySelector('[data-error-talleres-editar]');
        const modal = document.getElementById('modal-elegir-taller-editar');
        const buscador = document.getElementById('buscador-taller-ficha-editar');
        const grid = document.getElementById('grid-talleres-ficha-editar');
        const btnCerrarModal = document.getElementById('cerrar-modal-taller-editar');
        const inputPrecioGeneral = document.getElementById('ficha-editar-precio');
        if (!lista || !plantilla || !btnAgregar) return;

        const actualizarVacio = () => vacio?.classList.toggle('hidden', lista.children.length > 0);

        const cerrarModal = () => {
            modal?.classList.add('hidden'); modal?.classList.remove('flex');
            if (buscador) buscador.value = '';
            grid?.querySelectorAll('[data-opcion-taller]').forEach((b) => { b.style.display = ''; });
        };
        const abrirModal = () => {
            modal?.classList.remove('hidden'); modal?.classList.add('flex');
            buscador?.focus();
        };
        btnCerrarModal?.addEventListener('click', cerrarModal);
        modal?.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });
        buscador?.addEventListener('input', (e) => {
            const termino = e.target.value.toLowerCase().trim();
            grid?.querySelectorAll('[data-opcion-taller]').forEach((b) => {
                b.style.display = (b.dataset.nombre || '').toLowerCase().includes(termino) ? '' : 'none';
            });
        });

        const repintarColoresDeFila = (fila) => {
            const contenedor = fila.querySelector('[data-taller-colores]');
            if (!contenedor) return;
            const idsMarcados = new Set([...contenedor.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value));
            contenedor.innerHTML = '';
            estado.obtenerColores().forEach((c) => {
                const label = document.createElement('label');
                label.className = 'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-slate-200 cursor-pointer hover:border-gh-primary/40';
                const check = document.createElement('input');
                check.type = 'checkbox'; check.value = String(c.idAtributoColor);
                check.className = 'accent-gh-primaryHover';
                check.checked = idsMarcados.has(String(c.idAtributoColor));
                const texto = document.createElement('span');
                texto.textContent = c.nombre;
                label.append(check, texto);
                contenedor.appendChild(label);
            });
        };

        estado.actualizarColoresEnTalleres = () => {
            lista.querySelectorAll('[data-fila-taller]').forEach(repintarColoresDeFila);
        };

        const agregarTaller = (idProveedor, nombre, datosIniciales) => {
            const opcion = grid?.querySelector(`[data-opcion-taller][data-id="${idProveedor}"]`);
            const nodo = plantilla.content.firstElementChild.cloneNode(true);
            nodo.dataset.idProveedor = idProveedor;
            nodo.querySelector('[data-taller-nombre]').textContent = nombre;
            lista.appendChild(nodo);

            const inputPrecio = nodo.querySelector('[data-taller-precio]');
            window.initMoneyInput?.(inputPrecio);
            // El precio sugerido es el "Precio general de confección" — todos arrancan ahí,
            // se puede cambiar por taller (pedido explícito del usuario). Un taller que ya
            // traía su propio precio guardado (datosIniciales) conserva el suyo.
            const precioInicial = datosIniciales?.precioConfeccion
                ?? (window.parseMoney ? window.parseMoney(inputPrecioGeneral?.value || '0') : 0);
            if (precioInicial) inputPrecio.value = Math.round(precioInicial).toLocaleString('es-CO');

            nodo.querySelector('[data-quitar-taller]')?.addEventListener('click', () => {
                nodo.remove();
                if (opcion) opcion.style.display = '';
                actualizarVacio();
            });

            repintarColoresDeFila(nodo);
            if (datosIniciales?.colores?.length) {
                const idsIniciales = new Set(datosIniciales.colores.map(String));
                nodo.querySelectorAll('[data-taller-colores] input[type="checkbox"]').forEach((c) => { c.checked = idsIniciales.has(c.value); });
            }

            if (opcion) opcion.style.display = 'none';
            actualizarVacio();
        };

        btnAgregar.addEventListener('click', abrirModal);
        grid?.addEventListener('click', (e) => {
            const opcion = e.target.closest('[data-opcion-taller]');
            if (!opcion) return;
            agregarTaller(opcion.dataset.id, opcion.dataset.nombre);
            errorTalleres?.classList.add('hidden');
            cerrarModal();
        });

        talleresIniciales.forEach((t) => agregarTaller(t.idProveedor, t.nombre, t));

        estado.obtenerTalleres = () => [...lista.querySelectorAll('[data-fila-taller]')]
            .map((fila) => ({
                idProveedor: fila.dataset.idProveedor,
                precioConfeccion: window.parseMoney ? window.parseMoney(fila.querySelector('[data-taller-precio]')?.value || '0') : 0,
                colores: [...fila.querySelectorAll('[data-taller-colores] input[type="checkbox"]:checked')].map((c) => parseInt(c.value, 10))
            }));

        estado.validarTalleres = () => {
            const talleres = estado.obtenerTalleres();
            const ok = talleres.every((t) => t.precioConfeccion > 0);
            errorTalleres?.classList.toggle('hidden', ok);
            if (errorTalleres) errorTalleres.textContent = 'Cada taller necesita un precio de confección mayor a $0.';
            return ok;
        };
    })();

    // ── Videos del proceso ───────────────────────────────────────────────────────────────
    // Mismo pipeline de Cloudflare Stream que el asistente (controller/
    // fichaConfeccionVideoController.js): pide una URL de subida directa, el navegador sube
    // el archivo DIRECTO a Cloudflare, confirma, y recién ahí se asocia a ESTA ficha (acá es
    // lo único distinto del asistente — ahí la asociación la hacía finalizarFicha al final).
    (function () {
        const urlBase = '/admin/procesos/fichas-confeccion/video';
        const input = document.getElementById('input-video-editar');
        const zona = document.getElementById('zona-agregar-video-editar');
        const lista = document.querySelector('[data-lista-videos-editar]');
        const progreso = document.querySelector('[data-progreso-video-editar]');
        const textoProgreso = document.querySelector('[data-texto-progreso-video-editar]');
        const errorVideo = document.querySelector('[data-error-video-editar]');
        const contador = document.getElementById('contador-videos-editar');
        if (!input || !lista) return;

        let total = lista.children.length;

        const actualizarContador = () => {
            if (contador) contador.textContent = `${total}/3`;
            if (zona) zona.classList.toggle('hidden', total >= 3);
        };
        actualizarContador();

        const subirArchivo = (archivo, uploadURL) => new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', uploadURL);
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && textoProgreso) textoProgreso.textContent = `Subiendo… ${Math.round((e.loaded / e.total) * 100)}%`;
            });
            xhr.addEventListener('load', () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Cloudflare rechazó la subida (HTTP ${xhr.status}).`)));
            xhr.addEventListener('error', () => reject(new Error('Se perdió la conexión subiendo el video.')));
            const formData = new FormData();
            formData.append('file', archivo);
            xhr.send(formData);
        });

        input.addEventListener('change', async () => {
            const archivo = input.files?.[0];
            input.value = '';
            if (!archivo || total >= 3) return;

            progreso?.classList.remove('hidden'); progreso?.classList.add('flex');
            errorVideo?.classList.add('hidden');
            if (textoProgreso) textoProgreso.textContent = 'Iniciando…';

            try {
                const rSolicitar = await fetch(`${urlBase}/solicitar-subida`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json'},
                    body: JSON.stringify({ orden: total + 1, nombreOriginal: archivo.name, pesoBytes: archivo.size, duracionSegundos: await duracionVideo(archivo) })
                });
                const dSolicitar = await rSolicitar.json();
                if (!rSolicitar.ok || !dSolicitar.success) throw new Error(dSolicitar.mensaje || 'No se pudo iniciar la subida.');

                if (dSolicitar.uploadURL) await subirArchivo(archivo, dSolicitar.uploadURL);

                if (textoProgreso) textoProgreso.textContent = 'Procesando…';
                const rConfirmar = await fetch(`${urlBase}/${dSolicitar.idVideo}/confirmar`, { method: 'POST', });
                const dConfirmar = await rConfirmar.json();
                if (!rConfirmar.ok || !dConfirmar.success) throw new Error(dConfirmar.mensaje || 'No se pudo confirmar la subida.');
                if (dConfirmar.estado === 'error') throw new Error(dConfirmar.errorMensaje || 'Cloudflare no pudo procesar el video.');

                const rAsociar = await fetch(`/admin/procesos/fichas-confeccion/${idFicha}/videos/${dSolicitar.idVideo}/asociar`, {
                    method: 'POST', });
                const dAsociar = await rAsociar.json();
                if (!rAsociar.ok || !dAsociar.success) throw new Error(dAsociar.mensaje || 'No se pudo asociar el video a la ficha.');

                const fila = document.createElement('div');
                fila.className = 'flex items-center gap-2 text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2';
                fila.innerHTML = '<i class="fi fi-rr-video-camera text-slate-400 text-sm flex-shrink-0"></i><span class="flex-1 truncate"></span>';
                fila.querySelector('span').textContent = archivo.name;
                lista.appendChild(fila);
                total += 1;
                actualizarContador();
            } catch (e) {
                if (errorVideo) { errorVideo.textContent = e.message; errorVideo.classList.remove('hidden'); }
            } finally {
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

        btnGuardar.addEventListener('click', async () => {
            errorEl?.classList.add('hidden');
            exitoEl?.classList.add('hidden');

            const referencia = inputReferencia?.value.trim();
            if (!referencia) {
                if (errorEl) { errorEl.textContent = 'Escribe una referencia.'; errorEl.classList.remove('hidden'); }
                return;
            }
            if (estado.validarInsumos && !estado.validarInsumos()) return;
            if (estado.validarTalleres && !estado.validarTalleres()) return;

            const precioConfeccion = window.parseMoney ? window.parseMoney(inputPrecio.value) : 0;
            if (precioConfeccion <= 0) {
                if (errorEl) { errorEl.textContent = 'El precio de confección debe ser mayor a $0.'; errorEl.classList.remove('hidden'); }
                return;
            }

            const textoOriginal = btnGuardar.innerHTML;
            btnGuardar.disabled = true;
            btnGuardar.textContent = 'Guardando…';

            try {
                const r = await fetch(`/admin/procesos/fichas-confeccion/${idFicha}/actualizar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        referencia,
                        complementos: inputComplementos?.value || '',
                        observaciones: inputObservaciones?.value || '',
                        precioConfeccion,
                        insumos: estado.obtenerInsumos(),
                        talleres: estado.obtenerTalleres()
                    })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudo guardar los cambios.');

                if (exitoEl) {
                    exitoEl.textContent = d.avisoPdf || 'Cambios guardados — el PDF ya quedó actualizado.';
                    exitoEl.classList.remove('hidden');
                }
                if (linkVerPdf) linkVerPdf.href = `/admin/procesos/fichas-confeccion/${idFicha}/pdf`;
            } catch (e) {
                if (errorEl) { errorEl.textContent = e.message; errorEl.classList.remove('hidden'); }
            } finally {
                btnGuardar.disabled = false;
                btnGuardar.innerHTML = textoOriginal;
            }
        });
    })();
})();
