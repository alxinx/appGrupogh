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
                    const buscador = document.getElementById('buscadorColor');
                    if (buscador) { buscador.value = ''; filtrarColores(''); }
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
                    const buscador = document.getElementById('buscadorColor');
                    if (buscador) { buscador.value = ''; filtrarColores(''); }
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

        document.getElementById('cerrarModal').onclick = () => {
            modal.classList.add('hidden');
            const buscador = document.getElementById('buscadorColor');
            if (buscador) { buscador.value = ''; filtrarColores(''); }
        };

        const filtrarColores = (texto) => {
            const termino = texto.toLowerCase().trim();
            document.querySelectorAll('#gridColores label').forEach(label => {
                const nombre = label.querySelector('span')?.textContent.toLowerCase() || '';
                label.style.display = nombre.includes(termino) ? '' : 'none';
            });
        };

        const buscadorColor = document.getElementById('buscadorColor');
        if (buscadorColor) {
            buscadorColor.addEventListener('input', (e) => filtrarColores(e.target.value));
        }
        
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

    async function procederConGuardado() {
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
                const mensajes = Object.values(resultado.errores).join('\n');
                Swal.fire({
                    icon: 'error',
                    title: 'Error de validación',
                    text: mensajes,
                    confirmButtonColor: '#EC5FA3'
                });
            } else if (resultado.mensaje && !resultado.success) {
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: resultado.mensaje,
                    confirmButtonColor: '#EC5FA3'
                });
            } else {
                if (resultado.idsProductos && resultado.idsProductos.length > 1) {
                    window.open(`/admin/inventario/etiqueta-sku/${resultado.idsProductos[0]}?ids=${resultado.idsProductos.join(',')}`, '_blank');
                } else if (resultado.idProducto) {
                    window.open(`/admin/inventario/etiqueta-sku/${resultado.idProducto}`, '_blank');
                }
                Swal.fire({
                    icon: 'success',
                    title: resultado.mensaje || '¡Producto Guardado!',
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
    }

    // --- 8.1 CONFIRMACIÓN DE SKU AUTOGENERADO POR COMBINACIÓN ---
    function nombreTallaPorId(idTalla) {
        const el = document.querySelector(`.talla-trigger[value="${idTalla}"]`);
        return el ? el.dataset.nombre : 'S/N';
    }
    function nombreColorPorId(idColor) {
        const el = document.querySelector(`.color-checkbox[value="${idColor}"]`);
        return el ? el.dataset.nombre : 'Color';
    }
    function codigoColorPorId(idColor) {
        const el = document.querySelector(`.color-checkbox[value="${idColor}"]`);
        const swatch = el?.closest('label')?.querySelector('div[style*="background-color"]');
        return swatch ? swatch.style.backgroundColor : '#ccc';
    }

    // Miniaturas actualmente en preview-container: nuevas (dataset.fileName) o existentes (.btn-delete-existente[data-id])
    function obtenerMiniaturasDisponibles() {
        const contenedor = document.getElementById('preview-container');
        if (!contenedor) return [];
        const miniaturas = [];
        let indiceNuevo = 0;
        Array.from(contenedor.children).forEach(card => {
            if (card.classList.contains('hidden')) return; // marcada para borrar
            const img = card.querySelector('img');
            if (!img) return; // slot de "agregar más"
            const btnExistente = card.querySelector('.btn-delete-existente');
            if (btnExistente) {
                miniaturas.push({ key: `existente:${btnExistente.dataset.id}`, src: img.src });
            } else if (card.dataset.fileName) {
                miniaturas.push({ key: `nuevo:${indiceNuevo}`, src: img.src });
                indiceNuevo++;
            }
        });
        return miniaturas;
    }

    function abrirModalConfirmacionSku(variantesActuales) {
        const modal = document.getElementById('modalConfirmSku');
        const listaSku = document.getElementById('listaSkuCombinaciones');
        const listaColores = document.getElementById('listaColoresImagenes');
        const skuBase = (document.getElementById('sku')?.value || 'PROD').trim().toUpperCase();

        // 1. Construir combinaciones y SKU sugerido
        const combos = [];
        const coloresUnicos = new Set();
        let contador = 1;
        Object.entries(variantesActuales).forEach(([idTalla, colores]) => {
            (colores || []).forEach(idColor => {
                combos.push({
                    idAtributos: `${idTalla}|${idColor}`,
                    nombreTalla: nombreTallaPorId(idTalla),
                    idColor,
                    nombreColor: nombreColorPorId(idColor),
                    skuSugerido: `${skuBase}-${String(contador).padStart(2, '0')}`
                });
                coloresUnicos.add(idColor);
                contador++;
            });
        });

        listaSku.innerHTML = combos.map(c => `
            <div class="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2">
                <span class="text-xs font-bold text-gray-500 flex-1">Talla ${c.nombreTalla} · ${c.nombreColor}</span>
                <input type="text" class="input-sku-combo field-text w-44 text-sm uppercase" data-key="${c.idAtributos}" value="${c.skuSugerido}">
            </div>
        `).join('');

        // 2. Emparejar imágenes por color
        const miniaturas = obtenerMiniaturasDisponibles();
        const imagenesPorColor = {}; // idColor -> Set(keys)

        listaColores.innerHTML = Array.from(coloresUnicos).map(idColor => `
            <div class="border border-gray-100 rounded-xl p-3">
                <div class="flex items-center gap-2 mb-2">
                    <span class="w-4 h-4 rounded-full inline-block shadow-sm" style="background-color:${codigoColorPorId(idColor)}"></span>
                    <span class="text-xs font-bold uppercase">${nombreColorPorId(idColor)}</span>
                </div>
                <div class="flex flex-wrap gap-2" data-color-thumbs="${idColor}">
                    ${miniaturas.length === 0
                        ? '<span class="text-xs text-gray-300 italic">No hay imágenes subidas todavía</span>'
                        : miniaturas.map(m => `
                            <button type="button" class="thumb-color-toggle w-12 h-12 rounded-lg overflow-hidden border-2 border-transparent" data-img-key="${m.key}" data-color="${idColor}">
                                <img src="${m.src}" class="w-full h-full object-cover">
                            </button>
                        `).join('')
                    }
                </div>
            </div>
        `).join('');

        listaColores.querySelectorAll('.thumb-color-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const idColor = btn.dataset.color;
                const key = btn.dataset.imgKey;
                if (!imagenesPorColor[idColor]) imagenesPorColor[idColor] = new Set();
                if (imagenesPorColor[idColor].has(key)) {
                    imagenesPorColor[idColor].delete(key);
                    btn.classList.remove('border-pink-500');
                } else {
                    imagenesPorColor[idColor].add(key);
                    btn.classList.add('border-pink-500');
                }
            });
        });

        modal.classList.remove('hidden');

        const cerrar = () => modal.classList.add('hidden');
        document.getElementById('cerrarModalSku').onclick = cerrar;

        document.getElementById('confirmarSkuGuardar').onclick = () => {
            const inputs = listaSku.querySelectorAll('.input-sku-combo');
            const variantesSku = {};
            const skusVistos = new Set();
            let hayError = false;

            inputs.forEach(input => {
                const valor = input.value.trim().toUpperCase().replace(/[^A-Z0-9-_]/g, '');
                input.value = valor;
                if (!valor || skusVistos.has(valor)) hayError = true;
                skusVistos.add(valor);
                variantesSku[input.dataset.key] = valor;
            });

            if (hayError) {
                Swal.fire({
                    icon: 'warning',
                    title: 'SKU inválidos',
                    text: 'Cada combinación necesita un SKU único y no vacío.',
                    confirmButtonColor: '#EC5FA3'
                });
                return;
            }

            const imagenesColorNuevas = {};
            const imagenesColorExistentes = {};
            Object.entries(imagenesPorColor).forEach(([idColor, keys]) => {
                keys.forEach(key => {
                    const [tipo, valor] = key.split(':');
                    if (tipo === 'nuevo') imagenesColorNuevas[valor] = idColor;
                    else imagenesColorExistentes[valor] = idColor;
                });
            });

            document.getElementById('variantes_sku').value = JSON.stringify(variantesSku);
            document.getElementById('imagenes_color_nuevas').value = JSON.stringify(imagenesColorNuevas);
            document.getElementById('imagenes_color_existentes').value = JSON.stringify(imagenesColorExistentes);

            cerrar();
            procederConGuardado();
        };
    }

    formulario.addEventListener('submit', function(e) {
        e.preventDefault();

        const limpiarPrecio = (val) => parseInt(String(val).replace(/\D/g, '')) || 0;
        const mayorista = limpiarPrecio(document.getElementById('precioVentaMayorista')?.value);
        const publico   = limpiarPrecio(document.getElementById('precioVentaPublicoFinal')?.value);

        if (mayorista <= 0 || publico <= 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Precios requeridos',
                text: 'El precio mayorista y el precio al público deben ser mayores a $0.',
                confirmButtonColor: '#EC5FA3'
            });
            return;
        }

        if (mayorista >= publico) {
            Swal.fire({
                icon: 'warning',
                title: 'Precio inválido',
                text: 'El precio mayorista debe ser menor que el precio al público final.',
                confirmButtonColor: '#EC5FA3'
            });
            return;
        }

        const variantesActuales = JSON.parse(document.getElementById('variantes_finales')?.value || '{}');
        const totalCombos = Object.values(variantesActuales).reduce((acc, colores) => acc + (colores?.length || 0), 0);

        if (totalCombos > 1) {
            abrirModalConfirmacionSku(variantesActuales);
            return;
        }

        procederConGuardado();
    });
})();

// FORMATO PESOS COLOMBIANOS PARA LOS PRECIOS
(function(){
    const inputMayorista = document.getElementById('precioVentaMayorista');
    const inputMayoristaSurtido = document.getElementById('precioVentaMayoristaSurtido');
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

    const inputs = [inputMayorista, inputMayoristaSurtido, inputPublico];

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
