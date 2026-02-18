
(function () {
    // Referencias al DOM
    const nitInput = document.getElementById('nit');
    const form = document.getElementById('formularioProvedor');
    const fileInput = document.getElementById('upload-images');
    const previewContainer = document.getElementById('preview-container');
    const guardarBtn = document.getElementById('guardar');

    // DataTransfer para manejar los archivos
    const dt = new DataTransfer();

    // 1. VALIDACIÓN DE NIT EN TIEMPO REAL
    if (nitInput) {
        nitInput.addEventListener('blur', async function () {
            const nit = this.value.trim();
            if (nit.length > 3) {
                try {
                    const response = await fetch(`/admin/api/check-nit/${nit}`);
                    const data = await response.json();

                    if (data.exists) {
                        Swal.fire({
                            icon: 'error',
                            title: '¡NIT Duplicado!',
                            text: 'Este número de identificación ya se encuentra registrado en el sistema.',
                            confirmButtonColor: '#7e22ce'
                        });
                        this.value = '';
                        this.focus();
                    }
                } catch (error) {
                    console.error('Error validando NIT:', error);
                }
            }
        });
    }

    // 2. PREVISUALIZACIÓN Y MANEJO DE ARCHIVOS
    if (fileInput) {
        fileInput.addEventListener('change', function (e) {
            const newFiles = Array.from(e.target.files);

            // Validar límites antes de agregar
            if (dt.files.length + newFiles.length > 10) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Límite excedido',
                    text: 'Solo se permiten máximo 10 archivos en total.',
                    confirmButtonColor: '#7e22ce'
                });
                return; // No agregamos nada si se pasa
            }

            // Agregar nuevos archivos al DataTransfer
            newFiles.forEach(file => {
                // Opcional: Validar duplicados por nombre si se desea
                dt.items.add(file);
            });

            // Actualizar el input con todos los archivos acumulados
            fileInput.files = dt.files;

            // Renderizar vista previa
            renderPreviews();
        });
    }

    function renderPreviews() {
        previewContainer.innerHTML = '';

        Array.from(dt.files).forEach((file, index) => {
            const reader = new FileReader();
            const isImage = file.type.startsWith('image/');
            const isPdf = file.type === 'application/pdf';
            const isWord = file.type.includes('word');
            const isExcel = file.type.includes('excel') || file.type.includes('spreadsheet');

            const div = document.createElement('div');
            // Añadimos clase 'relative' para posicionar el botón de borrar
            div.className = "relative w-24 h-24 rounded-xl border border-gray-200 overflow-hidden shadow-sm flex flex-col items-center justify-center p-1 bg-white group hover:border-purple-400 transition-colors";

            // Botón de eliminar (visible siempre o en hover, aquí lo pondremos visible)
            const deleteBtn = document.createElement('button');
            deleteBtn.className = "absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-20";
            deleteBtn.innerHTML = '<i class="fi-rr-cross-small"></i>';
            deleteBtn.onclick = (e) => {
                e.preventDefault(); // Evitar submit
                removeFile(index);
            };
            div.appendChild(deleteBtn);

            if (isImage) {
                reader.onload = (e) => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.className = "w-full h-full object-cover rounded-lg";
                    div.insertBefore(img, div.firstChild); // Insertar antes del botón (aunque position absolute lo maneja)

                    const nameSpan = document.createElement('span');
                    nameSpan.className = "text-[9px] w-full text-center truncate absolute bottom-0 bg-white/80 px-1";
                    nameSpan.textContent = file.name;
                    div.appendChild(nameSpan);
                };
                reader.readAsDataURL(file);
            } else {
                let iconClass = "fi-rr-file text-gray-400";
                if (isPdf) iconClass = "fi-rr-file-pdf text-red-500";
                if (isWord) iconClass = "fi-rr-file-word text-blue-600";
                if (isExcel) iconClass = "fi-rr-file-excel text-green-600";

                // Contenido HTML asíncrono no necesario aquí simple
                div.insertAdjacentHTML('afterbegin', `
                    <i class="${iconClass} text-3xl mb-1 mt-2"></i>
                    <span class="text-[9px] w-full text-center break-words leading-tight px-1 z-10">${file.name}</span>
                `);
            }
            previewContainer.appendChild(div);
        });
    }

    function removeFile(index) {
        // DataTransfer.items no tiene método remove(index) directamente compatible en todos, 
        // pero podemos reconstruir el DataTransfer.
        const newDt = new DataTransfer();
        Array.from(dt.files).forEach((file, i) => {
            if (i !== index) newDt.items.add(file);
        });

        // Actualizar referencia global y input
        dt.items.clear();
        Array.from(newDt.files).forEach(f => dt.items.add(f));
        fileInput.files = dt.files;

        renderPreviews();
    }


    // 3. ENVÍO DEL FORMULARIO
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            // A. Validación Categorías
            const categoriasCheckboxes = document.querySelectorAll('input[name="categorias"]:checked');
            if (categoriasCheckboxes.length === 0) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Falta Categoría',
                    text: 'Debes seleccionar al menos una categoría para el proveedor.',
                    confirmButtonColor: '#7e22ce'
                });
                return;
            }

            // B. Preparar Datos
            const formData = new FormData(form);
            // El input file ya tiene los archivos correctos gracias a dt sync

            guardarBtn.disabled = true;
            guardarBtn.innerHTML = '<i class="fi-rr-spinner animate-spin"></i> Guardando...';

            try {
                const response = await fetch('/admin/provedores/new', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    await Swal.fire({
                        icon: 'success',
                        title: '¡Guardado!',
                        text: 'El proveedor se ha registrado correctamente.',
                        confirmButtonColor: '#7e22ce'
                    });

                    form.reset();
                    dt.items.clear(); // Limpiar DataTransfer
                    previewContainer.innerHTML = '';

                } else {
                    throw new Error(result.mensaje || 'Error desconocido al guardar');
                }

            } catch (error) {
                console.error(error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    html: error.message || 'Hubo un problema al guardar el proveedor.',
                    confirmButtonColor: '#7e22ce'
                });
            } finally {
                guardarBtn.disabled = false;
                guardarBtn.innerHTML = '<i class="fi-rr-disk"></i> Guardar';
            }
        });
    }

    // Lógica original de selectores anidados (Departamento -> Ciudad)
    const departamentoSelect = document.getElementById('departamentoSelect');
    const ciudadSelect = document.getElementById('ciudadSelect');

    if (departamentoSelect && ciudadSelect) {
        departamentoSelect.addEventListener('change', async function (e) {
            const departamentoId = e.target.value;
            ciudadSelect.innerHTML = '<option value="">-- Cargando --</option>';

            if (departamentoId === '') {
                ciudadSelect.innerHTML = '<option value="">-- Seleccione Dpto --</option>';
                ciudadSelect.disabled = true;
                return;
            }
            try {
                const url = `/admin/json/municipios/${departamentoId}`;
                const res = await fetch(url);
                const municipios = await res.json();

                ciudadSelect.innerHTML = '<option value="">-- Seleccione Ciudad --</option>';

                municipios.forEach(m => {
                    const option = document.createElement('option');
                    option.value = m.id;
                    option.textContent = m.nombre;
                    if (ciudadSelect.dataset.selected == m.id) option.selected = true;
                    ciudadSelect.appendChild(option);
                });
                ciudadSelect.disabled = false;
            } catch (err) { console.error(err); }
        });

        if (departamentoSelect.value !== '') {
            departamentoSelect.dispatchEvent(new Event('change'));
        }
    }

})();