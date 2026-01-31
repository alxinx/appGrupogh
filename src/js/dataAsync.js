(function() {
    document.addEventListener('DOMContentLoaded', function() {
        // --- 1. SELECCIÓN DE ELEMENTOS ---
        const formulario = document.querySelector('#formulario');
        const btnContinuar2 = document.querySelector('a[data-step="2"]'); 
        const btnContinuar3 = document.querySelector('a[data-step="3"]'); 
        const btnVolver1 = document.querySelector('a[data-step="1"]');
        const departamentoSelect = document.querySelector('#departamento');
        const ciudadSelect = document.querySelector('#ciudad');
        
        // Seleccionamos todos los botones de guardado final
        const botonesGuardarFinal = document.querySelectorAll('#btnGuardarTienda, .btn-secondary');

        // --- 2. VALIDACIONES POR PASO ---
        const validarCampos = (paso) => {
            let campos = [];
            if (paso === 1) {
                campos = ['razonSocial', 'nombreComercial', 'tipo', 'direccionPrincipal', 'departamento', 'ciudad'];
            } else if (paso === 2) {
                const taxIdInput = document.querySelector('[name="taxId"]');
                
                // REGLA DE NEGOCIO: Si el NIT está vacío, no obligamos a llenar el resto del paso 2
                if (!taxIdInput || taxIdInput.value.trim() === "") {
                    return true; 
                }

                // Si hay algo en el NIT, entonces validamos todo el bloque tributario
                campos = ['taxId', 'DV', 'emailRut', 'resolucionFacturacion', 'responsabilidades'];
                
                // Validación de Rangos (Coherencia numérica)
                const nroInicio = document.querySelector('[name="nroInicio"]');
                const nroFin = document.querySelector('[name="nroFin"]');

                if (nroInicio && nroFin && nroInicio.value !== "" && nroFin.value !== "") {
                    if (parseInt(nroFin.value) <= parseInt(nroInicio.value)) {
                        nroFin.classList.add('field-text-error');
                        Swal.fire('Error de Rango', 'El número final de facturación debe ser mayor al inicial.', 'error');
                        return false;
                    }
                }
            }

            let valido = true;
            campos.forEach(campo => {
                const input = document.querySelector(`[name="${campo}"]`);
                if (!input || input.value.trim() === "") {
                    if (input) input.classList.add('field-text-error'); 
                    valido = false;
                } else {
                    if (input) input.classList.remove('field-text-error');
                }
            });
            return valido;
        };

        // --- 3. FUNCIÓN DE ENVÍO CENTRALIZADA ---
        const guardarDatos = async (pasoAValidar, redireccionar = false) => {
            if (!validarCampos(pasoAValidar)) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Atención',
                    text: 'Completa los campos obligatorios para continuar.',
                    confirmButtonColor: '#3085d6'
                });
                return false;
            }

            const formData = new FormData(formulario);
            const data = new URLSearchParams(formData);

            try {
                const respuesta = await fetch(formulario.action, {
                    method: 'POST',
                    body: data,
                    headers: { 'CSRF-Token': document.querySelector('input[name="_csrf"]').value }
                });

                const resultado = await respuesta.json();

                if (resultado.success) {
                    const inputID = document.querySelector('input[name="idPuntoDeVenta"]');
                    if (inputID) inputID.value = resultado.idPuntoDeVenta;

                    if (redireccionar) {
                    
                        Swal.fire({
                            icon: 'success',
                            title: '¡La tienda quedó guardada!',
                            html: resultado.mensaje,
                            timer: 3000, // Se cierra sola en 3 segundos
                            timerProgressBar: true,
                            didClose: () => {
                                window.location.href = '/admin/tiendas';
                            }
                        });

                        //window.location.href = '/admin/tiendas';
                    }
                    return true;
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error de Validación',
                        html: resultado.mensaje,
                        confirmButtonColor: '#d33'
                    });
                }
            } catch (error) {
                console.error("Error crítico:", error);
                Swal.fire('Error', 'Problema al conectar con el servidor.', 'error');
            }
            return false;
        };

        // --- 4. LISTENERS DE NAVEGACIÓN ---

        if (btnContinuar2) {
            btnContinuar2.addEventListener('click', async (e) => {
                e.preventDefault();
                if (await guardarDatos(1)) {
                    document.querySelector('[data-content="1"]').classList.add('hidden');
                    document.querySelector('[data-content="2"]').classList.remove('hidden');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        }

        if (btnContinuar3) {
            btnContinuar3.addEventListener('click', async (e) => {
                e.preventDefault();
                if (await guardarDatos(2)) {
                    document.querySelector('[data-content="2"]').classList.add('hidden');
                    document.querySelector('[data-content="3"]').classList.remove('hidden');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        }

        if (btnVolver1) {
            btnVolver1.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelector('[data-content="2"]').classList.add('hidden');
                document.querySelector('[data-content="1"]').classList.remove('hidden');
            });
        }

        // --- 5. LÓGICA UNIFICADA DE GUARDAR Y SALIR ---
        botonesGuardarFinal.forEach(boton => {
            boton.addEventListener('click', async (e) => {
                e.preventDefault();
                
                // Determinamos qué paso está viendo el usuario
                const enPaso2 = !document.querySelector('[data-content="2"]').classList.contains('hidden');
                const pasoAValidar = enPaso2 ? 2 : 1;

                // Validación de seguridad extra: Si intentan salir desde el paso 2, 
                // nos aseguramos que el paso 1 siga siendo válido por si borraron algo.
                if (enPaso2 && !validarCampos(1)) {
                    Swal.fire('Error', 'Los datos básicos (Paso 1) son obligatorios.', 'error');
                    document.querySelector('[data-content="2"]').classList.add('hidden');
                    document.querySelector('[data-content="1"]').classList.remove('hidden');
                    return;
                }

                await guardarDatos(pasoAValidar, true); 
            });
        });

        // --- 6. MUNICIPIOS (Se mantiene igual) ---
        if (departamentoSelect && ciudadSelect) {
            departamentoSelect.addEventListener('change', async function(e) {
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
            if (departamentoSelect.value !== '') departamentoSelect.dispatchEvent(new Event('change'));
        }
    });
})();