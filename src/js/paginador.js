window.generarPaginacion = (contenedorId, totalPaginas, paginaActual, callback) => {
    const contenedor = document.querySelector(contenedorId);
    if (!contenedor) return;

    contenedor.innerHTML = '';
    if (totalPaginas <= 1) return;

    const crearBoton = (texto, pagina, activo = false, deshabilitado = false) => {
        const boton = document.createElement('button');
        boton.innerText = texto;
        
        const clasesBase = "paginador";
        const clasesActivo = "paginadorActivo";
        const clasesInactivo = "paginadorInactivo";
        const clasesDisabled = "paginadorDeshabilidado";

        boton.className = `${clasesBase} ${deshabilitado ? clasesDisabled : (activo ? clasesActivo : clasesInactivo)} cursor-pointer`;
        
        if (!deshabilitado) {
            boton.onclick = (e) => {
                e.preventDefault();
                callback(pagina);
            };
        } else {
            boton.disabled = true;
        }
        return boton;
    };

    const maxBotones = 5;
    let inicio = Math.floor((paginaActual - 1) / maxBotones) * maxBotones + 1;
    let fin = Math.min(inicio + maxBotones - 1, totalPaginas);

    // Atras
    contenedor.appendChild(crearBoton('«', paginaActual - 1, false, paginaActual === 1));

    // Rangos de numeracin
    for (let i = inicio; i <= fin; i++) {
        contenedor.appendChild(crearBoton(i, i, i === paginaActual));
    }

    // Siguiente
    contenedor.appendChild(crearBoton('»', paginaActual + 1, false, paginaActual === totalPaginas));
};