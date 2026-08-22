window.generarPaginacion = (contenedorId, totalPaginas, paginaActual, callback) => {
    const contenedor = document.querySelector(contenedorId);
    if (!contenedor) return;

    if (totalPaginas <= 1) {
        contenedor.innerHTML = '';
        delete contenedor.dataset.ventanaInicio;
        return;
    }

    // La alineación se define acá, en el único lugar por el que pasan los 13 paginadores
    // del panel. Antes cada vista la resolvía por su cuenta y no había dos iguales:
    // unas centradas, otras pegadas a la izquierda, otras sin clases.
    // flex-wrap para que con muchas páginas los botones bajen de línea en vez de desbordar.
    contenedor.classList.add('flex', 'flex-wrap', 'items-center', 'justify-center', 'gap-1', 'mt-4', 'mb-2');

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
    const inicio = Math.floor((paginaActual - 1) / maxBotones) * maxBotones + 1;
    const fin = Math.min(inicio + maxBotones - 1, totalPaginas);

    const crearGrupoNumeros = () => {
        const grupo = document.createElement('div');
        grupo.className = 'flex items-center gap-1';
        grupo.setAttribute('data-grupo-numeros', '');
        for (let i = inicio; i <= fin; i++) {
            grupo.appendChild(crearBoton(i, i, i === paginaActual));
        }
        return grupo;
    };

    const btnAnterior = crearBoton('«', paginaActual - 1, false, paginaActual === 1);
    const btnSiguiente = crearBoton('»', paginaActual + 1, false, paginaActual === totalPaginas);

    // ¿El bloque de 5 números que se ve cambió (ej. "16-20" -> "21-25")? Eso es lo único
    // que se anima: moverse DENTRO del mismo bloque (16 -> 17) solo cambia cuál botón está
    // activo, no hay nada que deslizar.
    const inicioAnteriorRaw = contenedor.dataset.ventanaInicio;
    const inicioAnterior = inicioAnteriorRaw !== undefined ? parseInt(inicioAnteriorRaw, 10) : null;
    const viewportViejo = contenedor.querySelector('[data-viewport-numeros]');
    // Defensa por si una animación anterior quedó a medias (click muy rápido): se queda
    // solo con el primer grupo, que es el que corresponde al bloque que se veía.
    viewportViejo?.querySelectorAll('[data-grupo-numeros]').forEach((el, idx) => { if (idx > 0) el.remove(); });
    const grupoViejo = viewportViejo?.querySelector('[data-grupo-numeros]');
    const cambioDeVentana = inicioAnterior !== null && inicioAnterior !== inicio && viewportViejo && grupoViejo;
    contenedor.dataset.ventanaInicio = String(inicio);

    if (!cambioDeVentana) {
        contenedor.innerHTML = '';
        const viewport = document.createElement('div');
        viewport.setAttribute('data-viewport-numeros', '');
        viewport.className = 'relative overflow-hidden';
        viewport.appendChild(crearGrupoNumeros());
        contenedor.append(btnAnterior, viewport, btnSiguiente);
        return;
    }

    // Cambio de bloque: el grupo nuevo entra deslizando desde el lado hacia el que se
    // avanzó y el viejo sale por el lado contrario, como un carrusel — en vez de
    // reemplazar los números de golpe.
    contenedor.replaceChildren(btnAnterior, viewportViejo, btnSiguiente);

    const avanza = inicio > inicioAnterior;
    const anchoViejo = grupoViejo.getBoundingClientRect().width;
    const altoViejo = grupoViejo.getBoundingClientRect().height;

    const grupoNuevo = crearGrupoNumeros();
    viewportViejo.appendChild(grupoNuevo); // en flujo normal un instante, solo para medirlo
    const anchoNuevo = grupoNuevo.getBoundingClientRect().width;

    // El viewport se fija al ancho del bloque viejo mientras dura la animación, para que
    // los dos grupos (viejo saliendo, nuevo entrando) no empujen el layout ni se vean.
    viewportViejo.style.width = `${anchoViejo}px`;
    viewportViejo.style.height = `${altoViejo}px`;

    grupoViejo.style.position = 'absolute';
    grupoViejo.style.top = '0';
    grupoViejo.style.left = '0';

    grupoNuevo.style.position = 'absolute';
    grupoNuevo.style.top = '0';
    // Arranca completamente afuera del viewport, del lado por el que "entra".
    grupoNuevo.style.left = `${avanza ? anchoViejo : -anchoNuevo}px`;

    const DURACION_MS = 220;
    grupoViejo.style.transition = `transform ${DURACION_MS}ms ease-out`;
    grupoNuevo.style.transition = `transform ${DURACION_MS}ms ease-out`;

    // Fuerza el reflow: sin leer una propiedad de layout acá, el navegador junta el estado
    // inicial y el final en un solo frame y no hay nada que animar.
    void grupoNuevo.offsetWidth;

    requestAnimationFrame(() => {
        grupoViejo.style.transform = `translateX(${avanza ? -anchoViejo : anchoViejo}px)`;
        // Se mueve lo mismo que se lo corrió con `left` al ubicarlo, pero al revés, para
        // que termine exactamente en el borde izquierdo del viewport (x = 0).
        grupoNuevo.style.transform = `translateX(${avanza ? -anchoViejo : anchoNuevo}px)`;
    });

    setTimeout(() => {
        grupoViejo.remove();
        viewportViejo.style.width = '';
        viewportViejo.style.height = '';
        grupoNuevo.style.position = '';
        grupoNuevo.style.top = '';
        grupoNuevo.style.left = '';
        grupoNuevo.style.transform = '';
        grupoNuevo.style.transition = '';
    }, DURACION_MS + 30);
};
