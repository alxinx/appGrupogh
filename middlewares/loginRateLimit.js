// Freno de fuerza bruta para el login. Mismo patrón que verificarCodigoEmpleado.js del POS
// —contador en memoria, ventana, mensaje genérico— pero con dos ejes en vez de uno:
//
//   · por IP     → frena a quien prueba muchas contraseñas contra muchas cuentas.
//   · por correo → frena a quien prueba muchas contraseñas contra UNA cuenta desde
//                  varias IP (proxies rotativos, botnets).
//
// Hacen falta los dos: solo por IP se evade rotando salidas, y solo por correo un atacante
// puede dejar afuera a un usuario legítimo a propósito. Con ambos, para bloquear a alguien
// hay que quemar también su propia IP.
//
// El contador vive en el proceso, igual que el resto de limitadores del proyecto. Si la app
// llega a correr en más de una instancia, el límite real se multiplica por el número de
// procesos y hay que moverlo a un almacén compartido (ver CLAUDE.md § 5.5).

const MAX        = 5;
const VENTANA_MS = 15 * 60 * 1000;

// Map<clave, { count, primeraFalla }>  — la clave lleva prefijo 'ip:' o 'mail:'
const intentos = new Map();

const limpiarVencidos = () => {
    const ahora = Date.now();
    for (const [clave, reg] of intentos) {
        if (ahora - reg.primeraFalla > VENTANA_MS) intentos.delete(clave);
    }
};
setInterval(limpiarVencidos, VENTANA_MS).unref?.();

const clavesDe = (req) => {
    const ip     = req.ip || req.socket?.remoteAddress || 'desconocida';
    const correo = String(req.body?.emailUsuario || '').trim().toLowerCase();
    // Sin correo solo se vigila la IP; el validador rechazará la petición igual.
    return correo ? [`ip:${ip}`, `mail:${correo}`] : [`ip:${ip}`];
};

/** Segundos que faltan para que se libere la clave más restrictiva, o 0 si no hay bloqueo. */
const segundosBloqueo = (claves) => {
    const ahora = Date.now();
    let espera = 0;
    for (const clave of claves) {
        const reg = intentos.get(clave);
        if (!reg) continue;
        if (ahora - reg.primeraFalla > VENTANA_MS) { intentos.delete(clave); continue; }
        if (reg.count >= MAX) {
            espera = Math.max(espera, Math.ceil((reg.primeraFalla + VENTANA_MS - ahora) / 1000));
        }
    }
    return espera;
};

/** Suma un intento fallido a los dos ejes. Lo llama el controlador, no el middleware: */
/** solo cuentan los fallos reales, no cada visita al formulario.                     */
export const registrarFalloLogin = (req) => {
    const ahora = Date.now();
    for (const clave of clavesDe(req)) {
        const reg = intentos.get(clave);
        if (!reg || ahora - reg.primeraFalla > VENTANA_MS) {
            intentos.set(clave, { count: 1, primeraFalla: ahora });
        } else {
            reg.count++;
        }
    }
};

/** Login exitoso: se limpian los contadores para que un error previo no penalice después. */
export const limpiarIntentosLogin = (req) => {
    for (const clave of clavesDe(req)) intentos.delete(clave);
};

/** Cuántos intentos le quedan a la clave más castigada (para avisar antes del bloqueo). */
export const intentosRestantes = (req) => {
    const ahora = Date.now();
    let usados = 0;
    for (const clave of clavesDe(req)) {
        const reg = intentos.get(clave);
        if (reg && ahora - reg.primeraFalla <= VENTANA_MS) usados = Math.max(usados, reg.count);
    }
    return Math.max(0, MAX - usados);
};

const loginRateLimit = (req, res, next) => {
    const espera = segundosBloqueo(clavesDe(req));
    if (!espera) return next();

    const minutos = Math.ceil(espera / 60);
    console.warn(`[login] bloqueado por exceso de intentos · ip=${req.ip} · correo=${String(req.body?.emailUsuario || '(vacío)').trim().toLowerCase()}`);

    res.set('Retry-After', String(espera));
    return res.status(429).render('./auth/login', {
        titulo: 'Login',
        csrfToken: req.csrfToken(),
        errores: { msg: `Demasiados intentos fallidos. Volvé a intentar en ${minutos} minuto${minutos !== 1 ? 's' : ''}.` }
    });
};

export default loginRateLimit;
