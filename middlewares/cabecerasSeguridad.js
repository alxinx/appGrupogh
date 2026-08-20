// Cabeceras de seguridad HTTP.
//
// Se escriben a mano en vez de instalar `helmet` para no sumar una dependencia por cuatro
// líneas de cabecera, y sobre todo para poder decidir una por una: helmet trae CSP activada
// por defecto y esta app usa scripts en línea en casi todas las vistas, así que la habría
// roto entera en el primer despliegue.
//
// NO incluye Content-Security-Policy a propósito. Es la que más protege contra XSS, pero
// exige que ningún <script> viva dentro del HTML, y acá hay decenas. Ponerla en modo
// permisivo ('unsafe-inline') no protegería de nada. Es un trabajo aparte: mover los
// scripts a archivos y recién ahí activarla.
const cabecerasSeguridad = (req, res, next) => {
    // El navegador respeta el Content-Type declarado en vez de adivinarlo. Sin esto, un
    // archivo subido que empiece con algo que "parece" HTML puede terminar ejecutándose.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Nadie puede meter el panel en un iframe. Sin esto, una página ajena puede
    // superponerse sobre los botones reales y hacer que alguien apruebe un traslado
    // creyendo que hace clic en otra cosa.
    res.setHeader('X-Frame-Options', 'DENY');

    // Al salir a otro dominio solo se manda el origen, no la URL completa. Las rutas del
    // panel llevan ids de factura, de tienda y de empleado en el camino.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Ninguna pantalla usa cámara, micrófono ni ubicación. Negarlas de entrada evita que
    // un script inyectado las pida en nombre del sitio.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

    // HSTS solo cuando la app corre sobre HTTPS. Mandarla en HTTP no hace nada, y en
    // desarrollo obligaría al navegador a forzar https://localhost durante un año.
    if (process.env.COOKIE_SECURE === 'true') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
};

export default cabecerasSeguridad;
