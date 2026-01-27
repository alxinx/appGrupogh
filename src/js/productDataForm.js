(function() {
    document.addEventListener('DOMContentLoaded', function() {
        
        // --- 1. ESTADO INICIAL Y REFERENCIAS ---
        const inputHiddenVariantes = document.getElementById('variantes_finales');
        const contenedorSubCategorias = document.getElementById('SubCategorias');
        const resumenContainer = document.getElementById('resumenVariantes');
        const modal = document.getElementById('modalColores');
        const btnGuardarMaster = document.getElementById('guardar');
        
        const categoriasYaMarcadas = typeof categoriasSeleccionadas !== 'undefined' ? categoriasSeleccionadas : [];
        
        let variantesSeleccionadas = inputHiddenVariantes && inputHiddenVariantes.value !== "{}" 
            ? JSON.parse(inputHiddenVariantes.value) 
            : {}; 
        
        let tallaActualId = null;

        // --- 2. LÓGICA DE CATEGORÍAS Y SUBCATEGORÍAS ---
        const checkboxesCategorias = document.querySelectorAll('.categoria-checkbox');

        const cargarSubcategorias = async (idCategoria) => {
            const idContenedorGrupo = `grupo-sub-cat-${idCategoria}`;
            if (document.getElementById(idContenedorGrupo)) return;

            try {
                const respuesta = await fetch(`/admin/json/categorias/${idCategoria}`);
                const resultado = await respuesta.json();
                
                if (resultado.length > 0) {
                    const grupoDiv = document.createElement('div');
                    grupoDiv.id = idContenedorGrupo;
                    grupoDiv.className = 'flex flex-wrap gap-2 contents';
                    
                    resultado.forEach(element => {
                        const isChecked = categoriasYaMarcadas.includes(element.idCategoria) ? 'checked' : '';
                        
                        grupoDiv.innerHTML += `
                            <label class="subItems bg-[#EBE1F2] cursor-pointer" data-parent="${idCategoria}">
                                <input type="checkbox" name="categorias" value="${element.idCategoria}" 
                                       class="w-4 h-4 rounded border-gray-300 checkbox" ${isChecked}>
                                <span class="text-[10px] font-bold uppercase">${element.nombreCategoria}</span>
                            </label>`;
                    });
                    contenedorSubCategorias.appendChild(grupoDiv);
                }
            } catch (error) { console.error("Error en subcategorías:", error); }
        };

        checkboxesCategorias.forEach(checkbox => {
            checkbox.addEventListener('change', function(e) {
                if (e.target.checked) {
                    cargarSubcategorias(e.target.value);
                } else {
                    const grupo = document.getElementById(`grupo-sub-cat-${e.target.value}`);
                    if (grupo) grupo.remove();
                }
            });
        });

        // --- 3. LÓGICA DE VARIANTES Y RESUMEN INTERACTIVO ---
        const triggersTalla = document.querySelectorAll('.talla-trigger');
        const checksColor = document.querySelectorAll('.color-checkbox');

        const renderizarResumen = () => {
            if(!resumenContainer) return;
            resumenContainer.innerHTML = '';
            
            const keys = Object.keys(variantesSeleccionadas);
            if (keys.length === 0) {
                resumenContainer.innerHTML = '<span class="text-gray-400 text-sm italic">No hay combinaciones seleccionadas...</span>';
                return;
            }

            keys.forEach(idTalla => {
                const trigger = document.querySelector(`.talla-trigger[value="${idTalla}"]`);
                const nombreTalla = trigger ? trigger.dataset.nombre : 'S/N';
                
                const card = document.createElement('div');
                card.className = "flex items-center bg-white border border-gray-200 rounded-lg p-2 shadow-sm animate-fade-in cursor-pointer hover:bg-gray-50 transition-all";
                
                card.onclick = (e) => {
                    if (e.target.closest('button')) return;
                    tallaActualId = idTalla;
                    document.getElementById('tallaTitulo').innerText = nombreTalla;
                    const seleccionados = variantesSeleccionadas[idTalla] || [];
                    checksColor.forEach(c => c.checked = seleccionados.includes(c.value));
                    modal.classList.remove('hidden');
                };

                const nombresColores = variantesSeleccionadas[idTalla].map(idColor => {
                    const check = document.querySelector(`.color-checkbox[value="${idColor}"]`);
                    return check ? check.dataset.nombre : 'Color';
                }).join(', ');

                card.innerHTML = `
                    <div class="flex flex-col flex-1">
                        <span class="text-[12px] font-black text-gh-primaryHover uppercase">Talla ${nombreTalla}</span>
                        <span class="text-xs text-gray-600 font-medium">${nombresColores}</span>
                    </div>
                    <button type="button" class="ml-3 text-gray-300 hover:text-red-500 p-1" onclick="event.stopPropagation(); eliminarTalla('${idTalla}')">
                        <i class="fi-rr-trash text-sm"></i>
                    </button>`;
                resumenContainer.appendChild(card);
            });

            if(inputHiddenVariantes) inputHiddenVariantes.value = JSON.stringify(variantesSeleccionadas);
        };

        triggersTalla.forEach(trigger => {
            trigger.addEventListener('change', function() {
                if (this.checked) {
                    tallaActualId = this.value;
                    document.getElementById('tallaTitulo').innerText = this.dataset.nombre;
                    const seleccionados = variantesSeleccionadas[tallaActualId] || [];
                    checksColor.forEach(c => c.checked = seleccionados.includes(c.value));
                    modal.classList.remove('hidden');
                } else {
                    Swal.fire({
                        title: '¿Eliminar combinación?',
                        text: "Se borrarán los colores de esta talla.",
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: '#f472b6',
                        confirmButtonText: 'Sí, borrar',
                        cancelButtonText: 'Cancelar'
                    }).then((result) => {
                        if (result.isConfirmed) {
                            delete variantesSeleccionadas[this.value];
                            renderizarResumen();
                        } else {
                            this.checked = true;
                        }
                    });
                }
            });
        });

        document.getElementById('guardarColores').addEventListener('click', () => {
            const seleccionados = Array.from(checksColor).filter(c => c.checked).map(c => c.value);
            if (seleccionados.length > 0) {
                variantesSeleccionadas[tallaActualId] = seleccionados;
            } else {
                const checkTalla = document.querySelector(`.talla-trigger[value="${tallaActualId}"]`);
                if(checkTalla) checkTalla.checked = false;
                delete variantesSeleccionadas[tallaActualId];
            }
            modal.classList.add('hidden');
            renderizarResumen();
        });

        // --- 4. PROCESO DE HIDRATACIÓN INICIAL ---
        const hidratarFormulario = () => {
            checkboxesCategorias.forEach(checkbox => {
                if(checkbox.checked) cargarSubcategorias(checkbox.value);
            });

            Object.keys(variantesSeleccionadas).forEach(idTalla => {
                const check = document.querySelector(`.talla-trigger[value="${idTalla}"]`);
                if(check) check.checked = true;
            });

            renderizarResumen();
        };

        hidratarFormulario();

        document.getElementById('cerrarModal').onclick = () => modal.classList.add('hidden');
        
        window.eliminarTalla = (idTalla) => {
            Swal.fire({
                title: '¿Quitar talla?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#f472b6',
                confirmButtonText: 'Eliminar'
            }).then((result) => {
                if (result.isConfirmed) {
                    const checkTalla = document.querySelector(`.talla-trigger[value="${idTalla}"]`);
                    if (checkTalla) checkTalla.checked = false;
                    delete variantesSeleccionadas[idTalla];
                    renderizarResumen();
                }
            });
        };

        // --- 5. VALIDACIÓN ASÍNCRONA SKU / EAN ---
        const validarUnicidad = async (input, tipo) => {
            let valor = input.value.trim().toUpperCase().replace(/[^A-Z0-9-_]/g, '');
            input.value = valor; 

            if (!valor) return;

            try {
                const respuesta = await fetch(`/admin/json/${tipo}/${valor}`);
                const resultado = await respuesta.json();
                const contenedorError = document.getElementById(`error${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`);

                if (resultado && resultado.idProducto) {
                    input.value = '';
                    input.focus();
                    if(btnGuardarMaster) btnGuardarMaster.disabled = true;

                    contenedorError.innerHTML = `
                        <p class="text-red-600 text-xs font-bold mt-1 uppercase animate-pulse">
                            ⚠️ EL ${tipo.toUpperCase()} "${valor}" YA EXISTE.
                        </p>`;
                    
                    Swal.fire({
                        icon: 'warning',
                        title: `${tipo.toUpperCase()} Duplicado`,
                        text: `El código ${valor} ya pertenece a otro producto.`,
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 3000
                    });
                } else {
                    if(contenedorError) contenedorError.innerHTML = '';
                    if(btnGuardarMaster) btnGuardarMaster.disabled = false;
                }
            } catch (error) { console.error(`Error validando ${tipo}:`, error); }
        };

        const skuInput = document.getElementById('sku');
        const eanInput = document.getElementById('ean');
        if(skuInput) skuInput.addEventListener('change', (e) => validarUnicidad(e.target, 'sku'));
        if(eanInput) eanInput.addEventListener('change', (e) => validarUnicidad(e.target, 'ean'));

    });
})();

