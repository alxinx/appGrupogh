import { PORTAL_URL } from '../config/marca.js';
import { enviarCorreoSes, REMITENTE_EMPLEADOS } from './emailSes.js';
import { plantillaMarca, ICONO_CORREO, filaCorreo, botonCorreo, avisoCorreo } from './plantillaCorreo.js';
// La misma función que usa el navegador: pura, sin DOM, una sola copia.
import { escaparHtml } from '../src/js/escaparHtml.js';

// "Olvidé mi contraseña": el enlace para poner una nueva. Diseño de marca (plantillaMarca,
// el de la confirmación de pedido). Devuelve true/false y nunca lanza (enviarCorreoSes).
export async function enviarRecuperacionContrasena({ to, nombre, token, minutos }) {
    const url = `${PORTAL_URL}/restablecer/${token}`;
    const nombreSeguro = escaparHtml(nombre || '');

    const filasHtml = [
        filaCorreo(`<div style="text-align:center;padding-top:4px;">${botonCorreo(url, 'Crear nueva contraseña')}</div>`, { arriba: 24 }),
        filaCorreo(`
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ece8f3;border-radius:12px;">
                <tr><td style="padding:14px 16px;font-family:Helvetica,Arial,sans-serif;">
                    <p style="margin:0 0 4px;font-size:12.5px;font-weight:700;color:#241f38;">¿El botón no abre?</p>
                    <p style="margin:0;font-size:12px;color:#8a84a0;line-height:1.5;">Copia este enlace en tu navegador:</p>
                    <p style="margin:6px 0 0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${url}" style="color:#E24C95;text-decoration:none;">${url}</a></p>
                </td></tr>
            </table>`),
        filaCorreo(avisoCorreo('¿No fuiste tú?',
            `Si no pediste cambiar tu contraseña, ignora este correo: tu contraseña actual sigue funcionando y nadie puede usar este enlace sin tu correo.`))
    ].join('');

    const html = plantillaMarca({
        icono: { simbolo: '&#128273;', ...ICONO_CORREO.marca },
        titulo: 'Crea tu nueva contraseña',
        saludo: nombreSeguro ? `Hola ${nombreSeguro} &#128075;` : null,
        intro: `Recibimos una solicitud para recuperar el acceso a tu cuenta. El enlace sirve una sola vez y vence en ${minutos} minutos.`,
        filasHtml
    });

    const texto = `Hola ${nombre || ''}.\n\n`
        + `Para crear una nueva contraseña entra a este enlace (sirve una sola vez y vence en ${minutos} minutos):\n${url}\n\n`
        + `Si no lo pediste, ignora este correo: tu contraseña actual sigue funcionando.`;

    return enviarCorreoSes({
        remitente: REMITENTE_EMPLEADOS, destinatario: to,
        asunto: 'Recupera tu contraseña', html, texto, contexto: 'recuperar-contrasena'
    });
}
