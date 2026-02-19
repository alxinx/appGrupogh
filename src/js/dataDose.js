import { formatMoney, cleanMoney } from './utils.js';
//OBLIGO A HACER DOBLE CLIC A LAS UNIDADES POR PAQUETE POR SI QUIEREN CAMBIARLO
(function(){
    const inputUnidades = document.querySelector('#unidadesPorPaquete');


    
// 1. Activar con doble clic
inputUnidades.addEventListener('dblclick', function() {
    this.readOnly = false;
    this.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-75');
    this.classList.add('bg-white', 'border-blue-500'); // Indicador visual de edición
    this.focus(); // Poner el cursor de una vez
});

// 2. Bloquear automáticamente al salir del campo (blur)
inputUnidades.addEventListener('blur', function() {
    this.readOnly = true;
    this.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-75');
    this.classList.remove('bg-white', 'border-blue-500');
    

    
    // Aquí podrías disparar una validación para verificar 
    // si el nuevo número es compatible con las filas ya agregadas
   // validarCapacidadVersusFilas(); 
});

inputUnidades.addEventListener('blur', function() {
    const valor = parseInt(this.value);
    const LIMITE_MAXIMO = 36; // Puedes ajustar este número según la bolsa más grande

    // 1. Validar contra el límite máximo "irreal"
    if (valor > LIMITE_MAXIMO) {
        Swal.fire({
            icon: 'error',
            title: 'No puedo permitirte hacer eso 😶',
            text: `No es posible dosificar ${valor} prendas en una sola bolsa. El máximo permitido es ${LIMITE_MAXIMO}.`,
            confirmButtonColor: '#3085d6'
        });
        this.value = 12; // Revertir al estándar de GH
    }

    // 2. Validar que no sea cero o negativo
    if (valor <= 0 || isNaN(valor)) {
        this.value = 12;
    }

    // Volver a bloquear el campo
    this.readOnly = true;
    this.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-75');
});

})()




//FORMATEO A MONEDA PARA FRONTEND.
document.addEventListener('keyup', (e) => {
    if (e.target.matches('input[name="valorUnidad[]"]')) {
        // 1. Obtener el valor actual y limpiar lo que no sea número
        let valorPuro = e.target.value.replace(/\D/g, "");
        
        // 2. Si hay valor, formatearlo y ponerlo de vuelta en el input
        if (valorPuro) {
            e.target.value = formatMoney(valorPuro);
        }
    }
});



