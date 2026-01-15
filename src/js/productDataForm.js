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


//Check Sku Repetido
(function(){
        const checkSkuRepetido = document.getElementById('sku');
        checkSkuRepetido.addEventListener('change', async function(e) {
            let sku_ = e.target.value.trim().toUpperCase().replace(/[^A-Z0-9-_]/g, '');
            try {
                    const respuesta = await fetch(`/admin/json/sku/${sku_}`);
                    const resultado = await respuesta.json();
                    if (resultado && resultado.idProducto) {
                        //document.getElementById('errorSku').innerHTML
                        sku.value = ''
                        document.getElementById('sku').focus();
                        document.getElementById('guardar').disabled = true;
                        errorSku.innerHTML = `
                                <p class="text-red-600 text-xs font-bold mt-1">
                                    ⚠️ El SKU "${sku_}" ya está registrado para otro producto.
                                </p>
                            `;
                    }else{

                    }
            } catch (error) {
                throw new Error(error)
            }
        })
})()
