import dotenv from 'dotenv';
dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// Freno de peticiones por IP, con ventana fija.
//
// Vive en memoria del proceso, igual que el resto de limitadores del proyecto. Funciona
// para una sola instancia; si la app llega a correr en más de un proceso, el límite real
// se multiplica por el número de procesos y hay que moverlo a un almacén compartido
// (CLAUDE.md § 5.5).
//
// Cada limitador tiene su PROPIO contador. Compartir uno solo haría que las consultas del
// catálogo —que el navegador dispara en cada scroll— gastaran el cupo de crear pedidos, y
// un visitante mirando productos se quedaría sin poder comprar.
// ─────────────────────────────────────────────────────────────────────────────

// Cloudflare pone la IP real del visitante en CF-Connecting-IP y ese header no se puede
// falsear desde afuera: Cloudflare lo sobreescribe siempre, aunque el cliente lo mande. Con
// `trust proxy` en 1, req.ip ya debería resolver lo mismo vía X-Forwarded-For, pero
// CF-Connecting-IP no depende de la cantidad de saltos configurada — queda como fuente
// primaria y req.ip como respaldo si algún día la app deja de estar detrás de Cloudflare.
const ipDe = (req) => req.headers['cf-connecting-ip'] || req.ip || req.socket?.remoteAddress || 'unknown';

/**
 * @param {object}  opciones
 * @param {number}  opciones.limite    peticiones permitidas por ventana
 * @param {number}  opciones.ventanaMs largo de la ventana
 * @param {string}  opciones.nombre    aparece en el log al bloquear
 * @param {string}  opciones.mensaje   qué se le dice a quien lo choca
 */
export const crearRateLimit = ({ limite, ventanaMs = 60 * 1000, nombre = 'api', mensaje }) => {
    const contadores = new Map();

    // Se limpia solo para no acumular una entrada por cada IP que pasó alguna vez.
    // `unref` para que este temporizador no impida que el proceso termine.
    setInterval(() => {
        const ahora = Date.now();
        for (const [ip, e] of contadores) if (ahora >= e.resetAt) contadores.delete(ip);
    }, ventanaMs).unref?.();

    return (req, res, next) => {
        const ip    = ipDe(req);
        const ahora = Date.now();
        const tope  = typeof limite === 'function' ? limite() : limite;
        const e     = contadores.get(ip);

        if (!e || ahora >= e.resetAt) {
            contadores.set(ip, { count: 1, resetAt: ahora + ventanaMs });
            return next();
        }

        if (e.count >= tope) {
            const reintentarEn = Math.ceil((e.resetAt - ahora) / 1000);
            console.warn(`[${nombre}] límite alcanzado · ip=${ip} · ${e.count} peticiones`);
            res.set('Retry-After', String(reintentarEn));
            return res.status(429).json({
                success: false,
                mensaje: mensaje || `Límite de solicitudes alcanzado. Intenta de nuevo en ${reintentarEn} segundos.`
            });
        }

        e.count++;
        next();
    };
};

// El de siempre: lecturas del panel y del catálogo. El límite se lee en cada petición para
// que cambiar la variable de entorno no exija reiniciar.
const apiRateLimit = crearRateLimit({
    limite: () => parseInt(process.env.API_QUERY_PER_MIN) || 60,
    nombre: 'api'
});

// Para lo que ESCRIBE desde el sitio público: crear un pedido, dejar un interesado, subir
// un comprobante. Un tope bajo porque nadie hace eso diez veces por minuto de buena fe, y
// sin él la tabla de interesados es un formulario de spam abierto.
export const escrituraPublicaRateLimit = crearRateLimit({
    limite: () => parseInt(process.env.PUBLIC_WRITE_PER_MIN) || 10,
    nombre: 'escritura-publica',
    mensaje: 'Demasiadas solicitudes seguidas. Esperá un momento y volvé a intentar.'
});

// El rastreo de visitantes lo dispara el navegador solo, varias veces por página. Tope
// alto: acá el objetivo no es frenar a un usuario sino a quien intenta inflar la tabla.
export const trackingRateLimit = crearRateLimit({
    limite: () => parseInt(process.env.PUBLIC_TRACK_PER_MIN) || 120,
    nombre: 'tracking'
});

export default apiRateLimit;
