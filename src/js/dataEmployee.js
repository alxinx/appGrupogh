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
                const response = await fetch(`/admin/json/personal/documento/${tipo}/${numero}`);
                const data = await response.json();
                if (data.exists) {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Documento Duplicado!',
                        text: 'Este empleado ya se encuentra registrado.',
                        confirmButtonColor: '#7e22ce'
                    });
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
                const response = await fetch(`/admin/json/personal/email/${email}`);
                const data = await response.json();
                if (data.exists) {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Email Duplicado!',
                        text: 'Este correo electrónico ya está en uso.',
                        confirmButtonColor: '#7e22ce'
                    });
                    this.value = '';
                }
            } catch (error) { console.error(error); }
        }
    });

    // 3. FOTO: CAMBIO DE ICONO AL SUBIR
    if (filePhoto) {
        filePhoto.addEventListener('change', function (e) {
            if (this.files && this.files[0]) {
                if (photoIconContainer) {
                    photoIconContainer.innerHTML = '<i class="fi-rr-thumbs-up text-3xl"></i>';
                    photoIconContainer.classList.add('text-green-500');
                    photoIconContainer.classList.remove('text-purple-500');
                }
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

    // 5. ENVÍO DEL FORMULARIO
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            // Validaciones básicas requeridas
            const required = ['PrimerNombre', 'PrimerApellido', 'TipoDocumento', 'NumeroDocumento', 'fechaNacimiento', 'direccionResidencia', 'emailEmpleado', 'telefonoContacto', 'tipoContrato', 'cargo', 'salarioBase'];

            // Si es vendedor o bodega, la sede es obligatoria
            const cargo = cargoSelect.value;
            if (cargo === 'vendedor' || cargo === 'bodega') {
                required.push('idPuntoDeVenta');
            
            }


            let valid = true;
            required.forEach(id => {
                const el = document.getElementById(id) || document.getElementsByName(id)[0];
                if (!el || !el.value) {
                    el?.classList.add('border-red-500');
                    valid = false;
                } else {
                    el?.classList.remove('border-red-500');
                }
            });

            if (!valid) {
                Swal.fire({ icon: 'warning', title: 'Faltan datos 🧐', text: 'Debes llenar todos los datos obligatorios.', confirmButtonColor: '#7e22ce' });
                return;
            }

            const formData = new FormData(form);
            guardarBtn.disabled = true;
            guardarBtn.innerHTML = '<i class="fi-rr-spinner animate-spin"></i> Guardando...';

            try {
                const response = await fetch('/admin/personal/new', {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();
                if (result.success) {
                    await Swal.fire({ icon: 'success', title: '¡Empleado Guardado!', text: result.mensaje, confirmButtonColor: '#7e22ce' });
                    window.location.href = '/admin/personal';
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

        // Valores por defecto: Antioquia (05), Medellin (05001)
        if (!deptoSelect.value) {
            deptoSelect.value = '05';
            loadCiudades('05', '05001');
        } else {
            loadCiudades(deptoSelect.value, ciudadSelect ? ciudadSelect.dataset.selected : null);
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

})();