// --- 6. VISIBILIDAD, SEO Y SLUG ---
const checkActivo = document.getElementById('activo');
const checkWeb = document.getElementById('disponible_web');
const seccionSeo = document.getElementById('seccion-web-seo');
const inputNombre = document.getElementById('nombreProducto'); 
const inputSlug = document.getElementById('slug');

function actualizarEstadoWeb() {
    if (!checkActivo?.checked) {
        if(checkWeb) {
            checkWeb.checked = false;
            checkWeb.disabled = true;
            checkWeb.closest('label')?.classList.add('opacity-50', 'cursor-not-allowed');
        }
    } else {
        if(checkWeb) {
            checkWeb.disabled = false;
            checkWeb.closest('label')?.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
    
    if (checkWeb?.checked && !checkWeb?.disabled) {
        seccionSeo?.classList.remove('hidden');
    } else {
        seccionSeo?.classList.add('hidden');
    }
}

function generarSlug(texto) {
    return texto.toString().toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-');
}

if(checkActivo) checkActivo.addEventListener('change', actualizarEstadoWeb);
if(checkWeb) checkWeb.addEventListener('change', actualizarEstadoWeb);
if(inputNombre) inputNombre.addEventListener('input', (e) => {
    if(inputSlug) inputSlug.value = generarSlug(e.target.value);
});

actualizarEstadoWeb();

// --- 7. GESTIÓN DE IMÁGENES ---
(function(){
    const uploadInput = document.getElementById('upload-images');
    const previewContainer = document.getElementById('preview-container');
    let archivosActuales = new DataTransfer(); 

    if(!uploadInput) return;

    uploadInput.addEventListener('change', function(e) {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            if (!file.type.startsWith('image/')) return;
            if (file.size > 2 * 1024 * 1024) {
                Swal.fire('Error', 'Límite de 2MB superado', 'error');
                return;
            }

            archivosActuales.items.add(file);
            const reader = new FileReader();
            reader.onload = (ev) => {
                const div = document.createElement('div');
                div.className = "w-20 h-20 rounded-xl bg-gray-100 border relative group animate-fade-in";
                div.dataset.fileName = file.name; 
                div.innerHTML = `
                    <img src="${ev.target.result}" class="w-full h-full object-cover rounded-xl ">
                    <button type="button" class="btn-delete-img absolute -top-2 -right-2 cursor-pointer mt-1 ">
                        <i class="fi fi-rr-cross-circle bg-gh-primaryHover rounded-2xl p-1 pt-1.5 text-white "></i>
                    </button>`;
                previewContainer.insertBefore(div, previewContainer.lastElementChild);
            };
            reader.readAsDataURL(file);
        });
        uploadInput.files = archivosActuales.files;
    });

    previewContainer?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-delete-img');
        if (btn) {
            const card = btn.parentElement;
            const nombre = card.dataset.fileName;
            card.remove();
            const dt = new DataTransfer();
            Array.from(archivosActuales.files).filter(f => f.name !== nombre).forEach(f => dt.items.add(f));
            archivosActuales = dt;
            uploadInput.files = archivosActuales.files;
        }
    });
})();

