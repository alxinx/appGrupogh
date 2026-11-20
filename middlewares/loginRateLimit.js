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

// Contador genérico: N intentos por clave en una ventana. Lo usan el login, "Olvidé mi
// contraseña" y "Cambiar contraseña" (controller/loginControllers.js), cada uno con su
// propio Map, su tope y sus claves — una sola implementación del freno, no tres.
//
// `claves(req)` devuelve las claves a vigilar (con prefijo, p. ej. 'ip:…', 'mail:…'): se
// bloquea si CUALQUIERA llegó al tope.
export function crearLimitador({ max, ventanaMs, claves }) {
    const intentos = new Map();   // Map<clave, { count, primeraFalla }>

    setInterval(() => {
        const ahora = Date.now();
        for (const [clave, reg] of intentos) {
            if (ahora - reg.primeraFalla > ventanaMs) intentos.delete(clave);
        }
    }, ventanaMs).unref?.();

    return {
        /** Segundos que faltan para que se libere la clave más restrictiva, o 0 si no hay bloqueo. */
        segundosBloqueo(req) {
            const ahora = Date.now();
            let espera = 0;
            for (const clave of claves(req)) {
                const reg = intentos.get(clave);
                if (!reg) continue;
                if (ahora - reg.primeraFalla > ventanaMs) { intentos.delete(clave); continue; }
                if (reg.count >= max) espera = Math.max(espera, Math.ceil((reg.primeraFalla + ventanaMs - ahora) / 1000));
            }
            return espera;
        },
        /** Suma un intento a todas las claves. */
        registrar(req) {
            const ahora = Date.now();
            for (const clave of claves(req)) {
                const reg = intentos.get(clave);
                if (!reg || ahora - reg.primeraFalla > ventanaMs) intentos.set(clave, { count: 1, primeraFalla: ahora });
                else reg.count++;
            }
        },
        limpiar(req) { for (const clave of claves(req)) intentos.delete(clave); },
        /** Cuántos intentos le quedan a la clave más castigada. */
        restantes(req) {
            const ahora = Date.now();
            let usados = 0;
            for (const clave of claves(req)) {
                const reg = intentos.get(clave);
                if (reg && ahora - reg.primeraFalla <= ventanaMs) usados = Math.max(usados, reg.count);
            }
            return Math.max(0, max - usados);
        }
    };
}

/** "3 minutos" a partir de segundos de espera. */
export const textoEspera = (segundos) => {
    const minutos = Math.ceil(segundos / 60);
    return `${minutos} minuto${minutos !== 1 ? 's' : ''}`;
};

const ipDe = (req) => req.ip || req.socket?.remoteAddress || 'desconocida';
const correoDe = (req) => String(req.body?.emailUsuario || '').trim().toLowerCase();

// Sin correo solo se vigila la IP; el validador rechazará la petición igual.
export const clavesIpYCorreo = (req) => {
    const correo = correoDe(req);
    return correo ? [`ip:${ipDe(req)}`, `mail:${correo}`] : [`ip:${ipDe(req)}`];
};

const limitadorLogin = crearLimitador({ max: 5, ventanaMs: 15 * 60 * 1000, claves: clavesIpYCorreo });

/** Suma un intento fallido a los dos ejes. Lo llama el controlador, no el middleware: */
/** solo cuentan los fallos reales, no cada visita al formulario.                     */
export const registrarFalloLogin = (req) => limitadorLogin.registrar(req);

/** Login exitoso: se limpian los contadores para que un error previo no penalice después. */
export const limpiarIntentosLogin = (req) => limitadorLogin.limpiar(req);

/** Cuántos intentos le quedan a la clave más castigada (para avisar antes del bloqueo). */
export const intentosRestantes = (req) => limitadorLogin.restantes(req);

const loginRateLimit = (req, res, next) => {
    const espera = limitadorLogin.segundosBloqueo(req);
    if (!espera) return next();

    console.warn(`[login] bloqueado por exceso de intentos · ip=${req.ip} · correo=${String(req.body?.emailUsuario || '(vacío)').trim().toLowerCase()}`);

    res.set('Retry-After', String(espera));
    return res.status(429).render('./auth/login', {
        titulo: 'Login',
        errores: { msg: `Demasiados intentos fallidos. Vuelve a intentar en ${textoEspera(espera)}.` }
    });
};

export default loginRateLimit;
