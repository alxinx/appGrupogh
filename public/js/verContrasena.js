// Mostrar / ocultar contraseña. Lo usa el mixin views/components/campoContrasena.pug:
// cualquier botón con data-ver-contrasena="<id del input>" alterna ese input entre
// password y text. Un solo listener delegado para todos los campos de la página.
(function () {
    document.addEventListener('click', function (e) {
        const boton = e.target.closest('[data-ver-contrasena]');
        if (!boton) return;

        const input = document.getElementById(boton.dataset.verContrasena);
        if (!input) return;

        const mostrar = input.type === 'password';
        input.type = mostrar ? 'text' : 'password';

        const texto = mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña';
        boton.setAttribute('aria-pressed', String(mostrar));
        boton.setAttribute('aria-label', texto);
        boton.title = texto;

        const icono = boton.querySelector('i');
        if (icono) {
            icono.classList.toggle('fi-rr-eye', !mostrar);
            icono.classList.toggle('fi-rr-eye-crossed', mostrar);
        }

        // El foco vuelve al campo con el cursor al final, para seguir escribiendo.
        input.focus();
        const fin = input.value.length;
        try { input.setSelectionRange(fin, fin); } catch (_) { /* no aplica */ }
    });

    // Al enviar el formulario la contraseña vuelve a ocultarse: si el login falla y el
    // navegador muestra la página de nuevo, o alguien mira la pantalla, no queda a la vista.
    document.addEventListener('submit', function (e) {
        e.target.querySelectorAll('[data-ver-contrasena]').forEach(function (boton) {
            const input = document.getElementById(boton.dataset.verContrasena);
            if (input && input.type === 'text') boton.click();
        });
    }, true);
})();
