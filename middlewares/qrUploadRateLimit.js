// Límite de subidas del QR de pago: máximo 10 por hora y por usuario autenticado.
//
// Mismo patrón en memoria que apiRateLimit.js y verificarCodigoEmpleado.js. Igual que
// aquellos, el contador vive en el proceso: si la app llega a correr en más de una
// instancia, el límite deja de ser global y hay que moverlo a un almacén compartido.

const VENTANA_MS = 60 * 60 * 1000; // 1 hora
const LIMITE_POR_DEFECTO = 10;

// Map<idUsuario, { count: number, resetAt: number }>
const contadores = new Map();

setInterval(() => {
    const ahora = Date.now();
    for (const [clave, entrada] of contadores) {
        if (ahora >= entrada.resetAt) contadores.delete(clave);
    }
}, VENTANA_MS).unref?.();

const qrUploadRateLimit = (req, res, next) => {
    const limite  = parseInt(process.env.QR_UPLOADS_PER_HOUR) || LIMITE_POR_DEFECTO;
    const usuario = req.usuario?.idUsuario;

    // Sin usuario en sesión no debería llegarse aquí (va detrás de rutaProtegida),
    // pero si pasa, se corta en vez de dejar un carril sin límite.
    if (!usuario) return res.status(401).json({ success: false, mensaje: 'No autorizado.' });

    const ahora   = Date.now();
    const entrada = contadores.get(usuario);

    if (!entrada || ahora >= entrada.resetAt) {
        contadores.set(usuario, { count: 1, resetAt: ahora + VENTANA_MS });
        return next();
    }

    if (entrada.count >= limite) {
        const reintentarEn = Math.ceil((entrada.resetAt - ahora) / 1000);
        res.set('Retry-After', reintentarEn);
        return res.status(429).json({
            success: false,
            mensaje: `Alcanzaste el límite de ${limite} subidas de QR por hora. Intenta de nuevo en ${Math.ceil(reintentarEn / 60)} minutos.`
        });
    }

    entrada.count++;
    next();
};

export default qrUploadRateLimit;
