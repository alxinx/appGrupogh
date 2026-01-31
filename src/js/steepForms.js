document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const step = btn.dataset.step;
        const targetContent = document.querySelector(`.step-content[data-content="${step}"]`);

        if (!targetContent) {
            console.warn(`No se encontró contenido para el paso: ${step}`);
            return; 
        }
        document.querySelectorAll('.step-content').forEach(c => c.classList.add('hidden'));
        targetContent.classList.remove('hidden');
        document.querySelectorAll('.step-btn').forEach(b => {
    const circle = b.querySelector('.itemInCircle');
    const text = b.querySelector('span');

    // VALIDACIÓN DEFENSIVA: Solo actúa si los elementos existen
    if (circle && text) {
        if (b === btn) {
            // ESTADO ACTIVADO
            circle.classList.remove('circleGray');
            circle.classList.add('circlePink');
            text.classList.remove('text-gray-400');
            text.classList.add('text-pink-500');
        } else {
            // ESTADO DESACTIVADO
            circle.classList.remove('circlePink');
            circle.classList.add('circleGray');
            text.classList.remove('text-pink-500');
            text.classList.add('text-gray-400');
        }
    } else {
        //console.warn("Estructura incompleta en un step-btn", b);
    }
});
    });
});