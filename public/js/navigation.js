(function () {
    const sidebar = document.getElementById('sidebar');
    const hamburger = document.getElementById('btn-hamburger');
    const overlay = document.getElementById('sidebar-overlay');
    const menuItems = document.querySelectorAll('.menu-item');
    const detailsElements = document.querySelectorAll('details.group');

    if (!sidebar || !hamburger || !overlay) return;

    // 1. Alternar Sidebar
    function toggleSidebar() {
        const isHidden = sidebar.classList.contains('-translate-x-full');
        if (isHidden) {
            sidebar.classList.remove('-translate-x-full');
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden'; // Evitar scroll de fondo
        } else {
            sidebar.classList.add('-translate-x-full');
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidebar();
    });

    // 2. Cerrar al hacer clic en el overlay o fuera (en móvil)
    overlay.addEventListener('click', toggleSidebar);

    // 3. Manejo de submenús en móvil (expandir al tocar icons)
    // Nota: El elemento 'details' nativo ya maneja esto, pero podemos añadir 
    // lógica extra si queremos que al tocar el icono se comporte diferente
    detailsElements.forEach(details => {
        const summary = details.querySelector('summary');
        summary.addEventListener('click', (e) => {
            // Si estamos en móvil y el sidebar es "slim" (iconos)
            // Podríamos forzar la expansión del sidebar aquí si quisiéramos
            // sidebar.classList.add('sidebar-expanded');
        });
    });

    // 4. Asegurar que el sidebar se oculte al cambiar de página o redimensionar
    window.addEventListener('resize', () => {
        if (window.innerWidth >= 768) {
            sidebar.classList.remove('-translate-x-full');
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        } else {
            sidebar.classList.add('-translate-x-full');
        }
    });

    // Inicialización según ancho actual
    if (window.innerWidth < 768) {
        sidebar.classList.add('-translate-x-full');
    }

})();
