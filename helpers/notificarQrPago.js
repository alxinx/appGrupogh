import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

// Avisos al operador sobre el QR de pago. Son notificaciones de seguridad: si alguien
// cambia el QR por el que los clientes transfieren dinero, el dueño del negocio tiene
// que enterarse aunque el cambio haya sido legítimo.
//
// Hoy el proyecto solo tiene salida por correo (nodemailer). No hay integración de
// WhatsApp saliente — SOPORTE_WHATSAPP es un número que se muestra al cliente, no una
// API. Cuando exista un proveedor (Twilio/Meta Cloud API), se engancha en enviarWhatsapp().

const AVISO_SEGURIDAD = 'Si no realizaste este cambio, contacta soporte inmediatamente.';

const destinatario = () => process.env.QR_ALERTAS_EMAIL || process.env.SOPORTE_EMAIL;

const transporte = () => nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
    }
});

const fechaLegible = (fecha) =>
    new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Bogota'
    }).format(fecha);

function plantilla({ titulo, color, lineas }) {
    const filas = lineas
        .map(([etiqueta, valor]) => `
            <tr>
                <td style="padding:8px 0;color:#64748b;font-size:14px;">${etiqueta}</td>
                <td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${valor}</td>
            </tr>`)
        .join('');

    return `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#f8fafc;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
    <div style="background:${color};padding:24px;">
      <h1 style="margin:0;color:#ffffff;font-size:19px;">${titulo}</h1>
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;">${filas}</table>
      <p style="margin:24px 0 0;padding:14px;background:#fef2f2;border-left:4px solid #ef4444;color:#991b1b;font-size:14px;font-weight:700;">
        ${AVISO_SEGURIDAD}
      </p>
    </div>
  </div>
</body></html>`;
}

// Envío best-effort: un fallo de correo no puede tumbar la subida ya persistida.
async function enviar({ subject, html, text }) {
    const to = destinatario();
    if (!to) {
        console.warn('[qr-pago] Sin destinatario de alertas (QR_ALERTAS_EMAIL / SOPORTE_EMAIL). Aviso no enviado:', subject);
        return false;
    }
    try {
        await transporte().sendMail({ from: process.env.APP_NAME, to, subject, text, html });
        return true;
    } catch (e) {
        console.error('[qr-pago] No se pudo enviar el aviso por correo:', e.message);
        return false;
    }
}

// Punto de extensión para cuando se conecte un proveedor de WhatsApp saliente.
async function enviarWhatsapp(mensaje) {
    if (!process.env.WHATSAPP_API_URL) return false;
    console.warn('[qr-pago] WHATSAPP_API_URL definido pero sin implementación de envío:', mensaje.slice(0, 80));
    return false;
}

/** Se actualizó el QR de pago de una entidad. */
export async function notificarQrActualizado({ nombreEntidad, usuario, fecha, reemplazo }) {
    const cuando = fechaLegible(fecha);
    const quien  = usuario
        ? `${usuario.nombreUsuario || ''} ${usuario.apellidoUsuario || ''}`.trim() + ` (${usuario.emailUsuario})`
        : 'Usuario desconocido';

    const subject = `QR de pago actualizado — ${nombreEntidad}`;
    const text    = `Se actualizó el QR de pago de ${nombreEntidad}.\nRealizado por: ${quien}\nFecha: ${cuando}\n\n${AVISO_SEGURIDAD}`;

    const html = plantilla({
        titulo: 'Se actualizó un QR de pago',
        color: '#EC5FA3',
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
    const cuando  = fechaLegible(new Date());
    const subject = `⚠️ ALERTA: QR de pago deshabilitado — ${nombreEntidad}`;
    const text    = `El QR de pago de ${nombreEntidad} (id ${idEntidad}) fue deshabilitado automáticamente.\nMotivo: ${motivo}\nFecha: ${cuando}\n\n${AVISO_SEGURIDAD}`;

    const html = plantilla({
        titulo: '⚠️ QR de pago deshabilitado automáticamente',
        color: '#dc2626',
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