// --- 7.1 GESTIÓN DE IMÁGENES EXISTENTES (Versión Blindada) ---
(function() {
    const previewContainer = document.getElementById('preview-container');
    const formulario = document.getElementById('formularioProducto');

    if (!previewContainer || !formulario) return;

    // Usamos delegación de eventos: escuchamos en el contenedor padre
    previewContainer.addEventListener('click', function(e) {
        // Buscamos si el clic fue en el botón de borrar existente
        const btnDelete = e.target.closest('.btn-delete-existente');
        
        if (btnDelete) {
            // Importante: Prevenir que el clic dispare otros eventos
            e.preventDefault();
            e.stopPropagation();

            const idImagen = btnDelete.dataset.id;
            const card = btnDelete.parentElement;

            Swal.fire({
                title: '¿Marcar para eliminar?',
                text: "La imagen se borrará permanentemente al actualizar el producto.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#f472b6',
                cancelButtonColor: '#d33',
                confirmButtonText: '✅ Sí, QUITAR',
                cancelButtonText: '❌ Cancelar'
            }).then((result) => {
                if (result.isConfirmed) {
                    // Verificamos si ya existe el input para este ID para no duplicar
                    const yaExiste = formulario.querySelector(`input[name="imagenes_borrar[]"][value="${idImagen}"]`);
                    
                    if (!yaExiste) {
                        // 1. Creamos el input oculto con el ID correcto
                        const inputBorrado = document.createElement('input');
                        inputBorrado.type = 'hidden';
                        inputBorrado.name = 'imagenes_borrar[]';
                        inputBorrado.value = idImagen;
                        formulario.appendChild(inputBorrado);

                        // 2. Feedback visual: Ocultamos la tarjeta
                        card.classList.add('hidden');
                        
                    }
                }
            });
        }
    });
})();

