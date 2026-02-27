(function () {
    document.addEventListener('DOMContentLoaded', () => {
        // Estado para rastrear la imagen actual por modal (si hay varios)
        const modalStates = {};

        // 1. Escuchar el clic en cualquier tarjeta de producto o sus elementos
        document.addEventListener('dblclick', (e) => {
            // Verificar si el clic fue en el botón de agregar
            if (e.target.closest('.btn-agregar-pedido')) {
                return;
            }

            const tarjeta = e.target.closest('.product-card-individual');

            if (tarjeta) {
                const modalId = tarjeta.dataset.modalTarget;
                if (modalId) {
                    abrirModalProducto(modalId);
                }
            }
        });

        // Manejo de clics generales (Cierre y Navegación de Galería)
        document.addEventListener('click', (e) => {
            const modalAbierto = document.querySelector('div[id^="modal-producto-"]:not(.hidden)');
            if (!modalAbierto) return;

            // 1. Cerrar modal
            if (e.target === modalAbierto || e.target.closest('.btn-close-modal')) {
                cerrarModal(modalAbierto);
                return;
            }

            // 2. Navegación de Galería
            const btnPrev = e.target.closest('.btn-prev-image');
            const btnNext = e.target.closest('.btn-next-image');

            if (btnPrev || btnNext) {
                const modalId = modalAbierto.id;
                const images = JSON.parse(modalAbierto.dataset.images || '[]');
                if (images.length <= 1) return;

                if (!modalStates[modalId]) modalStates[modalId] = { currentIndex: 0 };

                if (btnPrev) {
                    modalStates[modalId].currentIndex = (modalStates[modalId].currentIndex - 1 + images.length) % images.length;
                } else {
                    modalStates[modalId].currentIndex = (modalStates[modalId].currentIndex + 1) % images.length;
                }

                const mainImg = modalAbierto.querySelector('#main-image');
                if (mainImg) {
                    mainImg.src = images[modalStates[modalId].currentIndex];
                    // Pequeña animación de transición
                    mainImg.animate([
                        { opacity: 0.5 },
                        { opacity: 1 }
                    ], { duration: 200, easing: 'ease-in-out' });
                }
            }
        });

        // 2. Función para mostrar el modal con animación
        function abrirModalProducto(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;

            modal.classList.remove('hidden');
            modal.classList.add('flex');

            // Resetear índice al abrir
            modalStates[modalId] = { currentIndex: 0 };
            const images = JSON.parse(modal.dataset.images || '[]');
            const mainImg = modal.querySelector('#main-image');
            if (mainImg && images.length > 0) {
                mainImg.src = images[0];
            }

            // Animación de entrada estilo iOS
            const contenido = modal.querySelector('.bg-white');
            if (contenido) {
                contenido.animate([
                    { transform: 'scale(0.95)', opacity: 0 },
                    { transform: 'scale(1)', opacity: 1 }
                ], { duration: 200, easing: 'ease-out' });
            }
        }

        // 3. Soporte para tecla ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modalAbierto = document.querySelector('div[id^="modal-producto-"]:not(.hidden)');
                if (modalAbierto) {
                    cerrarModal(modalAbierto);
                }
            }
        });

        function cerrarModal(modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    });
})();