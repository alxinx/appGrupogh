


//CARGA DE DPTOS Y MUNICIPIOS.
(function(){
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
})();


//VALIDACIONES ASINCTRONICAS. 

(function(){
const nitInput = document.querySelector('#nit');
nitInput.addEventListener('blur', async (e) => {
    const nit = e.target.value.trim();
    
    // Solo validamos si hay algo escrito para no disparar errores en vano
    if (nit.length > 5) {
        try {
            const response = await fetch(`/admin/provedores/validar-nit/${nit}`);
            const resultado = await response.json();

            if (resultado.existe) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Proveedor ya registrado',
                    text: `El NIT ${nit} ya pertenece a ${resultado.razonSocial}.`,
                    confirmButtonColor: '#d33'
                });
                // Limpiamos el campo o lo marcamos en rojo
                e.target.classList.add('border-red-500');
            } else {
                e.target.classList.remove('border-red-500');
                e.target.classList.add('border-green-500');
            }
        } catch (error) {
            console.error('Error al validar el NIT:', error);
        }
    }
});
})()