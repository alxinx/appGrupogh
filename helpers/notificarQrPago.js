import dotenv from 'dotenv';
import { COLORES_CORREO as C, SOPORTE_EMAIL } from '../config/marca.js';
import { enviarCorreoSes, REMITENTE_ALERTAS } from './emailSes.js';
import { plantillaSimple, filasDefinicion, fmtFechaLarga } from './plantillaCorreo.js';
dotenv.config();

// Avisos al operador sobre el QR de pago. Son notificaciones de seguridad: si alguien
// cambia el QR por el que los clientes transfieren dinero, el dueño del negocio tiene
// que enterarse aunque el cambio haya sido legítimo.
//
// Hoy el proyecto solo tiene salida por correo (SES). No hay integración de
// WhatsApp saliente — SOPORTE_WHATSAPP es un número que se muestra al cliente, no una
// API. Cuando exista un proveedor (Twilio/Meta Cloud API), se engancha en enviarWhatsapp().

const AVISO_SEGURIDAD = 'Si no realizaste este cambio, contacta soporte inmediatamente.';

const destinatario = () => process.env.QR_ALERTAS_EMAIL || SOPORTE_EMAIL;

// El aviso va con el encabezado sólido (no el rosa suave por defecto) para que se
// distinga de un correo comercial a simple vista: el color lo elige cada llamador según
// la gravedad — rosa de marca si el cambio fue normal, rojo si el QR se comprometió.
const plantilla = ({ titulo, color, lineas }) => plantillaSimple({
    titulo,
    encabezado: { fondo: color, texto: '#ffffff' },
    cuerpoHtml: filasDefinicion(lineas),
    avisoHtml: AVISO_SEGURIDAD
});

// Envío best-effort: un fallo de correo no puede tumbar la subida ya persistida.
// enviarCorreoSes ya atrapa el error del send() y devuelve false (helpers/emailSes.js),
// así que acá solo queda resolver a quién se le avisa.
//
// Remitente propio (alertas@) y no el de empleados: esto es una alerta de seguridad
// sobre el QR por el que entra dinero real, no un aviso de nómina — se filtra y se
// busca distinto en la bandeja del operador.
async function enviar({ subject, html, text }) {
    const to = destinatario();
    if (!to) {
        console.warn('[qr-pago] Sin destinatario de alertas (QR_ALERTAS_EMAIL / SOPORTE_EMAIL). Aviso no enviado:', subject);
        return false;
    }
    return enviarCorreoSes({
        remitente: REMITENTE_ALERTAS,
        destinatario: to,
        asunto: subject,
        texto: text,
        html,
        contexto: 'qr-pago'
    });
}

// Punto de extensión para cuando se conecte un proveedor de WhatsApp saliente.
async function enviarWhatsapp(mensaje) {
    if (!process.env.WHATSAPP_API_URL) return false;
    console.warn('[qr-pago] WHATSAPP_API_URL definido pero sin implementación de envío:', mensaje.slice(0, 80));
    return false;
}

/** Se actualizó el QR de pago de una entidad. */
export async function notificarQrActualizado({ nombreEntidad, usuario, fecha, reemplazo }) {
    const cuando = fmtFechaLarga(fecha);
    const quien  = usuario
        ? `${usuario.nombreUsuario || ''} ${usuario.apellidoUsuario || ''}`.trim() + ` (${usuario.emailUsuario})`
        : 'Usuario desconocido';

    const subject = `QR de pago actualizado — ${nombreEntidad}`;
    const text    = `Se actualizó el QR de pago de ${nombreEntidad}.\nRealizado por: ${quien}\nFecha: ${cuando}\n\n${AVISO_SEGURIDAD}`;

    const html = plantilla({
        titulo: 'Se actualizó un QR de pago',
        color: C.primary,
        lineas: [
            ['Entidad', nombreEntidad],
            ['Realizado por', quien],
            ['Fecha', cuando],
            ['Tipo de cambio', reemplazo ? 'Reemplazo de un QR anterior' : 'Primera carga'],
        ]
    });

    const [okMail] = await Promise.all([enviar({ subject, html, text }), enviarWhatsapp(text)]);
    return okMail;
}

/** El hash del objeto en R2 dejó de coincidir con el guardado: el QR se marcó como comprometido. */
export async function notificarQrComprometido({ nombreEntidad, idEntidad, motivo }) {
    const cuando  = fmtFechaLarga(new Date());
    const subject = `⚠️ ALERTA: QR de pago deshabilitado — ${nombreEntidad}`;
    const text    = `El QR de pago de ${nombreEntidad} (id ${idEntidad}) fue deshabilitado automáticamente.\nMotivo: ${motivo}\nFecha: ${cuando}\n\n${AVISO_SEGURIDAD}`;

    const html = plantilla({
        titulo: '⚠️ QR de pago deshabilitado automáticamente',
        color: C.alerta,
        lineas: [
            ['Entidad', `${nombreEntidad} (id ${idEntidad})`],
            ['Motivo', motivo],
            ['Fecha', cuando],
            ['Estado', 'compromised — ya no se sirve a los clientes'],
        ]
    });

    const [okMail] = await Promise.all([enviar({ subject, html, text }), enviarWhatsapp(text)]);
    return okMail;
}
