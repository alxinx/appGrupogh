// `_correccion` es interno: lo usa la comprobación de abajo para repintarse a sí misma
// cuando lo pintado no entró en una fila. Los llamadores pasan cuatro argumentos.
window.generarPaginacion = (contenedorId, totalPaginas, paginaActual, callback, _correccion = 0) => {
    const contenedor = document.querySelector(contenedorId);
    if (!contenedor) return;

    if (totalPaginas <= 1) {
        contenedor.innerHTML = '';
        delete contenedor.dataset.ventanaInicio;
        delete contenedor.dataset.maxBotones;
        delete contenedor.dataset.anchoBase;
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

        // `shrink-0`: son hijos flex y por defecto se dejan comprimir. Aplastados, el rótulo
        // se recorta y —peor— medirlos devuelve menos de lo que ocupan de verdad, así que el
        // cálculo de cuántos entran se retroalimentaba mal.
        boton.className = `${clasesBase} ${deshabilitado ? clasesDisabled : (activo ? clasesActivo : clasesInactivo)} shrink-0 cursor-pointer`;

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

    // Cuántos números entran de verdad en el contenedor. Antes eran 5 fijos, y en el listado
    // del inventario —que ocupa las 12 columnas— eso dejaba tres cuartos de la barra vacíos y
    // obligaba a saltar de bloque en bloque para llegar a la página 30. El ancho se mide con
    // un botón de prueba rotulado con la página más alta (`128` es más ancho que `7`), así que
    // el cálculo no depende de cuántos dígitos tenga el listado.
    const GAP = 4;              // gap-1 del contenedor y del grupo de números
    const MINIMO = 5;           // en un contenedor angosto se mantiene lo de antes y envuelve
    const calcularMaxBotones = () => {
        const disponible = contenedor.clientWidth;
        if (!disponible) return MINIMO;  // todavía sin layout (contenedor oculto o recién creado)

        const sonda = crearBoton(String(totalPaginas), 1);
        sonda.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
        contenedor.appendChild(sonda);
        // Lo que ocupa un botón en la fila es su caja MÁS sus márgenes: `.paginador` lleva
        // mx-0.5 y getBoundingClientRect no los cuenta. Sin sumarlos se subestimaba 4px por
        // botón —con 27 botones, 108px— y el » terminaba envuelto en un segundo renglón.
        const caja = sonda.getBoundingClientRect().width;
        const estilo = getComputedStyle(sonda);
        const margenes = (parseFloat(estilo.marginLeft) || 0) + (parseFloat(estilo.marginRight) || 0);
        sonda.remove();
        if (!caja) return MINIMO;
        const anchoBoton = caja + margenes;

        // El conteo se congela mientras el contenedor mida más o menos lo mismo. Medir en cada
        // pintada lo hacía variar en uno —una tabla más larga saca la barra de scroll y se
        // pierden ~15px—, y como los bloques se calculan a partir de ese número, con 26 la
        // página 27 abría el bloque "27-30" y con 27 seguía en el bloque "1-27": al pasar de
        // la 26 a la 27 la barra crecía en vez de avanzar. El umbral es un botón entero, así
        // que una barra de scroll no lo mueve pero cambiar el tamaño de la ventana sí.
        const previo = parseInt(contenedor.dataset.maxBotones, 10);
        const anchoBase = parseFloat(contenedor.dataset.anchoBase);
        // Los dígitos entran en la llave: pasar de 27 a 124 páginas ensancha cada botón y el
        // conteo de antes ya no sirve.
        const mismosDigitos = contenedor.dataset.digitos === String(totalPaginas).length.toString();
        if (previo > 0 && mismosDigitos && Math.abs(disponible - anchoBase) < anchoBoton) return previo;

        // « y » ocupan su lugar aunque estén deshabilitados; se reservan como un botón de
        // número cada uno, que es más ancho que una flecha y deja aire en vez de rozar el borde.
        const avance = anchoBoton + GAP;
        const paraNumeros = disponible - 2 * avance;
        const cabe = Math.max(MINIMO, Math.floor(paraNumeros / avance));
        contenedor.dataset.maxBotones = String(cabe);
        contenedor.dataset.anchoBase = String(disponible);
        contenedor.dataset.digitos = String(String(totalPaginas).length);
        return cabe;
    };

    const maxBotones = Math.min(calcularMaxBotones(), totalPaginas);
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

    // Lo pintado manda sobre lo calculado. La estimación se hace antes de que exista el
    // marcado, y se puede quedar corta por cosas que no se ven al medir: la hoja de estilos
    // todavía sin aplicar (y entonces el botón no tiene ni padding), un zoom del navegador, o
    // una barra de scroll que aparece después. Cuando eso pasa, el grupo de números —que es un
    // solo hijo flex y no se parte— no cabe, el contenedor envuelve y « y » quedan cada uno en
    // su renglón, que es justo lo que se veía. Acá se mide lo que de verdad quedó en pantalla
    // y, si no entró en una fila, se recalcula con el ancho real del botón y se vuelve a pintar.
    const verificarQueEntra = () => {
        if (_correccion >= 2) return;                    // techo: nunca más de dos repintados
        const botones = [...contenedor.querySelectorAll('button')];
        const numeros = botones.slice(1, -1);
        if (numeros.length <= MINIMO) return;            // ya está en el mínimo, no hay qué quitar
        const filas = new Set(botones.map(b => Math.round(b.getBoundingClientRect().top)));
        if (filas.size === 1) return;                    // entró

        // Se vuelve a medir desde cero —con la sonda, que es un botón suelto y no uno ya
        // metido en la fila— en vez de confiar en el número guardado, que es justamente el
        // que quedó mal.
        delete contenedor.dataset.maxBotones;
        delete contenedor.dataset.anchoBase;
        delete contenedor.dataset.digitos;
        const cabe = Math.min(calcularMaxBotones(), totalPaginas);
        if (cabe >= numeros.length) return;              // envolvió por otra cosa, no por el ancho

        delete contenedor.dataset.ventanaInicio;         // una corrección no se anima
        window.generarPaginacion(contenedorId, totalPaginas, paginaActual, callback, _correccion + 1);
    };

    const btnAnterior = crearBoton('«', paginaActual - 1, false, paginaActual === 1);
    const btnSiguiente = crearBoton('»', paginaActual + 1, false, paginaActual === totalPaginas);

    // ¿El bloque de números que se ve cambió (ej. "16-20" -> "21-25")? Eso es lo único
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
        verificarQueEntra();
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

    // El navegador no garantiza que el rAF corra antes que el temporizador de limpieza: en una
    // pestaña en segundo plano los rAF se frenan y la limpieza llega primero. Cuando pasaba
    // eso, el rAF atrasado volvía a escribir el translateX DESPUÉS de haberlo borrado y el
    // grupo quedaba estacionado fuera del viewport — la barra se veía con « y » y ningún
    // número. Si ya se limpió, no hay nada que animar.
    let limpiado = false;

    requestAnimationFrame(() => {
        if (limpiado) return;
        grupoViejo.style.transform = `translateX(${avanza ? -anchoViejo : anchoViejo}px)`;
        // Se mueve lo mismo que se lo corrió con `left` al ubicarlo, pero al revés, para
        // que termine exactamente en el borde izquierdo del viewport (x = 0).
        grupoNuevo.style.transform = `translateX(${avanza ? -anchoViejo : anchoNuevo}px)`;
    });

    setTimeout(() => {
        limpiado = true;
        grupoViejo.remove();
        viewportViejo.style.width = '';
        viewportViejo.style.height = '';
        grupoNuevo.style.position = '';
        grupoNuevo.style.top = '';
        grupoNuevo.style.left = '';
        grupoNuevo.style.transform = '';
        grupoNuevo.style.transition = '';
        verificarQueEntra();   // recién acá el grupo nuevo ocupa su ancho real
    }, DURACION_MS + 30);
};
