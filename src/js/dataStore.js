document.addEventListener('DOMContentLoaded', () => {
    const container = document.querySelector('#loadDataStore');
    const tabs = document.querySelectorAll('nav button');

    /**
     * Función central para la carga asíncrona
     */

    const loadTabContent = async (tabId) => {
        // 1. Mostrar estado de carga (Feedback visual para el usuario)
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center p-20 opacity-50">
                <i class="fi-rr-spinner animate-spin text-3xl text-gh-primary"></i>
                <p class="mt-4 font-medium text-slate-500">Consultando ${tabId}...</p>
            </div>
        `;

        // 2. Extraer el UUID de la tienda desde la URL actual
        // Ejemplo: /tiendas/ver/010efef3...
        const idPuntoDeVenta = window.location.pathname.split('/').pop();

        try {
            // 3. Petición al servidor (Rutas que crearemos en Express)
            const response = await fetch(`/admin/tiendas/partials/${tabId}/${idPuntoDeVenta}`);
            
            if (!response.ok) throw new Error('Error en la respuesta del servidor');

            const html = await response.text();
            
            // 4. Inyectar contenido
            container.innerHTML = html;

        } catch (error) {
            console.error("Error al cargar pestaña:", error);
            container.innerHTML = `
                <div class="p-10 text-center">
                    <i class="fi-rr-warning text-red-500 text-2xl"></i>
                    <p class="text-slate-600">No se pudo cargar la sección de ${tabId}.</p>
                </div>
            `;
        }
    };

    /**
     * Configuración de Listeners para todos los botones
     */
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            const selectedTab = e.currentTarget.id;

            // Cambiar estilos de las pestañas (UI/UX)
            tabs.forEach(t => {
                t.classList.remove('tab-active', 'text-gh-primary');
                t.classList.add('text-slate-400');
            });
            e.currentTarget.classList.add('tab-active');
            e.currentTarget.classList.remove('text-slate-400');

            // Cargar el contenido correspondiente
            loadTabContent(selectedTab);
        });
    });

    // Carga inicial por defecto (Facturación de hoy)
    loadTabContent('facturacionHoy');
});