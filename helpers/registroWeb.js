import { ipDe } from '../middlewares/apiRateLimit.js';
import { PATRON_EMAIL } from './catalogos.js';

// Lo común a los formularios públicos de registro (clientes y proveedores, en grupogh.co/
// formularios/*): llegan de internet sin sesión, así que cada campo se limpia y se revalida
// acá, con las mismas reglas en los dos. Lo propio de cada uno vive en su controlador.

/** Texto de un campo: sin caracteres de control y sin espacios de los bordes. */
export const texto = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '');

/**
 * Colapsa variantes decorativas de Unicode de vuelta a su letra base — el caso real es el
 * teclado de celular con "texto elegante" activado, que escribe con el bloque Mathematical
 * Alphanumeric Symbols ("𝑫𝒊𝒆𝒈𝒐" en vez de "Diego"). Quien lo activó sin saberlo (frecuente
 * en adultos mayores) no tiene forma de notar el problema ni de corregirlo, así que la
 * corrección es automática y silenciosa — nunca se le pide que "arregle" el campo.
 *
 * Se aplica DESPUÉS de texto() y ANTES de validar con una regex de nombre
 * (RE_NOMBRE/RE_RAZON_SOCIAL): esas regex siguen siendo la única garantía real contra un
 * campo sin ninguna letra válida (su \p{L} inicial no se cumple si no queda ninguna letra
 * tras normalizar) — no hace falta una segunda comprobación de \p{L} en el controlador.
 */
export const normalizarTexto = (v) => String(v ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
export const esVerdadero = (v) => v === true || v === 'true' || v === 'on' || v === '1';

export const RE_NOMBRE       = /^[\p{L}][\p{L} '.-]{0,99}$/u;
export const RE_RAZON_SOCIAL = /^[\p{L}\p{N}][\p{L}\p{N} .,&'()/-]{1,199}$/u;
export const RE_EMAIL        = new RegExp(PATRON_EMAIL);
// Una dirección no lleva marcado ni plantillas: sin < > { } ` no puede volverse HTML.
const RE_DIRECCION_PROHIBIDO = /[<>{}`]/;
export const RE_CELULAR      = /^3\d{9}$/;

/** Correo en minúsculas, o `{ error }`. */
export function validarEmailWeb(valor) {
    const email = texto(valor).toLowerCase();
    if (email.length > 150 || !RE_EMAIL.test(email)) return { error: 'Ingresa un correo electrónico válido.' };
    return { email };
}

/**
 * Celular del selector de país del checkout. Uno colombiano se guarda con sus 10 dígitos,
 * como los del POS y la importación; uno de otro país, en formato internacional
 * (+indicativo número) para que no se confunda con un número local.
 * @returns `{ telefono, colombiano }` o `{ error }`
 */
export function validarCelularWeb(indicativoEntrada, numeroEntrada) {
    const indicativo = texto(indicativoEntrada || '57').replace(/\D/g, '');
    if (!/^\d{1,4}$/.test(indicativo)) return { error: 'Indicativo de país inválido.' };
    const numero = texto(numeroEntrada).replace(/\D/g, '');
    if (indicativo === '57') {
        const telefono = numero.replace(/^57(?=3\d{9}$)/, '');
        if (!RE_CELULAR.test(telefono)) return { error: 'Ingresa un celular de 10 dígitos que empiece por 3.' };
        return { telefono, colombiano: true };
    }
    if (!/^\d{6,14}$/.test(numero) || (indicativo + numero).length > 15) {
        return { error: 'Revisa el número de celular: sin el indicativo, entre 6 y 14 dígitos.' };
    }
    return { telefono: `+${indicativo}${numero}`, colombiano: false };
}

/** Dirección completa, o `{ error }`. */
export function validarDireccionWeb(valor) {
    const direccion = texto(valor);
    if (direccion.length < 5 || direccion.length > 250) return { error: 'Ingresa la dirección completa.' };
    if (RE_DIRECCION_PROHIBIDO.test(direccion)) return { error: 'La dirección tiene caracteres no permitidos.' };
    return { direccion };
}

/** Los datos de quién aceptó, para la constancia de la autorización (Ley 1581). */
export const origenConstancia = (req) => ({
    ip:        String(ipDe(req)).slice(0, 45),
    userAgent: String(req.get('user-agent') || '').slice(0, 255) || null
});

/** Campo trampa: invisible para una persona; un bot que rellena todo lo completa. */
export function cayoEnTrampa(req, contexto) {
    if (!texto(req.body?.sitio_web)) return false;
    console.warn(`[${contexto}] campo trampa lleno · ip=${ipDe(req)}`);
    return true;
}
