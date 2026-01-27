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

        boton.className = `${clasesBase} ${deshabilitado ? clasesDisabled : (activo ? clasesActivo : clasesInactivo)}`;
        
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

    contenedor.appendChild(crearBoton('«', paginaActual - 1, false, paginaActual === 1));

    for (let i = 1; i <= totalPaginas; i++) {
        contenedor.appendChild(crearBoton(i, i, i === paginaActual));
    }

    contenedor.appendChild(crearBoton('»', paginaActual + 1, false, paginaActual === totalPaginas));
    
};