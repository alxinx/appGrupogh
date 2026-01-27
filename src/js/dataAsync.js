(function() { // Envolvemos todo en una función autoejecutable para no ensuciar el global
    // Escuchamos cuando el DOM esté listo (por seguridad extra)
    document.addEventListener('DOMContentLoaded', function() {

        const departamentoSelect = document.querySelector('#departamento');
        const ciudadSelect = document.querySelector('#municipio');

        // Verificamos que existan en esta página (para evitar errores en otras vistas)
        if (departamentoSelect && ciudadSelect) {

            departamentoSelect.addEventListener('change', async function(e) {
                const departamentoId = e.target.value;

                // 1. Resetear el select de ciudades
                ciudadSelect.innerHTML = '<option value="">-- Cargando --</option>';
                
                if(departamentoId === '') {
                    ciudadSelect.innerHTML = '<option value="">-- Seleccione Dpto --</option>';
                    ciudadSelect.disabled = true;
                    return;
                }

                try {
                    // 2. Llamar a tu API
                    // Asegúrate de tener esta ruta creada en tu backend
                    const url = `/admin/json/municipios/${departamentoId}`;
                    const respuesta = await fetch(url);
                    const resultado = await respuesta.json();

                    // 3. Limpiar y Llenar
                    ciudadSelect.innerHTML = '<option value="">-- Seleccione Ciudad --</option>';
                    
                    resultado.forEach(municipio => {
                        const option = document.createElement('option');
                        option.value = municipio.id; // O el campo que sea tu ID
                        option.textContent = municipio.nombre;
                        ciudadSelect.appendChild(option);
                    });

                    ciudadSelect.disabled = false;

                } catch (error) {
                    console.log(error);
                    ciudadSelect.innerHTML = '<option value="">Error al cargar</option>';
                }
            });
        }
    });

})();
