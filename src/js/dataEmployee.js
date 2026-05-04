(function () {
    // Referencias al DOM
    const idTypeSelect = document.getElementById('TipoDocumento');
    const idNumberInput = document.getElementById('NumeroDocumento');
    const emailInput = document.getElementById('emailEmpleado');
    const form = document.getElementById('formularioEmpleado');
    const filePhoto = document.getElementById('upload-foto');
    const fileDocs = document.getElementById('upload-images');
    const idPuntoDeVenta = document.getElementById('idPuntoDeVenta');
    const previewContainer = document.getElementById('preview-container');
    const guardarBtn = document.getElementById('guardar');
    const photoIconContainer = document.querySelector('.inputUpload_mini .fi-rr-mode-portrait')?.parentElement;

    // ID del empleado en modo edición (vacío en modo nuevo)
    const empleadoId = form?.dataset.empleadoId || '';

    // Referencias para Sede y Cargo
    const cargoSelect = document.getElementById('cargo');
    const sedeSelect = document.getElementById('idPuntoDeVenta');

    const dtDocs = new DataTransfer();

    // 1. VALIDACIÓN ASINCRÓNICA DE DOCUMENTO
    const checkDocumento = async () => {
        const tipo = idTypeSelect.value;
        const numero = idNumberInput.value.trim();
        if (tipo && numero.length > 3) {
            try {
                const url = `/admin/json/personal/documento/${tipo}/${numero}${empleadoId ? '?exclude=' + empleadoId : ''}`;
                const response = await fetch(url);
                const data = await response.json();
                if (data.exists) {
                    Swal.fire({ icon: 'error', title: '¡Documento Duplicado!', text: 'Este empleado ya se encuentra registrado.', confirmButtonColor: '#7e22ce' });
                    idNumberInput.value = '';
                }
            } catch (error) { console.error(error); }
        }
    };

    idNumberInput.addEventListener('blur', checkDocumento);
    idTypeSelect.addEventListener('change', checkDocumento);

    // 2. VALIDACIÓN ASINCRÓNICA DE EMAIL
    emailInput.addEventListener('blur', async function () {
        const email = this.value.trim();
        if (email.length > 5) {
            try {
                const url = `/admin/json/personal/email/${email}${empleadoId ? '?exclude=' + empleadoId : ''}`;
                const response = await fetch(url);
                const data = await response.json();
                if (data.exists) {
                    Swal.fire({ icon: 'error', title: '¡Email Duplicado!', text: 'Este correo electrónico ya está en uso.', confirmButtonColor: '#7e22ce' });
                    this.value = '';
                }
            } catch (error) { console.error(error); }
        }
    });

    // 3. FOTO: preview en edición / cambio de icono en nuevo
    if (filePhoto) {
        filePhoto.addEventListener('change', function () {
            if (!this.files?.[0]) return;
            const previewImg = document.getElementById('preview-foto-empleado');
            if (previewImg) {
                // Modo edición: actualizar la imagen directamente
                const reader = new FileReader();
                reader.onload = e => { previewImg.src = e.target.result; };
                reader.readAsDataURL(this.files[0]);
            } else if (photoIconContainer) {
                // Modo nuevo: cambiar el icono
                photoIconContainer.innerHTML = '<i class="fi-rr-thumbs-up text-3xl"></i>';
                photoIconContainer.classList.add('text-green-500');
                photoIconContainer.classList.remove('text-purple-500');
            }
        });
    }

    // 4. DOCUMENTOS: PREVISUALIZACIÓN
    if (fileDocs) {
        fileDocs.addEventListener('change', function (e) {
            const newFiles = Array.from(e.target.files);
            if (dtDocs.files.length + newFiles.length > 10) {
                Swal.fire({ icon: 'warning', title: 'Límite excedido', text: 'Máximo 10 archivos.', confirmButtonColor: '#7e22ce' });
                return;
            }
            newFiles.forEach(file => dtDocs.items.add(file));
            fileDocs.files = dtDocs.files;
            renderPreviews();
        });
    }

    function renderPreviews() {
        if (!previewContainer) return;
        previewContainer.innerHTML = '';
        Array.from(dtDocs.files).forEach((file, index) => {
            const isImage = file.type.startsWith('image/');
            const div = document.createElement('div');
            div.className = "relative w-24 h-24 rounded-xl border border-gray-200 overflow-hidden shadow-sm flex flex-col items-center justify-center p-1 bg-white group hover:border-purple-400 transition-colors";

            const deleteBtn = document.createElement('button');
            deleteBtn.className = "absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-20";
            deleteBtn.innerHTML = '<i class="fi-rr-cross-small"></i>';
            deleteBtn.onclick = (e) => { e.preventDefault(); removeFile(index); };
            div.appendChild(deleteBtn);

            if (isImage) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.className = "w-full h-full object-cover rounded-lg";
                    div.insertBefore(img, div.firstChild);
                };
                reader.readAsDataURL(file);
            } else {
                let iconClass = "fi-rr-file text-gray-400";
                if (file.type === 'application/pdf') iconClass = "fi-rr-file-pdf text-red-500";
                div.insertAdjacentHTML('afterbegin', `<i class="${iconClass} text-3xl mb-1 mt-2"></i>`);
            }
            previewContainer.appendChild(div);
        });
    }

    function removeFile(index) {
        const newDt = new DataTransfer();
        Array.from(dtDocs.files).forEach((file, i) => { if (i !== index) newDt.items.add(file); });
        dtDocs.items.clear();
        Array.from(newDt.files).forEach(f => dtDocs.items.add(f));
        fileDocs.files = dtDocs.files;
        renderPreviews();
    }

    // 5. FORMATO SALARIO EN MILES (tiempo real)
    const salarioInput = document.getElementById('salarioBase');
    if (salarioInput) {
        salarioInput.addEventListener('input', function () {
            const raw = this.value.replace(/\D/g, '');
            this.value = raw ? parseInt(raw, 10).toLocaleString('es-CO') : '';
        });
    }

    // 6. ENVÍO DEL FORMULARIO
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            // Validaciones básicas requeridas
            const required = ['PrimerNombre', 'PrimerApellido', 'TipoDocumento', 'NumeroDocumento', 'fechaNacimiento', 'direccionResidencia', 'emailEmpleado', 'telefonoContacto', 'tipoContrato', 'cargo', 'salarioBase'];

            const cargo = cargoSelect.value;
            if (cargo === 'vendedor' || cargo === 'bodega') required.push('idPuntoDeVenta');

            let valid = true;
            required.forEach(id => {
                const el = document.getElementById(id) || document.getElementsByName(id)[0];
                if (!el || !el.value) { el?.classList.add('border-red-500'); valid = false; }
                else el?.classList.remove('border-red-500');
            });

            if (!valid) {
                Swal.fire({ icon: 'warning', title: 'Faltan datos 🧐', text: 'Debes llenar todos los datos obligatorios.', confirmButtonColor: '#7e22ce' });
                return;
            }

            const formData = new FormData(form);

            // Serializar permisos como JSON para evitar problemas con bracket notation en multer
            const permisosPayload = [];
            for (const [idRecurso, acciones] of Object.entries(_estadoGlobal)) {
                acciones.forEach(idAccion => {
                    permisosPayload.push({ idRecurso, idAccion });
                });
            }
            formData.set('permisosJSON', JSON.stringify(permisosPayload));

            guardarBtn.disabled = true;
            guardarBtn.innerHTML = '<i class="fi-rr-spinner animate-spin"></i> Guardando...';

            try {
                const response = await fetch(form.action || window.location.pathname, {
                    method: 'POST',
                    body: formData
                });
                if (!response.headers.get('content-type')?.includes('application/json')) {
                    window.location.href = '/admin/login';
                    return;
                }
                const result = await response.json();
                if (result.success) {
                    await Swal.fire({ icon: 'success', title: empleadoId ? '¡Empleado Actualizado!' : '¡Empleado Guardado!', text: result.mensaje, confirmButtonColor: '#7e22ce' });
                    window.location.href = empleadoId ? window.location.pathname : '/admin/personal';
                } else {
                    throw new Error(result.mensaje);
                }
            } catch (error) {
                Swal.fire({ icon: 'error', title: 'Error', text: error.message, confirmButtonColor: '#7e22ce' });
            } finally {
                guardarBtn.disabled = false;
                guardarBtn.innerHTML = '<i class="fi-rr-disk"></i> Guardar Empleado';
            }
        });
    }

    // 6. DEPTO / CIUDAD (Default Antioquia/Medellin)
    const deptoSelect = document.getElementById('departamentoSelect');
    const ciudadSelect = document.getElementById('ciudadSelect');

    const loadCiudades = async (deptoId, selectedCiudadId = null) => {
        if (!deptoId || !ciudadSelect) return;
        try {
            const res = await fetch(`/admin/json/municipios/${deptoId}`);
            const municipios = await res.json();
            ciudadSelect.innerHTML = '<option value="">Selecciona Ciudad</option>';
            municipios.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.nombre;
                if (m.id == selectedCiudadId) opt.selected = true;
                ciudadSelect.appendChild(opt);
            });
            ciudadSelect.disabled = false;
        } catch (err) { console.error(err); }
    };

    if (deptoSelect) {
        deptoSelect.addEventListener('change', (e) => loadCiudades(e.target.value));

        // Si ya hay departamento seleccionado (modo edición), carga sus ciudades manteniendo la ciudad actual
        if (!deptoSelect.value) {
            deptoSelect.value = '05';
            loadCiudades('05', '05001');
        } else {
            loadCiudades(deptoSelect.value, ciudadSelect?.value || null);
        }
    }

    // 7. LÓGICA CONDICIONAL DE SEDE
    if (cargoSelect && sedeSelect) {
        cargoSelect.addEventListener('change', function () {
            const cargo = this.value;
            if (cargo === 'vendedor' || cargo === 'bodega') {
                sedeSelect.disabled = false;
                sedeSelect.parentElement.classList.remove('opacity-50'); // Si tuviera opacidad
            } else {
                sedeSelect.disabled = true;
                sedeSelect.value = '';
                sedeSelect.parentElement.classList.add('opacity-50');
            }
        });

        // Disparar inicialmente si ya hay un valor (ej: al recargar con errores)
        if (cargoSelect.value === 'vendedor' || cargoSelect.value === 'bodega') {
            sedeSelect.disabled = false;
        }
    }

    // 8. SECCIÓN DE PERMISOS SEGÚN CARGO
    const seccionPermisos        = document.getElementById('seccionPermisos');
    const permisosVendedor       = document.getElementById('permisosVendedor');
    const permisosAdministrativo = document.getElementById('permisosAdministrativo');
    const permisosBodega         = document.getElementById('permisosBodega');

    const mapaPermisos = {
        vendedor:       permisosVendedor,
        administrativo: permisosAdministrativo,
        bodega:         permisosBodega,
    };

    // Estado de permisos — debe declararse aquí para evitar TDZ cuando actualizarPermisos
    // se llama inmediatamente en el init de la página (antes del bloque 9 más abajo)
    const GH_PRIMARY_HOVER = '#E24C95';
    const GH_GRAY_BORDER   = '#E5E7EB';
    const _estadoGlobal = {};
    let   _accionesGlobal = null;
    const _panelIds = {
        administrativo: { pills: 'pillsAdministrativo', acciones: 'accionesAdministrativo', titulo: 'tituloAccionesAdmin',      toggle: 'toggleTodosAdmin',      checkboxes: 'checkboxesAccionesAdmin'      },
        vendedor:        { pills: 'pillsVendedor',        acciones: 'accionesVendedor',        titulo: 'tituloAccionesVendedor',   toggle: 'toggleTodosVendedor',   checkboxes: 'checkboxesAccionesVendedor'   },
        bodega:          { pills: 'pillsBodega',          acciones: 'accionesBodega',          titulo: 'tituloAccionesBodega',     toggle: 'toggleTodosBodega',     checkboxes: 'checkboxesAccionesBodega'     },
    };
    const _panelState = {
        administrativo: { cargado: false, activo: null },
        vendedor:        { cargado: false, activo: null },
        bodega:          { cargado: false, activo: null },
    };

    function actualizarPermisos(cargo) {
        Object.values(mapaPermisos).forEach(el => { if (el) el.style.display = 'none'; });

        const panel = mapaPermisos[cargo];
        if (panel && seccionPermisos) {
            seccionPermisos.style.display = 'block';
            panel.style.display = 'block';
            initPermisosPanel(cargo);
        } else if (seccionPermisos) {
            seccionPermisos.style.display = 'none';
        }
    }

    if (cargoSelect) {
        cargoSelect.addEventListener('change', function () { actualizarPermisos(this.value); });
        actualizarPermisos(cargoSelect.value);
    }

    // 9. PILLS DE PERMISOS — SISTEMA GENÉRICO (administrativo / vendedor / bodega)
    const GH_PRIMARY_SOFT = '#FDE7F2';

    function applyPillStyle(btn, isActive) {
        const hasPerms = (_estadoGlobal[btn.dataset.id] || new Set()).size > 0;
        btn.className = 'pill-admin inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all';
        if (isActive) {
            btn.style.cssText = `background:${GH_PRIMARY_HOVER};color:#fff;border:1px solid ${GH_PRIMARY_HOVER};box-shadow:0 2px 8px rgba(226,76,149,0.35);`;
        } else if (hasPerms) {
            btn.style.cssText = `background:${GH_PRIMARY_SOFT};color:${GH_PRIMARY_HOVER};border:1px solid ${GH_PRIMARY_HOVER};`;
        } else {
            btn.style.cssText = `background:${GH_GRAY_BORDER};color:#4B5563;border:1px solid ${GH_GRAY_BORDER};`;
        }
    }

    async function initPermisosPanel(tipo) {
        const state = _panelState[tipo];
        const ids   = _panelIds[tipo];
        if (!state || !ids) return;
        if (state.cargado) return;
        state.cargado = true;

        const pillsBox = document.getElementById(ids.pills);
        if (!pillsBox) return;
        pillsBox.innerHTML = '<span class="text-xs text-gray-400 italic">Cargando...</span>';

        try {
            // Cargar acciones una sola vez para todos los paneles
            if (!_accionesGlobal) {
                const resA = await fetch('/admin/json/permisos/acciones');
                _accionesGlobal = await resA.json();
            }

            const resR = await fetch(`/admin/json/permisos/recursos/${tipo}`);
            const recursos = await resR.json();

            const preloaded = window.__PERMISOS_EMPLEADO__ || [];
            recursos.forEach(r => {
                if (!_estadoGlobal[r.idRecurso]) {
                    _estadoGlobal[r.idRecurso] = new Set(
                        preloaded.filter(p => p.idRecurso === r.idRecurso).map(p => p.idAccion)
                    );
                }
            });

            renderPillsPanel(tipo, recursos);
        } catch (e) {
            pillsBox.innerHTML = '<span class="text-xs text-red-400">Error al cargar permisos</span>';
        }
    }

    function renderPillsPanel(tipo, recursos) {
        const ids = _panelIds[tipo];
        const box = document.getElementById(ids.pills);
        box.innerHTML = '';

        if (!recursos.length) {
            box.innerHTML = '<span class="text-xs text-gray-400 italic">Sin recursos configurados</span>';
            return;
        }

        recursos.forEach(r => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.id   = r.idRecurso;
            btn.dataset.tipo = tipo;
            btn.innerHTML = `<i class="fi-rr-layers" style="font-size:10px"></i> ${r.nombreRecurso}`;
            btn.addEventListener('click', () => onPillClick(btn, r, tipo));
            box.appendChild(btn);
            applyPillStyle(btn, false);
        });
    }

    function onPillClick(btn, recurso, tipo) {
        const ids       = _panelIds[tipo];
        const state     = _panelState[tipo];
        const accionesBox = document.getElementById(ids.acciones);

        if (state.activo === recurso.idRecurso) {
            state.activo = null;
            applyPillStyle(btn, false);
            accionesBox.style.display = 'none';
            return;
        }

        // Desactivar todos los pills del mismo panel
        document.querySelectorAll(`.pill-admin[data-tipo="${tipo}"]`).forEach(p => applyPillStyle(p, false));

        state.activo = recurso.idRecurso;

        // Pre-marcar READ la primera vez que se abre este pill
        if (_estadoGlobal[recurso.idRecurso].size === 0) {
            const readAccion = _accionesGlobal.find(a => a.nombreAccion.toUpperCase() === 'READ');
            if (readAccion) _estadoGlobal[recurso.idRecurso].add(readAccion.idAccion);
        }

        applyPillStyle(btn, true);

        document.getElementById(ids.titulo).textContent = recurso.nombreRecurso;
        renderCheckboxesPanel(tipo, recurso.idRecurso);
        accionesBox.style.display = 'block';
    }

    function syncTogglePanel(tipo, idRecurso) {
        const ids    = _panelIds[tipo];
        const toggle = document.getElementById(ids.toggle);
        if (!toggle) return;
        const total   = _accionesGlobal.length;
        const marcados = _estadoGlobal[idRecurso].size;
        toggle.checked       = marcados === total;
        toggle.indeterminate = marcados > 0 && marcados < total;
        toggle.style.accentColor = GH_PRIMARY_HOVER;
    }

    function renderCheckboxesPanel(tipo, idRecurso) {
        const ids = _panelIds[tipo];
        const box = document.getElementById(ids.checkboxes);
        box.innerHTML = '';
        const seleccionados = _estadoGlobal[idRecurso] || new Set();

        _accionesGlobal.forEach(accion => {
            const label = document.createElement('label');
            label.className = 'flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 bg-white hover:border-pink-200 hover:bg-pink-50 cursor-pointer transition-colors select-none';

            const input = document.createElement('input');
            input.type    = 'checkbox';
            input.value   = '1';
            input.checked = seleccionados.has(accion.idAccion);
            input.className = 'w-4 h-4 cursor-pointer';
            input.style.accentColor = GH_PRIMARY_HOVER;

            input.addEventListener('change', () => {
                if (input.checked) _estadoGlobal[idRecurso].add(accion.idAccion);
                else _estadoGlobal[idRecurso].delete(accion.idAccion);

                syncTogglePanel(tipo, idRecurso);

                const pillBtn = document.querySelector(`.pill-admin[data-id="${idRecurso}"]`);
                if (pillBtn) applyPillStyle(pillBtn, true);
            });

            const span = document.createElement('span');
            span.className = 'text-sm text-gray-700';
            span.textContent = accion.nombreAccion;

            label.appendChild(input);
            label.appendChild(span);
            box.appendChild(label);
        });

        const toggle = document.getElementById(ids.toggle);
        if (toggle) {
            toggle.onchange = () => {
                box.querySelectorAll('input[type="checkbox"]').forEach((cb, i) => {
                    cb.checked = toggle.checked;
                    const id = _accionesGlobal[i]?.idAccion;
                    if (id) {
                        if (toggle.checked) _estadoGlobal[idRecurso].add(id);
                        else _estadoGlobal[idRecurso].delete(id);
                    }
                });
                const pillBtn = document.querySelector(`.pill-admin[data-id="${idRecurso}"]`);
                if (pillBtn) applyPillStyle(pillBtn, true);
            };
            syncTogglePanel(tipo, idRecurso);
        }
    }

    // 10. ELIMINAR DOCUMENTOS (modo edición)
    document.querySelectorAll('.btn-delete-doc').forEach(btn => {
        btn.addEventListener('click', async function () {
            const idDoc  = this.dataset.id;
            const nombre = this.dataset.nombre;
            const csrf   = document.querySelector('[name="_csrf"]')?.value;

            const confirm = await Swal.fire({
                icon: 'warning',
                title: '¿Eliminar documento?',
                text: `"${nombre}" se eliminará permanentemente.`,
                showCancelButton: true,
                confirmButtonColor: '#ef4444',
                cancelButtonColor: '#6b7280',
                confirmButtonText: 'Sí, eliminar',
                cancelButtonText: 'Cancelar',
            });
            if (!confirm.isConfirmed) return;

            try {
                const fd = new FormData();
                if (csrf) fd.append('_csrf', csrf);
                const res  = await fetch(`/admin/personal/documentos/eliminar/${idDoc}`, { method: 'POST', body: fd });
                const data = await res.json();
                if (data.success) {
                    this.closest('[data-doc-id]').remove();
                    Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1200, showConfirmButton: false });
                } else {
                    throw new Error(data.mensaje);
                }
            } catch (e) {
                Swal.fire({ icon: 'error', title: 'Error', text: e.message });
            }
        });
    });

})();
