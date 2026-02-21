import { formatMoney, cleanMoney } from './utils.js';

(function() {
    const inputUnidades = document.querySelector('#unidadesPorPaquete');
    const contenedor = document.querySelector('#contenedor-productos');

    /* ==========================================
       1. ALGORITMO DE KITTING PROPORCIONAL
       ========================================== */
    const calcularKitting = (productos, capacidad) => {
        let stock = { ...productos };
        let totalUnidades = Object.values(stock).reduce((a, b) => a + b, 0);
        let numPacksCompletos = Math.floor(totalUnidades / capacidad);
        let planEmpaque = [];

        for (let i = 0; i < numPacksCompletos; i++) {
            let bolsa = {};
            let totalEnBolsa = 0;
            let stockRestanteBolsa = Object.values(stock).reduce((a, b) => a + b, 0);

            Object.keys(stock).forEach(sku => {
                let proporcion = stock[sku] / stockRestanteBolsa;
                let asignacion = Math.floor(proporcion * capacidad);
                asignacion = Math.min(asignacion, stock[sku]);
                bolsa[sku] = asignacion;
                totalEnBolsa += asignacion;
                stock[sku] -= asignacion;
            });

            while (totalEnBolsa < capacidad) {
                let skuPrioridad = Object.keys(stock).reduce((a, b) => stock[a] > stock[b] ? a : b);
                if (stock[skuPrioridad] > 0) {
                    bolsa[skuPrioridad]++;
                    stock[skuPrioridad]--;
                    totalEnBolsa++;
                } else break;
            }
            planEmpaque.push(bolsa);
        }

        const agruparConfiguraciones = (packs) => {
            const grupos = {};
            packs.forEach(p => {
                const key = JSON.stringify(Object.fromEntries(Object.entries(p).sort()));
                grupos[key] = (grupos[key] || 0) + 1;
            });
            return Object.entries(grupos).map(([config, cantidad]) => ({
                cantidad,
                detalle: JSON.parse(config)
            }));
        };

        return {
            packs: agruparConfiguraciones(planEmpaque),
            residuo: Object.fromEntries(Object.entries(stock).filter(([_, v]) => v > 0))
        };
    };

    /* ==========================================
       2. GESTIÓN DE CAPACIDAD (Doble Clic)
       ========================================== */
    inputUnidades.addEventListener('dblclick', function() {
        this.readOnly = false;
        this.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-75');
        this.classList.add('bg-white', 'border-blue-500');
        this.focus();
    });

    inputUnidades.addEventListener('blur', function() {
        let valor = parseInt(this.value);
        if (valor > 36 || valor <= 0 || isNaN(valor)) this.value = 12;
        this.readOnly = true;
        this.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-75');
        this.classList.remove('bg-white', 'border-blue-500');
        actualizarTodo();
    });

    /* ==========================================
       3. GESTIÓN DE FILAS Y EVENTOS
       ========================================== */
    document.addEventListener('click', (e) => {
        if (e.target.closest('.addMore')) {
            const filasActuales = document.querySelectorAll('.fila-producto').length;
            if (filasActuales >= parseInt(inputUnidades.value)) return Swal.fire('Límite alcanzado', '', 'warning');
            
            const nuevaFila = document.querySelector('.fila-producto').cloneNode(true);
            nuevaFila.querySelectorAll('input').forEach(i => i.value = '');
            nuevaFila.querySelector('.btn-remove-row').classList.remove('hidden');
            contenedor.appendChild(nuevaFila);
            nuevaFila.querySelector('.sku-input').focus();
            actualizarTodo();
        }

        if (e.target.closest('.btn-remove-row')) {
            if (document.querySelectorAll('.fila-producto').length > 1) {
                e.target.closest('.fila-producto').remove();
                actualizarTodo();
            }
        }
    });

    /* ==========================================
   3. ESCUCHA GLOBAL DE EVENTOS (Separados)
   ========================================== */

// Listener para cambios de texto y cálculos inmediatos
document.addEventListener('input', (e) => {
    if (e.target.matches('input[name="valorUnidad[]"]')) {
        let valorPuro = e.target.value.replace(/\D/g, "");
        if (valorPuro) e.target.value = formatMoney(valorPuro);
    }
    
    // Cualquier cambio en cantidad dispara el monitor y el kitting
    if (e.target.matches('input[name="cantidad[]"]') || e.target.matches('input[name="valorUnidad[]"]')) {
        actualizarTodo();
    }
});

// Listener para el SKU: Solo cuando el usuario termina de escribir (pierde el foco)
document.addEventListener('change', async (e) => {
    if (e.target.matches('.sku-input')) {
        const sku = e.target.value.trim();
        const fila = e.target.closest('.fila-producto');
        
        if (sku.length > 0) {
            await buscarSkuEnDB(sku, fila);
        } else {
            limpiarFilaDose(fila);
            actualizarTodo();
        }
    }
});

    /* ==========================================
       4. FUNCIONES DE ACTUALIZACIÓN Y UI
       ========================================== */
    async function buscarSkuEnDB(sku, fila) {
    const inputNombre = fila.querySelector('input[name="name[]"]');
    const inputId = fila.querySelector('input[name="idProducto[]"]');
    const btnGuardar = document.querySelector('#guardar');

    try {
        // Bloqueo preventivo mientras busca
        if (btnGuardar) btnGuardar.disabled = true;
        inputNombre.placeholder = "Verificando...";

        // Usamos ruta absoluta /json/sku/ para evitar fallos de navegación
        const respuesta = await fetch(`../json/sku/${sku}`);
        
        if (respuesta.ok) {
            const producto = await respuesta.json();
            
            if (producto && producto.idProducto) {
                // Éxito: Llenamos los datos
                inputNombre.value = producto.nombreProducto;
                inputId.value = producto.idProducto;
                inputNombre.classList.remove('border-red-500', 'text-red-600');
            } else {
                throw new Error("No encontrado");
            }
        } else {
            throw new Error("Error servidor");
        }
    } catch (error) {
        // Error: Limpiamos campos y alertamos al operario
        inputNombre.value = '';
        inputId.value = '';
        inputNombre.placeholder = "SKU INVÁLIDO";
        inputNombre.classList.add('border-red-500', 'text-red-600');

        Swal.fire({
            icon: 'error',
            title: 'SKU no registrado',
            text: `El código "${sku}" no existe en el sistema del Grupo GH.`,
            confirmButtonColor: '#3085d6',
            timer: 2500 // Se cierra solo para no frenar tanto la operación
        });
    } finally {
        // Recalculamos monitor y botones siempre al terminar la promesa
        actualizarTodo();
    }
}

    function limpiarFilaDose(fila) {
        fila.querySelector('input[name="name[]"]').value = '';
        fila.querySelector('input[name="idProducto[]"]').value = '';
    }

    function actualizarTodo() {
        validarFilasCompletas();
        actualizarMonitorDosificacion();
        procesarYMostrarKitting();
    }

   function validarFilasCompletas() {
    const filas = document.querySelectorAll('.fila-producto');
    const botonesAdd = document.querySelectorAll('.addMore');
    const btnGuardar = document.querySelector('#guardar');
    
    let todasOk = true;

    filas.forEach(f => {
        // Obtenemos los valores críticos de cada fila
        const idProd = f.querySelector('input[name="idProducto[]"]').value.trim();
        const cant = f.querySelector('input[name="cantidad[]"]').value.trim();
        const valUnidad = f.querySelector('input[name="valorUnidad[]"]').value.trim();

        // REGLA DE ORO: Si no hay ID de producto, la fila es inválida
        if (!idProd || idProd === "" || !cant || parseInt(cant) <= 0 || !valUnidad) {
            todasOk = false;
        }
    });

    // Control de botones "Agregar Más" (.addMore)
    botonesAdd.forEach(btn => {
        btn.disabled = !todasOk;
        if (!todasOk) {
            btn.classList.add('opacity-50', 'cursor-not-allowed');
            btn.title = "Debe cargar un producto válido y llenar todos los campos antes de agregar otro";
        } else {
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
            btn.title = "Agregar nueva referencia";
        }
    });

    // Control del botón de guardado final
    if (btnGuardar) {
        btnGuardar.disabled = !todasOk;
        btnGuardar.classList.toggle('opacity-50', !todasOk);
    }
}

    function actualizarMonitorDosificacion() {
        const cap = parseInt(inputUnidades.value) || 0;
        let total = 0;
        document.querySelectorAll('input[name="cantidad[]"]').forEach(i => total += parseInt(i.value) || 0);
        document.querySelector('#monitorTotalProductos').innerText = total.toLocaleString();
        document.querySelector('#monitorEstimacionPacks').innerText = Math.floor(total / (cap || 1));
        document.querySelector('#monitorSobrantes').innerText = total % (cap || 1);
    }

    function procesarYMostrarKitting() {
    const inputUnidades = document.querySelector('#unidadesPorPaquete');
    const filas = document.querySelectorAll('.fila-producto');
    const capacidad = parseInt(inputUnidades.value) || 12;

    let productosParaKitting = {};
    let mapaNombres = {}; // Objeto para guardar la relación SKU -> Nombre

    filas.forEach(fila => {
        const sku = fila.querySelector('.sku-input').value;
        const nombre = fila.querySelector('input[name="name[]"]').value; // Capturamos el nombre
        const cantidad = parseInt(fila.querySelector('input[name="cantidad[]"]').value) || 0;
        
        if (sku && cantidad > 0) {
            productosParaKitting[sku] = cantidad;
            mapaNombres[sku] = nombre; // Guardamos el nombre asociado al SKU
        }
    });

    if (Object.keys(productosParaKitting).length === 0) return;

    const resultado = calcularKitting(productosParaKitting, capacidad);

    // Pasamos el mapa de nombres a la función de renderizado
    renderizarPlanEmpaque(resultado, mapaNombres); 
}

    function renderizarPlanEmpaque(resultado, mapaNombres) {
    const contenedor = document.querySelector('#monitorPlanDetalle');
    if (!contenedor) return;

    let html = '';

    // --- BLOQUE 1: LOTES COMPLETOS ---
    resultado.packs.forEach((grupo, index) => {
        const items = Object.entries(grupo.detalle)
            .map(([sku, cant]) => {
                const nombreAMostrar = mapaNombres[sku] || sku; 
                return `
                <div class="flex justify-between items-center bg-white px-2 py-1 rounded border border-gray-100 text-[11px] mb-1">
                    <span class="font-medium text-gray-700 uppercase">${nombreAMostrar}</span>
                    <span class="table-badge table-badge-active">${cant}</span>
                </div>`;
            }).join('');

        html += `
            <div class="bg-gray-50 border-l-4 border-gh-primaryHover p-4 rounded shadow-sm mb-3">
                <p class="text-xs font-bold text-gray-800 mb-2">Lote ${index + 1}: Debes Empacar ${grupo.cantidad} bolsas con esta configuración:</p>
                <div class="flex flex-col">
                    ${items}
                </div>
            </div>`;
    });

    // --- BLOQUE 2: SOBRANTES (RESIDUO) ---
    const tieneResiduo = Object.keys(resultado.residuo).length > 0;
    
    if (tieneResiduo) {
        const itemsResiduo = Object.entries(resultado.residuo)
            .map(([sku, cant]) => {
                const nombreAMostrar = mapaNombres[sku] || sku;
                return `
                <div class="flex justify-between items-center bg-white px-2 py-1 rounded border border-orange-100 text-[13px] mb-1">
                    <span class="font-medium  uppercase">${nombreAMostrar}</span>
                    <span class="bg-orange-100 px-2 rounded-full font-bold">${cant}</span>
                </div>`;
            }).join('');

        html += `
            <div class="alert-error border-l-4 border-[#b982e0] p-4 rounded shadow-sm mt-4">
                <p class="text-xs font-bold mb-2">📦 PACK DE SALDO: Empacar 1 bolsa final con:</p>
                <div class="flex flex-col">
                    ${itemsResiduo}
                </div>
                <p class="text-[10px] mt-2 italic">* Esta bolsa no cumple la capacidad total (Residuo matemático).</p>
            </div>`;
    }

    contenedor.innerHTML = html;
}
    validarFilasCompletas();


    /* ==========================================
   5. ENVÍO DE DATOS AL BACKEND
   ========================================== */
const btnGuardar = document.querySelector('#guardar');

if (btnGuardar) {
    btnGuardar.addEventListener('click', async (e) => {
        e.preventDefault();

        // 1. Recopilar datos de las filas
        const filas = document.querySelectorAll('.fila-producto');
        const productos = Array.from(filas).map(f => ({
            idProducto: f.querySelector('input[name="idProducto[]"]').value,
            cantidad: parseInt(f.querySelector('input[name="cantidad[]"]').value),
            //valorUnidad: cleanMoney(f.querySelector('input[name="valorUnidad[]"]').value)
            valorUnidad: Number(cleanMoney(f.querySelector('input[name="valorUnidad[]"]').value))
        }));

        const capacidadBolsa = parseInt(document.querySelector('#unidadesPorPaquete').value);

        // 2. Confirmación visual antes de procesar 1.843 unidades
        const { isConfirmed } = await Swal.fire({
            title: '¿Confirmar Dosificación?',
            text: `Se generarán aproximadamente ${Math.floor(productos.reduce((a,b) => a+b.cantidad, 0) / capacidadBolsa)} bultos.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, Guardar y Generar',
            cancelButtonText: 'Revisar'
        });

        if (!isConfirmed) return;

        // 3. Bloqueo de UI y envío (Fetch)
        btnGuardar.disabled = true;
        btnGuardar.innerText = 'Procesando...';

        try {
            const inputCsrf = document.querySelector('input[name="_csrf"]');
            if (!inputCsrf) {
                throw new Error("No se encontró el token de seguridad CSRF");
            }
            const token = inputCsrf.value;
    
            const respuesta = await fetch('/admin/dosificaciones/guardar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'CSRF-Token': token // O 'X-CSRF-TOKEN' dependiendo de cómo lo espere tu middleware
                },
                body: JSON.stringify({
                    productos,
                    capacidadBolsa
                })
            });

            const resultado = await respuesta.json();

            if (resultado.mensaje === 'ok') {
                // El SweetAlert que planeamos para decidir qué hacer después
                Swal.fire({
                    title: '¡Dosificación Exitosa!',
                    text: "¿Qué deseas hacer ahora?",
                    icon: 'success',
                    showCancelButton: true,
                    confirmButtonText: 'Ver Dashboard',
                    cancelButtonText: 'Nueva Carga',
                    allowOutsideClick: false
                }).then((res) => {
                    if (res.isConfirmed) {
                        window.location.href = '/dosificaciones/dashboard';
                    } else {
                        window.location.reload(); 
                    }
                });
            } else {
                throw new Error();
            }

        } catch (error) {
            console.log(error)
            Swal.fire('Error', 'No se pudo guardar la dosificación. Intenta de nuevo.', 'error');
            btnGuardar.disabled = false;
            btnGuardar.innerText = 'Guardar Dosificación';
        }
    });
}
})();