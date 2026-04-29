import dotenv from 'dotenv';
dotenv.config();

const VENTANA_MS = 60 * 1000; // 1 minuto

// Map<ip, { count: number, resetAt: number }>
const contadores = new Map();

// Limpia entradas expiradas cada minuto para no acumular memoria
setInterval(() => {
    const ahora = Date.now();
    for (const [ip, entrada] of contadores) {
        if (ahora >= entrada.resetAt) contadores.delete(ip);
    }
}, VENTANA_MS);

const apiRateLimit = (req, res, next) => {
    const limite = parseInt(process.env.API_QUERY_PER_MIN) || 60;
    const ip     = req.ip || req.socket?.remoteAddress || 'unknown';
    const ahora  = Date.now();

    const entrada = contadores.get(ip);

    if (!entrada || ahora >= entrada.resetAt) {
        contadores.set(ip, { count: 1, resetAt: ahora + VENTANA_MS });
        return next();
    }

    if (entrada.count >= limite) {
        const reintentarEn = Math.ceil((entrada.resetAt - ahora) / 1000);
        res.set('Retry-After', reintentarEn);
        return res.status(429).json({
            success: false,
            mensaje: `Límite de solicitudes alcanzado. Intenta de nuevo en ${reintentarEn} segundos.`
        });
    }

    entrada.count++;
    next();
};

export default apiRateLimit;
