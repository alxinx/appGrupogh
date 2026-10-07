// Pestañas "Admin" / "Producción" del menú lateral (views/partials/leftMenu.pug). El
// servidor ya pinta la pestaña correcta según `currentPath`, así que este script solo
// atiende lo que pasa DESPUÉS de esa carga: el clic, las flechas del teclado y el
// indicador que se desliza entre las dos. Nunca decide qué carpeta puede ver cada quien
// —eso es `ver()` en el propio pug, con el permiso real del lado del servidor.
(function () {
    const tablist = document.getElementById('menu-tabs');
    if (!tablist) return;

    const indicador = document.getElementById('menu-tabs-indicator');
    const botones = Array.from(tablist.querySelectorAll('[data-menu-tab]'));
    const paneles = {
        admin:      document.getElementById('menu-panel-admin'),
        produccion: document.getElementById('menu-panel-produccion')
    };

    // Vuelve a disparar `.animate-fade-in` (ya definida en input.css) cada vez que se activa
    // un panel, para que el cambio de pestaña se sienta tan intencional como la primera
    // carga de la página.
    const reproducirEntrada = (el) => {
        el.classList.remove('animate-fade-in');
        void el.offsetWidth; // fuerza el reflow: sin esto el navegador no vuelve a animar
        el.classList.add('animate-fade-in');
    };

    const activar = (tab) => {
        if (!paneles[tab]) tab = 'admin';

        if (indicador) indicador.style.transform = tab === 'produccion' ? 'translateX(100%)' : 'translateX(0)';

        Object.entries(paneles).forEach(([clave, el]) => {
            if (!el) return;
            const activo = clave === tab;
            el.classList.toggle('hidden', !activo);
            if (activo) reproducirEntrada(el);
        });

        botones.forEach((b) => {
            const activo = b.dataset.menuTab === tab;
            b.classList.toggle('text-white', activo);
            b.classList.toggle('text-gh-grayText', !activo);
            b.setAttribute('aria-selected', String(activo));
            b.tabIndex = activo ? 0 : -1;
        });
    };

    botones.forEach((boton, i) => {
        boton.addEventListener('click', () => activar(boton.dataset.menuTab));

        // Patrón ARIA de pestañas: las flechas mueven el foco Y activan la pestaña vecina.
        boton.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const siguiente = botones[(i + (e.key === 'ArrowRight' ? 1 : -1) + botones.length) % botones.length];
            siguiente.focus();
            activar(siguiente.dataset.menuTab);
        });
    });
})();