// --- 8. GUARDADO ASYNC Y REDIRECCIÓN ---
(function() {
    const formulario = document.querySelector('#formularioProducto');
    if (!formulario) return;

    formulario.addEventListener('submit', async function(e) {
        e.preventDefault(); 
        
        Swal.fire({
            title: 'Guardando producto...',
            text: 'Estamos procesando los datos e imágenes para el inventario.',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        const formData = new FormData(formulario);
        const token = document.querySelector('input[name="_csrf"]').value;
        try {
            const respuesta = await fetch(formulario.action, {
                method: 'POST',
                body: formData,
                headers: { 'x-csrf-token': token }
                
            });

            if (!respuesta.ok) {
                const textoError = await respuesta.text();
                throw new Error("Respuesta del servidor no es JSON");
            }

            const resultado = await respuesta.json();

            if (resultado.errores) {
                Swal.fire({
                    icon: 'error',
                    title: 'Error de validación',
                    text: 'Revisa los campos del formulario.'
                });
            } else {
                Swal.fire({
                    icon: 'success',
                    title: '¡Producto Guardado!',
                    text: 'Los cambios se aplicaron correctamente.',
                    timer: 2000,
                    showConfirmButton: false
                }).then(() => {
                    window.location.href = '/admin/inventario/listado'; 
                });
            }

        } catch (error) {
            console.error("Error en el envío:", error);
            Swal.fire('Error crítico', 'No se pudo conectar con el servidor.', 'error');
        }
    });
})();

// FORMATO PESOS COLOMBIANOS PARA LOS PRECIOS
(function(){
    const inputMayorista = document.getElementById('precioVentaMayorista');
    const inputPublico = document.getElementById('precioVentaPublicoFinal');

    // 1. Función para limpiar y formatear SOLO al cargar (Backend -> UI)
    const formatInitialValue = (n) => {
        if (!n) return "";
        // Quitamos decimales .00 solo si existen (viniendo de la DB)
        const value = String(n).split('.')[0].replace(/\D/g, '');
        return new Intl.NumberFormat('es-CO').format(value);
    };

    // 2. Función para formatear mientras se escribe (User -> UI)
    const formatOnInput = (n) => {
        // Aquí NO usamos split('.'), solo dejamos los números
        const value = String(n).replace(/\D/g, '');
        if (!value) return "";
        return new Intl.NumberFormat('es-CO').format(value);
    };

    const inputs = [inputMayorista, inputPublico];

    inputs.forEach(input => {
        if(!input) return;

        // --- PASO A: Hidratación al cargar ---
        // Usamos la lógica que limpia el ".00"
        if (input.value) {
            input.value = formatInitialValue(input.value);
        }

        // --- PASO B: Evento de escritura ---
        input.addEventListener('input', function(e) {
            let cursorPosition = e.target.selectionStart;
            let valueOriginal = e.target.value;

            // Usamos la lógica que NO corta por el punto
            const formattedValue = formatOnInput(valueOriginal);
            
            const diff = formattedValue.length - valueOriginal.length;
            e.target.value = formattedValue;

            // Ajuste de cursor para que la experiencia sea fluida en Medellín
            e.target.setSelectionRange(cursorPosition + diff, cursorPosition + diff);
        });
    });
})();


//**************************SECCION DE EDICION **************************///
// --- 5. VALIDACIÓN DE UNICIDAD (SKU / EAN) ---
(function() {
    // Definimos la función de validación
    const validarUnicidad = async (input, tipo) => {
        const valor = input.value.trim().toUpperCase();
        const idProducto = document.querySelector('input[name="idProducto"]')?.value;
        const idContenedor = `error${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`;
        const contenedorError = document.getElementById(idContenedor);
        const btnGuardar = document.getElementById('guardar');

        if (!valor) return;

        try {
            const url = `/admin/json/unicidad/${tipo}/${valor}${idProducto ? '?excludeId=' + idProducto : ''}`;
            const respuesta = await fetch(url);
            const resultado = await respuesta.json();

            if (resultado && resultado.idProducto) {
                // ESTADO: DUPLICADO
                input.classList.add('border-red-500', 'bg-red-50');
                if (btnGuardar) {
                    btnGuardar.disabled = true;
                    btnGuardar.classList.add('opacity-50', 'cursor-not-allowed');
                }

                Swal.fire({
                    icon: 'error',
                    title: `${tipo.toUpperCase()} Duplicado`,
                    text: `El código "${valor}" ya pertenece al producto: ${resultado.nombreProducto}`,
                    confirmButtonColor: '#f472b6'
                });

                if (contenedorError) {
                    contenedorError.innerHTML = `<p class="text-red-500 text-[10px] font-bold mt-1 uppercase">⚠️ ${tipo} en uso</p>`;
                    contenedorError.classList.remove('hidden');
                }
            } else {
                // ESTADO: LIBRE
                input.classList.remove('border-red-500', 'bg-red-50');
                input.classList.add('border-green-500');
                
                if (btnGuardar) {
                    btnGuardar.disabled = false;
                    btnGuardar.classList.remove('opacity-50', 'cursor-not-allowed');
                }

                if (contenedorError) contenedorError.classList.add('hidden');
            }
        } catch (error) {
            console.error(`Error validando ${tipo}:`, error);
        }
    };

    // --- ASIGNACIÓN DE EVENTOS (VITAL: Fuera de la función) ---
    document.addEventListener('DOMContentLoaded', () => {
        const inputSku = document.getElementById('sku');
        const inputEan = document.getElementById('ean');

        if (inputSku) {
            inputSku.addEventListener('change', (e) => validarUnicidad(e.target, 'sku'));
        }
        if (inputEan) {
            inputEan.addEventListener('change', (e) => validarUnicidad(e.target, 'ean'));
        }
    });
})();
