(function() {
    document.addEventListener('DOMContentLoaded', function() {
        
        // --- 1. LÓGICA DE CATEGORÍAS Y SUBCATEGORÍAS ---
        const checkboxesCategorias = document.querySelectorAll('.categoria-checkbox');
        const contenedorSubCategorias = document.getElementById('SubCategorias');

        checkboxesCategorias.forEach(checkbox => {
            checkbox.addEventListener('change', async function(e) {
                const idCategoria = e.target.value;
                const idContenedorGrupo = `grupo-sub-cat-${idCategoria}`;

                if (e.target.checked) {
                    if (document.getElementById(idContenedorGrupo)) return;
                    try {
                        const respuesta = await fetch(`/admin/json/categorias/${idCategoria}`);
                        const resultado = await respuesta.json();
                        if (resultado.length > 0) {
                            const grupoDiv = document.createElement('div');
                            grupoDiv.id = idContenedorGrupo;
                            grupoDiv.className = 'flex flex-wrap gap-2 contents';
                            resultado.forEach(element => {
                                grupoDiv.innerHTML += `
                                    <label class="subItems bg-[#EBE1F2]" data-parent="${idCategoria}">
                                        <input type="checkbox" name="subcategorias" value="${element.idCategoria}" class="w-4 h-4 rounded border-gray-300">
                                        <span class="text-[10px] font-bold uppercase">${element.nombreCategoria}</span>
                                    </label>`;
                            });
                            contenedorSubCategorias.appendChild(grupoDiv);
                        }
                    } catch (error) { console.error("Error:", error); }
                } else {
                    const grupoAEliminar = document.getElementById(idContenedorGrupo);
                    if (grupoAEliminar) grupoAEliminar.remove();
                }
            });
        });

        // --- 2. LÓGICA DE VARIANTES (TALLA / COLOR) ---
        let variantesSeleccionadas = {}; 
        let tallaActualId = null;

        const modal = document.getElementById('modalColores');
        const triggersTalla = document.querySelectorAll('.talla-trigger');
        const checksColor = document.querySelectorAll('.color-checkbox');

        // Función para actualizar el resumen (Movida adentro para acceder a variables locales)
        const renderizarResumen = () => {
            const contenedor = document.getElementById('resumenVariantes');
            if(!contenedor) return;
            
            contenedor.innerHTML = '';
            const keys = Object.keys(variantesSeleccionadas);
            //Aqui miro si el usuario seleccioono una talla pero no selecciono ningún color :( 
            if (keys.length === 0) {
                contenedor.innerHTML = '<span class="text-gray-400 text-sm italic">No hay combinaciones seleccionadas...</span>';
                return;
            }

            keys.forEach(idTalla => {
                const trigger = document.querySelector(`.talla-trigger[value="${idTalla}"]`);
                const nombreTalla = trigger ? trigger.dataset.nombre : idTalla;
                
                const card = document.createElement('div');
                card.className = "flex items-center bg-white border border-gray-200 rounded-lg p-2 shadow-sm animate-fade-in";
                
                const nombresColores = variantesSeleccionadas[idTalla].map(idColor => {
                    const check = document.querySelector(`.color-checkbox[value="${idColor}"]`);
                    return check ? check.dataset.nombre : 'Color';
                }).join(', ');

                card.innerHTML = `
                    <div class="flex flex-col">
                        <span class="text-[12px] font-black  text-gh-primaryHover uppercase">Talla ${nombreTalla}</span>
                        <span class="text-xs text-gray-600 font-medium">${nombresColores}</span>
                    </div>
                    <button type="button" class="ml-3 text-gray-300 cursor-pointer hover:text-red-500" onclick="eliminarTalla('${idTalla}')">
                        <i class="fi-rr-trash text-sm"></i>
                    </button>`;
                contenedor.appendChild(card);
            });

            // Sincronizar con el input hidden para el post
            const inputHidden = document.getElementById('variantes_finales');
            if(inputHidden) inputHidden.value = JSON.stringify(variantesSeleccionadas);
        };

        triggersTalla.forEach(trigger => {
            trigger.addEventListener('change', function() {
                if (this.checked) {
                    tallaActualId = this.value;
                    document.getElementById('tallaTitulo').innerText = this.dataset.nombre;
                    // preparo el modal
                    const seleccionados = variantesSeleccionadas[tallaActualId] || [];
                    checksColor.forEach(c => c.checked = seleccionados.includes(c.value));
                    modal.classList.remove('hidden');
                } else {
                    delete variantesSeleccionadas[this.value];
                    renderizarResumen();
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

        document.getElementById('cerrarModal').addEventListener('click', () => modal.classList.add('hidden'));

        // Exponer eliminarTalla al objeto global window
        window.eliminarTalla = function(idTalla) {
            const checkTalla = document.querySelector(`.talla-trigger[value="${idTalla}"]`);
            if (checkTalla) {
                checkTalla.checked = false;
                checkTalla.dispatchEvent(new Event('change'));
            }
        };
    });
})();



// Referencias
const checkActivo = document.getElementById('activo');
const checkWeb = document.getElementById('disponible_web');
const seccionSeo = document.getElementById('seccion-web-seo');
const inputNombre = document.getElementById('nombreProducto'); 
const inputSlug = document.getElementById('slug');

// 1. Lógica de visibilidad y dependencia
function actualizarEstadoWeb() {
    if (!checkActivo.checked) {
        // Si el producto no está activo, forzamos web a false y disabled
        checkWeb.checked = false;
        checkWeb.disabled = true;
        checkWeb.closest('label').classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        checkWeb.disabled = false;
        checkWeb.closest('label').classList.remove('opacity-50', 'cursor-not-allowed');
    }
    
    // Mostrar/Ocultar formularios SEO
    if (checkWeb.checked && !checkWeb.disabled) {
        seccionSeo.classList.remove('hidden');
    } else {
        seccionSeo.classList.add('hidden');
    }
}

// 2. Generador de Slug
function generarSlug(texto) {
    return texto
        .toString()
        .toLowerCase()
        .trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Quito tildes
        .replace(/\s+/g, '-')           // este Cambia espacios por guiones
        .replace(/[^\w\-]+/g, '')       // Esto Quita caracteres no permitidos
        .replace(/\-\-+/g, '-');        // Aqui evito guiones dobles
}

// Listeners
checkActivo.addEventListener('change', actualizarEstadoWeb);
checkWeb.addEventListener('change', actualizarEstadoWeb);

inputNombre.addEventListener('input', (e) => {
    inputSlug.value = generarSlug(e.target.value);
});

// Ejecutar al cargar por si vienen datos de edición
actualizarEstadoWeb();


//VISUALIZACION DE IMAGENES Y PRE-CARGA
(function(){
    const uploadInput = document.getElementById('upload-images');
    const previewContainer = document.getElementById('preview-container');
    // Objeto para manipular los archivos del input
    let archivosActuales = new DataTransfer(); 

    uploadInput.addEventListener('change', function(e) {
        const files = Array.from(e.target.files);

        files.forEach(file => {
            if (!file.type.startsWith('image/')) return;
            
            // Añadimos el archivo al manipulador
            archivosActuales.items.add(file);

            const reader = new FileReader();
            reader.onload = (event) => {
                const div = document.createElement('div');
                div.className = "w-20 h-20 rounded-xl bg-gray-100 border border-gray-100 relative overflow-hidden group animate-fade-in";
                // Guardamos el nombre del archivo para saber cuál borrar luego
                div.dataset.fileName = file.name; 
                
                div.innerHTML = `
                    <img src="${event.target.result}" class="w-full h-full object-cover">
                    <button type="button" class="btn-delete-img absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                `;
                previewContainer.insertBefore(div, previewContainer.lastElementChild);
            };
            reader.readAsDataURL(file);
        });

        // Sincronizamos el input con nuestro manipulador
        uploadInput.files = archivosActuales.files;
    });

    // Delegación de eventos para borrar
    previewContainer.addEventListener('click', function(e) {
        const btn = e.target.closest('.btn-delete-img');
        if (btn) {
            const card = btn.parentElement;
            const nombreABorrar = card.dataset.fileName;

            // 1. Borrar visualmente
            card.remove();

            // 2. Borrar del objeto DataTransfer
            const nuevoDataTransfer = new DataTransfer();
            Array.from(archivosActuales.files)
                .filter(file => file.name !== nombreABorrar)
                .forEach(file => nuevoDataTransfer.items.add(file));
            
            archivosActuales = nuevoDataTransfer;
            uploadInput.files = archivosActuales.files; // Sincronizar input
        }
    });
})();



//GUARDO ASYNC
(function() {
    const formulario = document.querySelector('#formularioProducto');
    const btnGuardar = document.querySelector('#guardar');

    // Función para mostrar errores
    function mostrarErrores(errores) {
        // Limpio los errores que pudieron haber antes.
        document.querySelectorAll('.error-msg').forEach(el => el.remove());
        document.querySelectorAll('.field-text, .checkbox').forEach(el => el.classList.remove('border-red-500'));

        // 'errores' ahora viene como un objeto { campo: mensaje } desde el back corregido
        Object.entries(errores).forEach(([campo, mensaje]) => {
            const input = document.querySelector(`[name="${campo}"]`);
            if (input) {
                const divError = document.createElement('div');
                divError.className = 'label-error animate-fade-in';
                divError.textContent = mensaje;
                
                input.parentElement.appendChild(divError);
                input.classList.add('border-red-500');
            }
        });
    }

    formulario.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        Swal.fire({
            title: 'Guardando producto...',
            text: 'Por favor espera un momento',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
        



        btnGuardar.disabled = true;
        btnGuardar.innerHTML = '<i class="fi-rr-spinner animate-spin"></i> Guardando...';

        const formData = new FormData(formulario);
        try {
            const respuesta = await fetch(formulario.action, {
                method: 'POST',
                body: formData,
                headers: {
                    'X-Requested-With': 'XMLHttpRequest' 
                }
            });

            const resultado = await respuesta.json();

            if (resultado.errores) {
                mostrarErrores(resultado.errores);
                btnGuardar.disabled = false;
                btnGuardar.innerHTML = '<i class="fi-rr-disk"></i> Guardar Salir';
            } else {
                
                Swal.fire({
                    icon: 'success',
                    title: '¡Todo listo!',
                    text: resultado.mensaje || 'Producto creado correctamente',
                    confirmButtonText: 'Ir al listado',
                    timer: 2000,
                    timerProgressBar: true
                }).then(() => {
                    window.location.href = '/admin/inventario/ingreso'; // Rediriges al terminar
                });
            }
        } catch (error) {
            console.error('Error:', error);
            btnGuardar.disabled = false;
            // Errores de validación o del servidor
            Swal.fire({
                icon: 'error',
                title: 'Ops...',
                text: resultado.mensaje || 'Hubo un error al guardar',
            });
        }
    });
})();


(function() {
    const btnGuardar = document.getElementById('guardar');

    // Función genérica para validar unicidad
    const validarUnicidad = async (input, tipo) => {
        let valor = input.value.trim().toUpperCase().replace(/[^A-Z0-9-_]/g, '');
        input.value = valor; // Reflejar la limpieza en el input

        if (!valor) return;

        try {
            const respuesta = await fetch(`/admin/json/${tipo}/${valor}`);
            const resultado = await respuesta.json();

            const contenedorError = document.getElementById(`error${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`);

            if (resultado && resultado.idProducto) {
                input.value = '';
                input.focus();
                btnGuardar.disabled = true;

                // Usamos una alerta sutil o el mensaje de error
                contenedorError.innerHTML = `
                    <p class="text-red-600 text-xs font-bold mt-1 uppercase">
                        ⚠️ EL ${tipo.toUpperCase()} "${valor}" YA EXISTE.
                    </p>`;
                
                // Opcional: SweetAlert2 para una interrupción clara
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
                contenedorError.innerHTML = '';
                btnGuardar.disabled = false;
            }
        } catch (error) {
            console.error(`Error validando ${tipo}:`, error);
        }
    };

    // Listeners limpios
    document.getElementById('sku').addEventListener('change', (e) => validarUnicidad(e.target, 'sku'));
    document.getElementById('ean').addEventListener('change', (e) => validarUnicidad(e.target, 'ean'));
})();






//FORMATO PESOS COLOMBIANOS PARA LOS PRECIOS DE MAYORISTAS Y MINORISTAS!
(function(){
    const inputMinorista = document.getElementById('precioVentaMayorista');
    const inputMayorista = document.getElementById('precioVentaPublicoFinal');

    const money = (n) => {
        const value = String(n).replace(/\D/g, '');
        if(!value) return "";
        
        return new Intl.NumberFormat('es-CO', {
            maximumFractionDigits: 0
        }).format(value);
    };

    [inputMinorista, inputMayorista].forEach(input => {
        if(!input) return;
        input.addEventListener('input', function(e) {
            let cursorPosition = e.target.selectionStart;
            let valueOriginal = e.target.value;

            // Formatear
            e.target.value = money(e.target.value);

            if (valueOriginal.length < e.target.value.length) cursorPosition++;
            e.target.setSelectionRange(cursorPosition, cursorPosition);
        });
    });
})();