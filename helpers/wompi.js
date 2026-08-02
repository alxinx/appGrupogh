import crypto from 'crypto';

// Algoritmo verificado contra la documentación oficial de Wompi (docs.wompi.co) —
// no se debe modificar sin volver a confirmar ahí, un error acá deja pasar pagos falsificados.

const WOMPI_BASE_URL = process.env.WOMPI_BASE_URL || 'https://sandbox.wompi.co/v1';
const PUBLIC_KEY = process.env.PUBLIC_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const INTEGRITY_SECRET = process.env.TEST_INTEGRITY || process.env.INTEGRITY_SECRET;
const EVENTS_SECRET = process.env.TEST_EVENTS || process.env.EVENTS_SECRET;

export function getPublicKey() {
    return PUBLIC_KEY;
}

export function getCheckoutBaseUrl() {
    return 'https://checkout.wompi.co/p/';
}

// Firma de integridad para el Web Checkout: SHA256(reference + amountInCents + currency + integritySecret)
export function generarFirmaIntegridad(reference, amountInCents, currency = 'COP') {
    const cadena = `${reference}${amountInCents}${currency}${INTEGRITY_SECRET}`;
    return crypto.createHash('sha256').update(cadena).digest('hex');
}

// Resuelve un path tipo "transaction.id" contra un objeto anidado.
function resolverPath(obj, path) {
    return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

// Checksum del webhook: concatenación de los valores en signature.properties (en ese orden)
// + timestamp + events secret, todo a SHA256. Se compara sin distinguir mayúsculas/minúsculas.
export function verificarChecksumWebhook(payload) {
    const { data, signature } = payload || {};
    if (!data || !signature?.properties || !signature?.checksum || signature?.timestamp == null) {
        return false;
    }

    const valores = signature.properties.map(prop => {
        const valor = resolverPath(data, prop);
        return valor == null ? '' : String(valor);
    });

    const cadena = valores.join('') + String(signature.timestamp) + EVENTS_SECRET;
    const checksumCalculado = crypto.createHash('sha256').update(cadena).digest('hex');

    return checksumCalculado.toLowerCase() === String(signature.checksum).toLowerCase();
}

// Consulta el estado real de una transacción directamente en Wompi (para la reconciliación).
export async function consultarTransaccion(idTransaccionWompi) {
    const res = await fetch(`${WOMPI_BASE_URL}/transactions/${idTransaccionWompi}`, {
        headers: { Authorization: `Bearer ${PUBLIC_KEY}` }
    });
    if (!res.ok) throw new Error(`Wompi respondió ${res.status} al consultar la transacción ${idTransaccionWompi}`);
    const { data } = await res.json();
    return data;
}
